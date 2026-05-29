import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  readMe,
  closeBattle,
  DEFEND_PARRY_WAIT_MS,
  DEFEND_LAPSE_WAIT_MS,
  type SlotKey,
} from './helpers';

// #134 — shadow gauge + Blinded extend the four-case model with a 4th gauge.
// Real PvP duel; gauges/elements seeded via __testSetState (now incl. shadowGauge).
// Mutations run through the authoritative BlockResolver/BattleRoom path. (The
// Fire-strong-block-clears-shadow+wood case is timing-precise and pinned in the
// integration suite — battle.test.ts Scenario 14 — where BLOCK vs PARRY is exact.)

const FIRE = 0;
const WATER = 1;
const SHADOW = 15;

async function setState(
  page: Page,
  patch: {
    hearts?: number;
    fireGauge?: number;
    waterGauge?: number;
    woodGauge?: number;
    shadowGauge?: number;
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

async function waitForDefend(page: Page): Promise<void> {
  await page.waitForFunction(() => (window as any).__room.state.phase === 'DEFEND_WINDOW', {
    timeout: 5000,
  });
}

// ── Scenario 1: uncontested Shadow hit fills shadowGauge ─────────────────────
test('Shadow gauge fills: an uncontested Shadow hit takes the defender 0 → 1', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, { elements: { a1: SHADOW } });
  await setState(defender, { shadowGauge: 0, hearts: 3 });

  await attacker.keyboard.press('1'); // SHADOW
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_LAPSE_WAIT_MS); // never block → uncontested hit

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(result.timing).toBe('NO_BLOCK');

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).shadowGauge === 1;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  expect(me.shadowGauge).toBe(1);

  await closeBattle(h);
});

// ── Scenario 2: a strong parry clears all four gauges (incl. shadow) ──────────
test('Parry clears four: a strong WATER parry of FIRE resets fire/water/wood/shadow to 0', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, {
    elements: { d2: WATER },
    fireGauge: 3,
    waterGauge: 2,
    woodGauge: 1,
    shadowGauge: 2,
  });

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = WATER → STRONG parry vs FIRE

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(result.timing).toBe('PARRY');
  expect(result.rallyContinues).toBe(true);

  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.fireGauge === 0 && me.waterGauge === 0 && me.woodGauge === 0 && me.shadowGauge === 0;
  }, { timeout: 4000 });

  const me = await readMe(defender);
  expect(me.fireGauge).toBe(0);
  expect(me.waterGauge).toBe(0);
  expect(me.woodGauge).toBe(0);
  expect(me.shadowGauge).toBe(0);

  await closeBattle(h);
});

// ── Scenario 3: shadowGauge caps at 5 ────────────────────────────────────────
test('Shadow cap: a Shadow hit at shadowGauge 5 stays at 5', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, { elements: { a1: SHADOW } });
  await setState(defender, { shadowGauge: 5, hearts: 3 });

  await attacker.keyboard.press('1'); // SHADOW
  await waitForDefend(defender);
  await defender.waitForTimeout(DEFEND_LAPSE_WAIT_MS); // uncontested hit → +1 (clamped)

  await waitForExchangeResult(defender);
  // Let the gauge diff (if any) settle.
  await defender.waitForFunction(
    () => (window as any).__room.state.phase !== 'RESOLVE',
    { timeout: 4000 },
  );

  const me = await readMe(defender);
  expect(me.shadowGauge).toBe(5); // clamped at the cap, not 6

  await closeBattle(h);
});
