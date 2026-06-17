import { test, expect, type Page } from '@playwright/test';
import {
  setupBattle,
  attackerDefender,
  waitForExchangeResult,
  closeBattle,
  DEFEND_BLOCK_WAIT_MS,
  type SlotKey,
} from './helpers';

// #487 — R-key recharge input overhaul (replaces double-tap recharge from #125).
// BattleScene attack-phase input gestures (GDD §6.3): R-key arms recharge state,
// ring-key completes it, Esc/timeout/R-again cancels. These drive the REAL Phaser
// client (window.__room / window.__scene) via real keyboard input only — __* hooks
// are used ONLY for READING state, never for driving input.

async function setState(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate((p) => (window as any).__room.send('__testSetState', p), patch);
}

/**
 * Convert logical Phaser canvas coordinates (1024×576 space) to page coordinates,
 * accounting for any CSS or browser scaling applied to the <canvas> element.
 * Mirrors the helper in anchorage-campfire.spec.ts.
 */
async function canvasCoords(
  page: Page,
  logicalX: number,
  logicalY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').first().boundingBox();
  if (!box) throw new Error('canvas element not found');
  const scaleX = box.width / 1024;
  const scaleY = box.height / 576;
  return {
    x: Math.round(box.x + logicalX * scaleX),
    y: Math.round(box.y + logicalY * scaleY),
  };
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

/**
 * Wait until it is the given page's turn as attacker in ATTACK_SELECT phase.
 * Gate before any real keyboard input — ensures the key handler is both wired
 * (BattleScene mounted) and logically active (it is this player's turn).
 */
async function waitForMyAttackTurn(page: Page, timeout = 15000): Promise<void> {
  await page.waitForFunction(
    () => {
      const room = (window as any).__room;
      return (
        room?.state?.phase === 'ATTACK_SELECT' &&
        room?.state?.currentAttackerId === room?.sessionId
      );
    },
    { timeout },
  );
}

/**
 * Install a spy on room.send that counts outgoing messages by type.
 * Use getSentCount() to assert no unwanted messages were emitted.
 */
async function spyOnAllSends(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__allSends = {};
    const orig = w.__room.send.bind(w.__room);
    w.__room.send = (type: string, payload: any) => {
      w.__allSends[type] = (w.__allSends[type] ?? 0) + 1;
      return orig(type, payload);
    };
  });
}

