import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests (pure logic) and integration tests (@colyseus/testing,
    // full Room round-trips over a real WebSocket transport) both live in
    // the repo-root `tests/` directory and import server source directly.
    // Run them from the server workspace so they resolve against the
    // server's installed dependencies.
    include: [
      '../tests/unit/**/*.{test,spec}.ts',
      '../tests/integration/**/*.{test,spec}.ts',
    ],
    testTimeout: 15000,
    // The integration tests boot a real Colyseus server (WebSocket transport).
    // Vitest's default `forks` pool crashes during IPC result serialization
    // when colyseus server objects cross the worker boundary
    // ("Buffer.from ... Received an instance of Object"). The `threads` pool
    // uses MessageChannel/structured-clone and handles this correctly.
    pool: 'threads',
  },
});
