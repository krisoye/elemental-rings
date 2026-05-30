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

// The PvP battle pages are token-backed (seedAuthToken injects er_token), so a
// test can hit /api/me + /api/test/set-spirit for the same DB player whose rings
// recharge in-duel. These exercise the spirit-gated path (#188 defense recharge).
const API_URL = 'http://localhost:2568';
const SPIRIT_PER_RING_USE = 1; // mirrors server/src/game/constants.ts

async function tokenOf(page: Page): Promise<string> {
  return page.evaluate(() => localStorage.getItem('er_token') as string);
}

async function spiritOf(token: string): Promise<number> {
  const res = await fetch(`${API_URL}/api/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`/api/me failed (${res.status})`);
  return (await res.json()).player.spirit_current as number;
}

async function setSpirit(token: string, spirit: number): Promise<void> {
  const res = await fetch(`${API_URL}/api/test/set-spirit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ spirit }),
  });
  if (!res.ok) throw new Error(`/api/test/set-spirit failed (${res.status})`);
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
  // Wait for the seed diff to apply before reading (the __testSetState mutation
  // arrives as a separate broadcast patch).
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });
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

// ── #188 Scenario 6: double-tap `4` recharges d2, restores uses, spends spirit ─
test('Double-tap 4 in attack phase recharges d2: uses restored, spirit spent, turn passes', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const token = await tokenOf(attacker);

  // Deplete d2 in the live battle state so the recharge has a deficit to cover,
  // and seat plenty of spirit so the full deficit is affordable.
  await setState(attacker, { uses: { d2: 0 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).d2.currentUses === 0;
  }, { timeout: 4000 });
  await setSpirit(token, 50);

  const d2Max = (await readSlot(attacker, 'd2')).maxUses;
  const spiritBefore = await spiritOf(token);

  // Two `4` presses inside the (fast=120ms) double-tap window → recharge d2.
  await attacker.keyboard.press('4');
  await attacker.keyboard.press('4');

  // d2 restores above 0 and the turn advances to the opponent (recharge consumes
  // the turn). A lone/first defense press would do nothing.
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.d2.currentUses > 0 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 5000 });

  const after = await readSlot(attacker, 'd2');
  expect(after.currentUses).toBe(d2Max); // fully restored (spirit was ample)
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  // Spirit dropped by restored × SPIRIT_PER_RING_USE.
  const restored = after.currentUses - 0;
  const spiritAfter = await spiritOf(token);
  expect(spiritAfter).toBe(spiritBefore - restored * SPIRIT_PER_RING_USE);

  await closeBattle(h);
});

// ── #188 Scenario 7: insufficient spirit → partial/no-op but turn still consumed
test('Double-tap 3 on depleted d1 with no spirit: no restore but the turn is still consumed', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const token = await tokenOf(attacker);

  // Deplete d1 and drain spirit to 0 → nothing is affordable.
  await setState(attacker, { uses: { d1: 0 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).d1.currentUses === 0;
  }, { timeout: 4000 });
  await setSpirit(token, 0);
  expect(await spiritOf(token)).toBe(0);

  // Double-tap `3` → recharge d1. With zero affordable spirit the ring stays at 0
  // but the turn is still consumed (the recharge always advances the turn).
  await attacker.keyboard.press('3');
  await attacker.keyboard.press('3');

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 5000 });

  const after = await readSlot(attacker, 'd1');
  expect(after.currentUses).toBe(0); // no spirit → no restore (no-op)
  expect(await isMyTurn(attacker)).toBe(false); // but the turn was consumed
  expect(await spiritOf(token)).toBe(0); // nothing spent

  await closeBattle(h);
});

// ── #188 Scenario 8: forfeit chord 3+4 still raises the forfeit prompt ─────────
test('3+4 simultaneous in attack phase still shows the forfeit confirm (no regression)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Press `3` then `4` back-to-back (well within FORFEIT_CHORD_MS over a local
  // socket) → the d1+d2 chord raises the forfeit prompt. The new defense-recharge
  // branch runs AFTER the chord check, so it must not shadow the forfeit.
  await attacker.keyboard.down('3');
  await attacker.keyboard.down('4');
  await attacker.keyboard.up('3');
  await attacker.keyboard.up('4');

  await attacker.waitForFunction(() => (window as any).__forfeitPromptOpen === true, {
    timeout: 3000,
  });

  // Still the attacker's live turn — the prompt is open, the duel has not ended.
  expect(await isMyTurn(attacker)).toBe(true);

  await closeBattle(h);
});