async function getSentCount(page: Page, type: string): Promise<number> {
  return page.evaluate((t) => (window as any).__allSends?.[t] ?? 0, type);
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

// ── Scenario 1: R then `1` recharges a1 ──────────────────────────────────────
// #487 Tests to Update: was "Double-tap Z recharges a1" — rewritten to R-key path.
test('R then 1 in attack phase recharges a1: ring use restored, no attack thrown, turn advances', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 adversarial: R-key arms the recharge state; the next ring key sends
  // `recharge` NOT `selectAttack`. No double-tap window timing dependency — the R
  // gesture is a clean two-step modal.
  await setState(attacker, { uses: { a1: 1 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });
  const before = await readSlot(attacker, 'a1');
  expect(before.currentUses).toBe(1);

  await waitForMyAttackTurn(attacker);

  // Step 1: press R to arm recharge state. Brief tick so armRecharge's timer is live.
  // Step 2: press 1 to complete recharge. Real keyboard input — not __* hooks.
  await attacker.keyboard.press('r');
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('1');

  // The ring restores above its pre-tap value and the turn advances to the opponent
  // (recharge consumes the turn). An ATTACK would instead drop a1 to 0 and move to
  // DEFEND_WINDOW.
  // Gate on recharge arrival before asserting state, then wait for turn-advance.
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses > 1 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  const after = await readSlot(attacker, 'a1');
  expect(after.currentUses).toBeGreaterThan(1); // recharged, not thrown
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  await closeBattle(h);
});

// ── Scenario 2: single key attacks immediately (no arming-window delay) ───────
// #487 Tests to Update: updated to assert immediate selectAttack without the removed
// RECHARGE_DOUBLE_TAP_MS deferral. `pendingAttackTimer` is gone — key-up fires immediately.
test('Single 1 in attack phase throws the normal a1 attack immediately (no arming-window delay)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  const before = await readSlot(attacker, 'a1');

  // #487 adversarial: without the RECHARGE_DOUBLE_TAP_MS pendingAttackTimer, a
  // single key press must land selectAttack on the server immediately on key-up —
  // no 120ms+ wait that was previously needed to confirm "not a double-tap". The
  // tap threshold is now handled entirely by the hold timer in onAttackHold.
  await attacker.keyboard.press('1'); // one press → attack fires on release

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 8000 },
  );
  const slot = await attacker.evaluate(() => (window as any).__room.state.attackerSlot);
  expect(slot).toBe('a1');

  // An attack SPENDS a use (or Tailwind pays); it never RESTORES one.
  const after = await readSlot(attacker, 'a1');
  expect(after.currentUses).toBeLessThanOrEqual(before.currentUses);

  // No recharge message was sent (single press, not R-key armed).
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 3: D1+D2 (3+4) forfeit confirm → Y forfeits ──────────────────────
// EPIC #266 relocated the forfeit chord from A1+A2 (Z+C) to D1+D2 (3+4). Y still
// confirms the forfeit; the duel ends with the opponent as winner.
test('3+4 simultaneous in attack phase shows the forfeit confirm; Y sends forfeit', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const myId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // Press 3 then 4 back-to-back (well within FORFEIT_CHORD_MS over a local socket)
  // → the d1+d2 chord raises the forfeit prompt.
  await attacker.keyboard.down('3');
  await attacker.keyboard.down('4');
  await attacker.keyboard.up('3');
  await attacker.keyboard.up('4');

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

// ── Scenario 4: Z+C (A1+A2) no longer forfeits ───────────────────────────────
// EPIC #266 — the A1+A2 attack-sibling chord no longer forfeits (that space is
// freed for the double-attack gesture). On the DEFAULT hand (FIRE base thumb) the
// combo is ineligible, so Z+C sends NO selectDoubleAttack and NO forfeit — the
// keys behave as ordinary single attacks (the last one arms an attack).
test('Z+C in attack phase no longer forfeits and sends no double attack on an ineligible hand', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await attacker.evaluate(() => {
    const w = window as any;
    w.__msgs = { selectDoubleAttack: [] };
    // selectDoubleAttack is a CLIENT→server message; assert the client never sent
    // it by spying on room.send.
    const orig = w.__room.send.bind(w.__room);
    w.__room.send = (type: string, payload: any) => {
      if (type === 'selectDoubleAttack') w.__msgs.selectDoubleAttack.push(payload);
      return orig(type, payload);
    };
  });

  await attacker.keyboard.down('z');
  await attacker.keyboard.down('c');
  await attacker.keyboard.up('z');
  await attacker.keyboard.up('c');

  // No forfeit prompt is raised (the A1+A2 chord no longer forfeits, #266).
  await attacker.waitForTimeout(300);
  expect(await attacker.evaluate(() => (window as any).__forfeitPromptOpen === true)).toBe(false);
  // No double attack sent either (the default FIRE-base-thumb hand is ineligible).
  // The keys instead behave as ordinary single attacks (covered by scenario 2).
  const sent = await attacker.evaluate(() => (window as any).__msgs.selectDoubleAttack);
  expect(sent.length).toBe(0);

  await closeBattle(h);
});

