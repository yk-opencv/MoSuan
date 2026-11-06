import { test, expect, type Page } from '@playwright/test';
import { openSettings as navigateSettings } from './helpers/navigation';

async function picture(page: Page) {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 2560; canvas.height = 1600;
    const context = canvas.getContext('2d')!;
    const sky = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    sky.addColorStop(0, '#1d4056'); sky.addColorStop(0.5, '#6e8e86'); sky.addColorStop(1, '#dbb987');
    context.fillStyle = sky; context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f5d99a'; context.beginPath(); context.arc(2050, 340, 180, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#263e44'; context.beginPath(); context.moveTo(0, 1300); context.lineTo(650, 620); context.lineTo(1450, 1500); context.lineTo(2200, 800); context.lineTo(2560, 1150); context.lineTo(2560, 1600); context.lineTo(0, 1600); context.fill();
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: '我的背景.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
async function openSettings(page: Page) {
  await navigateSettings(page);
  await expect(page.getByRole('button', { name: '上传背景图片', exact: true })).toBeEnabled();
}
async function backgroundRecord(page: Page) {
  return page.evaluate(() => new Promise<{ name: string; width: number; height: number; type: string } | null>((resolve, reject) => {
    const request = indexedDB.open('mosuan-preferences', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('appearance'); const read = tx.objectStore('appearance').get('background');
      tx.oncomplete = () => { const value = read.result; db.close(); resolve(value ? { name: value.name, width: value.width, height: value.height, type: value.image.type } : null); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
    request.onerror = () => reject(request.error);
  }));
}
async function abortNextSave(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (this.name === 'mosuan-preferences' && args[1] === 'readwrite') {
        IDBDatabase.prototype.transaction = original;
        queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
}

test('upload, optimize, reload, mobile layout and default restore persist without uploading', async ({ page }) => {
  const posts: string[] = []; const errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST' || request.method() === 'PUT') posts.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openSettings(page);
  await expect(page.locator('.app-shell')).not.toHaveClass(/custom-background/);
  const image = await picture(page);
  const choosing = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: '上传背景图片', exact: true }).click();
  await (await choosing).setFiles(image);
  await expect(page.locator('.background-feedback')).toContainText('背景已设置并保存');
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
  await expect(page.getByAltText('当前背景预览')).toBeVisible();
  expect(await backgroundRecord(page)).toEqual({ name: '我的背景.png', width: 1920, height: 1200, type: 'image/jpeg' });
  await page.getByRole('button', { name: '白色字体', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'white');
  await page.screenshot({ path: 'artifacts/verification/background-settings-desktop.png', fullPage: true });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = 500; });
  await expect(page.locator('.katex-display').first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/verification/background-reader-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/background-reader-mobile.png', fullPage: true });
  await openSettings(page);
  await expect(page.locator('.background-current')).toContainText('我的背景.png');
  await page.screenshot({ path: 'artifacts/verification/background-settings-mobile.png', fullPage: true });
  await page.getByRole('button', { name: '默认字体', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'default');
  await page.getByRole('button', { name: '恢复默认背景', exact: true }).click();
  await expect(page.locator('.background-feedback')).toContainText('已恢复默认背景并保存');
  await expect(page.locator('.app-shell')).not.toHaveClass(/custom-background/);
  expect(await backgroundRecord(page)).toBeNull();
  await page.reload();
  await expect(page.locator('.document-cover h1')).toContainText('幂级数');
  await expect(page.locator('.app-background')).toHaveCount(0);
  expect(await page.locator('.workspace').evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 254, 250)');
  expect(posts).toEqual([]); expect(errors).toEqual([]);
});

test('unsupported, corrupted and oversized images leave the current background unchanged', async ({ page }) => {
  await page.goto('/'); await openSettings(page);
  const input = page.getByLabel('选择背景图片', { exact: true });
  await input.setInputFiles(await picture(page));
  await expect(page.locator('.background-feedback')).toContainText('背景已设置并保存');
  const original = await page.locator('.app-background').getAttribute('style');
  await input.setInputFiles({ name: 'not-an-image.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.background-feedback')).toContainText('请选择 JPG');
  await input.setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really an image') });
  await expect(page.locator('.background-feedback')).toContainText('图片无法读取');
  await input.setInputFiles({ name: 'too-large.png', mimeType: 'image/png', buffer: Buffer.alloc(12 * 1024 * 1024 + 1) });
  await expect(page.locator('.background-feedback')).toContainText('不能超过 12 MB');
  expect(await page.locator('.app-background').getAttribute('style')).toBe(original);
  expect((await backgroundRecord(page))?.name).toBe('我的背景.png');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
});

test('failed writes preserve the prior background for both upload and default restore', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openSettings(page);
  const image = await picture(page);
  await page.getByLabel('选择背景图片', { exact: true }).setInputFiles(image);
  await expect(page.locator('.background-feedback')).toContainText('背景已设置并保存');
  const original = await page.locator('.app-background').getAttribute('style');
  await abortNextSave(page);
  await page.getByLabel('选择背景图片', { exact: true }).setInputFiles({ ...image, name: 'replacement.png' });
  await expect(page.locator('.background-feedback')).toContainText('原背景已保留');
  expect(await page.locator('.app-background').getAttribute('style')).toBe(original);
  await abortNextSave(page);
  await page.getByRole('button', { name: '恢复默认背景', exact: true }).click();
  await expect(page.locator('.background-feedback')).toContainText('默认背景保存失败');
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
  expect((await backgroundRecord(page))?.name).toBe('我的背景.png');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
  expect(errors).toEqual([]);
});

test('a damaged stored preference can be reset without changing notebooks', async ({ page }) => {
  await page.goto('/'); await openSettings(page);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mosuan-preferences', 1);
    request.onsuccess = () => {
      const db = request.result; const tx = db.transaction('appearance', 'readwrite');
      tx.objectStore('appearance').put({ image: new Blob(['broken'], { type: 'text/plain' }), name: 'bad' }, 'background');
      tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
    }; request.onerror = () => reject(request.error);
  }));
  await page.reload(); await openSettings(page);
  await expect(page.locator('.background-feedback')).toContainText('背景读取失败');
  await expect(page.locator('.app-background')).toHaveCount(0);
  await page.getByRole('button', { name: '恢复默认背景', exact: true }).click();
  await expect(page.locator('.background-feedback')).toContainText('已恢复默认背景并保存');
  await page.reload();
  await expect(page.locator('.document-cover h1')).toContainText('幂级数');
  expect(await backgroundRecord(page)).toBeNull();
});

