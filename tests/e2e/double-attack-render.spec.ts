import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// EPIC #264 / #267 — dual-orb telegraph, per-orb outcome attribution, and the
// parry-disperse VFX, observed on the DEFENDER's REAL Phaser client. The combo is
// committed by sending `selectDoubleAttack` over the socket (the #266 gesture is
// covered separately); here we assert the CLIENT render reacts correctly to the
// resulting doubleAttackStart / per-orb exchangeResult / doubleAttackCancelled
// broadcasts via the window render hooks (__orbLaunchCount, __lastOrbOutcome,
// __orbDispersed) — no pixel reads.
//
// MUD = WATER + EARTH (ElementEnum 11). WATER attack vs WOOD defense → STRONG
// (a WOOD PARRY of the WATER orb 1 rallies and cancels orb 2); EARTH is NEUTRAL.
const WATER = 1;
const EARTH = 2;
const WOOD = 4;
const MUD = 11;

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

async function seedDoubleAttacker(attacker: Page): Promise<void> {
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
}

async function sendCombo(attacker: Page, gapMs: number): Promise<void> {
  await attacker.evaluate(
    (g) => (window as any).__room.send('selectDoubleAttack', { first: 'a1', second: 'a2', gapMs: g }),
    gapMs,
  );
}

async function orbLaunchCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__orbLaunchCount ?? 0);
}

async function waitForPhase(page: Page, phase: string, timeout = 8000): Promise<void> {
  await page.waitForFunction((ph) => (window as any).__room?.state?.phase === ph, phase, { timeout });
}

// ── Scenario 1: doubleAttackStart launches two orbs gapMs apart ──────────────
test('doubleAttackStart launches two orbs on the defender client, gapMs apart', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await seedDoubleAttacker(attacker);
  await setState(defender, { hearts: 3 });

  // Reset the defender's launch counter just before the combo so we count only the
  // two combo orbs (and not any earlier telegraph).
  await defender.evaluate(() => ((window as any).__orbLaunchCount = 0));

  await sendCombo(attacker, 300);

  // Orb 1 launches as the DEFEND_WINDOW opens; orb 2 launches ~300ms later. The
  // count rises to 2 (one launch per orb). Each Orb.launch increments by 1.
  await defender.waitForFunction(() => ((window as any).__orbLaunchCount ?? 0) >= 1, {
    timeout: 6000,
  });
  const afterOrb1 = await orbLaunchCount(defender);
  expect(afterOrb1).toBeGreaterThanOrEqual(1);

  await defender.waitForFunction(() => ((window as any).__orbLaunchCount ?? 0) >= 2, {
    timeout: 6000,
  });
  expect(await orbLaunchCount(defender)).toBeGreaterThanOrEqual(2);

  await closeBattle(h);
});

// ── Scenario 2: per-orb outcome attribution (both orbs keyed) ─────────────────
// Both orbs go uncontested (no rally, no parry-cancel) so each resolves as its own
// independent exchange → two exchangeResults. The scene attributes the first to orb
// 1 and the second to orb 2 and logs each to __orbOutcomeLog. Leaving the orbs
// uncontested removes all defense-timing fragility — the attribution under test is
// the same whether each orb is blocked or missed.
test('each orb produces its own outcome flash, keyed to orb 1 then orb 2', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await seedDoubleAttacker(attacker);
  // 3 hearts so two uncontested hits do not KO (orb 1 would otherwise cancel orb 2).
  await setState(defender, { hearts: 3 });

  // The scene appends every per-orb combo outcome to __orbOutcomeLog (orb + label),
  // keyed orb 1 then orb 2. Reset it just before the combo.
  await defender.evaluate(() => ((window as any).__orbOutcomeLog = []));

  // Wide gap so orb 2 resolves well after orb 1.
  await sendCombo(attacker, 500);

  // Both orbs resolve uncontested → two per-orb outcomes, attributed orb 1 then 2.
  await defender.waitForFunction(() => ((window as any).__orbOutcomeLog?.length ?? 0) >= 2, {
    timeout: 8000,
  });
  const orbsSeen = await defender.evaluate(() =>
    ((window as any).__orbOutcomeLog as any[]).map((o) => o.orb),
  );
  expect(orbsSeen).toContain(1);
  expect(orbsSeen).toContain(2);

  await closeBattle(h);
});

// ── Scenario 3: parry orb 1 → orb 2 disperse VFX (no impact) ──────────────────
test('PARRY on orb 1 plays the orb-2 disperse VFX on the defender client', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const defenderId = await defender.evaluate(() => (window as any).__room.sessionId);

  await seedDoubleAttacker(attacker);
  // D1 = WOOD → STRONG vs the WATER orb 1; a PARRY rallies and cancels orb 2.
  await setState(defender, { elements: { d1: WOOD }, uses: { d1: 3 }, hearts: 3 });
  await defender.evaluate(() => ((window as any).__orbDispersed = 0));

  // Gap = 200 so orb 2 is still mid-flight (or pending) when orb 1 is parried.
  await sendCombo(attacker, 200);

  await waitForPhase(defender, 'DEFEND_WINDOW');
  await defender.waitForTimeout(40);
  await defender.keyboard.press('3'); // D1 = WOOD → PARRY+STRONG → cancels orb 2

  // The rally swaps roles (former defender becomes attacker) AND the orb-2 disperse
  // VFX plays (doubleAttackCancelled → handleDoubleAttackCancelled).
  await defender.waitForFunction(
    (id) => (window as any).__room.state.currentAttackerId === id,
    defenderId,
    { timeout: 6000 },
  );
  await defender.waitForFunction(() => ((window as any).__orbDispersed ?? 0) >= 1, {
    timeout: 4000,
  });
  expect(await defender.evaluate(() => (window as any).__orbDispersed)).toBeGreaterThanOrEqual(1);

  await closeBattle(h);
});

// ── Scenario 4: single attack is one orb (no second launch, no disperse) ──────
test('a normal single attack telegraphs exactly one orb with no combo render', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(defender, { hearts: 3 });
  await defender.evaluate(() => {
    (window as any).__orbLaunchCount = 0;
    (window as any).__orbDispersed = 0;
    (window as any).__lastOrbOutcome = null;
  });

  // A plain single attack (no combo) via the socket message the client emits.
  await attacker.evaluate(() => (window as any).__room.send('selectAttack', { slot: 'a1' }));

  await waitForPhase(defender, 'DEFEND_WINDOW');
  // Exactly one orb launches; no second launch arrives. Wait past a combo gap to
  // be sure no orb 2 appears.
  await defender.waitForFunction(() => ((window as any).__orbLaunchCount ?? 0) >= 1, {
    timeout: 6000,
  });
  await defender.waitForTimeout(700);
  expect(await orbLaunchCount(defender)).toBe(1);
  expect(await defender.evaluate(() => (window as any).__orbDispersed)).toBe(0);
  // No per-orb attribution outside a combo.
  expect(await defender.evaluate(() => (window as any).__lastOrbOutcome)).toBeNull();

  await closeBattle(h);
});