// ── Scenario 5: defense keys unaffected in DEFEND_WINDOW ─────────────────────
test('Defense phase: Z fires D1 normally, no forfeit prompt, no recharge', async ({ browser }) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // Attacker throws; defender presses Z (→ D1) inside the catch window. Z must act
  // as a single defense press — no forfeit chord, no recharge gesture.
  // Gate: ensure it is the attacker's turn and BattleScene is mounted before pressing.
  // Without this gate the keypress fires before the scene is ready → DEFEND_WINDOW never opens.
  await waitForMyAttackTurn(attacker);
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

// ── Scenario 6: R then `4` recharges d2 ──────────────────────────────────────
// #487 Tests to Update: was "Double-tap `4` recharges d2" — rewritten to R-key path.
// Confirms attack-ring and defense-ring recharge share the same R-key entry point.
test('R then 4 in attack phase recharges d2: uses restored, spirit spent, turn passes', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const token = await tokenOf(attacker);

  // #487 adversarial: R-key recharge unifies attack-ring (a1/a2) and defense-ring
  // (d1/d2) recharge under one gesture. Previously these were separate double-tap
  // branches that were timing-sensitive and prone to accidental trigger. Pressing R
  // then a defense-ring key (3 or 4) must complete a defense recharge, not a no-op.
  await setState(attacker, { uses: { d2: 0 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).d2.currentUses === 0;
  }, { timeout: 4000 });
  await setSpirit(token, 50);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  const d2Max = (await readSlot(attacker, 'd2')).maxUses;
  const spiritBefore = await spiritOf(token);

  // Step 1: press R to arm recharge state. Brief tick so armRecharge's timer is live.
  // Step 2: press 4 to complete d2 recharge.
  await attacker.keyboard.press('r');
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('4');

  // Gate on recharge arrival before asserting state (removes flaky race under PvP load).
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  // d2 restores above 0 and the turn advances to the opponent (recharge consumes
  // the turn).
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.d2.currentUses > 0 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  const after = await readSlot(attacker, 'd2');
  expect(after.currentUses).toBe(d2Max); // fully restored (spirit was ample)
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  // Spirit dropped by restored × SPIRIT_PER_RING_USE.
  const restored = after.currentUses - 0;
  const spiritAfter = await spiritOf(token);
  expect(spiritAfter).toBe(spiritBefore - restored * SPIRIT_PER_RING_USE);

  await closeBattle(h);
});

// ── Scenario 7: R then `3` on depleted d1 with no spirit ─────────────────────
// #487 Tests to Update: was "Double-tap `3` on depleted d1 with no spirit" — rewritten.
// The recharge turn is still consumed; spirit was 0 so no actual restore occurs.
test('R then 3 on depleted d1 with no spirit: no restore but the turn is still consumed', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const token = await tokenOf(attacker);

  // #487 adversarial: spirit=0 means the server cannot afford any ring use — the
  // recharge is sent and consumed as a turn action, but the ring stays at 0 uses.
  // Previously this was a double-tap on `3`; now R-key arms, `3` sends the recharge.
  await setState(attacker, { uses: { d1: 0 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).d1.currentUses === 0;
  }, { timeout: 4000 });
  await setSpirit(token, 0);
  expect(await spiritOf(token)).toBe(0);

  await waitForMyAttackTurn(attacker);
  // Small tick after turn gate so Phaser's key handlers are definitely ready.
  await attacker.waitForTimeout(50);

  // R to arm, then 3 to complete — recharge d1. With zero affordable spirit the
  // ring stays at 0 but the turn is still consumed (recharge always advances the turn).
  // Brief tick so armRecharge's timer is live before the completion key fires.
  await attacker.keyboard.press('r');
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('3');

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  const after = await readSlot(attacker, 'd1');
  expect(after.currentUses).toBe(0); // no spirit → no restore (no-op)
  expect(await isMyTurn(attacker)).toBe(false); // but the turn was consumed
  expect(await spiritOf(token)).toBe(0); // nothing spent

  await closeBattle(h);
});

