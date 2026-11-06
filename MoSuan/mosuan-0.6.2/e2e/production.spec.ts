import { test, expect } from '@playwright/test';
import { openSettings, openSidebar } from './helpers/navigation';
import { readFile, writeFile } from 'node:fs/promises';

test('signed Android package can be downloaded with the correct MIME type and unchanged bytes', async ({ request }) => {
  const response = await request.get('/api/android-apk');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toBe('application/vnd.android.package-archive');
  const { version } = JSON.parse(await readFile('package.json', 'utf8'));
  const expected = await readFile(`artifacts/android/mosuan-${version}-android.apk`);
  expect((await response.body()).equals(expected)).toBe(true);
});

test('native origin requires pairing, supports preflight, and cannot read pairing codes remotely', async ({ request }) => {
  const info = await request.get('/api/mobile-info'); expect(info.ok()).toBe(true);
  const pairing = await info.json(); expect(pairing.token).toMatch(/^[a-f0-9]{48}$/);
  const headers = { Origin: 'https://localhost', 'X-Mosuan-Key': pairing.token };
  expect((await request.get('/api/status', { headers: { Origin: 'https://localhost' } })).status()).toBe(403);
  const status = await request.get('/api/status', { headers }); expect(status.ok()).toBe(true);
  expect(status.headers()['access-control-allow-origin']).toBe('https://localhost');
  const preflight = await request.fetch('/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://localhost', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-mosuan-key' } });
  expect(preflight.status()).toBe(204);
  const remote = await request.get('/api/mobile-info', { headers: { ...headers, Host: '192.168.1.10:3003' } }); expect(remote.status()).toBe(403);
});

test('production assets, local reading and unconfigured API work', async ({ page, request }) => {
  const errors: string[] = [], failed: string[] = [], hosts = new Set<string>();
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('request', r => hosts.add(new URL(r.url()).host));
  const response = await page.goto('/'); expect(response?.status()).toBe(200);
  await expect(page.locator('.katex').first()).toBeVisible();
  await page.locator('.reader-scroll').evaluate(el => { el.scrollTop = 500; });
  await expect(page.locator('.katex-display').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: 'test-results/production/reader.png', fullPage: true, animations: 'disabled' });
  expect(errors).toEqual([]); expect(failed).toEqual([]); expect([...hosts]).toEqual(['127.0.0.1:3003']);
  const status = await request.get('/api/status'); expect(await status.json()).toMatchObject({ configured: false });
  const noKey = await request.post('/api/chat', { data: { messages: [{ role: 'user', content: 'test' }], rounds: 0 } });
  expect(noKey.status()).toBe(503); expect((await noKey.json()).error).toContain('API Key');
  const origin = await request.post('/api/chat', { headers: { Origin: 'https://example.com' }, data: {} }); expect(origin.status()).toBe(403);
  expect((await request.get('/api/missing')).status()).toBe(404);
  await page.getByLabel('输入问题').fill('不连接也能保留');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.getByRole('dialog')).toContainText('尚未配置');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await expect(page.getByLabel('输入问题')).toHaveValue('不连接也能保留');
});

test('production MathJax chunk loads locally and restores the selected renderer', async ({ page }) => {
  const errors: string[] = [], remote: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (new URL(request.url()).hostname !== '127.0.0.1') remote.push(request.url()); });
  await page.goto('/'); await openSettings(page);
  const loading = page.waitForResponse(response => /\/mathjaxRenderer-[^/]+\.js$/.test(new URL(response.url()).pathname));
  await page.getByRole('button', { name: /^MathJax/ }).click();
  expect((await loading).ok()).toBe(true);
  await expect(page.getByRole('button', { name: /^MathJax/ })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '关闭窗口' }).click();
  await page.locator('.reader-scroll').evaluate(element => { element.scrollTop = 500; });
  await page.locator('.mathjax-display svg').first().scrollIntoViewIfNeeded();
  await expect(page.locator('.mathjax-display svg').first()).toBeInViewport();
  await page.screenshot({ path: 'artifacts/verification/mathjax-production.png', fullPage: true });
  await page.reload(); await expect(page.locator('.mathjax-svg svg').first()).toBeVisible();
  expect(errors).toEqual([]); expect(remote).toEqual([]);
});

test('production long-note parser runs in its local worker and supports search jumps', async ({ page, context }) => {
  await page.addInitScript(() => {
    const w = window as any;
    const WorkerClass = window.Worker;
    window.Worker = class extends WorkerClass {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (!String(url).includes('markdownWorker')) return;
        const start = performance.now();
        this.addEventListener('message', ({ data }) => {
          if (data.blocks) w.__workerResult = { blocks: data.blocks.length, elapsedMs: Math.round(performance.now() - start) };
        });
      }
    };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const sample = await readFile('artifacts/mobile-stress/墨算手机公式压力测试.md');
  await page.goto('/');
  await expect(page.locator('.save-status')).toContainText('已保存');
  const devtools = await context.newCDPSession(page);
  await devtools.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await openSidebar(page);
  await page.getByRole('button', { name: '导入文本', exact: true }).click();
  const response = page.waitForResponse(res => /\/markdownWorker-[^/]+\.js$/.test(new URL(res.url()).pathname));
  const start = Date.now();
  await page.locator('input[type=file][accept*=".md"]').setInputFiles({ name: '生产长文.md', mimeType: 'text/markdown', buffer: sample });
  expect((await response).ok()).toBe(true);
  await expect(page.locator('.document-meta')).toContainText(/\d{3,} 个阅读块/);
  const readerReadyMs = Date.now() - start;
  const worker = await page.evaluate(() => (window as any).__workerResult);
  expect(worker.blocks).toBeGreaterThan(1600);
  await writeFile('artifacts/verification/reader-profile-production-startup.json', JSON.stringify({ cpuSlowdown: 4, readerReadyMs, worker }, null, 2));
  await openSidebar(page);
  await page.getByRole('button', { name: '搜索笔记', exact: true }).click();
  await page.getByRole('searchbox').fill('中部检查点 MID-060');
  await page.getByRole('dialog', { name: '搜索笔记' }).getByRole('button', { name: /第 060 组/ }).click();
  await expect(page.locator('.virtual-row[data-search-hit]')).toContainText('中部检查点 MID-060');
  await expect(page.locator('.virtual-row[data-search-hit]')).toBeInViewport();
});
