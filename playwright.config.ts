import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 20000,
  use: {
    baseURL: 'http://localhost:8080',
    actionTimeout: 10000,
    hasTouch: true,
  },
  webServer: [
    {
      command: 'cd server && npm run dev',
      port: 2567,
      reuseExistingServer: true,
      timeout: 15000,
    },
    {
      command: 'cd client && npm run dev',
      port: 8080,
      reuseExistingServer: true,
      timeout: 20000,
    },
  ],
});
