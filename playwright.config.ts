import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // 1 worker prevents matchmaking cross-pairing across parallel test contexts:
  // when multiple workers run PvP tests concurrently, their p1 clients pair with
  // each other before the corresponding p2 clients connect — causing rooms with
  // wrong partners and timeouts. Sequential execution (workers=1) guarantees
  // each test's p1 pairs with its own p2.
  workers: 1,
  // 60 s accommodates vsAI duels that need up to 30 s to reach KO.
  timeout: 60000,
  use: {
    // Port 8090 avoids colliding with the production Vite dev server (port 8080).
    baseURL: 'http://localhost:8090',
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
      // Port 8090 avoids colliding with the production Vite dev server on 8080.
      port: 8090,
      env: { VITE_SERVER_URL: 'ws://localhost:2568', VITE_PORT: '8090' },
      reuseExistingServer: true,
      timeout: 20000,
    },
  ],
});
