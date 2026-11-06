import { test, expect, type Page } from '@playwright/test';
import { openSettings } from './helpers/navigation';

async function legacyBackground(page: Page) {
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const canvas = document.createElement('canvas'); canvas.width = 1920; canvas.height = 1080;
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, 1920, 1080);
    gradient.addColorStop(0, '#d4e5e9'); gradient.addColorStop(1, '#526d78'); context.fillStyle = gradient; context.fillRect(0, 0, 1920, 1080);
    for (const [x, y, color] of [[0, 0, '#bc4545'], [1760, 0, '#dbc458'], [0, 920, '#428c54'], [1760, 920, '#4864a6']] as const) { context.fillStyle = color; context.fillRect(x, y, 160, 160); }
    canvas.toBlob(image => {
      const request = indexedDB.open('mosuan-preferences', 1);
      request.onsuccess = () => {
        const db = request.result; const tx = db.transaction('appearance', 'readwrite');
        // Old records have no framing metadata. All four corners must remain.
        tx.objectStore('appearance').put({ image, name: '旧背景.jpg', width: 1920, height: 1080 }, 'background');
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); };
      }; request.onerror = () => reject(request.error);
    }, 'image/jpeg');
  }));
  await page.reload(); await expect(page.locator('.app-background')).toBeAttached();
}
async function geometry(page: Page) {
  return page.locator('.app-background').evaluate(element => {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const width = rect.width * parseFloat(style.backgroundSize) / 100;
    const height = width * 1080 / 1920;
    const [x, y] = style.backgroundPosition.split(' ').map(parseFloat);
    return { frameWidth: rect.width, frameHeight: rect.height, width, height, left: (rect.width - width) * x / 100, top: (rect.height - height) * y / 100, size: style.backgroundSize, position: style.backgroundPosition };
  });
}
async function abortNextSave(page: Page) {
  await page.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(...args: Parameters<typeof original>) {
      const tx = original.apply(this, args);
      if (this.name === 'mosuan-preferences' && args[1] === 'readwrite') { IDBDatabase.prototype.transaction = original; queueMicrotask(() => tx.abort()); }
      return tx;
    };
  });
}

test('existing wide images default to complete display in wide and portrait windows', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 700 }); await legacyBackground(page);
  for (const viewport of [{ width: 1500, height: 700 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => (await geometry(page)).frameWidth).toBe(viewport.width);
    const result = await geometry(page);
    expect(result.width).toBeLessThanOrEqual(result.frameWidth + 1); expect(result.height).toBeLessThanOrEqual(result.frameHeight + 1);
    expect(result.left).toBeGreaterThanOrEqual(-1); expect(result.top).toBeGreaterThanOrEqual(-1);
    expect(result.left + result.width).toBeLessThanOrEqual(result.frameWidth + 1); expect(result.top + result.height).toBeLessThanOrEqual(result.frameHeight + 1);
  }
  await openSettings(page);
  await expect(page.getByRole('button', { name: /^完整显示/ })).toHaveAttribute('aria-pressed', 'true');
  const preview = (await page.getByRole('group', { name: '背景范围预览' }).boundingBox())!;
  expect(Math.abs(preview.width / preview.height - 390 / 844)).toBeLessThan(0.02);
  await page.getByRole('group', { name: '背景范围预览' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/verification/background-framing-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('preview, drag and zoom are saved explicitly, survive reload and retain old settings on failure', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 }); await legacyBackground(page); await openSettings(page);
  const original = await geometry(page);
  await page.getByRole('button', { name: /^铺满背景/ }).click();
  const zoom = page.getByRole('slider', { name: '背景放大', exact: true }); await zoom.focus(); await zoom.press('End');
  await expect(zoom).toHaveValue('200');
  const preview = page.getByRole('group', { name: '背景范围预览' }); await preview.scrollIntoViewIfNeeded();
  const rect = (await preview.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 25, rect.y + rect.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  const x = Number(await page.getByRole('slider', { name: '背景左右位置', exact: true }).inputValue());
  const y = Number(await page.getByRole('slider', { name: '背景上下位置', exact: true }).inputValue());
  expect(x).toBeLessThan(50); expect(y).toBeLessThan(50);
  expect(await geometry(page)).toEqual(original);
  await abortNextSave(page); await page.getByRole('button', { name: '应用显示设置', exact: true }).click();
  await expect(page.locator('.background-feedback')).toContainText('保存失败'); expect(await geometry(page)).toEqual(original);
  await page.getByRole('button', { name: '应用显示设置', exact: true }).click();
  await expect(page.locator('.background-feedback')).toContainText('已应用并保存');
  const applied = await geometry(page);
  expect(applied.width).toBeGreaterThan(original.width); expect(applied.position).toBe(`${x}% ${y}%`);
  await page.getByRole('button', { name: '关闭窗口' }).click(); await page.reload();
  await expect.poll(() => geometry(page)).toEqual(applied);
  await openSettings(page); await expect(page.getByRole('slider', { name: '背景放大', exact: true })).toHaveValue('200');
  await page.getByRole('button', { name: '还原显示范围', exact: true }).click();
  expect(await geometry(page)).toEqual(applied);
  await page.getByRole('button', { name: '应用显示设置', exact: true }).click();
  await expect.poll(() => geometry(page)).toEqual(original);
});

test('closing an unapplied preview discards it and viewport changes keep preview proportions correct', async ({ page }) => {
  await legacyBackground(page); await openSettings(page);
  const original = await geometry(page);
  await page.getByRole('button', { name: /^铺满背景/ }).click();
  await page.getByRole('slider', { name: '背景放大', exact: true }).press('End');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  expect(await geometry(page)).toEqual(original);
  await openSettings(page);
  await expect(page.getByRole('button', { name: /^完整显示/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('slider', { name: '背景放大', exact: true })).toHaveValue('100');
  await page.setViewportSize({ width: 1400, height: 700 });
  const preview = page.getByRole('group', { name: '背景范围预览' });
  await expect.poll(async () => { const rect = (await preview.boundingBox())!; return Math.round(rect.width / rect.height * 100); }).toBe(200);
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/verification/background-framing-desktop.png', fullPage: true });
});
