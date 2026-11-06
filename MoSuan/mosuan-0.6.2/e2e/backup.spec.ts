import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { conversationAction, openSettings } from './helpers/navigation';

test('backup restores formulas, attachments and pinning to a separate browser without overwriting notes', async ({ page, browser }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, provider: 'deepseek-web', model: 'mock', supportsImages: true } }));
  await page.route('**/api/chat', route => route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"积分结果 $x^3/3+C$"},"finish_reason":"stop"}]}\n\n' }));
  await page.goto('/');
  await page.getByRole('button', { name: '新的学习对话' }).click();
  await expect(page.locator('.document-cover h1')).toHaveText('新的学习对话');
  const picture = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 300; canvas.height = 120;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '36px serif'; ctx.fillText('x²', 40, 70);
    return canvas.toDataURL().split(',')[1];
  });
  await page.getByLabel('选择题目图片').setInputFiles({ name: '题图.png', mimeType: 'image/png', buffer: Buffer.from(picture, 'base64') });
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await page.getByLabel('输入问题').fill('整库恢复题图');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.locator('.reader-scroll')).toContainText('积分结果');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await conversationAction(page, '置顶对话');
  await expect(page.locator('.notebook-entry.active')).toContainText('置顶');
  await openSettings(page, '备份与恢复');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '备份全部笔记' }).click();
  const download = await downloading;
  const file = { name: download.suggestedFilename(), mimeType: 'application/json', buffer: await readFile((await download.path())!) };
  const backup = JSON.parse(file.buffer.toString('utf8'));
  const archived = backup.notebooks.find((book: { id: string }) => book.id === backup.activeId);
  expect(archived).toMatchObject({ title: '整库恢复题图', pinned: true, messages: [{ role: 'user', images: [{ name: '题图.png' }] }, { role: 'assistant', content: '积分结果 $x^3/3+C$', state: 'complete' }] });
  expect(archived.revision).toBeUndefined();

  const target = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const phone = await target.newPage();
    await phone.goto('http://127.0.0.1:5173');
    await expect(phone.locator('.save-status')).toContainText('已保存');
    await phone.evaluate(({ id }) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('mosuan-reader');
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('notebooks', 'readwrite');
        tx.objectStore('notebooks').add({ id, title: '此设备的版本', updated: 1, revision: 1, messages: [] });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    }), { id: archived.id });
    await phone.reload();
    await openSettings(phone, '备份与恢复');
    const dialog = phone.getByRole('dialog', { name: '备份与恢复' });
    const input = dialog.getByLabel('选择墨算备份');
    await input.setInputFiles({ ...file, buffer: Buffer.from('{"format":"mosuan-notebooks","version":99}') });
    await expect(dialog.getByRole('alert')).toContainText('不受支持');
    await expect(dialog.getByRole('button', { name: '确认恢复' })).toHaveCount(0);
    await input.setInputFiles(file);
    await expect(dialog.getByText('恢复预览')).toBeVisible();
    await expect(dialog.getByText('1 张图片', { exact: false })).toBeVisible();
    await phone.screenshot({ path: 'artifacts/verification/backup-preview-mobile.png' });
    await dialog.getByRole('button', { name: '取消恢复' }).click();
    await expect(dialog.getByRole('status')).toContainText('已取消恢复');
    await expect(phone.locator('.notebook-entry')).toHaveCount(2);
    // Fail on the second insertion and verify that the first is rolled back.
    await phone.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      (window as any).__restoreAdd = () => { IDBObjectStore.prototype.add = add; };
      let inserts = 0;
      IDBObjectStore.prototype.add = function (...args) {
        if (this.name === 'notebooks' && ++inserts === 2) throw new DOMException('Disk full', 'QuotaExceededError');
        return add.apply(this, args);
      };
    });
    await input.setInputFiles(file);
    await dialog.getByRole('button', { name: '确认恢复' }).click();
    await expect(dialog.getByRole('alert')).toContainText('恢复失败');
    expect(await phone.evaluate(async () => (await (await import('/src/lib/storage.ts')).loadNotebooks()).length)).toBe(2);
    await phone.evaluate(() => (window as any).__restoreAdd());
    await dialog.getByRole('button', { name: '确认恢复' }).click();
    await expect(dialog.getByRole('status')).toContainText('新增 2 本（含 1 本副本）');
    await input.setInputFiles(file);
    await dialog.getByRole('button', { name: '确认恢复' }).click();
    await expect(dialog.getByRole('status')).toContainText('跳过 2 本相同笔记');
    await expect(phone.locator('.notebook-entry')).toHaveCount(4);
    await dialog.getByRole('button', { name: '关闭窗口' }).click();
    await phone.reload();
    await expect(phone.locator('.document-cover h1')).toHaveText('整库恢复题图（备份副本）');
    await expect(phone.locator('.notebook-entry.active')).toContainText('置顶');
    await expect(phone.locator('.notebook-entry').filter({ hasText: '此设备的版本' })).toHaveCount(1);
    await expect(phone.locator('.message-images img')).toHaveAttribute('src', archived.messages[0].images[0].dataUrl);
    await expect(phone.locator('.katex')).toBeVisible();
  } finally { await target.close(); }
});

test('Android backup stages UTF-8 and cleans the private file when the save picker is canceled', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.CapacitorCustomPlatform = { name: 'android' };
    w.__backupSaves = [];
    w.__chunks = 0;
    const files = new Map<string, string>();
    w.Capacitor = {
      PluginHeaders: [
        { name: 'Filesystem', methods: ['writeFile', 'appendFile', 'deleteFile'].map(name => ({ name, rtype: 'promise' })) },
        { name: 'MosuanFiles', methods: [{ name: 'saveBackup', rtype: 'promise' }] },
      ],
      nativePromise: async (plugin: string, method: string, options: any) => {
        if (plugin === 'Filesystem' && method === 'writeFile') files.set(options.path, options.data);
        if (plugin === 'Filesystem' && method === 'appendFile') {
          w.__chunks++;
          files.set(options.path, files.get(options.path) + options.data);
        }
        if (plugin === 'Filesystem' && method === 'deleteFile') { files.delete(options.path); w.__remainingFiles = files.size; }
        if (plugin === 'MosuanFiles') {
          w.__backupSaves.push({ ...options, text: files.get('mosuan-backups/' + options.cacheName) });
          return { cancelled: true };
        }
        return {};
      },
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(async () => {
    const { saveNotebook } = await import('/src/lib/storage.ts');
    await saveNotebook({ id: 'long-backup-note', title: '分片保存', updated: 1, messages: [{ id: 'answer', role: 'assistant', content: '汉字与公式🙂'.repeat(62_000) }] }, true);
  });
  await page.reload();
  await expect(page.locator('.save-status')).toContainText('已保存');
  await openSettings(page, '备份与恢复');
  await page.getByRole('button', { name: '备份全部笔记' }).click();
  await expect(page.getByRole('status')).toContainText('已取消保存备份');
  const result = await page.evaluate(() => {
    const w = window as any;
    const saved = w.__backupSaves[0];
    const book = JSON.parse(saved.text).notebooks.find((book: { id: string }) => book.id === 'long-backup-note');
    return { filename: saved.filename, intact: book.messages[0].content === '汉字与公式🙂'.repeat(62_000), files: w.__remainingFiles, chunks: w.__chunks };
  });
  expect(result.filename).toMatch(/\.mosuan\.json$/);
  expect(result.intact).toBe(true);
  expect(result.chunks).toBeGreaterThan(1);
  expect(result.files).toBe(0);
});
