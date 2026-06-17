import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// #485 — Charge attack mechanic: oscillating orb throw with fusion ring integration.
// #487 — Attack-phase input overhaul: R-key recharge, deferred-threshold charge, orb-position fix.
// PvP duel (two browser sessions); all assertions read authoritative broadcast state
// (window.__room.state) or collected messages — never __* hooks to drive actions.
//
// Server broadcast contract:
//   chargeOrbStart  { attackerId, slot, startTime }  — on chargeStart, to BOTH clients
//   chargeOrbEnd    { attackerId }                   — on releaseAttack, to BOTH clients
//   chargeMiss      { attackerId, attackerSlot }     — on miss, to BOTH clients
//
// Server message contract (replacing selectAttack):
//   chargeStart     { slot }     — emitted on hold begin; server records timestamp
//   releaseAttack   { slot, holdDuration, fusionSecondSlot? } — emitted on release
//     tap:    holdDuration=0 (client skips chargeStart for sub-threshold holds)
//     charge: holdDuration = measured hold (server IGNORES this; uses its own timestamp)
//
// #487 tap-path contract change: the RECHARGE_DOUBLE_TAP_MS / pendingAttackTimer
// deferral window has been removed. A tap now fires releaseAttack immediately on key-up
// (no 120ms+ wait). CHARGE_THRESHOLD_CLIENT_MS is unified at 150ms (no __E2E_FAST__
// conditional); keyboard.press() (~10–40ms) is reliably below threshold.
//
// Determinism strategy: drive chargeStart / releaseAttack via direct socket sends
// (page.evaluate → window.__room.send) with a controlled waitForTimeout between them
// so the server's own clock measures a predictable holdMs. This avoids keyboard
// timing jitter that would land the Y position in an uncertain zone.
//
//   MISS target: holdMs ≈ 200ms → y ≈ 78.78px (|y| >> HIT_CONE_PX=20; miss zone covers
//                150–580ms so ±50ms jitter still lands in miss territory — robust)
//   HIT  target: holdMs ≈ 600ms → y ≈ 0.00px  (hit zone spans 585–619ms = 35ms wide;
//                server jitter ~5ms from event-loop — robust)

const WATER = 1;
const EARTH = 2;
const MUD = 11; // WATER + EARTH fusion

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait until the active Phaser scene is the named scene.
 * Keyboard handlers are registered in BattleScene.create() — this gate ensures
 * the scene is mounted before firing any real keyboard input.
 */
async function waitForScene(page: Page, name: string, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    (n) => (window as any).__scene?.constructor.name === n,
    name,
    { timeout },
  );
}

/**
 * Wait until it is the given page's turn as attacker in ATTACK_SELECT phase.
 * Use this gate before any real keyboard input — ensures the key handler is
 * both wired (BattleScene mounted) and logically active (it is this player's turn).
 */
async function waitForMyAttackTurn(page: Page, timeout = 15000): Promise<void> {
  await waitForScene(page, 'BattleScene', 5000);
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

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__room?.state?.phase ?? '');
}

async function myUses(page: Page, slot: SlotKey): Promise<number> {
  return page.evaluate((s) => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me[s].currentUses;
  }, slot);
}

async function defenderHearts(page: Page): Promise<number> {
  return page.evaluate(() => {
    const room = (window as any).__room;
    const me = room.state.players.get(room.sessionId);
    return me.hearts;
  });
}

/** Install a spy on room.send to capture outgoing releaseAttack messages. */
async function spyOnReleaseAttack(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as any;
    w.__releaseAttacks = [];
    const orig = w.__room.send.bind(w.__room);
    w.__room.send = (type: string, payload: any) => {
      if (type === 'releaseAttack') w.__releaseAttacks.push({ ...payload });
      return orig(type, payload);
    };
  });
}

async function getReleaseAttacks(page: Page): Promise<Array<{ slot: string; holdDuration: number; fusionSecondSlot?: string }>> {
  return page.evaluate(() => (window as any).__releaseAttacks ?? []);
}