// ── Scenario 8: forfeit chord 3+4 not broken by R-key restructure ────────────
// #487 Tests to Update: was "3+4 chord — no regression" (Scenario 8 from #188).
// Re-confirms that after pendingAttackTimer removal, the forfeit chord still fires.
test('3+4 simultaneous in attack phase still shows the forfeit confirm (no regression after #487)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 adversarial: the R-key handler and the removal of pendingAttackTimer must
  // not shadow the forfeit chord. The chord check in handleAttackPhasePress must still
  // fire BEFORE any R-armed recharge logic, so a clean 3+4 gesture triggers the prompt
  // even with the new input model in place.
  await waitForMyAttackTurn(attacker);
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

// ── Scenario 9 (NEW): R then Esc cancels recharge-armed state ────────────────
test('R then Esc in attack phase cancels recharge-armed state: no recharge sent, subsequent 1 attacks normally', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // #487 adversarial: Esc is one of three cancellation paths for recharge-armed state
  // (Esc, R-again, 2500ms timeout). After cancellation, the mode must be fully reset —
  // pressing a ring key must send selectAttack (normal attack), not recharge.
  // If Esc doesn't cancel, the subsequent `1` press would send recharge not selectAttack,
  // leaving the player stuck in recharge mode for the rest of their turn.
  await attacker.keyboard.press('r'); // arm recharge
  // Brief tick so armRecharge's timer is live before the Escape fires.
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('Escape'); // cancel

  // Give the client a moment to process the cancel before the next key.
  await attacker.waitForTimeout(100);

  // Now pressing 1 should send a normal attack, not recharge.
  await attacker.keyboard.press('1');

  // Gate on selectAttack arrival before asserting count (removes flaky race under PvP load).
  await attacker.waitForFunction(
    () => ((window as any).__allSends?.selectAttack ?? 0) >= 1,
    { timeout: 8000 },
  );

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 8000 },
  );

  // No recharge was sent — cancelled correctly.
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  // The attack slot is a1 — the press went through as a normal attack.
  const attackerSlot = await attacker.evaluate(() => (window as any).__room.state.attackerSlot);
  expect(attackerSlot).toBe('a1');

  await closeBattle(h);
});

// ── Scenario 10 (NEW): R again cancels recharge-armed state ──────────────────
test('R then R again in attack phase cancels recharge-armed state: no recharge sent', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // #487 adversarial: pressing R while already armed must cancel the armed state
  // (toggle-off), not send a recharge for some undefined slot. This prevents a
  // player from accidentally locking themselves into recharge mode indefinitely.
  await attacker.keyboard.press('r'); // arm
  // Brief tick so armRecharge's timer is live before the cancellation R fires.
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('r'); // cancel via second R

  // Give the client a moment to process the cancel.
  await attacker.waitForTimeout(100);

  // Press 1 — should attack normally since recharge was cancelled.
  await attacker.keyboard.press('1');

  // Gate on selectAttack arrival before asserting count (removes flaky race under PvP load).
  await attacker.waitForFunction(
    () => ((window as any).__allSends?.selectAttack ?? 0) >= 1,
    { timeout: 8000 },
  );

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 8000 },
  );

  // No recharge was sent.
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 11 (NEW): 2500ms timeout auto-cancels recharge-armed state ──────
test('R during attack phase then 2500ms timeout: recharge-armed state auto-cancels, next 1 attacks', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // #487 adversarial: the ~2500ms auto-cancel prevents a player from accidentally
  // arming recharge and walking away, leaving their turn frozen. After the timeout,
  // the next ring key must behave as a normal attack, not a recharge completion.
  // If the timeout does not cancel, the subsequent key press would incorrectly send
  // a recharge and consume the turn's attack slot as a recharge.
  await attacker.keyboard.press('r'); // arm recharge

  // Wait for the auto-cancel timeout (2500ms + some buffer for async processing).
  await attacker.waitForTimeout(3000);

  // Pressing 1 now should send a normal attack, not complete a recharge.
  await attacker.keyboard.press('1');

  // Gate on selectAttack arrival before asserting count (removes flaky race under PvP load).
  await attacker.waitForFunction(
    () => ((window as any).__allSends?.selectAttack ?? 0) >= 1,
    { timeout: 8000 },
  );

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 8000 },
  );

  // No recharge was sent — auto-cancel worked.
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  const attackerSlot = await attacker.evaluate(() => (window as any).__room.state.attackerSlot);
  expect(attackerSlot).toBe('a1');

  await closeBattle(h);
});

