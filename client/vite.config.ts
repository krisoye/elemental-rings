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
  },
});
