import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  waitForMyHearts,
  waitForMyRingUses,
  waitForMyGauge,
  readMe,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  DEFEND_PARRY_WAIT_MS,
  DEFEND_LAPSE_WAIT_MS,
} from './helpers';

// Defense-press calibration against the server's DEFEND_WINDOW through the real
// browser + Phaser keyboard path (~60ms latency over a raw socket). The exact
// waits are centralized in helpers (DEFEND_BLOCK_WAIT_MS / DEFEND_PARRY_WAIT_MS /
// DEFEND_LAPSE_WAIT_MS) and scale with E2E_FAST: normal mode keeps the proven
// 700/880/1500ms (impact at +900ms), fast mode shrinks them (impact at +150ms).
// The "successful catch" assertions accept BLOCK or PARRY — both are valid
// catches with identical relationship handling — to tolerate parallel-load
// jitter near the PARRY boundary.
const CAUGHT = ['BLOCK', 'PARRY'];

/** Wait for the live DEFEND_WINDOW phase on the given page. */
async function waitForDefendWindow(page: Page): Promise<void> {
  await page.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
}

/** Read the last broadcast exchange result as a plain object. */
async function lastResult(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__lastExchangeResult);
}

test('scenario 2: attacker presses A1 (key 1) -> DEFEND_WINDOW, attackerSlot=a1', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // A1 = FIRE

  await waitForDefendWindow(attacker);
  const [phase, slot, result] = await attacker.evaluate(() => {
    const s = (window as any).__room.state;
    return [s.phase, s.attackerSlot, (window as any).__lastExchangeResult];
  });
  expect(phase).toBe('DEFEND_WINDOW');
  expect(slot).toBe('a1');
  expect(result).toBeNull();

  await closeBattle(h);
});

test('scenario 3: BLOCK + NEUTRAL costs a use, no heart', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // A1 = FIRE
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('4'); // D2 = EARTH — always NEUTRAL

  await waitForExchangeResult(defender);
  const result = await lastResult(defender);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('NEUTRAL');
  expect(result.defenderHeartLost).toBe(false);

  // Wait for the use decrement diff to apply, then confirm no heart was lost.
  await waitForMyRingUses(defender, 'd2', 2);
  const me = await readMe(defender);
  expect(me.d2.currentUses).toBe(2);
  expect(me.hearts).toBe(3);

  await closeBattle(h);
});

test('scenario 4: BLOCK + WEAK loses a heart', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // A1 = FIRE
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('3'); // D1 = WOOD — FIRE beats WOOD => WEAK

  await waitForExchangeResult(defender);
  const result = await lastResult(defender);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('WEAK');
  expect(result.defenderHeartLost).toBe(true);

  // Wait for the heart-loss diff to apply before asserting on state.
  await waitForMyHearts(defender, 2);
  await waitForMyRingUses(defender, 'd1', 2);
  const me = await readMe(defender);
  expect(me.hearts).toBe(2);
  expect(me.d1.currentUses).toBe(2); // WOOD ring

  await closeBattle(h);
});

test('scenario 5: NO_BLOCK lands the attack and fills the gauge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefendWindow(defender);
  // Never press — let the DEFEND_WINDOW timer fully elapse → NO_BLOCK.
  await defender.waitForTimeout(DEFEND_LAPSE_WAIT_MS);

  await waitForExchangeResult(defender);
  const result = await lastResult(defender);
  expect(result.timing).toBe('NO_BLOCK');

  // Wait for the heart-loss and gauge-fill diffs to apply.
  await waitForMyHearts(defender, 2);
  await waitForMyGauge(defender, 'fireGauge', 1);
  const me = await readMe(defender);
  expect(me.hearts).toBe(2);
  expect(me.fireGauge).toBe(1);

  await closeBattle(h);
});

