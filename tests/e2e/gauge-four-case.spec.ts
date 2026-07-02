import { test, expect, type Page, type BrowserContext } from '@playwright/test';
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

  // Default loadout: a1=FIRE, a2=WATER. We seed both attack rings to 3 uses
  // (overriding the Fire thumb's all-in setup, which would otherwise have
  // poured the thumb uses onto a1) so the capacity tie resolves to a1. Seed
  // Drowning on the DEFENDER (next attacker) so the turn-start tick fires.
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

// ── Scenario 6: Fractional gauge delta — Tier-1 defender ring produces delta≈0.5
//
// The block-gauge delta formula is `1 / force(defenderRing.xp)` (#512). A Tier-0
// ring (xp<500) has force=1 → delta=1.0. A Tier-1 ring (xp>=500) has force=2 →
// delta=0.5 (unchanged from the pre-#512 `1/2^tier` formula at this exact tier —
// force(T1)=2=2^1 — so this scenario is not a regression signal for the #512
// change; it only distinguishes at Tier >= 2, see tests/unit/tiers-force.test.ts).
// This test seeds the defender's D2 ring to XP=500 (Tier-1 threshold) via the
// test-only `set-ring-xp` route BEFORE the battle starts, so the BattleRoom seats
// it with xp=500 from the DB. The defender then NEUTRAL-catches a FIRE attack with
// D2 set to FIRE, yielding fireGauge ≈ 0.5 (float32).
test('Block gauge: Tier-1 D2 ring produces fractional delta ≈ 0.5 on NEUTRAL catch', async ({
  browser,
}) => {
  const API_URL = 'http://localhost:2568';

  // ── Mint two players; set defender's D2 ring to XP=500 before battle starts ──
  const mintRes1 = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  const { token: token1 } = (await mintRes1.json()) as { token: string };

  const mintRes2 = await fetch(`${API_URL}/api/test/mint-token`, { method: 'POST' });
  const { token: token2 } = (await mintRes2.json()) as { token: string };

  // Identify the defender (p2) D2 ring id (Earth[0] in the default loadout).
  const meRes = await fetch(`${API_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token2}` },
  });
  const { loadout } = (await meRes.json()) as { loadout: Record<string, string | null> };
  const d2RingId = loadout.d2;
  if (!d2RingId) throw new Error('Defender has no D2 ring in loadout');

  // Set D2 ring XP to 500 (Tier-1 threshold) so BattleRoom seats it with xp=500.
  const xpRes = await fetch(`${API_URL}/api/test/set-ring-xp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token2}` },
    body: JSON.stringify({ ringId: d2RingId, xp: 500 }),
  });
  if (!xpRes.ok) throw new Error(`set-ring-xp failed: ${xpRes.status}`);

  // ── Inject tokens and enter a keyed battle room ──
  const p1ctx: BrowserContext = await browser.newContext({ hasTouch: true });
  const p2ctx: BrowserContext = await browser.newContext({ hasTouch: true });
  await p1ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token1)})`);
  await p2ctx.addInitScript(`localStorage.setItem('er_token', ${JSON.stringify(token2)})`);

  const roomRes = await fetch(`${API_URL}/api/test/create-battle-room`, { method: 'POST' });
  const { roomId } = (await roomRes.json()) as { roomId: string };

  const p1 = await p1ctx.newPage();
  const p2 = await p2ctx.newPage();
  const URL = 'http://localhost:8090';

  await p1.goto(URL);
  await p1.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', { timeout: 8000 });
  await p1.evaluate(() => (window as any).__campGoEncounter());
  await p1.waitForFunction(() => typeof (window as any).__encounterSelectPvP === 'function', { timeout: 10000 });
  await p1.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);
  await p1.waitForFunction(() => (window as any).__room !== null, { timeout: 8000 });

  await p2.goto(URL);
  await p2.waitForFunction(() => typeof (window as any).__campGoEncounter === 'function', { timeout: 8000 });
  await p2.evaluate(() => (window as any).__campGoEncounter());
  await p2.waitForFunction(() => typeof (window as any).__encounterSelectPvP === 'function', { timeout: 10000 });
  await p2.evaluate((id) => (window as any).__encounterSelectPvP(id), roomId);

  await p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', { timeout: 10000 });
  await p2.waitForFunction(() => (window as any).__room?.state?.phase === 'ATTACK_SELECT', { timeout: 10000 });

  const h = { p1, p2, p1ctx, p2ctx };
  const { attacker, defender } = await attackerDefender(p1, p2);

  // Override both D2 and A1 to FIRE so the matchup is NEUTRAL (FIRE-vs-FIRE).
  // The defender's D2 ring already has xp=500 from the DB; __testSetState only
  // patches in-room state (element/uses/gauges), leaving xp untouched.
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, { elements: { d2: FIRE }, hearts: 3, fireGauge: 0 });

  await attacker.keyboard.press('1'); // FIRE attack
  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = FIRE → NEUTRAL catch

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(CAUGHT).toContain(result.timing);
  expect(result.rallyContinues).toBe(false); // NEUTRAL never rallies

  // Wait for the fractional fireGauge update to propagate.
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge > 0;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  // Tier-1 ring → force = 2 → delta = 1/force = 0.5. The gauge is broadcast as float32, so
  // toBeCloseTo(0.5, 5) tolerates any float32 rounding at the 5th decimal place.
  expect(me.fireGauge).toBeCloseTo(0.5, 5);
  expect(me.hearts).toBe(3); // NEUTRAL catch loses no heart

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
  // thumb's all-in setup pours its uses onto the FIRE a1, so we pin a1/a2 to a
  // known value to assert Entangled never touches them).
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
