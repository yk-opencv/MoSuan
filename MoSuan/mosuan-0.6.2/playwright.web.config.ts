import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/web-mode.spec.ts', outputDir: 'test-results/web-mode', timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:3004', headless: true, channel: 'msedge' },
  webServer: { command: 'npm start', env: { PORT: '3004', DEEPSEEK_API_KEY: '', DEEPSEEK_WEB_BASE_URL: 'http://127.0.0.1:19655/v1', DEEPSEEK_WEB_PROXY_KEY: 'test-local-key', MOSUAN_CONNECTION_FILE: '.local/web-e2e-connection.json', CHAT_PROVIDER: 'official' }, url: 'http://127.0.0.1:3004', timeout: 30000 },
});
