import { defineConfig } from '@playwright/test';
export default defineConfig({
  // Formula-heavy pages compete for memory and renderer time. Keep the local
  // Edge run bounded instead of launching one browser worker per CPU core.
  workers: 2,
  testDir: './e2e', outputDir: 'test-results/reader', testIgnore: ['**/production.spec.ts', '**/web-mode.spec.ts'], timeout: 30000, use: { baseURL: 'http://127.0.0.1:5173', headless: true, channel: 'msedge' },
  webServer: { command: 'npm run dev', env: { PORT: '3002', MOSUAN_API_TARGET: 'http://127.0.0.1:3002', MOSUAN_CONNECTION_FILE: '.local/e2e-connection.json', CHAT_PROVIDER: 'official' }, url: 'http://127.0.0.1:5173', reuseExistingServer: !process.env.CI, timeout: 60000 },
});
