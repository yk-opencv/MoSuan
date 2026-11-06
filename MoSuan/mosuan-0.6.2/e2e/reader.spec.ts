import { test, expect } from '@playwright/test';
import { openSettings } from './helpers/navigation';

test('imports formulas, restores saved text, exports and bounds long-document DOM', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.document-cover h1')).toContainText('幂级数');
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = 430; });
  await page.screenshot({ path: 'test-results/desktop-reader.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await page.getByLabel('笔记标题').fill('我的公式验证');
  await page.getByLabel('Markdown / LaTeX 原文').fill(['# 测试笔记', '', String.raw`\[\frac{1}{1-x}\]`, '', '行内 $x^2$，代码里的公式保留：', '', '```tex', '$x^2$', '```'].join('\n'));
  await page.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('我的公式验证');
  await expect(page.locator('.katex-display')).toHaveCount(1);
  await expect(page.locator('.prose pre')).toContainText('$x^2$');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('我的公式验证');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 Markdown' }).click();
  expect((await download).suggestedFilename()).toBe('我的公式验证.md');
  await openSettings(page);
  await page.getByRole('button', { name: '加载示例' }).click();
  await expect(page.locator('.document-cover h1')).toContainText('120');
  await expect(page.locator('.document-meta')).toContainText(/\d{3,} 个阅读块/);
  const total = Number((await page.locator('.document-meta').innerText()).match(/([\d,]+) 个阅读块/)![1].replaceAll(',', ''));
  expect(total).toBeGreaterThan(100);
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = el.scrollHeight / 2; });
  await expect.poll(() => page.locator('.virtual-row').first().getAttribute('data-index')).not.toBe('0');
  await expect(page.locator('.prose').first()).not.toBeEmpty();
  await openSettings(page);
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.getByLabel('当前字号')).toContainText('17');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await expect.poll(() => page.locator('.virtual-row').evaluateAll(els => els.slice(1).every((el, i) => el.getBoundingClientRect().top >= els[i].getBoundingClientRect().bottom - 1))).toBe(true);
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect.poll(() => page.locator('.virtual-row').last().getAttribute('data-index')).toBe(String(total - 1));
  await expect(page.locator('.reading-end')).toBeInViewport();
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await page.screenshot({ path: 'test-results/stress-reader.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '回到顶部' }).click();
  await expect(page.getByRole('heading', { name: '第 1 组推导', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('mobile layout has no page overflow and navigation works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.katex').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.screenshot({ path: 'test-results/mobile-menu.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-import.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.locator('.sidebar-shade').click({ position: { x: 350, y: 400 } });
  await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = 650; });
  await page.screenshot({ path: 'test-results/mobile-reader.png', fullPage: true, animations: 'disabled' });
});

test('streaming completion, context limit and interrupted generation', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'deepseek-chat' } }));
  let sent: { messages: { role: string; content: string }[]; rounds: number };
  await page.route('**/api/chat', async route => {
    sent = route.request().postDataJSON();
    const events = [
      { context: { characters: 5, historyMessages: 0 } },
      { choices: [{ delta: { content: '积分结果：\\[' } }] },
      { choices: [{ delta: { content: '\\frac{x^2}{2}\\]' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { total_tokens: 42 } },
    ];
    await route.fulfill({ contentType: 'text/event-stream', body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '新的学习对话' }).click();
  await page.getByLabel('上下文轮数').selectOption('0');
  await page.getByLabel('输入问题').fill('求积分');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.locator('.composer-foot')).toContainText('42 tokens');
  expect(sent!.rounds).toBe(0);
  expect(sent!.messages).toEqual([{ role: 'user', content: '求积分' }]);
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.route('**/api/chat', route => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"未完成 \\\\["}}]}\n\n' }));
  await page.getByLabel('输入问题').fill('再试一次');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.getByRole('alert')).toContainText('提前结束');
  await expect(page.getByRole('button', { name: '发送问题' })).toBeVisible();
});
