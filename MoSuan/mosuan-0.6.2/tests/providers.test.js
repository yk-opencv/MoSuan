// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createConnections, localProxyUrl } from '../server/providers.js';

const context = { messages: [{ role: 'system', content: 'math' }, { role: 'user', content: String.raw`求 $\frac{1}{2}$` }] };
async function withFiles(run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mosuan-provider-'));
  try { await run({ filePath: path.join(dir, 'connection.json'), keyPath: path.join(dir, 'proxy-key') }); }
  finally {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith('mosuan-provider-')) throw new Error('Unexpected test cleanup path');
    await rm(target, { recursive: true, force: true });
  }
}
const mockProxy = (ready = true) => vi.fn(async url => {
  if (url.endsWith('/health')) return Response.json({ status: 'ok', config_ready: ready });
  if (url.endsWith('/v1/models')) return Response.json({ data: [{ id: 'web-thinking' }, { id: 'web-nosearch' }] });
  return Response.json({ status: 'ok' });
});
describe('explicit provider selection and credential boundaries', () => {
  it('defaults to official without probing the proxy', async () => withFiles(async files => {
    const fetchImpl = mockProxy(); const c = createConnections({ ...files, env: {}, fetchImpl });
    expect(await c.status()).toMatchObject({ provider: 'official', configured: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  }));
  it('persists web mode and never forwards the official API key', async () => withFiles(async files => {
    const fetchImpl = mockProxy(); await writeFile(files.keyPath, 'local-proxy-secret');
    const c = createConnections({ ...files, env: { DEEPSEEK_API_KEY: 'official-secret' }, fetchImpl });
    expect(await c.choose('deepseek-web')).toMatchObject({ configured: true, model: 'web-nosearch' });
    expect(JSON.parse(await readFile(files.filePath, 'utf8'))).toEqual({ provider: 'deepseek-web' });
    const a = await c.request(context), b = await c.request(context);
    expect(a.url).toBe('http://127.0.0.1:9655/v1/chat/completions');
    expect(a.headers.Authorization).toBe('Bearer local-proxy-secret');
    expect(JSON.stringify(a)).not.toContain('official-secret');
    expect(a.body.messages).toEqual(context.messages); expect(a.body.user).not.toBe(b.body.user);
    expect(a.body.web_search).toBe(false);
    await c.release(a);
    expect(fetchImpl.mock.calls.at(-1)[0]).toContain(`agent=${a.body.user}&history=drop`);
  }));
  it('does not use a paid fallback when the proxy fails', async () => withFiles(async files => {
    const fetchImpl = vi.fn(async () => { throw new Error('network'); });
    const c = createConnections({ ...files, env: { DEEPSEEK_API_KEY: 'official-secret' }, fetchImpl });
    expect(await c.choose('deepseek-web')).toMatchObject({ configured: false, state: 'proxy-unavailable' });
    await expect(c.request(context)).rejects.toThrow();
    expect(fetchImpl.mock.calls.every(([url]) => url.startsWith('http://127.0.0.1:9655/'))).toBe(true);
  }));
  it('requires login configuration and an advertised model', async () => withFiles(async files => {
    const c = createConnections({ ...files, env: {}, fetchImpl: mockProxy(false) });
    expect(await c.choose('deepseek-web')).toMatchObject({ configured: false, state: 'login-required' });
    await expect(c.request(context)).rejects.toThrow('登录');
    const other = createConnections({ ...files, env: { DEEPSEEK_WEB_MODEL: 'not-present' }, fetchImpl: mockProxy() });
    expect(await other.status()).toMatchObject({ configured: false, state: 'model-unavailable' });
  }));
  it('returns a useful status for a mismatched proxy key', async () => withFiles(async files => {
    const c = createConnections({ ...files, env: {}, fetchImpl: vi.fn(async () => Response.json({}, { status: 401 })) });
    expect(await c.choose('deepseek-web')).toMatchObject({ configured: false, message: expect.stringContaining('密钥不匹配') });
  }));
  it('keeps official mode independent from the proxy key', async () => withFiles(async files => {
    await writeFile(files.keyPath, 'proxy-secret');
    const c = createConnections({ ...files, env: { DEEPSEEK_API_KEY: 'official-secret' }, fetchImpl: mockProxy() });
    const r = await c.request(context);
    expect(r.url).toBe('https://api.deepseek.com/chat/completions');
    expect(r.headers.Authorization).toBe('Bearer official-secret'); expect(r.body.user).toBeUndefined();
    await expect(c.choose('unknown')).rejects.toThrow();
  }));
  it('restricts proxy destinations to literal loopback or localhost', () => {
    expect(localProxyUrl('http://[::1]:9655/v1/').pathname).toBe('/v1');
    for (const url of ['https://example.com/v1', 'http://127.0.0.1.evil.test/v1', 'http://key@127.0.0.1/v1', 'file:///tmp/x', 'http://127.0.0.1/v1?key=x']) expect(() => localProxyUrl(url)).toThrow();
  });
  it('forwards images only to an advertised web vision model as multimodal parts', async () => withFiles(async files => {
    const fetchImpl = vi.fn(async url => url.endsWith('/health') ? Response.json({ config_ready: true }) : Response.json({ data: [{ id: 'web-nosearch', capabilities: { vision: true } }] }));
    const connections = createConnections({ ...files, env: { CHAT_PROVIDER: 'deepseek-web' }, fetchImpl });
    const image = { dataUrl: 'data:image/jpeg;base64,/9j/AA==', name: 'question.jpg' };
    const request = await connections.request({ ...context, messages: [{ role: 'user', content: '解题', images: [image] }] });
    expect(request.body.messages[0].content).toEqual([{ type: 'text', text: '解题' }, { type: 'image_url', image_url: { url: image.dataUrl } }]);
    expect(request.provider).toBe('deepseek-web');
  }));
  it('rejects pictures on the official text interface before issuing a paid request', async () => withFiles(async files => {
    const fetchImpl = vi.fn();
    const connections = createConnections({ ...files, env: { DEEPSEEK_API_KEY: 'test-key' }, fetchImpl });
    await expect(connections.request({ messages: [{ role: 'user', content: '图片', images: [{ dataUrl: 'data:image/jpeg;base64,/9j/AA==' }] }] })).rejects.toThrow('不支持图片');
    expect(fetchImpl).not.toHaveBeenCalled();
  }));
});
