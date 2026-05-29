import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  type SlotKey,
} from './helpers';

// #125 — BattleScene attack-phase input gestures (GDD §6.3): double-tap recharge,
// Z+C (a1+a2) forfeit confirm, and the recharge pulse. These drive the REAL
// Phaser client (window.__room / window.__scene) so every assertion reads
// authoritative broadcast state or the scene's own prompt flag; the gestures send
// the same `recharge`/`forfeit` messages a player would.

async function setState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

async function readSlot(page: Page, slot: SlotKey): Promise<{ currentUses: number; maxUses: number }> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return { currentUses: me[s].currentUses, maxUses: me[s].maxUses };
  }, slot);
}

async function isMyTurn(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    return room.state.phase === 'ATTACK_SELECT' && room.state.currentAttackerId === room.sessionId;
  });
}

// ── Scenario 1: double-tap Z rechrges a1 ─────────────────────────────────────
test('Double-tap Z in attack phase rechrges a1: ring use updates, no attack thrown', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Drop a1 to 1 use so the recharge restores it (no-token-or-token, the server
  // restores; with the test PvP token it spends spirit but still restores).
  await setState(attacker, { uses: { a1: 1 } });
  const before = await readSlot(attacker, 'a1');
  expect(before.currentUses).toBe(1);

  // Two Z presses inside the 300ms window → recharge a1 (NOT an attack).
  await attacker.keyboard.press('z');
  await attacker.keyboard.press('z');

  // The ring restores above its pre-tap value and the turn advances to the
  // opponent (recharge consumes the turn). An ATTACK would instead drop a1 to 0
  // and move to DEFEND_WINDOW.
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses > 1 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 5000 });

  const after = await readSlot(attacker, 'a1');
  expect(after.currentUses).toBeGreaterThan(1); // recharged, not thrown
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  await closeBattle(h);
});

// ── Scenario 2: single Z attacks ─────────────────────────────────────────────
test('Single Z in attack phase throws the normal a1 attack (no recharge)', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  const before = await readSlot(attacker, 'a1');

  await attacker.keyboard.press('z'); // one press → attack after the arming window

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  const slot = await attacker.evaluate(() => (window as any).__room.state.attackerSlot);
  expect(slot).toBe('a1');

  // An attack SPENDS a use (or Tailwind pays); it never RESTORES one.
  const after = await readSlot(attacker, 'a1');
  expect(after.currentUses).toBeLessThanOrEqual(before.currentUses);

  await closeBattle(h);
});

// ── Scenario 3: Z+C forfeit confirm → Y forfeits ─────────────────────────────
test('Z+C simultaneous in attack phase shows the forfeit confirm; Y sends forfeit', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const myId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // Press Z then C back-to-back (well within the 50ms chord window over a local
  // socket) → the a1+a2 chord raises the forfeit prompt.
  await attacker.keyboard.down('z');
  await attacker.keyboard.down('c');
  await attacker.keyboard.up('z');
  await attacker.keyboard.up('c');

  await attacker.waitForFunction(() => (window as any).__forfeitPromptOpen === true, {
    timeout: 3000,
  });

  // Confirm with Y → forfeit; the duel ends with the opponent as winner.
  await attacker.keyboard.press('y');
  await attacker.waitForFunction(
    (id) =>
      (window as any).__room.state.phase === 'ENDED' &&
      (window as any).__room.state.winnerId &&
      (window as any).__room.state.winnerId !== id,
    myId,
    { timeout: 5000 },
  );

  await closeBattle(h);
});

// ── Scenario 4: N cancels the forfeit ────────────────────────────────────────
test('Z+C forfeit confirm: N cancels and the duel stays live', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await attacker.keyboard.down('z');
  await attacker.keyboard.down('c');
  await attacker.keyboard.up('z');
  await attacker.keyboard.up('c');

  await attacker.waitForFunction(() => (window as any).__forfeitPromptOpen === true, {
    timeout: 3000,
  });

  await attacker.keyboard.press('n'); // cancel
  await attacker.waitForFunction(() => (window as any).__forfeitPromptOpen !== true, {
    timeout: 3000,
  });

  // Still the attacker's live turn — not ended.
  expect(await isMyTurn(attacker)).toBe(true);
  const phase = await attacker.evaluate(() => (window as any).__room.state.phase);
  expect(phase).toBe('ATTACK_SELECT');

  await closeBattle(h);
});

// ── Scenario 5: defense keys unaffected in DEFEND_WINDOW ─────────────────────
test('Defense phase: Z fires D1 normally, no forfeit prompt, no recharge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws; defender presses Z (→ D1) inside the catch window. Z must act
  // as a single defense press — no forfeit chord, no recharge gesture.
  await attacker.keyboard.press('1');
  await defender.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
  );
  await defender.waitForTimeout(DEFEND_BLOCK_WAIT_MS);
  await defender.keyboard.press('z'); // D1

  await waitForExchangeResult(defender);
  const result = await defender.evaluate(() => (window as any).__lastExchangeResult);
  // The defender committed D1 (a real catch) — not a NO_BLOCK, and never a forfeit.
  expect(['BLOCK', 'PARRY']).toContain(result.timing);
  expect(result.defenderSlot).toBe('d1');

  const promptOpen = await defender.evaluate(() => (window as any).__forfeitPromptOpen === true);
  expect(promptOpen).toBe(false);

  await closeBattle(h);
});
