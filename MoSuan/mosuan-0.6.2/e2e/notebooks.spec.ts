import { test, expect, type Page } from '@playwright/test';

async function seed(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mosuan-reader', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('notebooks', 'readwrite');
      const store = tx.objectStore('notebooks'); store.clear();
      // Legacy records intentionally omit pinned; no schema migration required.
      for (const [id, updated] of [['A', 100], ['B', 300], ['C', 200]] as const) {
        store.put({ id, title: `对话 ${id}`, updated, messages: [{ id: `message-${id}`, role: 'assistant', content: `笔记 ${id}：$x^2$` }] });
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  }));
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('对话 B');
}
const entry = (page: Page, id: string) => page.locator(`[data-book-id="${id}"]`);
async function action(page: Page, id: string, name: string) {
  await entry(page, id).getByRole('button', { name: /^对话操作/ }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
const order = (page: Page) => page.locator('.notebook-entry').evaluateAll(elements => elements.map(el => el.getAttribute('data-book-id')));

test('pin and deletion persist; inactive/current/final conversations remain consistent', async ({ page }) => {
  await seed(page);
  await action(page, 'A', '置顶对话');
  await expect.poll(() => order(page)).toEqual(['A', 'B', 'C']);
  await expect(page.locator('.document-cover h1')).toHaveText('对话 B');
  await page.reload();
  await expect.poll(() => order(page)).toEqual(['A', 'B', 'C']);
  await expect(entry(page, 'A')).toContainText('置顶');
  await expect(page.locator('.document-cover h1')).toHaveText('对话 B');
  await action(page, 'A', '取消置顶');
  await expect.poll(() => order(page)).toEqual(['B', 'C', 'A']);
  await action(page, 'A', '删除对话');
  await expect(page.getByRole('dialog', { name: '删除对话确认' })).toContainText('对话 A');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(entry(page, 'A')).toBeVisible();
  await entry(page, 'A').locator('.notebook').click();
  // Deleting a different conversation must not change the active one.
  await action(page, 'B', '删除对话');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(entry(page, 'B')).toHaveCount(0);
  await expect(page.locator('.document-cover h1')).toHaveText('对话 A');
  await page.reload();
  await expect.poll(() => order(page)).toEqual(['C', 'A']);
  await action(page, 'C', '删除对话');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('对话 A');
  await page.reload();
  await expect.poll(() => order(page)).toEqual(['A']);
  await action(page, 'A', '删除对话');
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('新的学习对话');
  await expect(page.locator('.notebook-entry')).toHaveCount(1);
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.reload();
  await expect(page.locator('.notebook-entry')).toHaveCount(1);
  await expect(page.locator('.document-cover h1')).toHaveText('新的学习对话');
  await expect(page.locator('.empty-state')).toBeVisible();
});

test('failed delete retains data and mobile actions fit the sidebar', async ({ page }) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '打开菜单' }).click();
  await entry(page, 'B').getByRole('button', { name: /^对话操作/ }).click();
  await page.screenshot({ path: 'artifacts/verification/conversation-actions-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('menuitem', { name: '删除对话', exact: true }).click();
  await page.screenshot({ path: 'artifacts/verification/conversation-delete-mobile.png', fullPage: true });
  // Simulate an IndexedDB transaction failing, rather than just a UI error.
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (args[1] === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('删除失败');
  await expect(page.getByRole('dialog', { name: '删除对话确认' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(entry(page, 'B')).toBeVisible();
  await page.reload();
  await expect(page.locator('.document-cover h1')).toHaveText('对话 B');
  await expect(page.locator('.notebook-entry')).toHaveCount(3);
});