// ── Scenario 12 (NEW): off-turn R is a no-op ─────────────────────────────────
test('Off-turn R (during opponent ATTACK_SELECT) is a no-op: rechargeArmed stays false, no server message', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  // We need the OTHER player to be the attacker so we can test the non-attacker R press.
  // attackerDefender returns the player whose ATTACK_SELECT fires first.
  // We use the DEFENDER's page to press R while it's the attacker's turn.
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await spyOnAllSends(defender);

  // #487 adversarial: R pressed when it is NOT the player's turn must be ignored
  // entirely — no recharge message, no UI state change (rechargeArmed stays false).
  // Without this guard, a player could arm recharge out-of-turn and then have it
  // fire unexpectedly when the turn eventually reaches them.
  // Ensure it's the ATTACKER's turn, so it is NOT the defender's turn.
  await waitForMyAttackTurn(attacker);

  // The defender is not the attacker right now — R press should be off-turn no-op.
  await defender.keyboard.press('r');

  // Wait a moment to allow any async server message to propagate.
  await attacker.waitForTimeout(300);

  // No recharge or any other unexpected message sent from the defender.
  expect(await getSentCount(defender, 'recharge')).toBe(0);
  expect(await getSentCount(defender, 'selectAttack')).toBe(0);

  // #487 impl: BattleScene.armRecharge() sets window.__rechargeArmed = true;
  // cancelRecharge() sets it back to false. Off-turn R must never call armRecharge,
  // so the hook must remain false (its default — never set to true).
  const rechargeArmed = await defender.evaluate(() => (window as any).__rechargeArmed ?? false);
  expect(rechargeArmed).toBe(false);

  await closeBattle(h);
});

