import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: '**/production.spec.ts', outputDir: 'test-results/production',
  use: { baseURL: 'http://127.0.0.1:3003', headless: true, channel: 'msedge' },
  webServer: { command: 'npm start', env: { PORT: '3003', DEEPSEEK_API_KEY: '', MOSUAN_CONNECTION_FILE: '.local/production-connection.json', MOSUAN_MOBILE_KEY_FILE: '.local/production-mobile-key', CHAT_PROVIDER: 'official' }, url: 'http://127.0.0.1:3003', timeout: 30000 },
});