test('default, black and white affect text and formulas while keeping the image unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.prose p').first()).toBeVisible();
  const defaultColor = await page.locator('.prose p').first().evaluate(element => getComputedStyle(element).color);
  await openSettings(page);
  await page.getByLabel('选择背景图片', { exact: true }).setInputFiles(await picture(page));
  await expect(page.locator('.background-feedback')).toContainText('背景已设置并保存');
  const imageStyle = await page.locator('.app-background').getAttribute('style');
  const imageRecord = await backgroundRecord(page);
  await page.getByRole('button', { name: '黑色字体', exact: true }).click();
  await expect(page.getByRole('button', { name: '黑色字体', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.prose p').first()).toHaveCSS('color', 'rgb(0, 0, 0)');
  await expect(page.locator('.katex .katex-base').first()).toHaveCSS('color', 'rgb(0, 0, 0)');
  expect(await page.locator('.app-background').getAttribute('style')).toBe(imageStyle);
  await page.getByRole('button', { name: '白色字体', exact: true }).click();
  await expect(page.getByRole('button', { name: '白色字体', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.prose p').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('.katex .katex-base').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  await expect(page.locator('.katex .frac-line').first()).toHaveCSS('border-bottom-color', 'rgb(255, 255, 255)');
  expect(await page.locator('.app-background').getAttribute('style')).toBe(imageStyle);
  expect(await backgroundRecord(page)).toEqual(imageRecord);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'white');
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
  await openSettings(page);
  await expect(page.getByRole('button', { name: '白色字体', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '默认字体', exact: true }).click();
  await expect(page.locator('.prose p').first()).toHaveCSS('color', defaultColor);
  expect(await backgroundRecord(page)).toEqual(imageRecord);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'default');
  await expect(page.locator('.app-shell')).toHaveClass(/custom-background/);
});

test('font color write failure keeps the previous color and allows retry', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await openSettings(page);
  await abortNextSave(page);
  await page.getByRole('button', { name: '白色字体', exact: true }).click();
  await expect(page.locator('.reading-color-feedback')).toContainText('保存失败');
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'default');
  await expect(page.getByRole('button', { name: '默认字体', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '白色字体', exact: true }).click();
  await expect(page.locator('.reading-color-feedback')).toContainText('字体颜色已保存');
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveAttribute('data-reading-color', 'white');
  await expect(page.locator('.app-background')).toHaveCount(0);
  expect(errors).toEqual([]);
});
