import { test, expect } from '@playwright/test';
import { openSettings, conversationAction } from './helpers/navigation';

test('MathJax switches locally, survives reload and handles long notes, font color and mobile overflow', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).origin !== 'http://127.0.0.1:5173') remote.push(request.url()); });
  await page.goto('/'); await expect(page.locator('.katex').first()).toBeVisible();
  await openSettings(page);
  await expect(page.getByRole('button', { name: /^KaTeX/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: /^MathJax/ }).click();
  await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true', { timeout: 20000 });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  await expect(page.locator('.katex,.math-fallback')).toHaveCount(0);
  await expect.poll(() => page.locator('.virtual-row').evaluateAll(elements => elements.slice(1).every((element, i) => Math.abs(element.getBoundingClientRect().top - elements[i].getBoundingClientRect().bottom) < 2))).toBe(true);
  await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = 440; });
  await page.locator('.mathjax-display svg').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.mathjax-display svg').first()).toBeInViewport();
  await page.screenshot({ path: 'artifacts/verification/mathjax-reader-desktop.png', fullPage: true });
  await page.reload(); await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  await openSettings(page); await page.getByRole('button', { name: '加载示例' }).click();
  await expect(page.locator('.document-cover h1')).toContainText('120 组推导');
  await expect(page.locator('.document-meta')).toContainText(/\d{3,} 个阅读块/);
  const total = Number((await page.locator('.document-meta').innerText()).match(/([\d,]+) 个阅读块/)![1].replaceAll(',', ''));
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await expect.poll(() => page.locator('.virtual-row').first().getAttribute('data-index')).not.toBe('0');
  await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  await expect.poll(() => page.locator('.virtual-row').evaluateAll(elements => elements.slice(1).every((element, i) => element.getBoundingClientRect().top >= elements[i].getBoundingClientRect().bottom - 1))).toBe(true);
  await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect.poll(() => page.locator('.virtual-row').last().getAttribute('data-index')).toBe(String(total - 1));
  await expect(page.locator('.reading-end')).toBeInViewport();
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await page.screenshot({ path: 'artifacts/verification/mathjax-stress-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await openSettings(page);
  await page.getByRole('button', { name: '白色字体', exact: true }).click();
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.getByLabel('当前字号')).toContainText('17');
  const dark = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 390; canvas.height = 844;
    const context = canvas.getContext('2d')!; context.fillStyle = '#284139'; context.fillRect(0, 0, 390, 844);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.getByLabel('选择背景图片', { exact: true }).setInputFiles({ name: '深色背景.png', mimeType: 'image/png', buffer: Buffer.from(dark, 'base64') });
  await expect(page.locator('.background-feedback')).toContainText('背景已设置并保存');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  // An actual long SVG must remain independently scrollable on mobile.
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  const source = '$$' + Array.from({ length: 45 }, (_, i) => `x^{${i}}`).join('+') + '$$';
  await page.getByLabel('笔记标题').fill('MathJax 长公式'); await page.getByLabel('Markdown / LaTeX 原文').fill(source);
  await page.getByRole('button', { name: '导入并阅读' }).click();
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  await expect(page.locator('.mathjax-svg svg g[fill]').first()).toHaveCSS('fill', 'rgb(255, 255, 255)');
  expect(await page.locator('.math-block').first().evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/mathjax-mobile.png', fullPage: true });
  await conversationAction(page, '查看原文');
  await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue(source);
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await openSettings(page); await page.getByRole('button', { name: /^KaTeX/ }).click();
  await expect(page.getByRole('button', { name: /^KaTeX/ })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'artifacts/verification/math-renderer-settings-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await expect(page.locator('.katex').first()).toBeVisible(); await expect(page.locator('.mathjax-svg')).toHaveCount(0);
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('failed engine preference write retains KaTeX and permits retry', async ({ page }) => {
  await page.goto('/'); await openSettings(page);
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (this.name === 'mosuan-preferences' && args[1] === 'readwrite') { IDBDatabase.prototype.transaction = original; queueMicrotask(() => tx.abort()); }
      return tx;
    };
  });
  await page.getByRole('button', { name: /^MathJax/ }).click();
  await expect(page.locator('.renderer-feedback')).toContainText('保存失败', { timeout: 20000 });
  await expect(page.getByRole('button', { name: /^KaTeX/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.mathjax-svg')).toHaveCount(0);
  await page.getByRole('button', { name: /^MathJax/ }).click();
  await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true');
  await page.reload(); await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
});
