import { test, expect } from '@playwright/test';
import { openSettings, conversationAction } from './helpers/navigation';
import { createServer } from 'node:http';

test('web mode selects, isolates context, streams formulas and fails without paid fallback', async ({ page, request }) => {
  let loginReady = true;
  let responseMode: 'stream' | 'json-error' | 'json-rate' | 'json-answer' = 'stream';
  const calls: { user: string; messages: { role: string; content: string }[] }[] = [];
  const released = new Set<string>();
  const answer = String.raw`网页代理模拟结果：\[\frac{x^2}{2}\]`;
  const proxy = createServer(async (req, res) => {
    const json = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== 'Bearer test-local-key') { json(401, {}); return; }
    if (req.url === '/health') { json(200, { config_ready: loginReady, status: 'ok' }); return; }
    if (req.url === '/v1/models') { json(200, { data: [{ id: 'mock-web-nosearch', capabilities: { vision: true } }] }); return; }
    if (req.url?.startsWith('/reset-session')) { released.add(new URL(req.url, 'http://local').searchParams.get('agent')!); json(200, {}); return; }
    if (req.url === '/v1/chat/completions') {
      const buffers = []; for await (const chunk of req) buffers.push(chunk);
      const input = JSON.parse(Buffer.concat(buffers).toString('utf8')); calls.push(input);
      if (responseMode === 'json-error') { json(200, { error: { message: 'protected-upstream-detail', type: 'image_processing_error' } }); return; }
      if (responseMode === 'json-rate') { json(200, { error: { message: 'DeepSeek upstream HTTP 200: {"code":40029,"msg":"TOO_MANY_REQUESTS"}' } }); return; }
      if (responseMode === 'json-answer') { json(200, { choices: [{ message: { content: 'JSON 回答正常' }, finish_reason: 'stop' }] }); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(0, 15) } }] })}\n\n`);
      await new Promise(r => setTimeout(r, 150));
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer.slice(15) }, finish_reason: 'stop' }] })}\n\ndata: {"usage":{"total_tokens":19}}\n\ndata: [DONE]\n\n`);
      return;
    }
    json(404, {});
  });
  await new Promise<void>(r => proxy.listen(19655, '127.0.0.1', r));
  try {
    await request.put('/api/connection', { data: { provider: 'official' } });
    await page.goto('/');
    await openSettings(page, 'API 与连接');
    await page.getByRole('button', { name: /^网页版代理/ }).click();
    await expect(page.getByRole('dialog')).toContainText('网页版代理已就绪');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/web-mode/settings-mobile.png', fullPage: true, animations: 'disabled' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await page.getByRole('button', { name: '新的学习对话' }).click();
    await page.getByLabel('输入问题').fill('独立问题 A'); await page.getByRole('button', { name: '发送问题' }).click();
    await expect(page.locator('.composer-foot')).toContainText('代理统计 19 tokens');
    await page.getByRole('button', { name: '跳到末尾' }).click();
    await expect(page.locator('.katex-display')).toBeVisible();
    await page.getByLabel('上下文轮数').selectOption('0');
    await page.getByLabel('输入问题').fill('独立问题 B'); await page.getByRole('button', { name: '发送问题' }).click();
    await expect.poll(() => calls.length).toBe(2);
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    expect(calls[0].user).not.toBe(calls[1].user);
    expect(calls[1].messages.filter(m => m.role !== 'system')).toEqual([{ role: 'user', content: '独立问题 B' }]);
    await expect.poll(() => released.size).toBe(2);
    await conversationAction(page, '查看原文');
    expect(await page.getByRole('textbox', { name: 'Markdown 原文' }).inputValue()).toContain(answer);
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await page.reload();
    await expect(page.locator('.composer-model')).toContainText('网页版代理');
    responseMode = 'json-error';
    const invalid = await request.post('/api/chat', { data: { rounds: 0, messages: [{ role: 'user', content: 'JSON 错误不可伪装为回答' }] } });
    expect(invalid.status()).toBe(502);
    const message = await invalid.json(); expect(message.error).toContain('请求未成功'); expect(message.error).not.toContain('protected-upstream-detail');
    responseMode = 'json-rate';
    const limited = await request.post('/api/chat', { data: { rounds: 0, messages: [{ role: 'user', content: 'rate limit' }] } });
    expect(limited.status()).toBe(429); expect((await limited.json()).error).toContain('请求过于频繁');
    responseMode = 'json-answer';
    await page.getByLabel('输入问题').fill('兼容 JSON 回答'); await page.getByRole('button', { name: '发送问题' }).click();
    await expect(page.getByRole('button', { name: '停止生成' })).toHaveCount(0);
    await conversationAction(page, '查看原文');
    await expect(page.getByRole('textbox', { name: 'Markdown 原文' })).toHaveValue(/JSON 回答正常/);
    await page.getByRole('button', { name: '关闭窗口' }).click();
    await expect.poll(() => released.size).toBe(5);
    loginReady = false;
    await openSettings(page, 'API 与连接'); await page.getByRole('button', { name: '刷新状态' }).click();
    await expect(page.getByRole('dialog')).toContainText('尚未就绪');
    await expect(page.getByRole('dialog')).toContainText('登录');
    expect((await (await request.get('/api/status')).json()).provider).toBe('deepseek-web');
    const failure = await request.post('/api/chat', { data: { rounds: 0, messages: [{ role: 'user', content: 'no fallback' }] } });
    expect(failure.status()).toBe(503); expect(calls).toHaveLength(5);
    await page.getByRole('button', { name: /^官方 API/ }).click();
    await expect(page.getByRole('dialog')).toContainText('DeepSeek 尚未配置');
  } finally {
    proxy.closeAllConnections(); await new Promise<void>(r => proxy.close(() => r()));
  }
});
