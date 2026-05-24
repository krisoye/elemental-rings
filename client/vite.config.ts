import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 8080 },
  define: {
    __SERVER_URL__: JSON.stringify(process.env.VITE_SERVER_URL ?? 'ws://localhost:2567'),
  },
});
