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

  // Step 1: press R to arm recharge state. Step 2: press 1 to complete recharge.
  // Real keyboard input — not __* hooks.
  await attacker.keyboard.press('r');
  await attacker.keyboard.press('1');

  // The ring restores above its pre-tap value and the turn advances to the opponent
  // (recharge consumes the turn). An ATTACK would instead drop a1 to 0 and move to
  // DEFEND_WINDOW.
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
    { timeout: 5000 },
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

  const d2Max = (await readSlot(attacker, 'd2')).maxUses;
  const spiritBefore = await spiritOf(token);

  // Step 1: press R to arm recharge state. Step 2: press 4 to complete d2 recharge.
  await attacker.keyboard.press('r');
  await attacker.keyboard.press('4');

  // d2 restores above 0 and the turn advances to the opponent (recharge consumes
  // the turn).
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

  // R to arm, then 3 to complete — recharge d1. With zero affordable spirit the
  // ring stays at 0 but the turn is still consumed (recharge always advances the turn).
  await attacker.keyboard.press('r');
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
  await attacker.keyboard.press('Escape'); // cancel

  // Give the client a moment to process the cancel before the next key.
  await attacker.waitForTimeout(100);

  // Now pressing 1 should send a normal attack, not recharge.
  await attacker.keyboard.press('1');

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
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
  await attacker.keyboard.press('r'); // cancel via second R

  // Give the client a moment to process the cancel.
  await attacker.waitForTimeout(100);

  // Press 1 — should attack normally since recharge was cancelled.
  await attacker.keyboard.press('1');

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
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

  await attacker.waitForFunction(
    () => (window as any).__room.state.phase === 'DEFEND_WINDOW',
    { timeout: 5000 },
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

  // The rechargeArmed state on the defender client must remain false.
  const rechargeArmed = await defender.evaluate(() => {
    const scene = (window as any).__scene;
    return scene?.rechargeArmed ?? false;
  });
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
  await attacker.keyboard.press('z'); // z = slot 1 → complete recharge for a1

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.a1.currentUses > 1 && room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 5000 });

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

  const before = await readSlot(attacker, 'd1');

  await attacker.keyboard.press('r');
  await attacker.keyboard.press('3');

  await attacker.waitForFunction(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.d1.currentUses > before.currentUses || room.state.currentAttackerId !== room.sessionId;
  }, { timeout: 5000 });

  const after = await readSlot(attacker, 'd1');
  expect(after.currentUses).toBeGreaterThanOrEqual(before.currentUses);
  expect(await isMyTurn(attacker)).toBe(false); // turn advanced

  // Recharge fired (not selectAttack or releaseAttack).
  expect(await getSentCount(attacker, 'recharge')).toBe(1);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);

  await closeBattle(h);
});
