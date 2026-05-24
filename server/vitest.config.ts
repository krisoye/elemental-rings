import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests live in the repo-root `tests/unit` directory and import
    // server source directly. Run them from the server workspace so they
    // resolve against the server's installed dependencies.
    include: ['../tests/unit/**/*.{test,spec}.ts'],
  },
});
