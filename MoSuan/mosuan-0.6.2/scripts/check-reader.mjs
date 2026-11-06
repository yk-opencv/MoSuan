import net from 'node:net';
import { isReaderRunning } from '../server/running.js';

const host = process.env.HOST || '127.0.0.1';
const target = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
const port = Number(process.env.PORT || 3001);
const url = `http://${target.includes(':') ? `[${target}]` : target}:${port}`;
if (await isReaderRunning(url)) {
  console.log(`Mosuan Reader is already running: ${url}`);
  process.exitCode = 0;
} else {
  const free = await new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, host, () => server.close(() => resolve(true)));
  });
  if (!free) console.error(`Port ${port} is occupied by another service. Please check it before starting.`);
  process.exitCode = free ? 1 : 2;
}
