import { Capacitor, registerPlugin } from '@capacitor/core';
import { PhoneWeb, phoneWebResponse } from './phoneWeb';

export const isAndroidApp = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
const key = 'mosuan-mobile-server-v1';
export type MobileMode = 'phone-web' | 'computer';
export function mobileMode(): MobileMode {
  try { const saved = localStorage.getItem('mosuan-mobile-mode-v1'); return saved === 'computer' || saved === 'phone-web' ? saved : mobileConnection() ? 'computer' : 'phone-web'; } catch { return 'phone-web'; }
}
export function saveMobileMode(mode: MobileMode) { localStorage.setItem('mosuan-mobile-mode-v1', mode); }
export function normalizeServer(value: string) {
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('请填写完整服务地址，例如 http://192.168.1.10:3001，不要附带路径。');
  const host = url.hostname;
  const privateHttp = host === 'localhost' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^\[(::1|f[cd]|fe80)/i.test(host);
  if (url.protocol === 'http:' && !privateHttp) throw new Error('HTTP 服务地址需使用电脑的局域网 IP；其他地址请使用 HTTPS。');
  return url.origin;
}
export function mobileConnection(): { url: string; token: string } | null {
  try { const value = JSON.parse(localStorage.getItem(key) || 'null'); return value?.url && value?.token ? { url: normalizeServer(value.url), token: value.token } : null; } catch { return null; }
}
export function saveMobileConnection(url: string, token: string) {
  if (!/^[a-f0-9]{32,64}$/i.test(token.trim())) throw new Error('配对码格式不正确，请从电脑端墨算复制完整配对码。');
  localStorage.setItem(key, JSON.stringify({ url: normalizeServer(url), token: token.trim() }));
  saveMobileMode('computer');
}
export function disconnectMobile() { localStorage.removeItem(key); }
export async function apiFetch(route: string, init?: RequestInit) {
  if (!isAndroidApp()) return fetch(route, init);
  if (mobileMode() === 'phone-web') {
    if (route === '/api/status') {
      const status = await PhoneWeb.status();
      return Response.json({ provider: 'phone-web', configured: status.available && status.ready, model: 'DeepSeek 手机网页版', supportsImages: status.available && status.ready,
        message: !status.available ? '请更新 Android System WebView 后再登录。' : status.ready ? '手机网页直连登录已保存；提问由原生接口直接发送，回答显示在墨算中。' : '请点击“登录 / 打开 DeepSeek”，登录后点击“保存登录并返回”。旧版登录需要重新保存一次。' });
    }
    if (route === '/api/chat') return phoneWebResponse(JSON.parse(String(init?.body || '{}')), init?.signal);
    throw new Error('当前使用手机网页版，请在连接设置中切换到电脑转发后再选择电脑端 API。');
  }
  const connection = mobileConnection();
  if (!connection) throw new Error('请先在“API 与连接”中设置电脑端墨算服务地址和配对码。');
  const headers = new Headers(init?.headers); headers.set('X-Mosuan-Key', connection.token);
  return fetch(connection.url + route, { ...init, headers, credentials: 'omit', mode: 'cors' });
}
interface NativeFiles {
  saveText(options: { filename: string; text: string }): Promise<{ cancelled?: boolean; uri?: string }>;
  saveBackup(options: { filename: string; cacheName: string }): Promise<{ cancelled?: boolean; uri?: string }>;
  saveBinary(options: { filename: string; base64: string; mime: string }): Promise<{ cancelled?: boolean; uri?: string }>;
  printPdf(options: { title: string; html: string }): Promise<{ opened: boolean }>;
}
export const NativeFiles = registerPlugin<NativeFiles>('MosuanFiles');
export async function shareNativeText(filename: string, text: string, title: string) {
  const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const safe = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  const result = await Filesystem.writeFile({ path: `shared/${Date.now()}-${safe}`, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
  await Share.share({ title, files: [result.uri], dialogTitle: '分享墨算笔记' });
}