test('scenario 6: uncontested FIRE attacks score a KO', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Capture the round-1 attacker: with no defenses and roles swapping each
  // NO_BLOCK exchange, this player lands hits on rounds 1, 3, 5 and reaches the
  // KO first, so they are the expected winner.
  const firstAttackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // Drive whichever player currently holds the attack each round. Neither side
  // defends, so each exchange resolves NO_BLOCK and costs the defender a heart.
  for (let round = 0; round < 6; round++) {
    const ended = await h.p1.evaluate(() => (window as any).__room?.state?.phase === 'ENDED');
    if (ended) break;

    await h.p1.waitForFunction(
      () => ['ATTACK_SELECT', 'ENDED'].includes((window as any).__room?.state?.phase),
      { timeout: 5000 },
    );
    if (await h.p1.evaluate(() => (window as any).__room?.state?.phase === 'ENDED')) break;

    const p1IsAttacker = await h.p1.evaluate(
      () => (window as any).__room.sessionId === (window as any).__room.state.currentAttackerId,
    );
    const current = p1IsAttacker ? h.p1 : h.p2;
    await current.keyboard.press('1');

    // Wait for the orb to leave (DEFEND_WINDOW), then for the NO_BLOCK timer to
    // resolve the exchange back to a turn boundary or game over.
    await h.p1.waitForFunction(
      () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
      { timeout: 3000 },
    );
    await h.p1.waitForFunction(
      () => ['ATTACK_SELECT', 'ENDED'].includes((window as any).__room?.state?.phase),
      { timeout: 4000 },
    );
  }

  await h.p1.waitForFunction(() => (window as any).__room?.state?.phase === 'ENDED', {
    timeout: 5000,
  });
  const winnerId = await h.p1.evaluate(() => (window as any).__room.state.winnerId);
  expect(winnerId).toBe(firstAttackerId);

  await closeBattle(h);
});

test('scenario 8: PARRY+STRONG triggers rally and fires return orb', async ({ browser }) => {
  // WATER(a2) attack, WOOD(d1) defense in PARRY timing → STRONG → rally.
  // Verifies: rallyContinues=true in exchangeResult, attacker is now rally-defender
  // (sees DEFEND! banner), and the return orb fires (__orbLaunchCount === 2).
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Reset orb count on both pages for clean measurement
  await attacker.evaluate(() => { (window as any).__orbLaunchCount = 0; });
  await defender.evaluate(() => { (window as any).__orbLaunchCount = 0; });

  // Attacker throws WATER (A2 = key '2')
  await attacker.keyboard.press('2');

  // Defender waits for DEFEND_WINDOW then presses WOOD (D1 = key '3') just before
  // impact, inside the parry window. WOOD beats WATER → STRONG → rally.
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(DEFEND_PARRY_WAIT_MS);
  await defender.keyboard.press('3'); // WOOD

  // Wait for exchangeResult to confirm rallyContinues
  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  expect(result.rallyContinues).toBe(true);
  expect(result.relationship).toBe('STRONG');

  // Original attacker should now be the rally-defender — phase DEFEND_WINDOW
  await attacker.waitForFunction(
    () => (window as any).__room?.state?.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  const rallyActive = await attacker.evaluate(
    () => (window as any).__room?.state?.rallyActive,
  );
  expect(rallyActive).toBe(true);

  // Two orbs should have launched on the attacker's screen:
  // 1st = their original FIRE throw, 2nd = WATER volley coming back
  const orbCount = await attacker.evaluate(() => (window as any).__orbLaunchCount);
  expect(orbCount).toBe(2);

  await closeBattle(h);
});

test('scenario 7: opponent attack reveals their element to the defender', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws FIRE (slot 0). Defender does not block.
  await attacker.keyboard.press('1');
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(DEFEND_LAPSE_WAIT_MS);
  await waitForExchangeResult(defender);

  // The defender's scene should have recorded FIRE (element 0) as revealed.
  const revealed = await defender.evaluate(() =>
    Array.from((window as any).__scene.revealedOpponentElements as Set<number>),
  );
  expect(revealed).toContain(0);

  await closeBattle(h);
});
