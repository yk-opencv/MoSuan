import { test, expect, type Page } from '@playwright/test';
import { conversationAction } from './helpers/navigation';
import { readFile } from 'node:fs/promises';

const title = '分享:积分/讲义';
const question = String.raw`求 $\int_0^1 x\,dx$。`;
const answer = Array.from({ length: 90 }, (_, i) => `## 推导 ${i + 1}\n\n` + String.raw`\[\int_0^1 x\,dx=\frac12\]`).join('\n\n') + '\n\n完整末尾：不是只有可见阅读块。';
const partial = String.raw`未完成的公式 $\frac{`;
const expected = `# ${title}\n\n## 我的问题\n\n${question}\n\n---\n\n## 学习笔记\n\n${answer}\n\n---\n\n## 学习笔记（输出未完成）\n\n${partial}`;

async function openShare(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(({ title, question, answer, partial }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mosuan-reader', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('notebooks', 'readwrite'); const store = tx.objectStore('notebooks');
      store.put({ id: 'DO_NOT_SHARE_INTERNAL_ID', title, updated: Date.now() + 10000, pinned: true, messages: [
        { id: 'q', role: 'user', content: question },
        { id: 'a', role: 'assistant', content: answer },
        { id: 's', role: 'assistant', content: partial, state: 'stopped' },
      ] });
      store.put({ id: 'private', title: '另一段私人对话', updated: 1, messages: [{ id: 'p', role: 'assistant', content: 'DO_NOT_SHARE_OTHER_CONVERSATION' }] });
      tx.oncomplete = () => { sessionStorage.setItem('mosuan-active-book', 'DO_NOT_SHARE_INTERNAL_ID'); db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    }; request.onerror = () => reject(request.error);
  }), { title, question, answer, partial });
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText(title);
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await conversationAction(page, '分享对话');
  await expect(page.getByRole('dialog', { name: '分享对话', exact: true })).toBeVisible();
}

test('copy and downloaded file preserve full formulas, roles and completion state', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__copied = text; } } });
  });
  await openShare(page);
  await expect(page.getByRole('textbox', { name: '分享内容', exact: true })).toHaveValue(expected);
  await page.getByRole('button', { name: '复制对话', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已复制整段对话');
  const copied = await page.evaluate(() => (window as any).__copied);
  expect(copied).toBe(expected);
  expect(copied).not.toContain('DO_NOT_SHARE_');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载分享文件' }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('分享_积分_讲义.md');
  expect(await readFile((await file.path())!, 'utf8')).toBe(expected);
  await page.screenshot({ path: 'artifacts/verification/share-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '关闭分享' }).click();
  await expect(page.locator('.notebook-entry.active .notebook-more')).toBeFocused();
  await page.getByRole('button', { name: '新的学习对话' }).click();
  await page.locator('.notebook-entry.active .notebook-more').click();
  await expect(page.getByRole('menuitem', { name: '分享对话', exact: true })).toBeDisabled();
});

test('missing native APIs on mobile allow manual copy and downloadable sharing', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openShare(page);
  await expect(page.getByRole('button', { name: '系统分享', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '复制对话', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已选中全部内容');
  expect(await page.getByRole('textbox', { name: '分享内容', exact: true }).evaluate((area: HTMLTextAreaElement) => [area.selectionStart, area.selectionEnd])).toEqual([0, expected.length]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/share-mobile.png', fullPage: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '分享对话', exact: true })).toHaveCount(0);
});

for (const supportsFiles of [true, false]) {
  test(`system share ${supportsFiles ? 'sends full Markdown file' : 'falls back to full text'}`, async ({ page }) => {
    await page.addInitScript(({ supportsFiles }) => {
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: (data: ShareData) => data.files ? supportsFiles : true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
        (window as any).__shared = { title: data.title, text: data.text, fileName: data.files?.[0].name, fileText: data.files ? await data.files[0].text() : undefined };
      } });
    }, { supportsFiles });
    await openShare(page);
    await page.getByRole('button', { name: '系统分享', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已交给系统分享');
    const shared = await page.evaluate(() => (window as any).__shared);
    expect(shared.title).toBe(title);
    expect(supportsFiles ? shared.fileText : shared.text).toBe(expected);
    if (supportsFiles) expect(shared.fileName).toBe('分享_积分_讲义.md');
  });
}

test('native cancellation and permission failures retain copy and download options', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Cancelled', 'AbortError'); } });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new DOMException('Denied', 'NotAllowedError'); } } });
  });
  await openShare(page);
  await page.getByRole('button', { name: '系统分享', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('已取消系统分享');
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } }));
  await page.getByRole('button', { name: '系统分享', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('系统分享未完成');
  await page.getByRole('button', { name: '复制对话', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('无法自动复制');
  await expect(page.getByRole('textbox', { name: '分享内容', exact: true })).toHaveValue(expected);
  await expect(page.getByRole('button', { name: '下载分享文件' })).toBeEnabled();
});
