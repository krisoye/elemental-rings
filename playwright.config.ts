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
      // Use port 2568 so prod server on 2567 doesn't interfere
      command: 'cd server && PORT=2568 npm run dev',
      port: 2568,
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: 'cd client && npm run dev',
      port: 8080,
      env: { VITE_SERVER_URL: 'ws://localhost:2568' },
      reuseExistingServer: true,
      timeout: 20000,
    },
  ],
});
