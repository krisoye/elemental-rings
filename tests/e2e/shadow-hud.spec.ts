import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  closeBattle,
  DEFEND_PARRY_WAIT_MS,
  type SlotKey,
} from './helpers';

// #135 — client shadow gauge bar + Blinded progressive HUD hiding (own HUD only).
// Real PvP duel; shadowGauge seeded via __testSetState. The LOCAL player's
// RENDERED HUD is read from window.__hudView (the `?` substitution); the OPPONENT
// reads the same player's authoritative use counts from __room.state, which must
// stay numeric (only the Blinded player loses visibility of their OWN HUD).

const FIRE = 0;
const WATER = 1;

async function setState(
  page: Page,
  patch: { shadowGauge?: number; hearts?: number; elements?: Partial<Record<SlotKey, number>> },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Read the local player's rendered HUD view (`?` where Blinded). */
async function hudView(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => (window as any).__hudView);
}

/** Read player `pid`'s authoritative a1/a2 use counts from this page's state. */
async function oppSeesUses(page: Page, pid: string): Promise<{ a1: number; a2: number }> {
  return page.evaluate((id) => {
    const me = (window as any).__room.state.players.get(id);
    return { a1: me.a1.currentUses, a2: me.a2.currentUses };
  }, pid);
}

// ── Scenario 1: shadow bar appears, A1/A2 hidden at gauge 2 ──────────────────
test('Shadow bar appears at gauge 2; local A1/A2 use counts show `?`', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { defender } = await attackerDefender(h.p1, h.p2);

  await setState(defender, { shadowGauge: 2 });

  // Wait for the state diff to re-render the HUD with the `?` substitution.
  await defender.waitForFunction(() => {
    const v = (window as any).__hudView;
    return v && v.a1 === '?' && v.a2 === '?';
  }, { timeout: 4000 });

  const v = await hudView(defender);
  expect(v.a1).toBe('?'); // ≥ 1 hides A1
  expect(v.a2).toBe('?'); // ≥ 2 hides A2
  expect(v.d1).not.toBe('?'); // < 3 — D1 still visible
  expect(v.d2).not.toBe('?');
  expect(v.hearts).not.toBe('?'); // < 5 — hearts still visible

  await closeBattle(h);
});

// ── Scenario 2: opponent's view of the Blinded player is unaffected ──────────
test('Opponent unaffected: the opponent sees the Blinded player\'s real A1/A2', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const defenderId = await defender.evaluate(() => (window as any).__room.sessionId);

  await setState(defender, { shadowGauge: 2 });
  await defender.waitForFunction(() => (window as any).__hudView?.a1 === '?', { timeout: 4000 });

  // The defender's OWN HUD hides A1/A2.
  const own = await hudView(defender);
  expect(own.a1).toBe('?');
  expect(own.a2).toBe('?');

  // The attacker's view of the defender's rings is the authoritative numeric state.
  const opp = await oppSeesUses(attacker, defenderId);
  expect(typeof opp.a1).toBe('number');
  expect(opp.a1).toBeGreaterThanOrEqual(1);
  expect(typeof opp.a2).toBe('number');

  await closeBattle(h);
});

// ── Scenario 3: parry restores all hidden use counts immediately ─────────────
test('Restore on parry: shadowGauge 4 hides A1/A2/D1/D2; a parry clears it and all reveal', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Seed the defender Blinded at 4 (A1/A2/D1/D2 hidden) with a WATER defense ring.
  await setState(attacker, { elements: { a1: FIRE } });
  await setState(defender, { shadowGauge: 4, elements: { d2: WATER } });

  await defender.waitForFunction(() => {
    const v = (window as any).__hudView;
    return v && v.a1 === '?' && v.a2 === '?' && v.d1 === '?' && v.d2 === '?';
  }, { timeout: 4000 });

  // Defender parries FIRE with WATER → STRONG parry clears shadowGauge to 0.
  await attacker.keyboard.press('1'); // FIRE
  await defender.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = WATER → STRONG parry

  await waitForExchangeResult(defender);

  // shadowGauge → 0 and every hidden use count reveals (no longer `?`).
  await defender.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    const v = (window as any).__hudView;
    return me.shadowGauge === 0 && v && v.a1 !== '?' && v.a2 !== '?' && v.d1 !== '?' && v.d2 !== '?';
  }, { timeout: 4000 });

  const v = await hudView(defender);
  expect(v.a1).not.toBe('?');
  expect(v.a2).not.toBe('?');
  expect(v.d1).not.toBe('?');
  expect(v.d2).not.toBe('?');

  await closeBattle(h);
});

// ── Scenario 4: hearts hide at shadowGauge 5 ─────────────────────────────────
test('Hearts hide at 5: the local player\'s hearts show `?` at shadowGauge 5', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { defender } = await attackerDefender(h.p1, h.p2);

  await setState(defender, { shadowGauge: 5 });

  await defender.waitForFunction(() => (window as any).__hudView?.hearts === '?', {
    timeout: 4000,
  });

  const v = await hudView(defender);
  expect(v.hearts).toBe('?'); // ≥ 5 hides hearts
  // All four use counts are hidden too at 5.
  expect(v.a1).toBe('?');
  expect(v.a2).toBe('?');
  expect(v.d1).toBe('?');
  expect(v.d2).toBe('?');

  await closeBattle(h);
});
