import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { spawn } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const local = path.join(root, '.local');
const source = path.resolve(process.env.MOSUAN_WEB_SOURCE || path.join(root, 'FreeDeepseekAPI-main'));
const action = process.argv[2];
async function assertFree(port) {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', () => reject(new Error(`端口 ${port} 已被占用，请先关闭之前的对应窗口，再重试。`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
async function main() {
  if (!['login', 'start'].includes(action)) throw new Error('用法：node scripts/web-proxy.mjs login 或 start');
  await access(path.join(source, 'server.js'));
  await access(path.join(source, 'scripts/deepseek_chrome_auth.js'));
  await mkdir(local, { recursive: true });
  const accountDir = path.join(local, 'web-accounts');
  await mkdir(accountDir, { recursive: true });
  const auth = path.join(accountDir, 'deepseek-auth.json');
  const keyPath = path.join(local, 'proxy-key');
  try { await access(keyPath); }
  catch { await writeFile(keyPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  // Do not load .env into the third-party process. Official API credentials are
  // not needed here and are removed even if inherited from a parent terminal.
  const env = { ...process.env };
  for (const name of ['DEEPSEEK_API_KEY', 'OPENAI_API_KEY', 'PROXY_API_KEY', 'TLS_CERT_FILE', 'TLS_KEY_FILE', 'OPEN_DASHBOARD', 'FREDEEPSEEK_EMBEDDED']) delete env[name];
  Object.assign(env, {
    HOST: '127.0.0.1', PORT: '9655', PROXY_API_KEY_FILE: keyPath, REQUIRE_PROXY_API_KEY: '1',
    DEEPSEEK_AUTH_PATH: auth, DEEPSEEK_AUTH_DIR: accountDir,
    SKIP_ACCOUNT_MENU: '1', DEEPSEEK_MAX_RETRIES: '0', PROXY_ADMIN_ALLOW_REMOTE: '0',
  });
  // Node 24 can use the user's standard HTTPS_PROXY/HTTP_PROXY environment,
  // including for fetch. We do not change Windows network settings.
  env.NODE_USE_ENV_PROXY = '1';
  let entry;
  if (action === 'login') {
    await assertFree(19334);
    // Every login uses a new isolated profile. Keep it rather than invoking
    // upstream recursive deletion or closing a pre-existing browser session.
    Object.assign(env, {
      DEEPSEEK_CHROME_PROFILE: path.join(local, `login-browser-${randomUUID()}`),
      DEEPSEEK_CHROME_PORT: '19334', DEEPSEEK_KEEP_CHROME_PROFILE: '1', DEEPSEEK_REUSE_CHROME: '0',
    });
    console.log('请在即将打开的 Chrome 中登录自己的 DeepSeek 账号，发送“你好”。');
    console.log('收到回答后回到此窗口，选择“继续”并按回车，再按提示完成。');
    console.log('登录信息仅保存到本机 .local，不需要在聊天中发送密钥或 cookies。');
    entry = path.join(source, 'scripts/deepseek_chrome_auth.js');
  } else {
    try {
      const response = await fetch('http://127.0.0.1:9655/health', {
        headers: { Authorization: `Bearer ${(await readFile(keyPath, 'utf8')).trim()}` }, signal: AbortSignal.timeout(1500), redirect: 'error',
      });
      const status = await response.json();
      if (response.ok && status.service === 'FreeDeepseekAPI' && status.config_ready === true) {
        console.log('网页版代理已在运行，无需重复启动。请直接打开墨算使用。');
        return;
      }
    } catch { /* If no working instance exists, perform the normal startup. */ }
    try { const saved = JSON.parse(await readFile(auth, 'utf8')); if (!saved.token || !saved.cookie) throw new Error(); }
    catch { throw new Error('尚未完成网页登录，请先双击 login-deepseek-web.cmd。'); }
    await assertFree(9655);
    console.log('网页版代理：http://127.0.0.1:9655/v1；关闭此窗口会停止代理。');
    console.log('墨算中选择：设置 → API 与连接 → 网页版代理 → 刷新状态。');
    entry = path.join(source, 'server.js');
  }
  const child = spawn(process.execPath, [entry], { cwd: source, env, stdio: 'inherit', windowsHide: false });
  child.once('error', () => { console.error('启动失败，请检查 Node.js 和下载的源文件。'); process.exitCode = 1; });
  child.once('exit', code => { process.exitCode = code ?? 1; });
}
main().catch(error => { console.error(error.code === 'ENOENT' ? '找不到 FreeDeepseekAPI-main，请将完整下载的文件夹放在墨算项目内。' : error.message); process.exitCode = 1; });
