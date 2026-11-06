// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createMobileAccess } from '../server/mobile.js';
it('requires a local pairing code for native cross-origin calls and never exposes it to a LAN visitor', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mosuan-mobile-'));
  try {
    const mobile = createMobileAccess({ file: path.join(dir, 'key') });
    const info = await mobile.info({ headers: { host: '127.0.0.1:3001' }, socket: { remoteAddress: '127.0.0.1' } }, 3001);
    const headers = {}; const res = { setHeader: (k,v) => { headers[k] = v; }, writeHead() {}, end() {} };
    const req = { headers: { host: '192.168.1.10:3001', origin: 'https://localhost' }, method: 'POST' };
    expect(await mobile.authorize(req, res)).toBe(false);
    req.headers['x-mosuan-key'] = info.token;
    expect(await mobile.authorize(req, res)).toBe(true);
    req.headers.origin = 'https://evil.example'; expect(await mobile.authorize(req, res)).toBe(false);
    await expect(mobile.info({ headers: { host: '192.168.1.10:3001' }, socket: { remoteAddress: '127.0.0.1' } }, 3001)).rejects.toThrow('电脑本机');
  } finally {
    const target = path.resolve(dir);
    if (path.dirname(target) !== path.resolve(tmpdir()) || !path.basename(target).startsWith('mosuan-mobile-')) throw new Error('Unexpected test directory');
    await rm(target, { recursive: true, force: true });
  }
});
