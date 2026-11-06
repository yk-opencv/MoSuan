import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import path from 'node:path';

export function createMobileAccess({ file = process.env.MOSUAN_MOBILE_KEY_FILE || new URL('../.local/mobile-key', import.meta.url) } = {}) {
  let pending;
  const getKey = () => pending ||= (async () => {
    try { const key = (await readFile(file, 'utf8')).trim(); if (/^[a-f0-9]{48}$/.test(key)) return key; throw new Error('配对文件损坏'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const key = randomBytes(24).toString('hex'); const target = file instanceof URL ? file : path.resolve(file);
    await mkdir(target instanceof URL ? new URL('.', target) : path.dirname(target), { recursive: true });
    try { await writeFile(target, key, { flag: 'wx', mode: 0o600 }); } catch (error) { if (error.code !== 'EEXIST') throw error; return (await readFile(target, 'utf8')).trim(); }
    return key;
  })();
  async function authorize(req, res) {
    const origin = req.headers.origin;
    if (!origin || new URL(origin).host === req.headers.host) return true;
    if (origin !== 'https://localhost') return false;
    res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Mosuan-Key');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return null; }
    const supplied = Buffer.from(String(req.headers['x-mosuan-key'] || '')); const expected = Buffer.from(await getKey());
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  async function info(req, port) {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host) || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)) throw Object.assign(new Error('请在电脑本机 http://127.0.0.1:3001 查看配对信息。'), { status: 403 });
    const ips = Object.values(networkInterfaces()).flat().filter(entry => entry && !entry.internal && entry.family === 'IPv4').map(entry => entry.address);
    return { token: await getKey(), urls: ips.map(ip => `http://${ip}:${port}`) };
  }
  return { authorize, info };
}
