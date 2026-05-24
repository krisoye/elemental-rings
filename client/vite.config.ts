import { defineConfig } from 'vite';

export default defineConfig({
  // Bind to all interfaces so other LAN machines can reach the client.
  server: { host: '0.0.0.0', port: 8080 },
  define: {
    // Empty default → the client derives the server URL from the page hostname
    // at runtime (see Connection.ts). Playwright sets VITE_SERVER_URL explicitly.
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL ?? ''),
  },
});
