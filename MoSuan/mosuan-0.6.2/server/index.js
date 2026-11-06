import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildContext } from './context.js';
import { createConnections } from './providers.js';
import { isReaderRunning } from './running.js';
import { createMobileAccess } from './mobile.js';
import { validateImages } from './images.js';

const root = path.resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const appVersion = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const port = Number(process.env.PORT || 3001);
const connections = createConnections();
const mobile = createMobileAccess();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 9_000_000) throw Object.assign(new Error('请求过大；请减少图片或上下文轮数'), { status: 413 });
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export const server = http.createServer(async (req, res) => {
  res.setHeader('X-Mosuan-Service', 'reader');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const url = new URL(req.url, `http://localhost:${port}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      // API is intentionally same-origin. A public deployment needs authentication.
      const allowed = await mobile.authorize(req, res);
      if (allowed === null) return;
      if (!allowed) return json(res, 403, { error: '仅允许同源请求或已配对的墨算 App，请检查配对码。' });
      if (url.pathname === '/api/android-apk' && ['GET', 'HEAD'].includes(req.method)) {
        let data;
        try { data = await readFile(new URL(`../artifacts/android/mosuan-${appVersion}-android.apk`, import.meta.url)); }
        catch { return json(res, 404, { error: '安装包尚未生成，请先完成 Android 构建。' }); }
        res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': data.length, 'Content-Disposition': `attachment; filename="mosuan-${appVersion}-android.apk"` });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      if (url.pathname === '/api/mobile-info' && req.method === 'GET') return json(res, 200, await mobile.info(req, port));
      if (url.pathname === '/api/status' && req.method === 'GET') return json(res, 200, await connections.status());
      if (url.pathname === '/api/connection' && req.method === 'PUT') {
        if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: '需要 application/json 请求' });
        const input = await body(req);
        return json(res, 200, await connections.choose(input.provider));
      }
      if (url.pathname !== '/api/chat' || req.method !== 'POST') return json(res, 404, { error: '接口不存在' });
      if (!req.headers['content-type']?.startsWith('application/json')) return json(res, 415, { error: '需要 application/json 请求' });
      const input = await body(req);
      if (!Array.isArray(input.messages) || input.messages.some(m => !m || !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string')) return json(res, 400, { error: '消息格式无效' });
      input.messages.forEach(message => { if (message.images !== undefined) message.images = validateImages(message.images); });
      const rounds = Math.max(0, Math.min(12, Math.floor(Number(input.rounds) || 0)));
      const context = buildContext(input.messages, rounds);
      let connection;
      try { connection = await connections.request(context); }
      catch (err) { return json(res, 503, { error: err.message }); }
      const controller = new AbortController();
      const onClose = () => controller.abort();
      res.on('close', onClose);
      // Includes connection and generation. Disconnect cancels upstream work.
      const timeout = setTimeout(() => controller.abort(), 300_000);
      try {
        const upstream = await fetch(connection.url, {
          method: 'POST', signal: controller.signal, redirect: 'error',
          headers: connection.headers,
          body: JSON.stringify(connection.body),
        });
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel();
          if (upstream.status === 429) return json(res, 429, { error: '当前服务请求过于频繁，请稍后再试。问题草稿和图片已保留。' });
          return json(res, upstream.status === 401 ? 401 : 502, { error: connection.provider === 'deepseek-web' ? `网页版代理请求失败（HTTP ${upstream.status}），请检查代理窗口、登录状态与模型。` : `DeepSeek 请求失败（HTTP ${upstream.status}）。请检查 Key、余额与模型配置。` });
        }
        // Some web proxies return JSON errors with HTTP 200. Do not forward
        // those bytes as SSE and leave the client waiting for an empty answer.
        let completion;
        if (upstream.headers.get('content-type')?.includes('application/json')) {
          completion = await upstream.json();
          if (completion.error && /TOO_MANY_REQUESTS|rate.?limit|\b429\b|\b40029\b/i.test(JSON.stringify(completion.error))) return json(res, 429, { error: '当前服务请求过于频繁，请稍后再试。问题草稿和图片已保留。' });
          if (completion.error || typeof completion.choices?.[0]?.message?.content !== 'string' || !completion.choices[0].message.content.trim()) {
            const imageRequest = context.messages.some(message => message.images?.length);
            return json(res, 502, { error: connection.provider === 'deepseek-web'
              ? `网页版代理${imageRequest ? '图片' : ''}请求未成功，请检查代理窗口、登录状态及上游服务后重试。草稿和图片已保留。`
              : 'DeepSeek 返回了异常内容，请检查连接配置后重试。' });
          }
        } else if (!upstream.headers.get('content-type')?.includes('text/event-stream')) {
          await upstream.body.cancel();
          return json(res, 502, { error: '服务未返回可读取的回答，请检查代理或 API 配置后重试。' });
        }
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
        res.write(`data: ${JSON.stringify({ context: { characters: context.characters, historyMessages: context.historyMessages, provider: connection.provider } })}\n\n`);
        if (completion) {
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: completion.choices[0].message.content }, finish_reason: completion.choices[0].finish_reason || 'stop' }], ...(completion.usage ? { usage: completion.usage } : {}) })}\n\ndata: [DONE]\n\n`);
          res.end(); return;
        }
        for await (const chunk of upstream.body) {
          if (res.destroyed) break;
          if (!res.write(chunk)) await new Promise(resolve => {
            const done = () => { res.off('drain', done); res.off('close', done); resolve(); };
            res.once('drain', done); res.once('close', done);
          });
        }
        res.end();
      } catch {
        if (!res.destroyed) {
          if (res.headersSent) { res.write(`data: ${JSON.stringify({ error: '连接中断或超时，已保留收到的内容。' })}\n\n`); res.end(); }
          else json(res, 502, { error: connection.provider === 'deepseek-web' ? '本地代理连接中断或请求超时，请检查代理窗口。' : '无法连接 DeepSeek 或请求超时，请检查网络后重试。' });
        }
      } finally { clearTimeout(timeout); res.off('close', onClose); await connections.release(connection); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: '不支持此方法' });
    let target = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (target !== root && !target.startsWith(root + path.sep)) return json(res, 403, { error: '禁止访问' });
    try { if ((await stat(target)).isDirectory()) target = path.join(target, 'index.html'); }
    catch { target = path.join(root, 'index.html'); }
    const data = await readFile(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Content-Length': data.length });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch (err) { if (!res.headersSent) json(res, err.status || 400, { error: err.message || '请求无效' }); else res.end(); }
});
const host = process.env.HOST || '127.0.0.1';
server.on('error', async err => {
  const target = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  const address = `http://${target.includes(':') ? `[${target}]` : target}:${port}`;
  if (err.code === 'EADDRINUSE' && await isReaderRunning(address)) {
    console.log(`墨算已在运行，直接打开 ${address} 即可，无需重复启动。`);
    return;
  }
  console.error(err.code === 'EADDRINUSE' ? `端口 ${port} 被其他程序占用，请检查已有服务。` : `服务启动失败：${err.message}`);
  process.exitCode = 1;
});
server.listen(port, host, () => console.log(`墨算服务：http://${host}:${port}`));
