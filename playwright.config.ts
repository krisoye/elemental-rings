import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:8080',
  },
  webServer: {
    command: 'npx serve tests/e2e -p 8080',
    port: 8080,
    reuseExistingServer: true,
    timeout: 10000,
  },
});
