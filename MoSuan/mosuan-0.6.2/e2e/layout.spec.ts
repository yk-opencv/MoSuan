import { test, expect, type Page } from '@playwright/test';
import { openSettings } from './helpers/navigation';

async function options(page: Page) {
  const control = page.getByRole('button', { name: '显示选项', exact: true });
  if (await control.getAttribute('aria-expanded') !== 'true') await control.click();
  return page.getByRole('region', { name: '显示选项', exact: true });
}
const hides = ['顶部导航与导出', '阅读工具栏', '笔记标题与信息', '滚动条', '上下跳转按钮'];

test('divider drag, width limits, keyboard, slider and reload preserve both panes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 }); await page.goto('/');
  const separator = page.getByRole('separator', { name: '调整左右栏宽度' });
  const side = page.locator('.sidebar'); const reader = page.locator('.workspace');
  const original = (await side.boundingBox())!.width; const readerWidth = (await reader.boundingBox())!.width;
  const handle = (await separator.boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 220); await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 + 100, handle.y + 220, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(original + 100);
  expect((await reader.boundingBox())!.width).toBe(readerWidth - 100);
  await page.reload();
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(original + 100);
  await separator.focus(); await page.keyboard.press('End');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(480);
  await page.keyboard.press('Home');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(200);
  await page.keyboard.press('ArrowRight');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(212);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(original);
  const panel = await options(page); const slider = panel.getByRole('slider', { name: '左栏宽度' });
  await slider.focus(); await page.keyboard.press('End');
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(480);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/layout-controls-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '显示选项', exact: true }).click();
  await page.setViewportSize({ width: 800, height: 800 });
  await expect.poll(async () => (await side.boundingBox())!.width).toBe(434);
  expect((await reader.boundingBox())!.width).toBeGreaterThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('hiding all chrome keeps long math aligned, scrollable and recoverable after reload', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openSettings(page); await page.getByRole('button', { name: '加载示例' }).click();
  const panel = await options(page);
  for (const name of [...hides, '左侧对话列表']) await panel.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.getByRole('button', { name: '显示选项', exact: true }).click();
  await expect(page.locator('.topbar')).toBeHidden(); await expect(page.locator('.reader-toolbar')).toBeHidden();
  await expect(page.locator('.document-cover')).toBeHidden(); await expect(page.locator('.jump-actions')).toBeHidden();
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.reader-scroll')).toHaveCSS('scrollbar-width', 'none');
  await expect(page.getByRole('heading', { name: '第 1 组推导', exact: true })).toBeVisible();
  await page.screenshot({ path: 'artifacts/verification/layout-minimal-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.document-cover')).toBeHidden(); await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: '显示选项', exact: true })).toBeVisible();
  await expect(page.locator('.reading-end')).toContainText('思考不停');
  await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = element.scrollHeight / 2; });
  await expect.poll(() => page.locator('.virtual-row').first().getAttribute('data-index')).not.toBe('0');
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await expect.poll(() => page.locator('.virtual-row').evaluateAll(elements => elements.slice(1).every((element, i) => element.getBoundingClientRect().top >= elements[i].getBoundingClientRect().bottom - 1))).toBe(true);
  await expect.poll(async () => {
    await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = element.scrollHeight; });
    return page.locator('.reading-end').evaluate(element => element.getBoundingClientRect().bottom <= element.parentElement!.getBoundingClientRect().bottom + 1);
  }).toBe(true);
  expect(await page.locator('.virtual-row').count()).toBeLessThan(35);
  await options(page); await page.getByRole('button', { name: '恢复默认布局', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible(); await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.document-cover')).toBeVisible(); await expect(page.locator('.jump-actions')).toBeVisible();
  await page.reload(); await expect(page.locator('.topbar')).toBeVisible();
  await page.getByRole('button', { name: '回到顶部' }).click();
  await expect(page.locator('.document-cover h1')).toContainText('120');
  await expect.poll(async () => {
    const first = await page.locator('.virtual-row').first().boundingBox(); const cover = await page.locator('.document-cover').boundingBox();
    return Boolean(first && cover && first.y >= cover.y + cover.height - 1);
  }).toBe(true);
  expect(errors).toEqual([]);
});

test('mobile can open its sidebar and restore the layout even with both top bars hidden', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const panel = await options(page);
  await expect(panel.getByRole('slider')).toHaveCount(0);
  for (const name of hides) await panel.getByRole('checkbox', { name, exact: true }).uncheck();
  await page.getByRole('button', { name: '显示选项', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开菜单', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
  await page.locator('.sidebar-shade').click({ position: { x: 350, y: 400 } });
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'artifacts/verification/layout-minimal-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload(); await expect(page.locator('.topbar')).toBeHidden();
  await options(page); await page.screenshot({ path: 'artifacts/verification/layout-options-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '恢复默认布局', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible(); await expect(page.locator('.document-cover')).toBeVisible();
  await page.getByRole('button', { name: '显示选项', exact: true }).click();
  await page.getByRole('button', { name: '打开菜单', exact: true }).click();
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeVisible();
});

test('blocked storage reports unsaved changes while keeping display controls usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'mosuan-layout-v1') throw new DOMException('denied', 'QuotaExceededError'); original.call(this, key, value); };
  });
  await page.goto('/'); const panel = await options(page);
  await panel.getByRole('checkbox', { name: '顶部导航与导出', exact: true }).uncheck();
  await expect(page.locator('.topbar')).toBeHidden();
  await expect(panel.getByRole('status')).toContainText('无法保存');
  await page.reload(); await expect(page.locator('.topbar')).toBeVisible();
  await options(page); await page.getByRole('button', { name: '恢复默认布局', exact: true }).click();
  await expect(page.locator('.topbar')).toBeVisible();
});
