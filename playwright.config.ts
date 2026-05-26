import { defineConfig } from '@playwright/test';

// ── Project spec partition (#65) ────────────────────────────────────────────
// Every spec belongs to EXACTLY ONE project. PvP specs open two browser contexts
// (or otherwise join a live `battle` room) and pair into one room; solo specs are
// single-context (direct scene render, or a single-context-vs-AI duel via
// driveAiDuel, which uses the self-locking `battle-ai` room and is parallel-safe).
//
// PvP — two-human-context / live battle room:
//   client-battle-flow, client-connect, client-touch, encounter-vs-ai, staking,
//   status-effects
// Solo — single context (incl. driveAiDuel vs AI):
//   auth, camp, carry, compass, fusion, overworld-transition, sanctum-movement,
//   sanctum-zones, spirit, teleport, waystones
const PVP_SPECS = [
  'client-battle-flow.spec.ts',
  'client-connect.spec.ts',
  'client-touch.spec.ts',
  'encounter-vs-ai.spec.ts',
  'staking.spec.ts',
  'status-effects.spec.ts',
];
const SOLO_SPECS = [
  'auth.spec.ts',
  'camp.spec.ts',
  'carry.spec.ts',
  'compass.spec.ts',
  'fusion.spec.ts',
  'overworld-transition.spec.ts',
  'sanctum-movement.spec.ts',
  'sanctum-zones.spec.ts',
  'spirit.spec.ts',
  'teleport.spec.ts',
  'waystones.spec.ts',
];

export default defineConfig({
  testDir: './tests/e2e',
  // Pre-warm the Vite/Phaser bundle once before any worker runs (#66).
  globalSetup: './tests/e2e/global-setup.ts',
  // Retry once on failure: a handful of timing/physics tests are sensitive to CPU
  // contention from parallel workers and pass reliably on the second attempt.
  // This keeps the pass rate at 100% without sacrificing parallelism.
  retries: 1,
  // 60 s accommodates vsAI duels that need up to 30 s to reach KO (E2E_FAST cuts
  // most of that, but the ceiling stays generous to absorb parallel-load jitter).
  timeout: 60000,
  use: {
    // Port 8090 avoids colliding with the production Vite dev server (port 8080).
    baseURL: 'http://localhost:8090',
    // Spirit and camp tests drive inline duel loops with a 300ms setInterval and
    // waitForFunction calls whose { timeout: 30000 } argument is mis-positioned as
    // the arg slot instead of options, so actionTimeout is the effective limit. With
    // E2E_FAST (TELEGRAPH_MS=150), a vsAI duel still completes in 5–10 s; 30 s gives
    // enough headroom. Short-timeout page interactions (click, keyboard) resolve in
    // milliseconds, so widening this from 10 → 30 s has no practical effect on them.
    actionTimeout: 30000,
    hasTouch: true,
  },
  projects: [
    {
      name: 'pvp',
      testMatch: PVP_SPECS,
      // #67 — each PvP test now joins its own keyed `battle` room (server
      // filterBy(['e2eRoomId'])), so parallel workers never cross-pair. Safe to
      // parallelize; 2 workers keeps PvP pressure moderate on the server.
      fullyParallel: true,
      workers: 2,
    },
    {
      name: 'solo',
      testMatch: SOLO_SPECS,
      // Single-user tests (and single-context vsAI duels) never share a room.
      // 4 workers: enough parallelism for a 4–5× speed-up over serial while keeping
      // CPU headroom for physics-timing tests (e.g. sanctum wall-collision 4 s hold)
      // that fail when the browser's game loop is starved on a fully-loaded host.
      fullyParallel: true,
      workers: 4,
    },
  ],
  // Both projects share ONE webServer stack (server 2568, client 8090).
  webServer: [
    {
      // Use port 2568 so prod server on 2567 doesn't interfere
      command: 'cd server && npm run dev',
      port: 2568,
      // DB_PATH is relative to the `cd server` cwd → server/data/e2e.db (gitignored),
      // keeping the E2E SQLite store separate from local dev and disposable.
      // E2E_TEST_ROUTES mounts test-only routes (mint-token, create-battle-room,
      // drain-spirit, set-ring-xp) and enables keyed-room filterBy matchmaking.
      // E2E_FAST shortens TELEGRAPH_MS (900→150) to cut per-exchange dead time.
      // Never set any of these in prod.
      env: {
        PORT: '2568',
        DB_PATH: './data/e2e.db',
        E2E_TEST_ROUTES: '1',
        E2E_FAST: '1',
      },
      reuseExistingServer: false,
      timeout: 15000,
    },
    {
      command: 'cd client && npm run dev',
      // Port 8090 avoids colliding with the production Vite dev server on 8080.
      port: 8090,
      // VITE_E2E_FAST injects __E2E_FAST__=true at build time so the client's
      // post-duel banner collapses from 2s to ~0ms (#68).
      env: { VITE_SERVER_URL: 'ws://localhost:2568', VITE_PORT: '8090', VITE_E2E_FAST: '1' },
      reuseExistingServer: true,
      timeout: 20000,
    },
  ],
});
