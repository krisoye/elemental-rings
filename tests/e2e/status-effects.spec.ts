import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  readMe,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  DEFEND_PARRY_WAIT_MS,
  type SlotKey,
} from './helpers';

// GDD §7 status-effect E2E. These drive a real PvP duel (two browser sessions)
// so every assertion reads authoritative broadcast state (window.__room.state),
// never a mock. Precise gauge values are seeded via the server's test-only
// `__testSetState` message (gated by E2E_TEST_ROUTES, set in playwright.config)
// — engineering an exact gauge through timed play is impractical, but every
// EFFECT (Burning damage, Drowning/Entangled turn-start drain, strong-parry
// clear) still runs through the authoritative server resolution paths.
//
// Default loadout (BattleRoom DEFAULT_LOADOUT): thumb=FIRE, a1=FIRE, a2=WATER,
// d1=WOOD, d2=EARTH. EARTH defense (D2='4') is always a NEUTRAL catch — it
// passes the turn safely without losing a heart and fills no gauge, so it is
// used to hand the turn over cleanly.

// Browser-path defend-window calibration (see client-battle-flow.spec.ts and
// helpers DEFEND_BLOCK_WAIT_MS): waiting this long after the window opens lands
// the press inside the catch band. Scales with E2E_FAST.
const CAUGHT = ['BLOCK', 'PARRY'];

/** Seed exact state on a player via the test-only server hook. */
async function setState(
  page: Page,
  patch: {
    target?: 'self' | 'opponent';
    hearts?: number;
    fireGauge?: number;
    waterGauge?: number;
    woodGauge?: number;
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Wait for a named phase on a page. */
async function waitForPhase(page: Page, phase: string, timeout = 6000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, { timeout });
}

/** True iff this page is the current attacker. */
async function isAttacker(page: Page): Promise<boolean> {
  return page.evaluate(
    () => (window as any).__room.sessionId === (window as any).__room.state.currentAttackerId,
  );
}

/**
 * Drive one full exchange where `attacker` throws A1 (FIRE) and `defender`
 * catches safely with D2 (EARTH, always NEUTRAL — no heart, no cleanse). Resolves
 * once both pages observe a turn boundary (ATTACK_SELECT or ENDED). Used to pass
 * the turn so the start-of-turn status tick fires for the next attacker.
 */
async function passTurnViaSafeCatch(attacker: Page, defender: Page): Promise<void> {
  await attacker.keyboard.press('1'); // A1 = FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = EARTH → NEUTRAL catch
  await waitForExchangeResult(defender);
  await attacker.waitForFunction(
    () => ['ATTACK_SELECT', 'ENDED'].includes((window as any).__room?.state?.phase),
    { timeout: 6000 },
  );
}

// ── Scenario 1: Burning deals heart damage at turn start ────────────────────
test('Burning: fireGauge>=4 costs the afflicted player a heart at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Seed Burning (fireGauge=4) on the DEFENDER — they become the attacker next
  // turn, when the start-of-turn tick fires. Keep them at 3 hearts so the only
  // heart change is the Burning tick.
  await setState(defender, { fireGauge: 4, hearts: 3 });

  // Pass the turn via a clean EARTH catch (no heart loss, no fire cleanse).
  await passTurnViaSafeCatch(attacker, defender);

  // The former defender is now the attacker; Burning fired at turn entry.
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return room.state.phase === 'ATTACK_SELECT' && me.hearts === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.hearts).toBe(2);
  expect(me.fireGauge).toBe(4); // still Burning (no cleanse occurred)
  expect(await isAttacker(defender)).toBe(true);

  await closeBattle(h);
});