// ── Scenario 13 (NEW): R → z completes recharge for a1 (z is alias for 1) ────
test('R then z in attack phase recharges a1: z key is treated as slot-1 ring in recharge-armed mode', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 adversarial: `z` has always mapped to a1/d1 in GDD §6.3. In recharge-armed
  // mode, `z` must be treated as a slot-key for ring a1 (same as pressing `1`).
  // If `z` is not wired to the recharge completion handler, the player cannot use
  // their familiar `z` binding to recharge and is stuck until timeout.
  await setState(attacker, { uses: { a1: 1 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  await attacker.keyboard.press('r'); // arm recharge
  // Brief tick so armRecharge's timer is live before the completion key fires.
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('z'); // z = slot 1 → complete recharge for a1

  // Gate on recharge arrival before asserting state (removes flaky race under PvP load).
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses > 1 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  // Recharge fired, no selectAttack.
  expect(await getSentCount(attacker, 'recharge')).toBe(1);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 14 (NEW): R → 3 recharges d1 (confirms unified A+D recharge path) ─
test('R then 3 in attack phase recharges d1: confirms A-ring and D-ring share single R-key path', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const token = await tokenOf(attacker);

  // #487 E2E Scenario 2: "R then 3 → recharge D1 (defense ring)" — this confirms
  // that attack-ring and defense-ring recharge share the same R-key path, replacing
  // two separate double-tap branches (one for attack rings, one for defense rings).
  await setState(attacker, { uses: { d1: 1 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).d1.currentUses === 1;
  }, { timeout: 4000 });
  await setSpirit(token, 50);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  const beforeUses = (await readSlot(attacker, 'd1')).currentUses;

  // Brief tick so armRecharge's timer is live before the completion key fires.
  await attacker.keyboard.press('r');
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('3');

  // Gate on recharge arrival before asserting state (removes flaky race under PvP load).
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  // Pass beforeUses as an arg so it's serialized into the browser context — Node-side
  // variables cannot be referenced directly inside page.waitForFunction closures.
  await attacker.waitForFunction((prev: number) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.d1.currentUses > prev || room.state.currentAttackerId !== room.sessionId;
  }, beforeUses, { timeout: 8000 });

  const after = await readSlot(attacker, 'd1');
  expect(after.currentUses).toBeGreaterThanOrEqual(beforeUses);
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  // Recharge fired (not selectAttack or releaseAttack).
  expect(await getSentCount(attacker, 'recharge')).toBe(1);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 15 (NEW/P2): recharge + tap race — no spurious attack on tap ────
// #487 P1 bug: completeRecharge fires synchronously; the coincident onAttackHold
// keydown (same DOM event) must be suppressed via rechargeCompletedSlot marker.
test('R then quick tap on 1 completes recharge and sends NO spurious attack or chargeStart', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 adversarial: keyboard.press() fires keydown + keyup in one call. On keydown
  // completeRecharge runs (triggered by triggerSlot); on the same event, onAttackHold
  // would also fire and arm chargeStartTimer — unless the rechargeCompletedSlot marker
  // suppresses it. Without the marker: chargeStart fires ~150ms after press, leaking an
  // unwanted charge cycle into the already-recharged turn (which has moved on).
  // This test proves the marker works: recharge==1, selectAttack==0, chargeStart==0.
  await setState(attacker, { uses: { a1: 1 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  await attacker.keyboard.press('r'); // arm recharge
  // Small tick after R to ensure armRecharge's timer is live before the completion press.
  await attacker.waitForTimeout(50);
  await attacker.keyboard.press('1'); // quick tap — completeRecharge fires on keydown

  // Gate on recharge send-count first (confirms completeRecharge ran and room.send fired
  // before we assert the absence of other messages). This removes the flaky race where
  // the 250ms timer fired before the recharge round-trip completed, giving a count of 0.
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  // Turn must advance (recharge consumed it) — gate before counting spurious messages.
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  // Wait long enough for any suppressed chargeStartTimer (150ms) to fire if the marker
  // were absent — a leak would surface within this window.
  await attacker.waitForTimeout(250);

  expect(await getSentCount(attacker, 'recharge')).toBe(1);      // recharge fired
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);  // no legacy attack
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);   // no leaked charge start
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0); // no phantom release

  // rechargeArmed must be false after completion.
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed ?? false)).toBe(false);

  await closeBattle(h);
});

// ── Scenario 16 (NEW/P2): recharge + hold race — no spurious orb on hold ─────
// Same P1 race but with a HOLD (≥150ms) instead of a tap on the completion key.
test('R then hold on 1 (≥150ms) completes recharge and spawns NO charge orb', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 adversarial: keyboard.down() fires keydown; completeRecharge runs immediately.
  // The rechargeCompletedSlot marker must prevent onAttackHold from arming chargeStartTimer.
  // Without the marker: holding for 200ms after keydown arms a timer that fires at 150ms —
  // beginCharge runs, sends chargeStart, and spawns an orb into a turn that has already ended.
  // This test proves neither chargeStart nor an orb appear during the hold.
  await setState(attacker, { uses: { a1: 1 } });
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.players.get(room.sessionId).a1.currentUses === 1;
  }, { timeout: 4000 });

  await waitForMyAttackTurn(attacker);
  // Small tick after turn gate so Phaser's key handlers are definitely ready.
  await attacker.waitForTimeout(50);
  await spyOnAllSends(attacker);

  await attacker.keyboard.press('r'); // arm recharge
  // Brief tick so armRecharge's timer is live before the completion keydown fires.
  await attacker.waitForTimeout(50);

  // Hold the key — completeRecharge fires on keydown; turn advances server-side.
  // Release key first, then wait for turn-advance (ensures onAttackHold key-up runs
  // before we poll state, and avoids leaving a dangling held key).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200); // hold 200ms > 150ms threshold
  await attacker.keyboard.up('1');

  // Gate on recharge arrival before asserting counts (removes flaky race under PvP load).
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  // Turn must have advanced (recharge consumed it on keydown).
  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    return room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 8000 });

  // Wait a final buffer for any suppressed chargeStart leak to surface.
  await attacker.waitForTimeout(200);

  expect(await getSentCount(attacker, 'recharge')).toBe(1);      // recharge fired
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);   // no spurious charge start
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0); // no phantom release
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);  // no legacy attack

  // Orb must NOT have spawned — chargeOrbX is null (no orb created).
  const orbX = await attacker.evaluate(() => {
    const scene = (window as any).__scene;
    return (scene as any)?.chargeOrbX ?? null;
  });
  expect(orbX).toBeNull();

  await closeBattle(h);
});

