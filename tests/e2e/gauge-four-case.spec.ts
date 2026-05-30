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

// #123 — four-case gauge model E2E (GDD §7.1). Real PvP duel (two browser
// sessions); every assertion reads authoritative broadcast state
// (window.__room.state), never a mock. Exact configurations are seeded via the
// server's test-only `__testSetState` (gated by E2E_TEST_ROUTES). The gauge
// MUTATIONS still run entirely through the authoritative BlockResolver →
// BattleRoom resolution path.
//
// Default loadout (BattleRoom DEFAULT_LOADOUT): thumb=FIRE, a1=FIRE, a2=WATER,
// d1=WOOD, d2=EARTH. We override defense/attack elements per test via
// __testSetState.elements so the matchup under test is deterministic.

const FIRE = 0;
const WATER = 1;

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

async function waitForPhase(page: Page, phase: string, timeout = 6000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, {
    timeout,
  });
}

const CAUGHT = ['BLOCK', 'PARRY'];

// ── Scenario 1: block gauge — a NEUTRAL triangle block fills the defending gauge
test('Block gauge: a NEUTRAL FIRE-vs-FIRE block fills the defender fireGauge +1, no heart', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Override the defense ring D2 to FIRE. FIRE vs FIRE is NEUTRAL — it never
  // rallies/clears regardless of BLOCK-vs-PARRY timing, so case 2 (the defending
  // ring's own gauge +1) is observed in isolation: fireGauge 0 → 1, no heart.
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, { elements: { d2: FIRE }, hearts: 3, fireGauge: 0 });

  await attacker.keyboard.press('1'); // FIRE attack
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = FIRE → NEUTRAL catch

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);
  expect(result.rallyContinues).toBe(false); // NEUTRAL never rallies/clears

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 1;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  // Gauges are float32 since #179, but these rings seed at Tier 0 (no XP) so the
  // block delta is the full 1.0 — and 1.0 === 1 in JS, so the integer assertion
  // still holds for the broadcast float value.
  expect(me.fireGauge).toBe(1); // defending ring's element gauge +1 (case 2)
  expect(me.hearts).toBe(3); // a NEUTRAL catch loses no heart

  await closeBattle(h);
});

// ── Scenario 2: Wind/Earth defense adds no block gauge ───────────────────────
test('Block gauge: an EARTH (non-triangle) block adds no gauge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Default D2 = EARTH (non-triangle, always NEUTRAL). Blocking FIRE with EARTH is
  // safe but fills NO gauge (case 2 skipped for Wind/Earth/fusion).
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, { hearts: 3, fireGauge: 0, waterGauge: 0, woodGauge: 0 });

  await attacker.keyboard.press('1'); // FIRE attack
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = EARTH → NEUTRAL catch, no gauge

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);

  // Let the diff settle, then confirm every gauge is still 0.
  await defender.waitForFunction(
    () => (window as any).__room?.state?.phase !== 'RESOLVE',
    { timeout: 4000 },
  );

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(0);
  expect(me.waterGauge).toBe(0);
  expect(me.woodGauge).toBe(0);
  expect(me.hearts).toBe(3);

  await closeBattle(h);
});

// ── Scenario 3: Parry clears all triangle gauges in one update ───────────────
test('Parry: a strong parry resets fire/water/wood gauges to 0 in one state update', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender parries FIRE with WATER (STRONG parry → clear all). Seed all three
  // gauges high so the clear is unambiguous.
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, {
    elements: { d2: WATER },
    fireGauge: 3,
    waterGauge: 2,
    woodGauge: 1,
  });

  await attacker.keyboard.press('1'); // FIRE attack
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = WATER → STRONG parry vs FIRE

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  // A strong parry rallies; confirm a genuine PARRY occurred.
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

// ── Scenario 4: Drowning drains the highest-capacity attack ring at turn start ─
test('Drowning: waterGauge>=4 drains the highest-capacity attack ring (a1/a2) at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Default loadout: a1=FIRE (max 3 after Kindling possibly), a2=WATER. Both
  // start at the same max so the tie resolves to a1. Seed Drowning on the
  // DEFENDER (next attacker) so the turn-start tick fires on their turn.
  await setState(defender, { waterGauge: 4, uses: { a1: 3, a2: 3 } });

  // Pass the turn with a clean EARTH catch (no heart, no gauge change).
  await attacker.keyboard.press('1'); // A1 FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 EARTH NEUTRAL catch
  await waitForExchangeResult(defender);

  // The former defender becomes the attacker; Drowning drained an attack ring.
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return room.state.phase === 'ATTACK_SELECT' && me.a1.currentUses === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  // Capacity tie → a1 drained 3 → 2; a2 untouched.
  expect(me.a1.currentUses).toBe(2);
  expect(me.a2.currentUses).toBe(3);

  await closeBattle(h);
});

// ── Scenario 5: Entangled drains the highest-capacity defense ring at turn start
test('Entangled: woodGauge>=4 drains the highest-capacity defense ring (d1/d2) at turn start', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Defender becomes attacker next turn. Default d1=WOOD, d2=EARTH (both max 3 →
  // tie resolves to d1). Seed Entangled and explicit attack-ring uses (the Fire
  // thumb's Kindling buffs the FIRE a1, so we pin a1/a2 to a known value to assert
  // Entangled never touches them).
  await setState(defender, { woodGauge: 4, uses: { a1: 3, a2: 3, d1: 3, d2: 3 } });

  await attacker.keyboard.press('1'); // A1 FIRE
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 EARTH NEUTRAL catch (spends a d2 use)
  await waitForExchangeResult(defender);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    // d2 was spent (3 → 2) by the catch; Entangled then drains the highest-capacity
    // STILL-usable defense ring at the next turn start (d1, the tie winner, 3 → 2).
    return room.state.phase === 'ATTACK_SELECT' && me.d1.currentUses === 2;
  }, { timeout: 6000 });

  const me = await readMe(defender);
  expect(me.d1.currentUses).toBe(2); // Entangled drained the defense ring
  // Attack rings are never touched by Entangled.
  expect(me.a1.currentUses).toBe(3);
  expect(me.a2.currentUses).toBe(3);

  await closeBattle(h);
});
