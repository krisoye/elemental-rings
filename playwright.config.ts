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
//   auth, camp, carry, compass, difficulty, fusion, overworld-transition,
//   reliquary-cap, sanctum-movement, sanctum-summon, sanctum-zones, spare-carry,
//   spirit, swamp, talisman, teleport, waystones
// Visual capture specs — run on demand via `--project visual`. Never in CI.
const VISUAL_SPECS = ['visual-capture.spec.ts'];

const PVP_SPECS = [
  'client-battle-flow.spec.ts',
  'client-connect.spec.ts',
  'client-touch.spec.ts',
  'encounter-vs-ai.spec.ts',
  'staking.spec.ts',
  'status-effects.spec.ts',
  // Battle System v2 + Shadow (EPIC #122 / #132).
  'gauge-four-case.spec.ts', // #123
  'recharge-forfeit.spec.ts', // #124
  'recharge-input.spec.ts', // #125
  'shadow-element.spec.ts', // #133
  'shadow-gauge.spec.ts', // #134
  'shadow-hud.spec.ts', // #135
  'double-attack.spec.ts', // #265 — fusion-thumb double-attack engine
  'double-attack-input.spec.ts', // #266 — hold-cross-tap gesture + forfeit relocation
  'double-attack-render.spec.ts', // #267 — dual-orb telegraph + parry-disperse VFX
  'charge-attack.spec.ts', // #485 — oscillating-orb charge + fusion ring integration
  'force-heart-loss.spec.ts', // #514 — force-scaled multi-heart loss + OQ-4 whole-exchange absorb
];
const SOLO_SPECS = [
  'auth.spec.ts',
  'blink.spec.ts',
  'camp.spec.ts',
  'carry.spec.ts',
  'compass.spec.ts',
  'difficulty.spec.ts', // EPIC #279 (#280 + #283) — difficulty tier + PUT /api/difficulty
  'difficulty-modal.spec.ts', // EPIC #279 (#284) — CampScene Settings button + DifficultyModal UI
  'forage.spec.ts',
  'forage-client.spec.ts',
  'frost-sentinel.spec.ts', // #269
  'fusion.spec.ts',
  'merge.spec.ts', // #431 — ring merge at shrines (GDD §4.7)
  'merchant.spec.ts',
  'merchant-client.spec.ts',
  'npc-population.spec.ts',
  'npc-wander.spec.ts',
  'npc-stake-element-sync.spec.ts', // #199
  'npc-xp-scaling.spec.ts', // #196
  'overworld-battlehand.spec.ts',
  'overworld-transition.spec.ts',
  'heart-slot.spec.ts',      // EPIC #302 (#306) — Heart-slot reliquary modal restructure
  'manage-battle-rings.spec.ts', // #305 / #348 — field BattleHandOverlay grouped layout + safe discard
  'overworld-hud-stats.spec.ts', // #353
  'reliquary-cap.spec.ts',   // #182
  'reliquary-modal.spec.ts',
  'ring-storage-ux.spec.ts',
  'sanctum-movement.spec.ts',
  'sanctum-summon.spec.ts',  // #180/#174
  'sanctum-zones.spec.ts',
  'spare-carry.spec.ts',     // #171
  'spare-ring-scroll.spec.ts',  // #194
  'merchant-qty-scroll.spec.ts', // #193
  'anchorage-campfire.spec.ts',  // #191
  'anchorage-campfire-qa.spec.ts', // #417 QA adversarial close-gesture tests
  'spirit.spec.ts',
  'swamp.spec.ts',
  'talisman.spec.ts',
  'teleport.spec.ts',
  'waystones.spec.ts',
  '16px-foundation.spec.ts',
  'ai-recharge-policy.spec.ts', // #197
  'spirit-hud.spec.ts', // #211
  'battle-end-modal.spec.ts', // #212
  'npc-duel-return.spec.ts', // #88 / #212 migration
  // EPIC #256 — boss combat identity. Single-context harness duels (boss-harness.html
  // → battle-ai on 2568); parallel-safe (each create yields a fresh locked room).
  'boss-fused-thumb.spec.ts', // #257
  'boss-modifiers.spec.ts', // #258
  'boss-enrage.spec.ts', // #259
  'boss-gauge-pressure.spec.ts', // #260
  'boss-passives.spec.ts', // #261
  'boss-cards.spec.ts', // #263 — two-tone fused card render + ordering (camp/REST)
  'boss-rematch.spec.ts', // #262 — TRAINING-screen rematch row + practice launch
  'ai-double-attack-offense.spec.ts', // #268 — AI fusion-thumb double-attack offense
  'monster-overworld-sprite.spec.ts', // #192 — overworld marker frame crop
  'battle-feedback.spec.ts', // #313 — battleKey threading + AI spirit broadcast
  'battle-entry-gating.spec.ts', // #319 — null-thumb 4001 guard + EncounterScene catch
  'snow-biome.spec.ts', // #335 — Snow biome v1: Frost Sentinel gate + SnowScene transitions + World Map node
  'snow-gate-boss-gate.spec.ts', // #344 — roster-authoritative boss gate, no-bypass, swamp regression
  'world-map-modal.spec.ts',    // #334 — fit-to-viewport + zoom/pan E2E
  'dom-label-contract.spec.ts', // #361 / #366 — DomLabel CSS contract + overflow regression guard
  'reliquary-header-convergence-qa.spec.ts', // #426 QA adversarial header-convergence tests
  'reset-game.spec.ts', // #477 — Restart Game affordance in CampScene Settings
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
      name: 'visual',
      testMatch: VISUAL_SPECS,
      // On-demand only — single worker to avoid port contention.
      // Driven by CAPTURE_TARGET + CAPTURE_OUT env vars; see visual-capture.spec.ts.
      fullyParallel: false,
      workers: 1,
    },
    {
      name: 'solo',
      testMatch: SOLO_SPECS,
      // Single-user tests (and single-context vsAI duels) never share a room.
      // 4 workers: enough parallelism for a 4–5× speed-up over serial while keeping
      // CPU headroom for physics-timing tests (e.g. sanctum wall-collision 4 s hold)
      // that fail when the browser's game loop is starved on a fully-loaded host.
      //
      // #312 partition (workers=1 vs workers=4): the failure set is NOT
      // starvation. The wall-collision / movement physics specs (sanctum-movement,
      // sanctum-zones bed/ring-wall/meditation) pass at BOTH worker counts. At
      // workers=1 the suite fails *more* (80 vs ~59), not less, so do NOT "fix" E2E
      // flake by lowering this number — it will not help and slows the run 5×.
      // The residual failures are genuine assertion/coordinate bugs (routed to
      // Cluster B / #311 — e.g. fusion/combine → 400, npc-xp-scaling DEFENSIVE
      // value, 16px zoom===2) plus a host-isolation race: the shared fixed ports
      // (2568/8090) + `reuseExistingServer` below mean a concurrently-running
      // workspace's webServer can be attached to or torn down mid-run, producing
      // the `mint-token 404` / `TypeError: fetch failed` cascade. Run the solo
      // suite on an otherwise-idle host (no other E2E workspace bound to 2568/8090).
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
      reuseExistingServer: true,
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
