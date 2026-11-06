import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const mobile of [false, true]) {
  test(`auto converts GBK on ${mobile ? 'phone viewport' : 'desktop'}, persists and exports UTF-8`, async ({ page }) => {
    if (mobile) await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await expect(page.locator('.document-cover h1')).toBeVisible();
    if (mobile) await page.getByRole('button', { name: '打开菜单' }).click();
    await page.getByRole('button', { name: '导入文本', exact: true }).click();
    const original = Buffer.concat([Buffer.from('# ', 'ascii'), Buffer.from('d6d0cec4', 'hex'), Buffer.from('\n\n$x^2$\n', 'ascii')]);
    await page.locator('input[type=file][accept*=".md"]').setInputFiles({ name: '中文旧文件.md', mimeType: 'text/plain', buffer: original });
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('status')).toContainText('GBK / GB18030');
    await expect(dialog.getByLabel('Markdown / LaTeX 原文')).toHaveValue('# 中文\n\n$x^2$\n');
    if (mobile) {
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(dialog.getByRole('button', { name: '导入并阅读' })).toBeInViewport({ ratio: 1 });
    }
    await page.screenshot({ path: `artifacts/verification/import-encoding-${mobile ? 'mobile' : 'desktop'}.png`, fullPage: true });
    await dialog.getByRole('button', { name: '导入并阅读' }).click();
    await expect(page.locator('.document-cover h1')).toHaveText('中文旧文件');
    await expect(page.locator('.katex').first()).toBeVisible();
    await expect(page.locator('.save-status')).toContainText('已保存');
    await page.reload();
    await expect(page.locator('.document-cover h1')).toHaveText('中文旧文件');
    const downloading = page.waitForEvent('download');
    await page.getByRole('button', { name: '导出 Markdown' }).click();
    const path = await (await downloading).path();
    const exported = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path!));
    expect(exported).toContain('# 中文\n\n$x^2$');
    expect(exported).not.toContain('�');
  });
}

test('manual encoding fixes Big5 and invalid files never import replacement text', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  const input = page.locator('input[type=file][accept*=".md"]');
  await input.setInputFiles({ name: '繁体.md', mimeType: 'text/plain', buffer: Buffer.from('a4a4a4e5', 'hex') });
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('文件编码').selectOption('big5');
  await expect(dialog.getByLabel('Markdown / LaTeX 原文')).toHaveValue('中文');
  await input.setInputFiles({ name: '损坏.md', mimeType: 'text/plain', buffer: Buffer.from('81', 'hex') });
  await expect(dialog.getByRole('alert')).toContainText('无法按当前编码');
  await expect(dialog.getByLabel('Markdown / LaTeX 原文')).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '导入并阅读' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: '导入前预览' }).check();
  await input.setInputFiles({ name: 'UTF16.md', mimeType: 'text/plain', buffer: Buffer.from('\ufeff# 中文\n\n$x^2$', 'utf16le') });
  await expect(dialog.getByLabel('文件编码')).toHaveValue('auto');
  await expect(dialog.getByRole('status')).toContainText('UTF-16 LE');
  await expect(dialog.getByLabel('Markdown / LaTeX 原文')).toHaveValue('# 中文\n\n$x^2$');
  await expect(dialog.getByRole('button', { name: '导入并阅读' })).toBeEnabled();
});