// ── Scenario 2: Burning can KO at turn start (opponent wins) ────────────────
test('Burning: KOs an afflicted player at 1 heart; opponent wins', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // Defender becomes next attacker at 1 heart with Burning → KO on turn start.
  await setState(defender, { fireGauge: 4, hearts: 1 });

  await passTurnViaSafeCatch(attacker, defender);

  // The Burning tick KOs the former defender before they can act → ENDED, the
  // other player wins.
  await defender.waitForFunction(() => (window as any).__room?.state?.phase === 'ENDED', {
    timeout: 6000,
  });
  const winnerId = await defender.evaluate(() => (window as any).__room.state.winnerId);
  expect(winnerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 3: Drowning drains the highest-capacity attack ring at turn start
test('Drowning: waterGauge>=4 drains the highest-capacity attack ring at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender becomes attacker next turn. Default a1=FIRE, a2=WATER (equal max →
  // tie resolves to a1). Seed Drowning and equal uses; v2 Drowning is a
  // turn-start ATTACK-ring drain, NOT a per-throw surcharge.
  await setState(defender, { waterGauge: 4, uses: { a1: 3, a2: 3 } });

  await passTurnViaSafeCatch(attacker, defender);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return room.state.phase === 'ATTACK_SELECT' && me.a1.currentUses === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.a1.currentUses).toBe(2); // capacity tie → a1 drained 3 → 2
  expect(me.a2.currentUses).toBe(3); // a2 untouched

  await closeBattle(h);
});

// ── Scenario 4: Entangled drains the highest-capacity defense ring at turn start
test('Entangled: woodGauge>=4 drains the highest-capacity defense ring at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender becomes attacker next turn. Default d1=WOOD, d2=EARTH (equal max →
  // tie resolves to d1). v2 Entangled drains a DEFENSE ring at turn start. Seed
  // attack-ring uses too (the Fire thumb's all-in setup pours uses onto the FIRE
  // a1) so the "attack rings untouched" assertion is exact.
  await setState(defender, { woodGauge: 4, uses: { a1: 3, a2: 3, d1: 3, d2: 3 } });

  await passTurnViaSafeCatch(attacker, defender);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    // The turn-passing catch spent d2 (EARTH) 3 → 2; Entangled then drains the
    // highest-capacity still-usable defense ring (d1, the tie winner) 3 → 2.
    return room.state.phase === 'ATTACK_SELECT' && me.d1.currentUses === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.d1.currentUses).toBe(2); // Entangled drained the defense ring
  // Attack rings are never touched by Entangled.
  expect(me.a1.currentUses).toBe(3);
  expect(me.a2.currentUses).toBe(3);

  await closeBattle(h);
});

// ── Scenario 5: a strong parry clears the triangle gauges ────────────────────
test('Parry clears gauges: a strong WATER parry of FIRE resets all triangle gauges to 0', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender holds a WATER defense ring (D2) with all three gauges seeded. A WATER
  // PARRY of FIRE is STRONG → rally + clear-all (case 4): every gauge → 0.
  await setState(attacker, { elements: { a1: 0 /* FIRE */ } });
  await setState(defender, {
    elements: { d2: 1 /* WATER */ },
    fireGauge: 3,
    waterGauge: 2,
    woodGauge: 1,
  });

  await attacker.keyboard.press('1'); // FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = WATER → STRONG parry vs FIRE

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(result.timing).toBe('PARRY');
  expect(result.rallyContinues).toBe(true);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 0 && me.waterGauge === 0 && me.woodGauge === 0;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(0);
  expect(me.waterGauge).toBe(0);
  expect(me.woodGauge).toBe(0);

  await closeBattle(h);
});

// ── Scenario 6: clearing fire below threshold lifts Burning ──────────────────
test('Parry-clear lifts Burning: a Burning defender who parries drops below threshold', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender at fireGauge=4 (Burning) with a WATER defense ring (D2). A WATER PARRY
  // of FIRE clears all gauges (case 4) → fireGauge 0, lifting Burning (gauge <
  // threshold). The observable: Burning is no longer active (fireGauge below the
  // STATUS_THRESHOLD of 4) and the parry cost no heart.
  await setState(attacker, { elements: { a1: 0 /* FIRE */ } });
  await setState(defender, { fireGauge: 4, hearts: 3, elements: { d2: 1 /* WATER */ } });

  await attacker.keyboard.press('1'); // A1 = FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = WATER → STRONG parry of FIRE

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(result.timing).toBe('PARRY');

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 0;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(0); // cleared below the threshold → Burning lifted
  expect(me.hearts).toBe(3); // the parry cost no heart

  await closeBattle(h);
});
