import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { conversationAction, openSettings, openSidebar } from './helpers/navigation';

test('settings expose backup, keyboard navigation and a mobile submenu', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  const categories = page.getByRole('menu', { name: '设置分类' });
  await expect(categories.getByRole('menuitem')).toHaveCount(4);
  await expect(categories.getByRole('menuitem').first()).toBeFocused();
  await page.screenshot({ path: 'artifacts/verification/settings-menu-desktop.png', fullPage: true });
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'API 与连接', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '连接方式' })).toBeVisible();
  await expect(page.getByRole('button', { name: '白色字体', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回设置菜单' }).click();
  await expect(categories).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '字体与外观', exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: '连接方式' })).toHaveCount(0);
  await page.getByRole('button', { name: '增大字号' }).click();
  await expect(page.getByLabel('当前字号')).toContainText('17');
  expect(await page.locator('.reader-scroll').evaluate(element => (element as HTMLElement).style.getPropertyValue('--reader-font'))).toBe('17px');
  await page.getByRole('button', { name: '默认字号', exact: true }).click();
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await openSidebar(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(categories).toBeVisible();
  await page.screenshot({ path: 'artifacts/verification/settings-menu-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await categories.evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(categories).toHaveCount(0);
  await expect(page.getByRole('button', { name: '设置', exact: true })).toBeFocused();
  await openSettings(page);
  await page.screenshot({ path: 'artifacts/verification/settings-appearance-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('language changes immediately and survives a reload on a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.locator('.save-status')).toContainText('已保存到本机');
  const title = await page.locator('.document-cover h1').textContent();
  await page.getByRole('textbox', { name: '输入问题' }).fill('保留我的草稿');

  await openSidebar(page);
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('menuitem', { name: /^语言/ }).click();
  await page.getByRole('combobox', { name: '界面语言' }).selectOption('en');
  await expect(page.getByRole('dialog', { name: 'Language', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('.sidebar-shade').click({ position: { x: 370, y: 30 } });
  await expect(page.getByRole('textbox', { name: 'Enter a question' })).toHaveValue('保留我的草稿');
  await expect(page.locator('.document-cover h1')).toHaveText(title!);

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('textbox', { name: 'Enter a question' })).toBeVisible();
  await page.getByRole('button', { name: 'Open menu', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Language/ }).click();
  await page.getByRole('combobox', { name: 'Interface language' }).selectOption('zh-TW');
  await expect(page.getByRole('dialog', { name: '語言', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: '介面語言' })).toHaveValue('zh-TW');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-TW');
});

test('ellipsis shares and exports the chosen inactive conversation without switching notes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mosuan-reader', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('notebooks', 'readwrite'); const store = tx.objectStore('notebooks');
      for (const [id, title, content, updated] of [
        ['selected', '当前阅读', 'ONLY_CURRENT_NOTE', Date.now() + 20000],
        ['other', '要分享的另一条', String.raw`TARGET_NOTE $\frac{1}{2}$`, Date.now() + 10000],
      ] as const) store.put({ id, title, updated, messages: [{ id: `${id}-m`, role: 'assistant', content }] });
      tx.oncomplete = () => { sessionStorage.setItem('mosuan-active-book', 'selected'); db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('当前阅读');
  await expect(page.locator('.top-actions button')).toHaveCount(2);
  await expect(page.getByRole('button', { name: '导出 Markdown', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '选择导出格式', exact: true })).toBeVisible();
  await expect(page.locator('.reader-toolbar').getByRole('button', { name: '原文', exact: true })).toHaveCount(0);
  await conversationAction(page, '查看原文', 'other');
  await expect(page.getByRole('textbox', { name: 'Markdown 原文', exact: true })).toHaveValue(String.raw`TARGET_NOTE $\frac{1}{2}$`);
  await expect(page.locator('.document-cover h1')).toHaveText('当前阅读');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出原文', exact: true }).click();
  const file = await downloading;
  expect(file.suggestedFilename()).toBe('要分享的另一条.md');
  const text = await readFile((await file.path())!, 'utf8');
  expect(text).toContain('TARGET_NOTE'); expect(text).not.toContain('ONLY_CURRENT_NOTE');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await conversationAction(page, '分享对话', 'other');
  await expect(page.getByRole('textbox', { name: '分享内容', exact: true })).toHaveValue(text);
  await page.getByRole('button', { name: '关闭分享' }).click();
  await expect(page.locator('[data-book-id="other"] .notebook-more')).toBeFocused();
  await expect(page.locator('.document-cover h1')).toHaveText('当前阅读');
  await page.setViewportSize({ width: 390, height: 844 }); await openSidebar(page);
  await page.locator('[data-book-id="other"] .notebook-more').click();
  await expect(page.locator('[data-book-id="other"]').getByRole('menuitem')).toHaveCount(4);
  await page.screenshot({ path: 'artifacts/verification/conversation-menu-mobile.png', fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
