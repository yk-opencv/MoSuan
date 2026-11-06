import { test, expect, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { conversationAction, openSettings } from './helpers/navigation';

const saved = (page: Page) => expect(page.locator('.save-status')).toContainText('已保存');
async function imported(page: Page, title: string, content: string) {
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  await page.getByLabel('笔记标题').fill(title);
  await page.locator('.source-editor').fill(content);
  await page.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText(title); await saved(page);
  return (await page.locator('.notebook-entry.active').getAttribute('data-book-id'))!;
}

test('tabs synchronize deletion and pinning; stale atomic saves cannot recreate or overwrite records', async ({ page, context }) => {
  await page.goto('/'); await saved(page);
  const id = await imported(page, '跨页复核', '原始内容 $x^2$');
  const other = await context.newPage(); await other.goto('/'); await saved(other);
  await other.evaluate(async id => {
    const storage = await import('/src/lib/storage.ts');
    (window as any).staleBook = (await storage.loadNotebooks()).find(book => book.id === id);
  }, id);
  await conversationAction(page, '置顶对话', id);
  await expect(other.locator(`.notebook-entry[data-book-id="${id}"]`)).toContainText('置顶');
  const staleUpdate = await other.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts');
    try { await storage.saveNotebook({ ...(window as any).staleBook, title: '过期写入' }); return false; }
    catch (error) { return error instanceof storage.NotebookConflict; }
  });
  expect(staleUpdate).toBe(true);
  await conversationAction(page, '删除对话', id);
  await page.getByRole('button', { name: '确认删除', exact: true }).click(); await saved(page);
  await expect(other.locator(`.notebook-entry[data-book-id="${id}"]`)).toHaveCount(0);
  const staleDeletion = await other.evaluate(async () => {
    const storage = await import('/src/lib/storage.ts');
    try { await storage.saveNotebook((window as any).staleBook); return false; }
    catch (error) { return error instanceof storage.NotebookConflict; }
  });
  expect(staleDeletion).toBe(true);
  await other.reload(); await expect(other.locator(`.notebook-entry[data-book-id="${id}"]`)).toHaveCount(0);
});

for (const engine of ['katex', 'mathjax']) test(`font size, context rounds, active conversation and reading anchor survive reload and switching (${engine})`, async ({ page }) => {
  await page.goto('/'); await saved(page);
  const id = await imported(page, '恢复阅读位置', Array.from({ length: 180 }, (_, i) => `## 第 ${i} 步\n\n这是第 ${i} 步的推导 $x_${i}^2=1$。${'对照前一段的定义，确认假设后再化简。'.repeat(10)}\n\n`).join(''));
  await expect(page.locator('.reading-end')).toContainText('思考不停');
  await openSettings(page);
  if (engine === 'mathjax') {
    await page.getByRole('button', { name: /^MathJax/ }).click();
    await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true');
  }
  await page.getByRole('button', { name: '增大字号' }).click();
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.getByLabel('上下文轮数').selectOption('12');
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = el.scrollHeight * 0.45; });
  const anchor = () => page.locator('.reader-scroll').evaluate(el => {
    const top = el.getBoundingClientRect().top;
    const row = [...el.querySelectorAll<HTMLElement>('.virtual-row')].find(row => row.getBoundingClientRect().bottom > top + 1);
    return { key: row?.dataset.rowKey ?? null, offset: row ? Math.round(top - row.getBoundingClientRect().top) : 0 };
  });
  await expect.poll(async () => (await anchor()).key).not.toBeNull();
  await page.waitForTimeout(700);
  const before = await anchor();
  await page.reload(); await expect(page.locator('.document-cover h1')).toHaveText('恢复阅读位置');
  await expect(page.getByLabel('上下文轮数')).toHaveValue('12');
  await expect(page.locator('.reader-scroll')).toHaveCSS('--reader-font', '17px');
  if (engine === 'mathjax') await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  await expect.poll(async () => (await anchor()).key).toBe(before.key);
  await expect.poll(async () => Math.abs((await anchor()).offset - before.offset)).toBeLessThan(3);
  await page.getByRole('button', { name: '新的学习对话' }).click(); await saved(page);
  await page.locator(`.notebook-entry[data-book-id="${id}"] .notebook`).click();
  await expect.poll(async () => (await anchor()).key).toBe(before.key);
  await expect.poll(async () => Math.abs((await anchor()).offset - before.offset)).toBeLessThan(3);
});

for (const engine of ['katex', 'mathjax']) test(`dense list formulas remain bounded, scroll to the end and retain bold formatting on mobile (${engine})`, async ({ page }) => {
  await page.goto('/'); await saved(page);
  if (engine === 'mathjax') {
    await openSettings(page); await page.getByRole('button', { name: /^MathJax/ }).click();
    await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '关闭窗口' }).click();
  }
  await imported(page, '密集公式', '- **' + Array.from({ length: 400 }, (_, i) => `结论 $x_{${i}}^2+y_{${i}}^2=1$。`).join('') + '**\n- 最后一步');
  await page.screenshot({ path: `artifacts/verification/reliability-dense-${engine}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(el => el.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  const check = async () => {
    expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
    expect(await page.locator('.virtual-row').evaluateAll(rows => rows.every(row => row.querySelectorAll('.katex,.mathjax-svg').length <= 8))).toBe(true);
    expect(await page.locator('.virtual-document').evaluate(el => el.querySelectorAll('*').length)).toBeLessThan(10000);
    expect(await page.locator('.prose').evaluateAll(nodes => nodes.every(node => !node.textContent?.includes('**')))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await check();
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = el.scrollHeight / 2; }); await check();
  await page.screenshot({ path: `artifacts/verification/reliability-dense-${engine}-mobile.png` });
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect(page.getByText('最后一步', { exact: true })).toBeInViewport(); await check();
  await page.screenshot({ path: 'artifacts/verification/reliability-dense-mobile.png' });
});

test('deletion during generation preserves received content in a conflict copy', async ({ page, context }) => {
  let disconnected = false;
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    req.resume(); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: '冲突前收到的推导 $x^2$' } }] })}\n\n`);
    res.on('close', () => { disconnected = true; });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/'); await saved(page);
    const id = await imported(page, '生成冲突', '已有笔记');
    const other = await context.newPage();
    await other.route('**/api/status', route => route.fulfill({ json: { configured: true, model: 'mock' } }));
    await other.route('**/api/chat', route => route.fulfill({ status: 307, headers: { location: `http://127.0.0.1:${(server.address() as AddressInfo).port}/` } }));
    await other.goto('/'); await saved(other);
    await other.getByLabel('输入问题').fill('开始推导'); await other.getByRole('button', { name: '发送问题' }).click();
    await expect(other.getByText('冲突前收到的推导', { exact: false })).toBeVisible();
    // Let the first checkpoint finish before deleting from the other tab.
    await expect.poll(() => page.locator(`.notebook-entry[data-book-id="${id}"]`).textContent()).toContain('3 条内容');
    await conversationAction(page, '删除对话', id); await page.getByRole('button', { name: '确认删除', exact: true }).click();
    await expect(other.locator('.document-cover h1')).toContainText('冲突副本');
    await expect(other.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    await expect.poll(() => disconnected).toBe(true); await saved(other);
    await other.reload();
    await expect(other.locator('.document-cover h1')).toContainText('冲突副本');
    await other.getByRole('button', { name: '跳到末尾' }).click();
    await expect(other.getByText('冲突前收到的推导', { exact: false })).toBeVisible();
    await expect(other.locator(`.notebook-entry[data-book-id="${id}"]`)).toHaveCount(0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});
