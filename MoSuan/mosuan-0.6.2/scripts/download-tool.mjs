import { createWriteStream } from 'node:fs';
import { stat, mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const [url, destination] = process.argv.slice(2);
const allowed = new Set(['cdn.azul.com', 'dl.google.com', 'downloads.gradle.org', 'repo.huaweicloud.com', 'mirrors.huaweicloud.com']);
if (!allowed.has(new URL(url).hostname)) throw new Error('Unexpected toolchain download host');
const root = path.resolve('.local/android-tools/downloads');
const target = path.resolve(destination);
if (!target.startsWith(root + path.sep)) throw new Error('Download target must stay inside project tools');
await mkdir(root, { recursive: true });
const headers = await fetch(url, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(30000) });
if (!headers.ok) throw new Error(`Download metadata failed: ${headers.status}`);
const length = Number(headers.headers.get('content-length'));
if (!length || length > 600_000_000) throw new Error('Invalid toolchain archive length');
const count = 10;
await Promise.all(Array.from({ length: count }, async (_, index) => {
  const start = Math.floor(length * index / count), end = Math.floor(length * (index + 1) / count) - 1;
  const chunk = `${target}.identity.chunk-${index}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const size = await stat(chunk).then(s => s.size).catch(() => 0);
    if (size === end - start + 1) return;
    if (size > end - start + 1) throw new Error('Invalid partial tool archive');
    try {
      const response = await fetch(url, { headers: { Range: `bytes=${start + size}-${end}`, 'Accept-Encoding': 'identity' }, signal: AbortSignal.timeout(300000) });
      if (response.status !== 206 || !response.headers.get('content-range')?.startsWith(`bytes ${start + size}-${end}/`)) {
        await response.body?.cancel(); throw new Error('Download server did not honor byte ranges');
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(chunk, { flags: 'a' }));
      if ((await stat(chunk)).size !== end - start + 1) throw new Error('Incomplete archive chunk');
      console.log(`Downloaded ${path.basename(target)} part ${index + 1}/${count}`);
      return;
    } catch (error) { if (attempt === 3) throw error; }
  }
}));
const output = await open(`${target}.assembled`, 'w');
try {
  for (let i = 0; i < count; i++) {
    const input = await open(`${target}.identity.chunk-${i}`, 'r');
    try { for await (const chunk of input.createReadStream()) await output.write(chunk); } finally { await input.close(); }
  }
} finally { await output.close(); }
if ((await stat(`${target}.assembled`)).size !== length) throw new Error('Tool archive size mismatch');
await rename(`${target}.assembled`, target);
console.log(`Archive ready: ${path.basename(target)} (${length} bytes)`);
