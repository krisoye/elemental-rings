import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// EPIC #264 / #265 — fusion-thumb double-attack engine E2E. Real PvP duel (two
// browser sessions); every assertion reads authoritative broadcast state
// (window.__room.state), never a mock. The client hold-cross-tap GESTURE is a
// separate issue (#266) — here we exercise the SERVER contract directly by
// sending `selectDoubleAttack` over the live room socket (window.__room.send),
// the same message the client will emit once #266 lands. Exact fusion-thumb
// loadouts are seeded via the test-only `__testSetState` hook (E2E_TEST_ROUTES).
//
// MUD = WATER + EARTH (ElementEnum 11). v4 triangle (Fire→Wood→Water→Fire):
// WATER attack vs WOOD defense → STRONG (a WOOD PARRY of the WATER orb rallies);
// EARTH defending is always NEUTRAL.
const WATER = 1;
const EARTH = 2;
const WOOD = 4;
const MUD = 11;

/** Seed exact state on a player via the test-only server hook. */
async function setState(
  page: Page,
  patch: {
    target?: 'self' | 'opponent';
    hearts?: number;
    uses?: Partial<Record<SlotKey, number>>;
    elements?: Partial<Record<SlotKey, number>>;
  },
): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/** Collect every broadcast of `type` into window.__msgs[type] on the page. */
async function collectMessages(page: Page, type: string): Promise<void> {
  await page.evaluate((t) => {
    const w = window as any;
    w.__msgs = w.__msgs || {};
    w.__msgs[t] = [];
    w.__room.onMessage(t, (m: any) => w.__msgs[t].push(m));
  }, type);
}

async function getMessages(page: Page, type: string): Promise<any[]> {
  return page.evaluate((t) => (window as any).__msgs?.[t] ?? [], type);
}

async function waitForPhase(page: Page, phase: string, timeout = 8000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, {
    timeout,
  });
}

/** The live impact time for orb 1 is not exposed to the client; the defender
 * presses relative to DEFEND_WINDOW entry using calibrated waits instead. */

/** Read a slot's currentUses on the local player. */
async function myUses(page: Page, slot: SlotKey): Promise<number> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me[s].currentUses;
  }, slot);
}

/** Configure the current attacker as a MUD-thumb double-attacker. */
async function seedDoubleAttacker(attacker: Page): Promise<void> {
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
}

// ── Scenario 1: eligible double attack lands ─────────────────────────────────
test('eligible double attack fires two orbs; thumb/a1/a2 each −1 use; defender takes hits', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await seedDoubleAttacker(attacker);
  await setState(defender, { hearts: 3 });
  await collectMessages(defender, 'doubleAttackStart');
  await collectMessages(defender, 'exchangeResult');

  await attacker.evaluate(() =>
    (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: 250 }),
  );

  // doubleAttackStart broadcast with both orbs + the clamped gap.
  await defender.waitForFunction(() => ((window as any).__msgs?.doubleAttackStart?.length ?? 0) >= 1, {
    timeout: 6000,
  });
  const starts = await getMessages(defender, 'doubleAttackStart');
  expect(starts[0].first).toBe('a1');
  expect(starts[0].second).toBe('a2');
  expect(starts[0].gapMs).toBe(250);

  // Use cost charged at commit: thumb/a1/a2 each 3 → 2.
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.thumb.currentUses === 2 && me.a1.currentUses === 2 && me.a2.currentUses === 2;
  }, { timeout: 4000 });
  expect(await myUses(attacker, 'thumb')).toBe(2);
  expect(await myUses(attacker, 'a1')).toBe(2);
  expect(await myUses(attacker, 'a2')).toBe(2);

  // Defender no-blocks both orbs → two exchangeResult broadcasts, two hearts lost.
  await defender.waitForFunction(() => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 2, {
    timeout: 8000,
  });
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(2);

  await closeBattle(h);
});