/**
 * Install a broad spy that captures EVERY outgoing room.send call by type.
 * Use getAllSentByType() to assert no unwanted message types were emitted.
 * This spy is composable with spyOnReleaseAttack — install both if needed.
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

test.describe('charge attack', () => {

// ── Scenario 1: tap — single selectAttack, defend phase opens ──────────────────
// #487 contract: a tap on an attack key sends `selectAttack` (BattleScene.sendSingleAttack).
// The old releaseAttack/holdDuration=0 contract was #485 pre-#487; the tap bypass path now
// uses selectAttack exclusively. releaseAttack is only sent for holds ≥150ms.

test('tap A1 (< threshold): client sends ONE selectAttack; no chargeStart, no releaseAttack; defend phase opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Gate: wait for BattleScene to be mounted and it to be our turn — keyboard
  // handlers are registered in BattleScene.create(); firing before mount drops the event.
  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // #487: keyboard.press() (~10–40ms) is well below CHARGE_THRESHOLD_CLIENT_MS=150ms.
  // sendSingleAttack fires on key-up → room.send('selectAttack', { slot: 'a1' }).
  await attacker.keyboard.press('1'); // press+release in one call ≈ 10–40ms hold

  // Gate on selectAttack arrival (tap is synchronous on key-up, no timer needed).
  await attacker.waitForFunction(() => ((window as any).__allSends?.selectAttack ?? 0) >= 1, {
    timeout: 3000,
  });

  // Give a brief window for any spurious second message.
  await attacker.waitForTimeout(150);

  // #487 adversarial: exactly ONE selectAttack — no double-fire on a tap.
  expect(await getSentCount(attacker, 'selectAttack')).toBe(1);
  // Tap must NOT send releaseAttack — that is the hold path.
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);
  // Tap must NOT send chargeStart — timer fires only if key still held at 150ms.
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);

  // Tap always hits → defend phase must open (no miss path for taps).
  await waitForPhase(h.p2, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Scenario 2: chargeOrbStart broadcast reaches DEFENDER when charge begins ──────

test('chargeOrbStart is broadcast to the DEFENDER (defender visibility contract)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // #485 adversarial: the defender must receive chargeOrbStart as soon as the attacker
  // begins a hold. If the server fails to broadcast (e.g. phase-check too strict, or
  // only sends to the attacker), the defender cannot show the oscillating orb — a spec
  // violation ("Both players see the oscillating orb" GDD §6.3).
  await collectMessages(defender, 'chargeOrbStart');
  await collectMessages(defender, 'chargeOrbEnd');

  // Send chargeStart directly (deterministic; no keyboard jitter).
  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));

  // chargeOrbStart must arrive at the DEFENDER within 1s.
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const starts = await getMessages(defender, 'chargeOrbStart');
  expect(starts.length).toBe(1);
  expect(starts[0].attackerId).toBe(attackerId);
  expect(starts[0].slot).toBe('a1');
  // startTime is a server epoch timestamp — must be a positive integer.
  expect(typeof starts[0].startTime).toBe('number');
  expect(starts[0].startTime).toBeGreaterThan(0);

  // Release the charge — chargeOrbEnd must also arrive at the defender.
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 0 }),
  );
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const ends = await getMessages(defender, 'chargeOrbEnd');
  expect(ends.length).toBe(1);
  expect(ends[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 3: chargeOrbStart also reaches ATTACKER (full broadcast, not targeted) ──

test('chargeOrbStart is broadcast to the ATTACKER too (room.broadcast, not client.send)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // #485 adversarial: the broadcast must use room.broadcast(), not a targeted send.
  // If implementation uses client.send() instead of broadcast(), the attacker would
  // not receive chargeOrbStart and cannot animate its own orb position readout.
  await collectMessages(attacker, 'chargeOrbStart');

  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  const starts = await getMessages(attacker, 'chargeOrbStart');
  expect(starts.length).toBe(1);
  expect(starts[0].attackerId).toBe(attackerId);

  // Clean up: release.
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 0 }),
  );
  await closeBattle(h);
});

// ── Scenario 4: MISS path — deterministic 200ms hold, ring −1 use, no defend phase ──

test('hold A1 at MISS duration (200ms): chargeMiss broadcast, attacker ring −1 use, phase → ATTACK_SELECT', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: a 200ms server-measured hold produces y≈78.78px >> HIT_CONE_PX=20.
  // The miss zone covers t=150..580ms, so ±50ms timing jitter still guarantees a miss.
  // Using direct socket sends avoids keyboard jitter entirely — server measures the gap.
  await setState(attacker, { uses: { a1: 3 } });
  await setState(defender, { hearts: 3 });
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'chargeMiss');

  const usesBeforeA = await myUses(attacker, 'a1');

  // Drive miss via direct socket sends (no keyboard jitter).
  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(200);
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 200 }),
  );

  // chargeMiss MUST fire — no conditional guard.
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 4000,
  });

  const attMisses = await getMessages(attacker, 'chargeMiss');
  expect(attMisses.length).toBe(1);
  expect(attMisses[0].attackerSlot).toBe('a1');

  // Attacker ring must have lost exactly 1 use. Wait for the Colyseus state patch
  // carrying the use deduction to arrive — chargeMiss fires slightly before the patch.
  await attacker.waitForFunction(
    ([slot, before]: [string, number]) => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me[slot].currentUses < before;
    },
    ['a1', usesBeforeA] as [string, number],
    { timeout: 3000 },
  );
  const usesAfterA = await myUses(attacker, 'a1');
  expect(usesAfterA).toBe(usesBeforeA - 1);

  // Phase returns to ATTACK_SELECT — miss skips the defender phase entirely.
  await waitForPhase(attacker, 'ATTACK_SELECT', 4000);

  // Defender must NOT have entered DEFEND_WINDOW.
  const defPhase = await getPhase(defender);
  expect(defPhase).toBe('ATTACK_SELECT');

  // Defender hearts must be untouched (attacker mistake ≠ defender punishment).
  expect(await defenderHearts(defender)).toBe(3);

  await closeBattle(h);
});

// ── Scenario 5: chargeMiss is broadcast to BOTH players ─────────────────────────────

test('chargeMiss on a 200ms hold: broadcast reaches DEFENDER (not just attacker side)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // #485 adversarial: chargeMiss must be broadcast (not targeted) so the defender's
  // client can show the WHIFF animation. A targeted send to only the attacker would
  // leave the defender stuck showing the oscillating orb indefinitely.
  await collectMessages(defender, 'chargeMiss');

  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(200);
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 200 }),
  );

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 4000,
  });

  const defMisses = await getMessages(defender, 'chargeMiss');
  expect(defMisses.length).toBe(1);
  expect(defMisses[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 6: HIT path — deterministic 600ms hold, defend phase opens ─────────────

test('hold A1 at HIT duration (600ms): no chargeMiss, defend phase opens, defender heart lost on no-block', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 deterministic: 600ms server-measured hold → y≈0px (zero-crossing), solidly
  // in the hit zone. We also seed defender hearts explicitly so the heart-decrement
  // waitForFunction below is deterministic regardless of prior exchange history.
  //
  // NOTE: The hit window around t=600ms is ~35ms (585–619ms). With server event-loop
  // jitter up to ~20ms, the 600ms target is sufficiently centered. We assert the
  // heart decrement via state (not just the exchangeResult message field) to guard
  // against the race where the message and state diff arrive in different ticks.
  await setState(defender, { hearts: 3 });
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'exchangeResult');

  // Wait for the setState patch to land before sending chargeStart.
  await defender.waitForFunction(
    () => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me.hearts === 3;
    },
    { timeout: 3000 },
  );

  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(600);
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 600 }),
  );

  // Defend phase must open — a 600ms hit triggers it.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // No chargeMiss fired — it was a hit.
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(0);

  // exchangeResult fires after the defend window lapses (no-block).
  await defender.waitForFunction(() => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 1, {
    timeout: 8000,
  });
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(1);
  expect(results[0].defenderHeartLost).toBe(true);

  // Wait for the Colyseus state patch carrying the heart decrement — state diffs
  // and the exchangeResult message can arrive in separate ticks.
  await defender.waitForFunction(
    () => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me.hearts < 3;
    },
    { timeout: 5000 },
  );
  expect(await defenderHearts(defender)).toBe(2);

  await closeBattle(h);
});

// ── Scenario 7: stale-timestamp guard — releaseAttack without chargeStart → tap ────

test('releaseAttack with no preceding chargeStart treated as tap (holdMs=0): no chargeMiss, defend opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: a client that sends releaseAttack without a chargeStart
  // (missed message, sub-threshold tap, or spoofed message) must have holdMs=0
  // on the server (tap path), not trust the client-supplied holdDuration.
  // Sending holdDuration=99999 without a prior chargeStart must NOT produce a miss —
  // the server falls back to holdMs=0 (tap path) which is always a hit.
  await collectMessages(attacker, 'chargeMiss');

  // No chargeStart sent. Send releaseAttack with a large holdDuration to test the guard.
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 99999 }),
  );

  // Must NOT fire chargeMiss — server ignores the spoofed holdDuration and treats as tap.
  await attacker.waitForTimeout(300);
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(0);

  // Phase advances to DEFEND_WINDOW (tap always hits) — not stuck in ATTACK_SELECT.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Scenario 8: chargeOrbEnd fires on miss path (not just hit) ────────────────────

test('chargeOrbEnd is broadcast on a MISS release (not only on hit)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  // #485 adversarial: if chargeOrbEnd is only broadcast on the hit path, a miss
  // would leave the defender's ghost orb stuck on screen. The server must broadcast
  // chargeOrbEnd unconditionally in handleReleaseAttack before branching hit/miss.
  await collectMessages(defender, 'chargeOrbEnd');

  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(200); // guaranteed miss duration
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 200 }),
  );

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 4000,
  });
  const ends = await getMessages(defender, 'chargeOrbEnd');
  expect(ends.length).toBe(1);
  expect(ends[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 9: fusion off-center miss — A1 misses, A2 always hits ─────────────────

test('fusion A1 at MISS duration (200ms) + tap A2: chargeMiss for A1, A2 orb hits, defend phase opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: the tapped slot (A2) must ALWAYS hit regardless of A1's Y position.
  // If the server mistakenly applies the held-orb Y check to A2 as well, A2 would miss —
  // leaving the attacker with 0 hits and no defend window despite having two rings.
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await setState(defender, { hearts: 3 });

  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'exchangeResult');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');
  const thumbBefore = await myUses(attacker, 'thumb');

  // Drive miss on A1 (200ms → y≈78.78px) + fusion tap on A2 via direct socket sends.
  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(200);
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 200, fusionSecondSlot: 'a2' }),
  );

  // chargeMiss MUST fire for A1 — no conditional guard.
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 4000,
  });
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(1);
  expect(misses[0].attackerSlot).toBe('a1');

  // A1 use must have been deducted. Wait for Colyseus state patch (chargeMiss fires
  // slightly before the state diff carrying the use deduction arrives).
  await attacker.waitForFunction(
    ([slot, before]: [string, number]) => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me[slot].currentUses < before;
    },
    ['a1', a1Before] as [string, number],
    { timeout: 3000 },
  );
  expect(await myUses(attacker, 'a1')).toBe(a1Before - 1);

  // A2 (tapped, always hits) must open a defend window for the defender.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // A2 use deducted (second orb fired).
  expect(await myUses(attacker, 'a2')).toBe(a2Before - 1);

  // Thumb use deducted (fusion combo costs thumb use).
  expect(await myUses(attacker, 'thumb')).toBe(thumbBefore - 1);

  // Defender hearts still 3 — the defend window has only opened, not resolved.
  expect(await defenderHearts(defender)).toBe(3);

  await closeBattle(h);
});

// ── Scenario 10: fusion HIT on A1 + tap A2 → doubleAttackStart broadcast ─────────────

test('fusion A1 at HIT duration (600ms) + tap A2: both orbs fire, doubleAttackStart broadcast', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 spec: "Both orbs hit; single combined defender phase; compressed window from A1 charge."
  // Server reuses the combo machinery (doubleAttackStart broadcast) with compressed telegraph.
  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });

  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'doubleAttackStart');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');
  const thumbBefore = await myUses(attacker, 'thumb');

  // Drive HIT on A1 (600ms → y≈0px, guaranteed hit) + fusion tap on A2.
  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(600);
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 600, fusionSecondSlot: 'a2' }),
  );

  // No chargeMiss — A1 hit.
  await attacker.waitForTimeout(300);
  expect((await getMessages(attacker, 'chargeMiss')).length).toBe(0);

  // doubleAttackStart must be broadcast (server uses combo machinery for hit+tap path).
  await defender.waitForFunction(() => ((window as any).__msgs?.doubleAttackStart?.length ?? 0) >= 1, {
    timeout: 5000,
  });
  const starts = await getMessages(defender, 'doubleAttackStart');
  expect(starts.length).toBe(1);
  expect(starts[0].first).toBe('a1');
  expect(starts[0].second).toBe('a2');

  // A1, A2, and thumb uses all deducted.
  expect(await myUses(attacker, 'a1')).toBe(a1Before - 1);
  expect(await myUses(attacker, 'a2')).toBe(a2Before - 1);
  expect(await myUses(attacker, 'thumb')).toBe(thumbBefore - 1);

  await closeBattle(h);
});

// ── Scenario 11: fusion eligibility gate — ineligible hand, fusionSecondSlot ignored ─

test('fusion charge with ineligible hand (non-fusion thumb): fusionSecondSlot ignored, only A1 resolves', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 adversarial: if a player with a non-fusion thumb sends a releaseAttack with
  // fusionSecondSlot, the server must silently ignore the second slot (canDoubleAttack
  // returns false). Only A1 resolves; the second slot is NOT fired.
  // If this gate is missing, a non-fusion hand could bypass the thumb cost or fire
  // an extra orb — effectively a free double-attack exploit.
  //
  // IMPORTANT: EARTH (2) is used for the non-fusion thumb because its only passive
  // (Precision Parry) is DEFENSIVE — it never fires on attack. WIND (3) would trigger
  // Tailwind on attack (consuming thumb use), skewing the thumb-use assertions.
  const NON_FUSION_THUMB = EARTH; // EARTH=2; Precision Parry (defensive only)
  await setState(attacker, {
    elements: { thumb: NON_FUSION_THUMB, a1: WATER, a2: NON_FUSION_THUMB },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });

  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'doubleAttackStart');

  const thumbBefore = await myUses(attacker, 'thumb');
  const a2Before = await myUses(attacker, 'a2');

  // Attempt a fusion charge-release with an ineligible hand; miss on A1.
  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));
  await attacker.waitForTimeout(200); // guaranteed miss Y position
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 200, fusionSecondSlot: 'a2' }),
  );

  // A1 misses (single-slot charge, no fusion).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 4000,
  });

  // doubleAttackStart must NOT have fired — ineligible hand.
  await attacker.waitForTimeout(200); // give any spurious broadcast time to arrive
  const doubleStarts = await getMessages(defender, 'doubleAttackStart');
  expect(doubleStarts.length).toBe(0);

  // Thumb use must NOT have been deducted (no fusion combo fired).
  expect(await myUses(attacker, 'thumb')).toBe(thumbBefore);

  // A2 use must NOT have been deducted (second slot was ignored).
  expect(await myUses(attacker, 'a2')).toBe(a2Before);

  // Phase returned to ATTACK_SELECT (single-slot miss, no second orb).
  await waitForPhase(attacker, 'ATTACK_SELECT', 4000);

  await closeBattle(h);
});

// ── Real-input scenarios: exercise the actual client input handler ────────────
//
// The socket-send scenarios above prove the server contract. These two scenarios
// drive REAL keyboard input through the Phaser client so the client-side charge
// handler (beginCharge / endChargeOrb in BattleScene) is in the call-path.
// They assert MESSAGE EMISSION only — not hit/miss landing (the 35ms hit window
// is too narrow for keyboard jitter). This covers the P1-3/P2-2/P2-3 fixes:
//   P1-3: exactly ONE releaseAttack per release (no double-send bug)
//   P2-3: tap path sends holdDuration=0 (not raw elapsed)
//   P2-2: hold above E2E_FAST threshold (60ms) emits chargeStart before release

// ── Scenario 12: real tap — keyboard press emits ONE selectAttack, no releaseAttack ──
// #487 contract: tap → selectAttack (sendSingleAttack); no releaseAttack, no chargeStart.

test('real keyboard tap A1: exactly ONE selectAttack emitted; no releaseAttack, no chargeStart', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487: the real client tap path (hold < CHARGE_THRESHOLD_CLIENT_MS=150ms) must emit
  // exactly ONE selectAttack via sendSingleAttack. The old releaseAttack/holdDuration=0
  // contract was pre-#487. A double-send bug would produce 2 selectAttacks; a regression
  // to the old hold path would produce chargeStart + releaseAttack instead.
  await spyOnAllSends(attacker);

  // Gate: BattleScene must be mounted and it must be our turn before firing a key.
  await waitForMyAttackTurn(attacker);

  // keyboard.press() is a near-instantaneous down+up — well below 150ms threshold.
  await attacker.keyboard.press('1');

  // Gate on selectAttack arrival (fires on key-up, no deferral).
  await attacker.waitForFunction(() => ((window as any).__allSends?.selectAttack ?? 0) >= 1, {
    timeout: 3000,
  });

  // Give a short window for any spurious second message to appear.
  await attacker.waitForTimeout(150);

  // Exactly ONE selectAttack — no double-send.
  expect(await getSentCount(attacker, 'selectAttack')).toBe(1);
  // Tap must NOT send releaseAttack (that is the hold path).
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);
  // #487: with 150ms threshold, keyboard.press() (~10–40ms) must not arm chargeStart.
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);

  // Defend phase must open — tap always hits.
  await waitForPhase(h.p2, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Scenario 13: real hold+release — keyboard hold emits chargeStart then ONE releaseAttack ──

test('real keyboard hold A1 (~400ms) then release: one chargeStart, one chargeOrbEnd, one releaseAttack(holdDuration>0)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #485 P1-3 + P2-2 + #487: the real client hold-release path must emit exactly ONE chargeStart
  // (on keydown, after CHARGE_THRESHOLD_CLIENT_MS=150ms elapses with key still held) and
  // exactly ONE releaseAttack (on keyup) with holdDuration > 0. A double-send bug would
  // produce two releaseAttacks; a chargeStart leak would produce a second chargeStart.
  // The chargeOrbEnd broadcast from the server confirms the full lifecycle completed.
  // #487: CHARGE_THRESHOLD_CLIENT_MS is now 150ms unified (no __E2E_FAST__ conditional);
  // a 400ms hold is well above this threshold and guarantees chargeStart emission.
  await spyOnReleaseAttack(attacker);
  await spyOnAllSends(attacker);
  await collectMessages(attacker, 'chargeOrbStart');
  await collectMessages(attacker, 'chargeOrbEnd');

  // Gate: BattleScene must be mounted and it must be our turn before firing a key.
  // Keyboard handlers are registered in BattleScene.create() — events before mount are dropped.
  await waitForMyAttackTurn(attacker);

  // Hold for ~400ms — well above the 150ms client threshold.
  // We assert message-emission only, not hit/miss (Y at 400ms varies with timing jitter).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);
  await attacker.keyboard.up('1');

  // releaseAttack must arrive within 2s of key-up.
  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  // Brief pause for any spurious second message.
  await attacker.waitForTimeout(150);

  const sent = await getReleaseAttacks(attacker);
  // Exactly ONE releaseAttack — no double-send on hold release.
  expect(sent.length).toBe(1);
  expect(sent[0].slot).toBe('a1');
  // Above-threshold hold: holdDuration must be positive (not the tap sentinel 0).
  expect(sent[0].holdDuration).toBeGreaterThan(0);

  // Exactly ONE chargeStart emitted (keydown triggered it; no re-arm on hold).
  expect(await getSentCount(attacker, 'chargeStart')).toBe(1);
  // No legacy selectAttack — replaced by releaseAttack path.
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  // Server broadcast chargeOrbStart in response to chargeStart (lifecycle started).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  expect((await getMessages(attacker, 'chargeOrbStart')).length).toBe(1);

  // Server broadcast chargeOrbEnd in response to releaseAttack (lifecycle ended).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  expect((await getMessages(attacker, 'chargeOrbEnd')).length).toBe(1);

  // Game must have transitioned (hit or miss — either is fine; we don't assert which).
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 5000 },
  );

  await closeBattle(h);
});

// ── Scenario 14 (#487): charge orb spawns at PLAYER_X - 60 on attacker view ──────

test('#487 charge orb spawns at PLAYER_X - 60 (in front of player, toward opponent) on attacker view', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // #487 orb-position fix (Section C): the oscillating orb must spawn in front of its
  // owner, toward the target. PLAYER_X = 768; PLAYER_X - 60 = 708 (toward opponent at
  // x=256). Previously the sign was flipped (PLAYER_X + 60 = 828), spawning behind the
  // attacker away from the opponent — visually wrong.
  // #487 impl: BattleScene exposes `get chargeOrbX(): number | null` — returns
  // chargeOrbSpawnX while chargeOrbHandle is alive, null otherwise. Read it while held.
  await waitForMyAttackTurn(attacker);

  // Hold long enough to arm the deferred-threshold timer and trigger beginCharge.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300); // 300ms > 150ms threshold → chargeStart + beginCharge

  // Gate: wait until chargeOrbX becomes non-null — confirms beginCharge ran and the
  // orb handle is live. Polling the getter is more robust than waiting for chargeOrbStart
  // broadcast (which could arrive before the listener is ready if timing is tight).
  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbX !== null && (window as any).__scene?.chargeOrbX !== undefined,
    { timeout: 8000 },
  );

  // Read spawn X via the public getter while the orb is alive.
  // PLAYER_X - 60 = 768 - 60 = 708.
  const orbX = await attacker.evaluate(() => (window as any).__scene?.chargeOrbX ?? null);
  expect(orbX).toBe(708);

  // Release the key to clean up.
  await attacker.keyboard.up('1');

  await closeBattle(h);
});

// ── Scenario 15 (#487): defender-view orb spawns at OPPONENT_X + 60 ─────────────

test('#487 defender-view charge orb spawns at OPPONENT_X + 60 (in front of opponent, toward player)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #487 orb-position fix (Section C): the defender sees the attacker's orb spawning
  // at OPPONENT_X + 60 = 256 + 60 = 316 (in front of the opponent, toward the player
  // at x=768). Previously the sign was flipped (OPPONENT_X - 60 = 196), placing the
  // defender-view orb behind the opponent.
  // #487 impl: BattleScene exposes `get opponentChargeOrbX(): number | null` — returns
  // opponentChargeOrbSpawnX while opponentChargeOrbHandle is alive, null otherwise.
  // Drive chargeStart via direct socket send (deterministic; avoids keyboard jitter).
  await collectMessages(defender, 'chargeOrbStart');

  await attacker.evaluate(() => (window as any).__room.send('chargeStart', { slot: 'a1' }));

  // Gate: wait for chargeOrbStart broadcast so handleOpponentChargeOrbStart has run and
  // the defender's orb handle is live before reading opponentChargeOrbX.
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  // Read spawn X via the public getter while the orb handle is alive.
  // OPPONENT_X + 60 = 256 + 60 = 316.
  const defenderOrbX = await defender.evaluate(() => (window as any).__scene?.opponentChargeOrbX ?? null);
  expect(defenderOrbX).toBe(316);

  // Clean up: release the charge.
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 0 }),
  );

  await closeBattle(h);
});

// ── Scenario 16 (#487): R-key does not break the charge/fusion path ───────────

test('#487 R key during ATTACK_SELECT (when recharge cancelled before hold) does not break charge flow', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  // Use spyOnAllSends only — it captures all types including chargeStart and releaseAttack.
  // spyOnReleaseAttack + spyOnAllSends would double-wrap room.send, making __releaseAttacks
  // unreliable; getSentCount via __allSends is the single source of truth.
  await spyOnAllSends(attacker);

  // #487 adversarial: pressing R then immediately cancelling (via R again) must leave
  // the charge input path completely intact — a subsequent hold-and-release must still
  // emit chargeStart + releaseAttack normally. If the R-key state machine gets stuck
  // (e.g., doesn't fully reset on cancel), the hold event might be swallowed or the
  // charge threshold timer might not re-arm on the next keydown.
  await attacker.keyboard.press('r'); // arm recharge
  await attacker.keyboard.press('r'); // cancel via second R — no recharge state

  await attacker.waitForTimeout(50); // allow cancel to settle

  // Now hold A1 for a full charge — must work normally post-R-cancel.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400); // 400ms > 150ms threshold → chargeStart fires
  await attacker.keyboard.up('1');

  // Gate: releaseAttack must arrive after key-up.
  await attacker.waitForFunction(() => ((window as any).__allSends?.releaseAttack ?? 0) >= 1, {
    timeout: 8000,
  });

  // Give a brief window for any spurious duplicate.
  await attacker.waitForTimeout(150);

  // chargeStart was emitted (hold path fired correctly).
  expect(await getSentCount(attacker, 'chargeStart')).toBe(1);
  // Exactly one releaseAttack — hold path is intact post-R-cancel.
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(1);
  // No recharge was sent (R was cancelled before a ring key was pressed).
  expect(await getSentCount(attacker, 'recharge')).toBe(0);
  // No legacy selectAttack.
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  // Game transitioned (hit or miss — either is fine; R-cancel did not break the flow).
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 5000 },
  );

  await closeBattle(h);
});

}); // end test.describe('charge attack')
