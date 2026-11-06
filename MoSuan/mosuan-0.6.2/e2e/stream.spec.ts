import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openSettings } from './helpers/navigation';

const delta = (content: string) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
async function fixture(page: Page, frames: { delay: number; data: string }[], holdOpen = false) {
  let disconnected = false;
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    req.resume();
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.flushHeaders();
    res.on('close', () => { disconnected = true; });
    for (const frame of frames) {
      if (frame.delay) await new Promise(r => setTimeout(r, frame.delay));
      if (res.destroyed) return;
      // Real socket writes, rather than a single buffered route.fulfill response.
      res.write(frame.data);
    }
    if (!holdOpen) res.end();
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/stream`;
  await page.route('**/api/status', r => r.fulfill({ json: { configured: true, model: 'deepseek-chat' } }));
  await page.route('**/api/chat', r => r.fulfill({ status: 307, headers: { location: url } }));
  return { disconnected: () => disconnected, close: async () => { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); } };
}

test('real streamed chunks show pending math, checkpoint it and complete it', async ({ page }) => {
  const f = await fixture(page, [
    { delay: 0, data: delta('实时推导：\\[\\frac{') },
    { delay: 2600, data: delta('x^2}{2}\\]') },
    { delay: 100, data: 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: {"usage":{"total_tokens":27}}\n\ndata: [DONE]\n\n' },
  ]);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: '新的学习对话' }).click();
    await page.getByLabel('输入问题').fill('实时流验证');
    await page.getByRole('button', { name: '发送问题' }).click();
    await expect(page.locator('.math-pending')).toBeVisible();
    await expect(page.getByRole('button', { name: '停止生成' })).toBeVisible();
    await expect(page.locator('.notebook-entry.active .notebook-more')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => new Promise<boolean>(resolve => {
      const req = indexedDB.open('mosuan-reader', 1);
      req.onsuccess = () => {
        const db = req.result; const read = db.transaction('notebooks').objectStore('notebooks').getAll();
        read.onsuccess = () => { resolve(read.result.some(b => b.messages.some((m: { content: string; state?: string }) => m.content.includes('实时推导') && m.state === 'stopped'))); db.close(); };
      };
    }))).toBe(true);
    await expect(page.locator('.composer-foot')).toContainText('27 tokens');
    await expect(page.locator('.math-pending')).toHaveCount(0);
    await expect(page.locator('.katex-display')).toBeVisible();
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('button', { name: '跳到末尾' }).click();
    await expect(page.locator('.katex-display')).toBeVisible();
  } finally { await f.close(); }
});

test('stop aborts a live socket and keeps partial response after refresh', async ({ page }) => {
  const f = await fixture(page, [{ delay: 0, data: delta('已收到的部分内容，保留未闭合公式 \\[x^2') }], true);
  try {
    await page.goto('/'); await page.getByRole('button', { name: '新的学习对话' }).click();
    await page.getByLabel('输入问题').fill('停止验证');
    await page.getByRole('button', { name: '发送问题' }).click();
    await expect(page.locator('.math-pending')).toBeVisible();
    await page.getByRole('button', { name: '停止生成' }).click();
    await expect(page.getByRole('alert')).toContainText('已停止');
    await expect.poll(f.disconnected).toBe(true);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await page.getByRole('button', { name: '跳到末尾' }).click();
    await expect(page.locator('.prose').filter({ hasText: '已收到的部分内容' })).toBeVisible();
    await expect(page.locator('.message-heading')).toContainText(['我的问题', '输出未完成']);
  } finally { await f.close(); }
});

test('HTTP errors preserve the question and do not leave generation running', async ({ page }) => {
  await page.route('**/api/status', r => r.fulfill({ json: { configured: true, model: 'deepseek-chat' } }));
  await page.route('**/api/chat', r => r.fulfill({ status: 503, json: { error: '模拟服务不可用' } }));
  await page.goto('/'); await page.getByRole('button', { name: '新的学习对话' }).click();
  await page.getByLabel('输入问题').fill('保留这个问题'); await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.getByRole('alert')).toContainText('模拟服务不可用');
  await expect(page.getByLabel('输入问题')).toHaveValue('保留这个问题');
  await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
});

test('long equations scroll inside mobile viewport and LAN UUID fallback works', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { Object.defineProperty(crypto, 'randomUUID', { value: undefined }); });
  await page.goto('/');
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await page.getByLabel('笔记标题').fill('长公式验证');
  await page.getByLabel('Markdown / LaTeX 原文').fill('$$' + Array.from({ length: 35 }, (_, i) => `x^{${i}}`).join('+') + '$$');
  await page.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.katex-display')).toBeVisible();
  const box = page.locator('.math-block');
  expect(await box.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await box.evaluate(el => { el.scrollLeft = 150; });
  expect(await box.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
});


test('MathJax completes a formula across real streamed chunks and restores it', async ({ page }) => {
  const f = await fixture(page, [
    { delay: 0, data: delta('MathJax 流式推导：\\[\\frac{') },
    { delay: 1800, data: delta('x^2}{2}\\]') },
    { delay: 100, data: 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' },
  ]);
  try {
    await page.goto('/'); await openSettings(page);
    await page.getByRole('button', { name: /^MathJax/ }).click();
    await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '新的学习对话' }).click();
    await page.getByLabel('输入问题').fill('MathJax 流式测试'); await page.getByRole('button', { name: '发送问题' }).click();
    await expect(page.locator('.math-pending')).toBeVisible();
    await expect(page.locator('.mathjax-display svg')).toBeVisible();
    await expect(page.locator('.math-pending')).toHaveCount(0);
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload(); await page.getByRole('button', { name: '跳到末尾' }).click();
    await expect(page.locator('.mathjax-display svg')).toBeVisible();
  } finally { await f.close(); }
});
