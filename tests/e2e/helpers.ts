import type { Browser, Page, BrowserContext } from '@playwright/test';

// Port 8090 avoids colliding with the production Vite dev server on 8080.
const URL = 'http://localhost:8090';
// Phase 4+5 auth API runs on the same port as Colyseus in tests.
const API_URL = 'http://localhost:2568';

// E2E fast mode (#68). The Playwright test PROCESS reads E2E_FAST from its env
// (the npm `test:e2e` script sets it, matching the SERVER/CLIENT webServer env).
// When set, the server's TELEGRAPH_MS drops 900 → 150 (impact lands ~150ms after
// the defend window opens instead of 900ms), so all wall-clock-relative defense
// timings here are scaled to keep presses inside the catch band.
export const E2E_FAST = process.env.E2E_FAST === '1';

// Server timing (mirrors server/src/game/constants.ts): the defend window opens,
// impact lands TELEGRAPH_MS later (900ms normal / 150ms fast), and a defense
// press is classified by |arrival − impact| (≤175 PARRY, ≤200 BLOCK). The waits
// below are derived so presses arrive just before impact in either mode.

/**
 * How long to wait after the DEFEND_WINDOW opens before pressing a defense so the
 * press ARRIVES just before impact → a comfortable PARRY/BLOCK with margin
 * against the ~60ms browser+Phaser keyboard latency. We target arrival a little
 * BEFORE impact (impact − ~80ms of headroom, minus the ~60ms transport latency),
 * which lands well inside the ±175ms PARRY band in both normal and fast mode.
 * Normal mode ≈ 760ms (the historic 700ms calibration, unchanged); fast mode ≈
 * 30ms (impact at 150ms, latency carries arrival to ~90ms → offset ~−60ms).
 */
export const DEFEND_BLOCK_WAIT_MS = E2E_FAST ? 30 : 700;

/**
 * Wait for a PARRY-timed press: arrive as close to impact as the band allows so a
 * STRONG catch rallies (PARRY requires |offset| ≤ 175). Slightly later than the
 * BLOCK wait. Normal mode = 880ms (the historic just-before-900ms-impact value);
 * fast mode = 60ms (arrival ~120ms vs 150ms impact → offset ~−30ms → PARRY).
 */
export const DEFEND_PARRY_WAIT_MS = E2E_FAST ? 60 : 880;

/** A waitForTimeout long enough for the DEFEND_WINDOW to fully elapse → NO_BLOCK. */
export const DEFEND_LAPSE_WAIT_MS = E2E_FAST ? 600 : 1500;

export interface BattleHandles {
  p1: Page;
  p2: Page;
  p1ctx: BrowserContext;
  p2ctx: BrowserContext;
}

/**
 * 8E (#107) — restart ForestScene on a specific Forest region screen and wait for it
 * to fully load (the screen id is published + the waystone roster has been fetched).
 * Lets a test stand on any of the 15 generated Forest screens directly instead of
 * walking the hub, which after #107 no longer carries the per-screen catalog objects.
 * The page must already be in a live spatial scene (CampScene or ForestScene) so the
 * active-scene global is set; the helper stops it and starts ForestScene with the
 * requested screenId.
 */
export async function enterForestScreen(page: Page, screenId: string): Promise<void> {
  await page.evaluate((sid) => {
    const active = (window as any).__activeScene;
    if (active) (window as any).__game.scene.stop(active);
    (window as any).__game.scene.start('ForestScene', { screenId: sid });
  }, screenId);
  await page.waitForFunction((sid) => (window as any).__forestScreenId === sid, screenId, {
    timeout: 8000,
  });
  // loadWaystones publishes __waystones + __zoneCenters once the roster is fetched.
  await page.waitForFunction(() => !!(window as any).__waystones, { timeout: 8000 });
  await page.waitForFunction(() => !!(window as any).__zoneCenters, { timeout: 8000 });
}

/**
 * Provision a fresh player on the test server and inject the JWT into the context
 * via an init script. Call this BEFORE creating pages so BootScene routes to
 * CampScene instead of LoginScene. Phase 4+5 auth gate — required for any test
 * that navigates the main app (directly or via setupBattle).
 *
 * Uses the test-only /api/test/mint-token route (#66) instead of /auth/register:
 * it seeds the identical player (starter inventory + default loadout +
 * forest_entry attunement via createPlayer) but skips the deliberately-slow
 * bcrypt hash, which otherwise dominates per-test setup once the suite runs in
 * parallel.
 */
