import { test, expect, type Page } from '@playwright/test';
async function picture(page: Page) {
  return Buffer.from(await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 700; canvas.height = 280;
    const context = canvas.getContext('2d')!; context.fillStyle = 'white'; context.fillRect(0, 0, 700, 280);
    context.fillStyle = '#163b32'; context.font = '44px serif'; context.fillText('Find the integral of x^2', 40, 120);
    return canvas.toDataURL('image/png').split(',')[1];
  }), 'base64');
}
test('image upload, removal, send, preview and refresh preserve a real image', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, provider: 'deepseek-web', model: 'web-nosearch', supportsImages: true } }));
  let body: any;
  await page.route('**/api/chat', async route => { body = route.request().postDataJSON(); await route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"图片解析结果：$x^3/3+C$"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' }); });
  await page.goto('/'); await page.getByRole('button', { name: '新的学习对话' }).click();
  const buffer = await picture(page);
  await page.getByLabel('选择题目图片').setInputFiles({ name: '题目.png', mimeType: 'image/png', buffer });
  await expect(page.getByRole('button', { name: '移除图片：题目.png', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '移除图片：题目.png', exact: true }).click();
  await expect(page.locator('.attachment-preview')).toHaveCount(0);
  await page.getByLabel('选择题目图片').setInputFiles({ name: '题目.png', mimeType: 'image/png', buffer });
  await page.getByLabel('输入问题').fill('解答图片中的积分题');
  await page.screenshot({ path: 'artifacts/verification/image-composer-desktop.png' });
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect.poll(() => body?.messages?.at(-1)?.images?.length).toBe(1);
  expect(body.messages.at(-1).images[0].dataUrl).toMatch(/^data:image\/jpeg;base64,/);
  await expect(page.locator('.save-status')).toContainText('已保存');
  await page.reload(); await page.getByRole('button', { name: '跳到末尾' }).click();
  await expect(page.locator('.message-images img')).toBeVisible();
  await page.getByRole('button', { name: '查看图片：题目.png', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog', { name: '图片预览', exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.getByLabel('选择题目图片').setInputFiles({ name: '新题.png', mimeType: 'image/png', buffer });
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/verification/image-composer-mobile.png' });
});
test('unsupported connections and bad files retain drafts and show an actionable error', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, provider: 'official', model: 'text-only', supportsImages: false } }));
  let requests = 0; await page.route('**/api/chat', route => { requests++; return route.abort(); });
  await page.goto('/');
  await page.getByLabel('选择题目图片').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('请选择 JPG');
  await page.getByLabel('选择题目图片').setInputFiles({ name: '题目.png', mimeType: 'image/png', buffer: await picture(page) });
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await page.getByLabel('输入问题').fill('保留这道题'); await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.getByRole('alert')).toContainText('未提供图片能力');
  await expect(page.getByLabel('输入问题')).toHaveValue('保留这道题');
  await expect(page.locator('.attachment-preview')).toHaveCount(1); expect(requests).toBe(0);
});

test('image requests restore the question and attachment after a rate limit', async ({ page }) => {
  await page.route('**/api/status', route => route.fulfill({ json: { configured: true, provider: 'deepseek-web', model: 'web-nosearch', supportsImages: true } }));
  await page.route('**/api/chat', route => route.fulfill({ status: 429, json: { error: '当前服务请求过于频繁，请稍后再试。问题草稿和图片已保留。' } }));
  await page.goto('/'); await page.getByRole('button', { name: '新的学习对话' }).click();
  await page.getByLabel('选择题目图片').setInputFiles({ name: '重试题目.png', mimeType: 'image/png', buffer: await picture(page) });
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await page.getByLabel('输入问题').fill('解答这道图片题');
  await page.getByRole('button', { name: '发送问题' }).click();
  await expect(page.getByRole('alert')).toContainText('请求过于频繁');
  await expect(page.getByLabel('输入问题')).toHaveValue('解答这道图片题');
  await expect(page.locator('.attachment-preview')).toHaveCount(1);
  await expect(page.getByRole('button', { name: '发送问题' })).toBeEnabled();
});