// ── Scenario 17 (#490): pointer tap on RECHARGE slot card arms recharge ────────
// #490 adversarial: the gold RECHARGE card at (512,510) must call onArmRecharge()
// on pointerdown — same as R-key. Without this wire-up the touch path is silently
// broken and only keyboard users can recharge, violating the spec's parity contract.
test('#490 pointer tap on RECHARGE slot card at (512,510) arms recharge state and sends recharge on subsequent ring-key', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // Act via real pointer on the gold RECHARGE slot card — no __* hook for input.
  // canvasCoords converts logical 1024×576 coords to page coords (accounts for scaling).
  const slotPos17 = await canvasCoords(attacker, 512, 510);
  await attacker.mouse.click(slotPos17.x, slotPos17.y);

  // The slot tap must arm recharge — window.__rechargeArmed is the read-only hook
  // set by BattleScene.armRecharge() at line 1143 of BattleScene.ts.
  await attacker.waitForFunction(
    () => (window as any).__rechargeArmed === true,
    { timeout: 3000 },
  );
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed)).toBe(true);

  // Complete recharge via ring key (real keyboard) — no recharge message fired yet.
  await attacker.keyboard.press('1');

  // Gate on the recharge message reaching the server before asserting counts.
  await attacker.waitForFunction(() => ((window as any).__allSends?.recharge ?? 0) >= 1, {
    timeout: 8000,
  });

  expect(await getSentCount(attacker, 'recharge')).toBe(1);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  // rechargeArmed must clear after completion.
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed ?? false)).toBe(false);

  await closeBattle(h);
});

// ── Scenario 18 (#490): old blue button location (944,462) is dead ────────────
// #490 adversarial: clicking the old floating blue button coordinates must NOT arm
// recharge. If the old button is still present (not fully removed), this click would
// call onArmRecharge() and __rechargeArmed would flip to true — a silent regression.
test('#490 clicking old blue button position (944,462) does not arm recharge and sends no recharge message', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // Click the old blue button location — the button must be fully gone, not just restyled.
  const oldBtnPos = await canvasCoords(attacker, 944, 462);
  await attacker.mouse.click(oldBtnPos.x, oldBtnPos.y);

  // Allow any async side-effects to settle (pointer events are synchronous in Phaser
  // but give an event loop tick for any delayed handlers).
  await attacker.waitForTimeout(300);

  // No arm transition — __rechargeArmed must remain false (or undefined).
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed ?? false)).toBe(false);
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 19 (#490): double-tap on RECHARGE slot does not double-arm ────────
// #490 adversarial: two rapid clicks on the slot must leave recharge armed exactly
// once (second tap while already armed: armRecharge() is idempotent — it resets the
// timeout and stays armed). The server must not receive spurious recharge messages
// from the double-tap, and __rechargeArmed must be true (not toggled off).
test('#490 double-tap on RECHARGE slot card does not double-arm or desync: armed once, no spurious recharge sent', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // Two rapid clicks — first arms, second must be idempotent (not complete a recharge).
  const slotPos19 = await canvasCoords(attacker, 512, 510);
  await attacker.mouse.click(slotPos19.x, slotPos19.y);
  await attacker.mouse.click(slotPos19.x, slotPos19.y);

  // After two taps the state is armed (not cancelled, not double-completed).
  await attacker.waitForFunction(
    () => (window as any).__rechargeArmed === true,
    { timeout: 3000 },
  );

  // No recharge message sent yet — the slot tap only arms; ring-key press completes.
  await attacker.waitForTimeout(200);
  expect(await getSentCount(attacker, 'recharge')).toBe(0);
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed)).toBe(true);

  await closeBattle(h);
});