export async function seedAuthToken(ctx: BrowserContext): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  if (!res.ok) throw new Error(`seedAuthToken: mint-token failed (${res.status})`);
  const { token } = (await res.json()) as { token: string };
  // Init scripts run before every page load in this context, so er_token is
  // present when BootScene.create() checks localStorage.
  await ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token)})`);
}

/**
 * Wait for the CampScene placeholder to expose its __campGoEncounter hook,
 * then fire it to transition into EncounterScene. Use after page.goto() when
 * auth is seeded, to bridge the Phase 4+5 CampScene into the Encounter hub.
 */
export async function campToEncounter(page: Page): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as any).__campGoEncounter === 'function',
    { timeout: 8000 },
  );
  await page.evaluate(() => (window as any).__campGoEncounter());
}

/** Wait until the EncounterScene hub is active and its selection hook is ready. */
export async function waitForEncounter(page: import('@playwright/test').Page): Promise<void> {
  // EncounterScene.create() sets window.__encounterSelect; the scene's shutdown
  // handler clears it to undefined. Checking for the function is sufficient:
  // it is truthy during Encounter and falsy everywhere else.
  await page.waitForFunction(
    () => typeof (window as any).__encounterSelect === 'function',
    { timeout: 10000 },
  );
}

/**
 * Open two independent browser contexts (two distinct Colyseus sessions) and
 * drive them into a live PvP battle. After the Phase-3 routing change the page
 * lands in the EncounterScene and connects to nothing until a selection fires,
 * so each page triggers the PvP path via the deterministic `__encounterSelectPvP`
 * hook (identical code path to clicking the PvP marker → LobbyScene →
 * connectToRoom('battle', { e2eRoomId })).
 *
 * #67 — each call mints a UNIQUE room id and both contexts join 'battle' keyed
 * by it. With the server's `filterBy(['e2eRoomId'])` matchmaking, only these two
 * contexts ever pair, so parallel Playwright workers never cross-pair. p1 selects
 * first and waits until its keyed room exists before p2 joins it. Resolves once
 * both pages observe ATTACK_SELECT.
 */
export async function setupBattle(browser: Browser): Promise<BattleHandles> {
  const p1ctx = await browser.newContext({ hasTouch: true });
  const p2ctx = await browser.newContext({ hasTouch: true });

  // Phase 4+5: BootScene now requires auth. Seed a JWT into each context so
  // BootScene routes to CampScene instead of LoginScene.
  await seedAuthToken(p1ctx);
  await seedAuthToken(p2ctx);

  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();

  // Mint a unique room key so this duel is isolated from every other worker.
  const roomId = await createBattleRoomId();

  // p1 selects PvP first (creates the keyed room) and connects before p2 joins.
  await p1.goto(URL);
  await campToEncounter(p1);
  await waitForEncounter(p1);
  await p1.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await campToEncounter(p2);
  await waitForEncounter(p2);
  await p2.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });

  return { p1, p2, p1ctx, p2ctx };
}

/** Mint a unique keyed-room id via the test-only route (#67). */
async function createBattleRoomId(): Promise<string> {
  const res = await fetch(`${API_URL}/api/test/create-battle-room`, { method: 'POST' });
  if (!res.ok) throw new Error(`createBattleRoomId: failed (${res.status})`);
  const { roomId } = (await res.json()) as { roomId: string };
  return roomId;
}

/** Determine which page is the current attacker / defender from server state. */
export async function attackerDefender(
  p1: Page,
  p2: Page,
): Promise<{ attacker: Page; defender: Page }> {
  const p1IsAttacker = await p1.evaluate(
    () => (window as any).__room?.sessionId === (window as any).__room?.state?.currentAttackerId,
  );
  return p1IsAttacker ? { attacker: p1, defender: p2 } : { attacker: p2, defender: p1 };
}

/** Wait until the page records a non-null exchange result. */
export async function waitForExchangeResult(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(() => (window as any).__lastExchangeResult !== null, { timeout });
}

/**
 * Wait until the local player's hearts equal the expected value. The
 * `exchangeResult` message and the BattleState heart/use diffs are delivered
 * separately, so tests must wait for the diff to apply before asserting on
 * state — not just for the message.
 */
export async function waitForMyHearts(page: Page, hearts: number, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (h) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return me?.hearts === h;
    },
    hearts,
    { timeout },
  );
}

/** A named loadout slot key. */
export type SlotKey = 'thumb' | 'a1' | 'a2' | 'd1' | 'd2';

/** Wait until a specific named slot's remaining uses equal the expected value. */
export async function waitForMyRingUses(
  page: Page,
  slot: SlotKey,
  uses: number,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    ({ s, u }) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return me?.[s]?.currentUses === u;
    },
    { s: slot, u: uses },
    { timeout },
  );
}

/** Triangle gauge keys (FIRE/WATER/WOOD only — no earth/wind gauge). */
export type GaugeKey = 'fireGauge' | 'waterGauge' | 'woodGauge';

/** Wait until a named triangle gauge on the local player reaches the expected value. */
export async function waitForMyGauge(
  page: Page,
  key: GaugeKey,
  value: number,
  timeout = 5000,
): Promise<void> {
  await page.waitForFunction(
    ({ k, v }) => {
      const room = (window as any).__room;
      const me = room?.state?.players?.get(room.sessionId);
      return (me?.[k] ?? 0) === v;
    },
    { k: key, v: value },
    { timeout },
  );
}

/** Read the local player's current PlayerState as a plain JS snapshot. */
export async function readMe(page: Page): Promise<any> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    const me = room?.state?.players?.get(room.sessionId);
    if (!me) return null;
    const slot = (k: string) => ({
      element: me[k].element,
      currentUses: me[k].currentUses,
      isExtinguished: me[k].isExtinguished,
    });
    return {
      hearts: me.hearts,
      fireGauge: me.fireGauge ?? 0,
      waterGauge: me.waterGauge ?? 0,
      woodGauge: me.woodGauge ?? 0,
      shadowGauge: me.shadowGauge ?? 0,
      thumb: slot('thumb'),
      a1: slot('a1'),
      a2: slot('a2'),
      d1: slot('d1'),
      d2: slot('d2'),
    };
  });
}

export async function closeBattle(handles: BattleHandles): Promise<void> {
  await handles.p1ctx.close();
  await handles.p2ctx.close();
}

/**
 * Drive a vsAI duel to a DETERMINISTIC outcome and return to EncounterScene.
 *
 * Uses the BattleRoomOptions AI-strength overrides (via the
 * __encounterSelectWithOverrides hook) so the result is a property of setup, not
 * combat timing:
 *   aiHearts: 1  → AI dies almost immediately → guaranteed protagonist WIN
 *   aiHearts: 99 → AI unkillable; protagonist attacks until A1+A2 are
 *                  extinguished and forfeits (§6.6) → guaranteed protagonist LOSS
 *
 * The human just attacks a1 / defends d1 every turn. The page must already be in
 * CampScene with auth seeded. After the battle BattleScene returns to
 * EncounterScene (not Sanctum). Reusable by any test that needs a forced outcome.
 *
 * @returns the won ring id (from er_pending_ring) on a win, else null.
 */
export async function driveAiDuel(
  page: Page,
  opts: { personality?: string; aiHearts?: number; aiUses?: number } = {},
): Promise<string | null> {
  const personality = opts.personality ?? 'AGGRESSIVE';

  await page.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', {
    timeout: 8000,
  });
  await page.evaluate(() => (window as any).__campGoEncounter());
  await page.waitForFunction(
    () => typeof (window as any).__encounterSelectWithOverrides === 'function',
    { timeout: 10000 },
  );
  await page.evaluate(
    ({ p, ah, au }) =>
      (window as any).__encounterSelectWithOverrides(p, { aiHearts: ah, aiUses: au }),
    { p: personality, ah: opts.aiHearts, au: opts.aiUses },
  );

  // Poll interval: the driver fires selectAttack/submitDefense whenever it sees
  // the right phase. Under fast mode TELEGRAPH drops to 150ms (DEFEND_WINDOW =
  // 350ms), so we poll at 80ms to guarantee a defense lands inside the (shorter)
  // window with margin; normal mode keeps the proven 250ms cadence.
  const pollMs = E2E_FAST ? 80 : 250;
  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        // Fall back to a2 when a1 is extinguished so forced-loss duels (aiHearts:99)
        // progress through both attack rings. When BOTH are extinguished, ring
        // exhaustion no longer auto-loses (#124) — the protagonist must `forfeit`
        // explicitly to end the duel (the §6.3 escape hatch). Without this, the
        // deadlocked turn would never resolve.
        const me = room.state.players.get(room.sessionId);
        const a1Dead = !!me?.a1?.isExtinguished;
        const a2Dead = !!me?.a2?.isExtinguished;
        if (a1Dead && a2Dead) {
          room.send('forfeit');
        } else {
          room.send('selectAttack', { slot: a1Dead ? 'a2' : 'a1' });
        }
      } else if (
        room?.state?.phase === 'DEFEND_WINDOW' &&
        room?.state?.currentAttackerId !== room?.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, pollMs);
  try {
    // Fast mode collapses per-exchange wind-up + the banner, so the whole duel
    // resolves much sooner; keep the timeout generous enough to avoid flakes.
    await page.waitForFunction(
      () =>
        (window as any).__room?.state?.phase === 'ENDED' &&
        !!(window as any).__room?.state?.winnerId,
      { timeout: E2E_FAST ? 10000 : 30000 },
    );
  } finally {
    clearInterval(driver);
  }

  // BattleScene shows a winner banner (2s normal / ~0ms fast) before starting
  // EncounterScene; allow margin.
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('EncounterScene'), {
    timeout: E2E_FAST ? 5000 : 15000,
  });
  await page.waitForFunction(
    () => typeof (window as any).__encounterSelect === 'function',
    { timeout: 5000 },
  );

  return page.evaluate(() => localStorage.getItem('er_pending_ring'));
}
