import type { Page } from '@playwright/test';

export async function openSidebar(page: Page) {
  const trigger = page.getByRole('button', { name: '打开菜单', exact: true });
  if (await trigger.isVisible() && !await page.locator('.sidebar').evaluate(element => element.classList.contains('open'))) await trigger.click();
}
export async function openSettings(page: Page, category: '字体与外观' | 'API 与连接' | '备份与恢复' | '使用说明' = '字体与外观') {
  await openSidebar(page);
  const categories = page.getByRole('menu', { name: '设置分类' });
  if (!await categories.isVisible()) await page.getByRole('button', { name: '设置', exact: true }).click();
  await categories.getByRole('menuitem', { name: new RegExp(`^${category}`) }).click();
}
export async function conversationAction(page: Page, action: string, id?: string) {
  await openSidebar(page);
  const entry = id ? page.locator(`[data-book-id="${id}"]`) : page.locator('.notebook-entry.active');
  const trigger = entry.locator('.notebook-more');
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await entry.getByRole('menuitem', { name: action, exact: true }).click();
}
