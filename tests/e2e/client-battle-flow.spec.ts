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
} from './helpers';

// Calibrated against the server's DEFEND_WINDOW (impact at attack+900ms, BLOCK
// band ±180ms) through the real browser + Phaser keyboard path, which adds
// ~60ms of latency over a raw socket. Sleeping ~700ms after the defend window
// opens lands the defense arrival inside the catch window (browser path:
// <=640ms => MISTIME, 680–720ms => BLOCK, >=740ms => PARRY). Because parallel
// browser load adds jitter near the PARRY boundary, the "successful catch"
// assertions below accept either BLOCK or PARRY — both are valid catches with
// identical relationship handling. The MISTIME boundary is the one we stay
// clear of, so we keep the sleep at the high-MISTIME-margin end of the band.
const BLOCK_SLEEP_MS = 700;
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

test('scenario 2: attacker selects slot 0 -> DEFEND_WINDOW', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1');

  await waitForDefendWindow(attacker);
  const [phase, slot, result] = await attacker.evaluate(() => {
    const s = (window as any).__room.state;
    return [s.phase, s.attackerSelectedSlot, (window as any).__lastExchangeResult];
  });
  expect(phase).toBe('DEFEND_WINDOW');
  expect(slot).toBe(0);
  expect(result).toBeNull();

  await closeBattle(h);
});

test('scenario 3: BLOCK + NEUTRAL costs a use, no heart', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(BLOCK_SLEEP_MS);
  await defender.keyboard.press('1'); // FIRE vs FIRE = NEUTRAL

  await waitForExchangeResult(defender);
  const result = await lastResult(defender);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('NEUTRAL');
  expect(result.defenderHeartLost).toBe(false);

  // Wait for the use decrement diff to apply, then confirm no heart was lost.
  await waitForMyRingUses(defender, 0, 2);
  const me = await readMe(defender);
  expect(me.hand[0].currentUses).toBe(2);
  expect(me.hearts).toBe(3);

  await closeBattle(h);
});

test('scenario 4: BLOCK + WEAK loses a heart', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(BLOCK_SLEEP_MS);
  await defender.keyboard.press('5'); // WOOD — FIRE beats WOOD => WEAK

  await waitForExchangeResult(defender);
  const result = await lastResult(defender);
  expect(CAUGHT).toContain(result.timing);
  expect(result.relationship).toBe('WEAK');
  expect(result.defenderHeartLost).toBe(true);

  // Wait for the heart-loss diff to apply before asserting on state.
  await waitForMyHearts(defender, 2);
  await waitForMyRingUses(defender, 4, 2);
  const me = await readMe(defender);
  expect(me.hearts).toBe(2);
  expect(me.hand[4].currentUses).toBe(2); // WOOD ring

  await closeBattle(h);
});

test('scenario 5: NO_BLOCK lands the attack and fills the gauge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.press('1'); // FIRE
  await waitForDefendWindow(defender);
  // Never press — let the DEFEND_WINDOW timer (1080ms) elapse.
  await defender.waitForTimeout(1500);

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
  // FIRE(0) attack, WATER(1) defense in PARRY timing → STRONG → rally.
  // Verifies: rallyContinues=true in exchangeResult, attacker is now rally-defender
  // (sees DEFEND! banner), and the return orb fires (__orbLaunchCount === 2).
  // Depends on fix/rally-orb-visual (DEFEND_WINDOW→DEFEND_WINDOW detection).
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Reset orb count on both pages for clean measurement
  await attacker.evaluate(() => { (window as any).__orbLaunchCount = 0; });
  await defender.evaluate(() => { (window as any).__orbLaunchCount = 0; });

  // Attacker throws FIRE (slot 0 = key '1')
  await attacker.keyboard.press('1');

  // Defender waits for DEFEND_WINDOW then presses WATER (slot 1 = key '2')
  // at ~880ms — just before impact (900ms), inside ±175ms parry window.
  await waitForDefendWindow(defender);
  await defender.waitForTimeout(880);
  await defender.keyboard.press('2'); // WATER

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
  await defender.waitForTimeout(1500);
  await waitForExchangeResult(defender);

  // The defender's scene should have recorded FIRE (element 0) as revealed.
  const revealed = await defender.evaluate(() =>
    Array.from((window as any).__scene.revealedOpponentElements as Set<number>),
  );
  expect(revealed).toContain(0);

  await closeBattle(h);
});
