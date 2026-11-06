import { expect, test, type Page } from '@playwright/test';
import { openSettings, openSidebar } from './helpers/navigation';

async function openImport(page: Page) {
  await openSidebar(page);
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  return page.getByRole('dialog', { name: '导入学习笔记' });
}
async function openSearch(page: Page) {
  await openSidebar(page);
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click();
  return page.getByRole('dialog', { name: '搜索笔记' });
}

test('quick file import and paste work on a narrow screen; full-text search jumps to an unmounted match in another note', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  const original = '# 积分练习\n\n' + Array.from({ length: 125 }, (_, i) =>
    `## 推导 ${i}\n\n${i === 3 ? '第一处定位词' : i === 101 ? '第二处定位词' : '复习一遍积分变换'}，行内公式 $x_{${i}}^2$。\n\n`).join('');
  const importing = await openImport(page);
  const choosing = page.waitForEvent('filechooser');
  await importing.getByRole('button', { name: '选择文件', exact: true }).click();
  await (await choosing).setFiles({ name: '积分长笔记.md', mimeType: 'text/markdown', buffer: Buffer.from(original) });
  await expect(importing).toBeHidden();
  await expect(page.locator('.document-cover h1')).toHaveText('积分长笔记');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await expect(page.locator('.virtual-row').filter({ hasText: '第二处定位词' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('积分长笔记');

  const paste = await openImport(page);
  await paste.getByLabel('Markdown / LaTeX 原文').fill('# 另一本笔记\n\n尝试从另一本笔记搜索。');
  await paste.getByRole('button', { name: '导入并阅读' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('另一本笔记');

  const search = await openSearch(page);
  const input = search.getByRole('searchbox', { name: '关键词或公式原文' });
  await expect(input).toBeFocused();
  await input.fill('定位词');
  await expect(search.getByRole('status')).toContainText('找到 2 条结果');
  await expect(search.locator('mark')).toHaveText(['定位词', '定位词']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/notebook-search-mobile.png' });
  await search.getByRole('button', { name: /第二处定位词/ }).click();
  await expect(search).toBeHidden();
  await expect(page.locator('.document-cover h1')).toHaveText('积分长笔记');
  const match = page.locator('.virtual-row[data-search-hit]');
  await expect(match).toContainText('第二处定位词');
  await expect(match).toBeInViewport({ ratio: 0.4 });
  await expect(page.locator('.reader-scroll')).toBeFocused();

  await openSearch(page);
  await expect(input).toHaveValue('定位词');
  await input.fill('x_{3}^2');
  await expect(search.getByRole('status')).toContainText('找到 1 条结果');
  await input.press('Enter');
  await expect(match).toContainText('第一处定位词');
  await expect(match).toBeInViewport({ ratio: 0.4 });

  await openSearch(page);
  await input.fill('另一本笔记');
  await expect(search.getByRole('button', { name: /笔记标题/ })).toBeVisible();
  await search.getByRole('button', { name: /笔记标题/ }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('另一本笔记');
  await expect(page.locator('.document-cover h1')).toBeInViewport();
});

test('Android settings guide opens and expands offline on a narrow screen', async ({ page, context }) => {
  await page.addInitScript(() => { (window as any).CapacitorCustomPlatform = { name: 'android' }; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await context.setOffline(true);
  await openSettings(page, '使用说明');
  const guide = page.getByRole('dialog', { name: '使用说明' });
  await expect(guide).toBeVisible();
  await expect(guide.getByText('选中一条结果', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'artifacts/verification/android-usage-guide.png' });
  await guide.getByText('连接 DeepSeek 与图片提问', { exact: true }).click();
  await expect(guide.getByText('保存登录并返回', { exact: false })).toBeVisible();
  await guide.getByText('导出与本机保存', { exact: true }).click();
  await expect(guide.getByText('另存为 PDF', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await guide.getByRole('button', { name: '返回设置菜单' }).click();
  await expect(guide).toBeHidden();
  await expect(page.getByRole('menuitem', { name: /^使用说明/ })).toBeVisible();
});
