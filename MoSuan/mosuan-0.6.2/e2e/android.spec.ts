import { test, expect } from '@playwright/test';
import { openSettings } from './helpers/navigation';

test('Android client simulation reads offline, configures a paired server and invokes native file saving', async ({ page }) => {
  // Browser simulation of the JavaScript/native boundary, not an Android device.
  await page.addInitScript(() => {
    (window as any).CapacitorCustomPlatform = { name: 'android' };
    (window as any).__nativeSaves = [];
    (window as any).Capacitor = {
      PluginHeaders: [{ name: 'MosuanFiles', methods: [{ name: 'saveText', rtype: 'promise' }] }],
      nativePromise: async (_plugin: string, _method: string, options: any) => { (window as any).__nativeSaves.push(options); return { uri: 'content://mock/document/note.md' }; },
    };
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.katex').first()).toBeVisible();
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.getByRole('button', { name: '导出 Markdown', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__nativeSaves.length)).toBe(1);
  expect(await page.evaluate(() => (window as any).__nativeSaves[0].text)).toContain('幂级数');
  await openSettings(page, 'API 与连接');
  await page.getByRole('button', { name: '电脑转发', exact: false }).click();
  await expect(page.getByLabel('电脑服务地址', { exact: true })).toBeVisible();
  const requests: string[] = [];
  await page.route('http://192.168.1.10:3001/api/status', route => {
    if (route.request().method() !== 'OPTIONS') requests.push(route.request().headers()['x-mosuan-key']);
    return route.fulfill({ headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-Mosuan-Key, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS' }, json: { configured: true, provider: 'deepseek-web', model: 'web-nosearch', supportsImages: true } });
  });
  await page.getByLabel('电脑服务地址', { exact: true }).fill('http://192.168.1.10:3001');
  await page.getByLabel('配对码', { exact: true }).fill('a'.repeat(48));
  await page.getByRole('button', { name: '保存并检查连接' }).click();
  await expect(page.getByRole('status').filter({ hasText: '已连接电脑端墨算' })).toBeVisible();
  expect(requests.every(value => value === 'a'.repeat(48))).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/android-connection-simulated.png' });
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await expect(page.locator('.setup-steps')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