// ── Scenario 2: ineligible dropped ───────────────────────────────────────────
test('ineligible double attack (mismatched A1/A2) is silently dropped; no use spent', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // STEAM thumb (FIRE+WATER) but A1=WATER A2=EARTH → set mismatch → ineligible.
  const STEAM = 5;
  await setState(attacker, {
    elements: { thumb: STEAM, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await collectMessages(attacker, 'doubleAttackStart');

  await attacker.evaluate(() =>
    (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: 250 }),
  );
  await attacker.waitForTimeout(400);

  // Dropped: no broadcast, no use spent, still in ATTACK_SELECT as the attacker.
  const starts = await getMessages(attacker, 'doubleAttackStart');
  expect(starts.length).toBe(0);
  expect(await myUses(attacker, 'thumb')).toBe(3);
  expect(await myUses(attacker, 'a1')).toBe(3);
  expect(await myUses(attacker, 'a2')).toBe(3);
  const phase = await attacker.evaluate(() => (window as any).__room.state.phase);
  expect(phase).toBe('ATTACK_SELECT');

  await closeBattle(h);
});

// ── Scenario 3: parry orb 1 cancels orb 2 ────────────────────────────────────
test('PARRY on orb 1 (WOOD vs WATER) cancels orb 2 and starts orb-1 rally; 3 uses still spent', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);
  const defenderId = await defender.evaluate(() => (window as any).__room.sessionId);

  await seedDoubleAttacker(attacker);
  // Defender's d1 = WOOD → STRONG vs the WATER orb 1 (a parry rallies).
  await setState(defender, { elements: { d1: WOOD }, uses: { d1: 3 }, hearts: 3 });
  await collectMessages(defender, 'exchangeResult');
  await collectMessages(defender, 'doubleAttackCancelled');

  await attacker.evaluate(() =>
    (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: 200 }),
  );

  // Wait for the DEFEND_WINDOW then PARRY orb 1 with WOOD (D1 = key '3').
  await waitForPhase(defender, 'DEFEND_WINDOW');
  // Press near orb-1 impact for a PARRY. Impact lands TELEGRAPH_MS after launch;
  // under E2E_FAST that is 150ms. Press around there with a small lead.
  await defender.waitForTimeout(120);
  await defender.keyboard.press('3'); // D1 = WOOD → PARRY+STRONG → rally, cancels orb 2

  // The rally swaps roles: the former defender becomes the rally attacker.
  await defender.waitForFunction(
    (id) => (window as any).__room.state.currentAttackerId === id,
    defenderId,
    { timeout: 6000 },
  );
  expect(await defender.evaluate(() => (window as any).__room.state.rallyActive)).toBe(true);

  // Exactly ONE orb resolved (orb 1); orb 2 cancelled (marker broadcast).
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(1);
  expect(results[0].timing).toBe('PARRY');
  expect(results[0].relationship).toBe('STRONG');
  const cancels = await getMessages(defender, 'doubleAttackCancelled');
  expect(cancels.length).toBe(1);
  expect(cancels[0].orb).toBe(2);

  // The attacker's 3 combo uses remain spent despite the cancel.
  expect(await myUses(attacker, 'thumb')).toBe(2);
  expect(await myUses(attacker, 'a1')).toBe(2);
  expect(await myUses(attacker, 'a2')).toBe(2);
  expect(attackerId).not.toBe(defenderId);

  await closeBattle(h);
});

// ── Scenario 4: block one, parry two (defender catches orb 1, orb 2 resolves) ─
test('defender catches orb 1 (NEUTRAL, no rally) → orb 2 resolves independently (two results)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await seedDoubleAttacker(attacker);
  // Defender's D2 = EARTH → NEUTRAL vs orb 1 (no rally → orb 2 proceeds).
  await setState(defender, { elements: { d2: EARTH }, uses: { d2: 3 }, hearts: 3 });
  await collectMessages(defender, 'exchangeResult');
  await collectMessages(defender, 'doubleAttackCancelled');

  // Wide gap so orb 2's window opens well after orb 1's catch.
  await attacker.evaluate(() =>
    (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: 500 }),
  );

  await waitForPhase(defender, 'DEFEND_WINDOW');
  // Catch orb 1 with EARTH (D2 = key '4') as a NEUTRAL block (no rally).
  await defender.waitForTimeout(120);
  await defender.keyboard.press('4');

  // Both orbs ultimately resolve (orb 1 NEUTRAL catch + orb 2 independent).
  await defender.waitForFunction(() => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 2, {
    timeout: 8000,
  });
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(2);
  // Orb 1 was a NEUTRAL catch → no heart lost on orb 1.
  expect(results[0].defenderHeartsLost).toBe(0);
  // Orb 2 was NOT cancelled.
  const cancels = await getMessages(defender, 'doubleAttackCancelled');
  expect(cancels.length).toBe(0);

  await closeBattle(h);
});

// ── Scenario 5: KO on orb 1 ends the duel; orb 2 does not resolve ─────────────
test('orb 1 is the killing blow → duel ENDED; orb 2 does not resolve', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  await seedDoubleAttacker(attacker);
  // Defender on their last heart → an uncontested orb-1 hit is lethal.
  await setState(defender, { hearts: 1 });
  await collectMessages(defender, 'exchangeResult');

  await attacker.evaluate(() =>
    (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: 200 }),
  );

  // Defender no-blocks orb 1 → KO. Wait for ENDED.
  await waitForPhase(defender, 'ENDED', 8000);
  const winnerId = await defender.evaluate(() => (window as any).__room.state.winnerId);
  expect(winnerId).toBe(attackerId);

  // Only orb 1 resolved; orb 2 was cancelled by the KO. Confirm it stays at 1.
  await defender.waitForTimeout(600);
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(1);

  await closeBattle(h);
});
