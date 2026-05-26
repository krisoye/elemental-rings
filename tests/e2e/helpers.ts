import type { Browser, Page, BrowserContext } from '@playwright/test';

// Port 8090 avoids colliding with the production Vite dev server on 8080.
const URL = 'http://localhost:8090';
// Phase 4+5 auth API runs on the same port as Colyseus in tests.
const API_URL = 'http://localhost:2568';

export interface BattleHandles {
  p1: Page;
  p2: Page;
  p1ctx: BrowserContext;
  p2ctx: BrowserContext;
}

/**
 * Register a fresh user on the test server and inject the JWT into the context
 * via an init script. Call this BEFORE creating pages so BootScene routes to
 * CampScene instead of LoginScene. Phase 4+5 auth gate — required for any test
 * that navigates the main app (directly or via setupBattle).
 */
export async function seedAuthToken(ctx: BrowserContext): Promise<void> {
  const username = `t_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const res = await fetch(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'test_pw' }),
  });
  if (!res.ok) throw new Error(`seedAuthToken: register failed (${res.status})`);
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
 * so each page triggers the PvP path via the deterministic `__encounterSelect`
 * hook (identical code path to clicking the PvP marker → LobbyScene →
 * connectToRoom('battle')). p1 selects first so it creates the `battle` room;
 * p2 then joins the same room. Resolves once both pages observe ATTACK_SELECT.
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

  // p1 selects PvP first (creates the room) and connects before p2 joins it.
  await p1.goto(URL);
  await campToEncounter(p1);
  await waitForEncounter(p1);
  await p1.evaluate(() => (window as any).__encounterSelect('PVP'));
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await campToEncounter(p2);
  await waitForEncounter(p2);
  await p2.evaluate(() => (window as any).__encounterSelect('PVP'));

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', {
    timeout: 10000,
  });

  return { p1, p2, p1ctx, p2ctx };
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
 * Drive a vsAI duel to a DETERMINISTIC outcome and return to CampScene.
 *
 * Uses the BattleRoomOptions AI-strength overrides (via the
 * __encounterSelectWithOverrides hook) so the result is a property of setup, not
 * combat timing:
 *   aiHearts: 1  → AI dies almost immediately → guaranteed protagonist WIN
 *   aiHearts: 99 → AI unkillable; protagonist attacks until A1+A2 are
 *                  extinguished and forfeits (§6.6) → guaranteed protagonist LOSS
 *
 * The human just attacks a1 / defends d1 every turn. The page must already be in
 * CampScene with auth seeded. Reusable by any test that needs a forced outcome.
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

  const driver = setInterval(() => {
    void page.evaluate(() => {
      const room = (window as any).__room;
      if (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      ) {
        room.send('selectAttack', { slot: 'a1' });
      } else if (
        room?.state?.phase === 'DEFEND_WINDOW' &&
        room?.state?.currentAttackerId !== room?.sessionId
      ) {
        room.send('submitDefense', { slot: 'd1' });
      }
    });
  }, 250);
  try {
    await page.waitForFunction(
      () =>
        (window as any).__room?.state?.phase === 'ENDED' &&
        !!(window as any).__room?.state?.winnerId,
      { timeout: 30000 },
    );
  } finally {
    clearInterval(driver);
  }

  // BattleScene shows a 2s banner before starting CampScene; allow ample margin.
  await page.waitForFunction(() => (window as any).__game?.scene?.isActive('CampScene'), {
    timeout: 15000,
  });
  await page.waitForFunction(() => (window as any).__campState !== undefined, { timeout: 5000 });

  return page.evaluate(() => localStorage.getItem('er_pending_ring'));
}