// ── Scenario 20 (#490): off-turn pointer tap on RECHARGE slot is a no-op ──────
// #490 adversarial: tapping the RECHARGE slot when it is NOT the player's turn
// must be ignored — armRecharge() has a phase guard (ATTACK_SELECT + my turn).
// Without this guard, a touch user could pre-arm recharge out-of-turn and have it
// fire unexpectedly when their turn arrives, breaking server-authoritative guarantees.
test('#490 pointer tap on RECHARGE slot during opponent turn is a no-op: __rechargeArmed stays false', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await spyOnAllSends(defender);

  // Ensure it is the attacker's turn (not the defender's).
  await waitForMyAttackTurn(attacker);

  // Tap the RECHARGE slot on the DEFENDER's page — it is not their turn.
  const slotPos20 = await canvasCoords(defender, 512, 510);
  await defender.mouse.click(slotPos20.x, slotPos20.y);

  await attacker.waitForTimeout(300);

  // The defender's armRecharge() phase guard must block the tap entirely.
  expect(await defender.evaluate(() => (window as any).__rechargeArmed ?? false)).toBe(false);
  expect(await getSentCount(defender, 'recharge')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 21 (#490/impl): rechargeBg has no setDepth — pointer must still hit ─
// #490 impl: rechargeBg is added via scene.add.rectangle() at default depth 0 (the
// old blue button was at depth 500). Without a setDepth call the card renders behind
// the ring slot cards (also at default depth 0 in the Hand container). A ring slot
// card or HUD layer occluding (512,510) would silently eat the click and never fire
// pointerdown on rechargeBg — __rechargeArmed stays false even though the card exists.
// This test proves the card is actually hittable at that canvas position.
test('#490 rechargeBg at default depth is pointer-hittable: click at (512,510) arms recharge without any ring slot occlusion', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // A single pointer click at the exact rechargeBg center — if occlusion were present
  // __rechargeArmed would stay false (the click lands on a non-interactive layer instead).
  const slotPos21 = await canvasCoords(attacker, 512, 510);
  await attacker.mouse.click(slotPos21.x, slotPos21.y);

  // Gate: armRecharge() must fire within 3s; a timeout here is the occlusion signal.
  await attacker.waitForFunction(
    () => (window as any).__rechargeArmed === true,
    { timeout: 3000 },
  );
  expect(await attacker.evaluate(() => (window as any).__rechargeArmed)).toBe(true);

  // No recharge message sent yet (click only arms, does not complete).
  expect(await getSentCount(attacker, 'recharge')).toBe(0);

  await closeBattle(h);
});

// ── Scenario 22 (#490/impl): RECHARGE slot is NOT in __slotPositions ─────────
// #490 impl: publishSlotPositions() in Hand.ts maps only HAND_SLOT_X (5 ring slots,
// indexed thumb/a1/a2/d1/d2). RECHARGE_SLOT_X=512 is NOT published there. E2E tests
// that rely on __slotPositions[0] for "Thumb slot" must not accidentally index the
// RECHARGE card. This test asserts __slotPositions has exactly 5 entries and that
// none of them have x≈512, distinguishing the recharge slot from Thumb (x=580).
test('#490 __slotPositions contains exactly 5 ring slots and none has x≈512 (RECHARGE_SLOT_X excluded)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // __slotPositions is published by Hand.publishSlotPositions() during construction.
  const positions = await attacker.evaluate(() => (window as any).__slotPositions as { x: number; y: number }[]);

  // Exactly 5 ring slots — thumb, a1, a2, d1, d2.
  expect(positions).toHaveLength(5);

  // No entry should be near x=512 (RECHARGE_SLOT_X). Thumb is at 580, not 512.
  // A canvas-scale-adjusted tolerance of ±5px covers sub-pixel rounding.
  const rechargeSlotXInScreen = await attacker.evaluate(() => {
    const canvas = document.querySelector('canvas')!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / 1024; // CANVAS_W=1024
    return rect.left + 512 * scaleX;
  });
  const hasRechargeEntry = positions.some((p) => Math.abs(p.x - rechargeSlotXInScreen) < 5);
  expect(hasRechargeEntry).toBe(false);

  await closeBattle(h);
});
