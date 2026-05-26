import { defineConfig } from 'vite';

export default defineConfig({
  // Bind to all interfaces so other LAN machines can reach the client.
  // VITE_PORT overrides the port (used by Playwright tests to avoid port 8080
  // which the production dev server occupies on this machine).
  server: { host: '0.0.0.0', port: Number(process.env.VITE_PORT) || 8080 },
  define: {
    // Empty default → the client derives the server URL from the page hostname
    // at runtime (see Connection.ts). Playwright sets VITE_SERVER_URL explicitly.
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL ?? ''),
    // E2E fast mode (#68): the Playwright client webServer sets VITE_E2E_FAST=1
    // so the post-duel winner banner is shown for ~0ms instead of 2s, cutting
    // dead time off every vsAI duel. Never set in production builds.
    __E2E_FAST__: JSON.stringify(process.env.VITE_E2E_FAST === '1'),
  },
});
