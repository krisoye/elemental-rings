import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// #485 — Charge attack mechanic: oscillating orb throw with fusion ring integration.
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
  return page.evaluate((t) => (window as any).__msgs?.[t] ?? [], t);
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

// ── Scenario 1: tap — single releaseAttack with holdDuration=0, defend phase opens ──

test('tap A1 (< threshold): client sends ONE releaseAttack with holdDuration=0; defend phase opens at baseline', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  await spyOnReleaseAttack(attacker);

  // A tap is a quick press+release — client uses CHARGE_THRESHOLD_CLIENT_MS=60ms (E2E_FAST)
  // and sends holdDuration=0 WITHOUT a chargeStart message. Path is deterministic.
  await attacker.keyboard.press('1'); // press+release in one call ≈ 0ms hold

  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  const sent = await getReleaseAttacks(attacker);
  // #485 adversarial: exactly ONE message — no double-fire on a tap.
  expect(sent.length).toBe(1);
  expect(sent[0].slot).toBe('a1');
  // #485 P2-3: tap path always reports holdDuration=0 (not the raw elapsed time).
  expect(sent[0].holdDuration).toBe(0);
  // Tap has no fusionSecondSlot field.
  expect(sent[0].fusionSecondSlot).toBeUndefined();

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

  // Attacker ring must have lost exactly 1 use.
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
  // in the hit zone (585–619ms = 35ms window). Server jitter ~5ms — robust.
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'exchangeResult');

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

  // Defender no-blocks → exchangeResult fires after window lapses.
  await defender.waitForFunction(() => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 1, {
    timeout: 8000,
  });
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(1);
  expect(results[0].defenderHeartLost).toBe(true);

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

  // A1 use must have been deducted.
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
  const FIRE = 3; // non-fusion element (base triangle)
  await setState(attacker, {
    elements: { thumb: FIRE, a1: WATER, a2: EARTH },
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
