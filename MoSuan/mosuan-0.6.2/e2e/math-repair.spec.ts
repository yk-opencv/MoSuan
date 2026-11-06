import { expect, test } from '@playwright/test';

test('reviews and repairs pasted DeepSeek formulas on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '打开菜单' }).click();
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const editor = dialog.getByLabel('Markdown / LaTeX 原文');
  const inline = '\\vec{n}';
  const first = String.raw`= \frac{||\overrightarrow{P_0 P}| \cdot |\vec{n}| \cdot \cos\theta|}{|\vec{n}|}`;
  const second = String.raw`d = \frac{|Ax_0+By_0+Cz_0+D|}{\sqrt{A^2+B^2+C^2}}`;
  const fenced = ['```latex', first, '```'].join('\n');
  const main = ['# 点到平面的距离', '设平面的法向量为 ' + inline + '。', first, second, fenced].join('\n\n');
  // Exercise the background scan as well as the import and rendering flow.
  const source = main + '\n\n' + '补充说明与原始学习笔记内容。'.repeat(2450);
  await editor.fill(source);
  await dialog.getByRole('button', { name: '检测公式格式' }).click();
  await expect(dialog.locator('.import-math-source')).toHaveText(first);
  await expect(dialog.locator('.import-math-preview .katex')).toBeVisible();
  await dialog.getByRole('button', { name: '跳过这处' }).click();
  await expect(dialog.locator('.import-math-source')).toHaveText(second);
  await expect(editor).toHaveValue(source);
  await dialog.getByRole('button', { name: '检测公式格式' }).click();
  await expect(dialog.locator('.import-math-source')).toHaveText(first);
  const add = dialog.getByRole('button', { name: '补上 $$', exact: true });
  await add.click();
  await expect(dialog.locator('.import-math-source')).toHaveText(second);
  await add.click();
  await expect(dialog.locator('.import-math-source')).toHaveCount(0);
  const repaired = source.replace(first, () => '$$\n' + first + '\n$$').replace(second, () => '$$\n' + second + '\n$$');
  await expect(editor).toHaveValue(repaired);

  const start = repaired.indexOf(inline);
  await editor.evaluate((input, { start, end }) => {
    (input as HTMLTextAreaElement).focus();
    (input as HTMLTextAreaElement).setSelectionRange(start, end);
  }, { start, end: start + inline.length });
  await dialog.getByRole('button', { name: '将选区设为行内公式' }).click();
  await expect(editor).toHaveValue(repaired.replace(inline, '$' + inline + '$'));
  await expect(dialog.getByRole('button', { name: '导入并阅读' })).toBeInViewport({ ratio: 1 });
  await dialog.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('点到平面的距离');
  await expect(page.locator('.reader-scroll .math-block .katex').first()).toBeVisible();
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('点到平面的距离');
  await expect(page.locator('.reader-scroll .math-block .katex').first()).toBeVisible();
});
