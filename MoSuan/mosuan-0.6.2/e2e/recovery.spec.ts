import { expect, test } from '@playwright/test';
import { openSidebar } from './helpers/navigation';

test('Android background checkpoint survives reopen; retry and continue reuse the picture and preserve earlier answers', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.CapacitorCustomPlatform = { name: 'android' };
    w.__asks = [];
    const callbacks = new Map<string, (event: any) => void>();
    // Prevent the periodic checkpoint from hiding a missing background save.
    const interval = window.setInterval.bind(window);
    window.setInterval = ((task: TimerHandler, delay?: number, ...args: any[]) => interval(task, delay === 1000 ? 60_000 : delay, ...args)) as typeof setInterval;
    w.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: [{ name: 'addListener', rtype: 'callback' }, { name: 'removeListener', rtype: 'promise' }] },
        { name: 'MosuanWeb', methods: ['status', 'ask', 'cancel', 'removeListener'].map(name => ({ name, rtype: 'promise' })).concat([{ name: 'addListener', rtype: 'callback' }]) },
      ],
      nativeCallback: (plugin: string, _method: string, options: { eventName: string }, callback: (event: any) => void) => {
        const key = plugin + ':' + options.eventName;
        callbacks.set(key, callback);
        return key;
      },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (method === 'status') return { available: true, ready: true };
        if (method === 'ask') w.__asks.push(options);
        return {};
      },
    };
    w.__background = () => callbacks.get('App:appStateChange')?.({ isActive: false });
    w.__deliver = (event: any) => callbacks.get('MosuanWeb:webEvent')?.({ id: w.__asks.at(-1).id, ...event });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.composer-model')).toContainText('手机网页直连');
  await openSidebar(page);
  await page.getByRole('button', { name: '新的学习对话' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('新的学习对话');
  const image = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 100;
    canvas.getContext('2d')!.fillText('Integral of x^2', 40, 60);
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByLabel('选择题目图片').setInputFiles({ name: '后台积分题.png', mimeType: 'image/png', buffer: Buffer.from(image, 'base64') });
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await page.getByLabel('输入问题').fill('请推导这道积分题');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__asks.length)).toBe(1);
  const first = await page.evaluate(() => (window as any).__asks[0]);
  await page.evaluate(() => {
    const w = window as any;
    w.__deliver({ kind: 'answer', content: '第一步，应用幂函数积分。' });
    w.__deliver({ kind: 'answer', content: '第一步，应用幂函数积分。已收到的末段 $x^3/3$。' });
    w.__background();
  });
  await expect.poll(() => page.evaluate(async () => {
    const { loadNotebooks } = await import('/src/lib/storage.ts');
    const book = (await loadNotebooks()).find(book => book.title === '请推导这道积分题');
    return book?.messages.at(-1);
  })).toMatchObject({ state: 'stopped', content: '第一步，应用幂函数积分。已收到的末段 $x^3/3$。' });
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('请推导这道积分题');
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect(page.locator('.response-recovery')).toContainText('本机已保存');
  await expect(page.getByRole('button', { name: '从这里继续', exact: true })).toBeInViewport();
  await page.screenshot({ path: 'artifacts/verification/android-recovery-mobile.png' });

  await page.getByLabel('上下文轮数').selectOption('0');
  await page.getByLabel('输入问题').fill('暂存下一道题');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__asks.length)).toBe(1);
  const retry = await page.evaluate(() => (window as any).__asks[0]);
  expect(retry.prompt).toContain('请推导这道积分题');
  expect(retry.prompt).not.toContain('已收到的末段');
  expect(retry.images).toEqual(first.images);
  await page.evaluate(() => (window as any).__deliver({ kind: 'error', message: '模拟断网' }));
  await expect(page.getByRole('alert')).toContainText('模拟断网');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await expect(page.getByLabel('输入问题')).toHaveValue('暂存下一道题');

  await page.getByRole('button', { name: '从这里继续', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__asks.length)).toBe(2);
  const continuation = await page.evaluate(() => (window as any).__asks[1]);
  expect(continuation.prompt).toContain('原问题：\n请推导这道积分题');
  expect(continuation.prompt).toContain('已收到的末段 $x^3/3$');
  expect(continuation.prompt).not.toContain('暂存下一道题');
  expect(continuation.images).toEqual(first.images);
  await page.evaluate(() => (window as any).__deliver({ kind: 'finish', complete: true, content: '代入端点，结果为 $1/3$。' }));
  await expect(page.locator('.save-status')).toContainText('已保存');
  const messages = await page.evaluate(async () => {
    const { loadNotebooks } = await import('/src/lib/storage.ts');
    return (await loadNotebooks()).find(book => book.title === '请推导这道积分题')?.messages;
  });
  expect(messages?.map(message => [message.role, message.state])).toEqual([['user', undefined], ['assistant', 'stopped'], ['assistant', 'error'], ['assistant', 'complete']]);
  expect(messages?.[1].content).toContain('已收到的末段');
  expect(messages?.[3]).toMatchObject({ content: '代入端点，结果为 $1/3$。', recovery: { kind: 'continue', from: messages[1].id } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
