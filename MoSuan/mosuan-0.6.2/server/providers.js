import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const validProviders = new Set(['official', 'deepseek-web']);
export function localProxyUrl(value = 'http://127.0.0.1:9655/v1') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash) {
    throw new Error('网页版代理只允许不含凭据的本机地址');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function createConnections({ env = process.env, fetchImpl = fetch, filePath = env.MOSUAN_CONNECTION_FILE || path.join(project, '.local/connection.json'), keyPath = path.join(project, '.local/proxy-key') } = {}) {
  async function selected() {
    try {
      const saved = JSON.parse(await readFile(filePath, 'utf8'));
      if (validProviders.has(saved.provider)) return saved.provider;
    } catch (err) { if (err.code !== 'ENOENT') throw new Error('本地连接配置损坏，请重新选择连接方式'); }
    return validProviders.has(env.CHAT_PROVIDER) ? env.CHAT_PROVIDER : 'official';
  }
  async function choose(provider) {
    if (!validProviders.has(provider)) throw new Error('无效的连接方式');
    await mkdir(path.dirname(filePath), { recursive: true });
    const temp = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ provider }), { mode: 0o600 });
    await rename(temp, filePath);
    return status(provider);
  }
  async function proxyKey() {
    if (env.DEEPSEEK_WEB_PROXY_KEY) return env.DEEPSEEK_WEB_PROXY_KEY;
    try { return (await readFile(keyPath, 'utf8')).trim(); } catch (err) { if (err.code === 'ENOENT') return ''; throw err; }
  }
  async function resolve(provider) {
    if (provider === 'official') return { provider, url: 'https://api.deepseek.com/chat/completions', key: env.DEEPSEEK_API_KEY || '', model: env.DEEPSEEK_MODEL || 'deepseek-chat' };
    const base = localProxyUrl(env.DEEPSEEK_WEB_BASE_URL);
    return { provider, url: `${base.href.replace(/\/$/, '')}/chat/completions`, origin: base.origin, base: base.href.replace(/\/$/, ''), key: await proxyKey(), model: env.DEEPSEEK_WEB_MODEL || '' };
  }
  async function probe(config) {
    const headers = config.key ? { Authorization: `Bearer ${config.key}` } : {};
    const options = () => ({ headers, signal: AbortSignal.timeout(3500), redirect: 'error' });
    const [healthRes, modelsRes] = await Promise.all([
      fetchImpl(`${config.origin}/health`, options()), fetchImpl(`${config.base}/models`, options()),
    ]);
    if (!healthRes.ok || !modelsRes.ok) {
      await healthRes.body?.cancel(); await modelsRes.body?.cancel();
      throw new Error(modelsRes.status === 401 ? '代理访问密钥不匹配，请使用项目提供的启动入口' : '本地代理暂不可用，请检查代理窗口');
    }
    const health = await healthRes.json(); const models = await modelsRes.json();
    const ids = (Array.isArray(models.data) ? models.data : []).map(m => m?.id).filter(id => typeof id === 'string' && id.length < 150);
    const model = config.model || ids.find(id => id.endsWith('-nosearch') && !id.includes('thinking')) || ids.find(id => !id.includes('thinking')) || ids[0] || '';
    const loginReady = health.config_ready === true;
    const supported = Boolean(model && ids.includes(model));
    const supportsImages = models.data?.find(item => item.id === model)?.capabilities?.vision === true;
    return { configured: loginReady && supported, model, supportsImages, message: !loginReady ? '代理已启动，请先运行 login-deepseek-web.cmd 登录，再重启代理' : !supported ? '代理未提供所选模型，请检查模型配置' : '网页版登录信息已加载，可发送问题验证连接', state: !loginReady ? 'login-required' : !supported ? 'model-unavailable' : 'ready' };
  }
  async function status(provider = undefined) {
    provider ||= await selected();
    if (provider === 'official') return { provider, configured: Boolean(env.DEEPSEEK_API_KEY), model: env.DEEPSEEK_MODEL || 'deepseek-chat', state: env.DEEPSEEK_API_KEY ? 'configured' : 'key-required', message: env.DEEPSEEK_API_KEY ? '官方 API 已配置，调用按服务商规则计费' : '请在 .env 中配置 DEEPSEEK_API_KEY 后重启服务' };
    try { return { provider, ...await probe(await resolve(provider)) }; }
    catch (err) {
      return { provider, configured: false, model: '', state: 'proxy-unavailable', message: err.message?.startsWith('代理') || err.message?.startsWith('本地') || err.message?.startsWith('网页版') ? err.message : '尚未连接本地代理，请运行 start-web-proxy.cmd' };
    }
  }
  async function request(context) {
    const provider = await selected(); const config = await resolve(provider);
    const hasImages = context.messages.some(message => message.images?.length);
    if (provider === 'official') {
      if (hasImages) throw new Error('当前官方文本接口不支持图片，请切换到支持图片的网页版代理。如果只有历史问题带图，可将最近上下文设为 0 轮后发送纯文字问题。');
      if (!config.key) throw new Error('尚未配置 API Key。请在 .env 中设置 DEEPSEEK_API_KEY 后重启，或选择网页版代理。');
    } else {
      const check = await probe(config);
      if (!check.configured) throw new Error(check.message);
      if (hasImages && !check.supportsImages) throw new Error('当前代理模型未声明图片能力，请更新代理或选择支持图片的模型。');
      config.model = check.model;
    }
    const messages = context.messages.map(({ role, content, images }) => ({ role, content: images?.length ? [{ type: 'text', text: content }, ...images.map(image => ({ type: 'image_url', image_url: { url: image.dataUrl } }))] : content }));
    const body = { model: config.model, messages, stream: true, stream_options: { include_usage: true }, max_tokens: 4096 };
    if (provider === 'deepseek-web') {
      // A new remote conversation for every request preserves the caller's exact
      // context window and prevents two notebooks sharing implicit web history.
      body.user = `mosuan-${randomUUID()}`;
      body.web_search = false;
    }
    return { ...config, body, headers: { 'Content-Type': 'application/json', ...(config.key ? { Authorization: `Bearer ${config.key}` } : {}) } };
  }
  async function release(config) {
    if (config.provider !== 'deepseek-web' || !config.body.user) return;
    try {
      const res = await fetchImpl(`${config.origin}/reset-session?agent=${encodeURIComponent(config.body.user)}&history=drop`, {
        method: 'POST', headers: config.key ? { Authorization: `Bearer ${config.key}` } : {}, signal: AbortSignal.timeout(2000), redirect: 'error',
      });
      await res.body?.cancel();
    } catch { /* Best-effort local cache cleanup, never retry generation. */ }
  }
  return { selected, choose, status, request, release };
}
