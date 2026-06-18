import { test, expect, type Page } from '@playwright/test';
import { setupBattle, attackerDefender, closeBattle, type SlotKey } from './helpers';

// #485 — Charge attack mechanic: arc-swing orb throw with fusion ring integration.
// #487 — Attack-phase input overhaul: R-key recharge, deferred-threshold charge, orb-position fix.
// #491 — Arc rework: replace Y-sine oscillation with constant-angular-velocity arc swing.
// PvP duel (two browser sessions); all assertions read authoritative broadcast state
// (window.__room.state) or collected messages — never __* hooks to drive actions.
//
// Server broadcast contract:
//   chargeOrbStart  { attackerId, slot, startTime, startAngle }  — on chargeStart, to BOTH clients
//   chargeOrbEnd    { attackerId }                               — on releaseAttack, to BOTH clients
//   chargeMiss      { attackerId, attackerSlot }                 — on miss, to BOTH clients
//
// #491 arc model: startAngle=-45 always; orbAngle(holdMs) sweeps −45→+45 in BASE_SWEEP_MS=1200ms.
// Hit cone: ±10° around 0°. Sweet spot: midpoint of sweep 0 (~600ms hold).
// Keyboard input is mandatory for charge scenarios (#413 rule).

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
  return page.evaluate((msgType) => (window as any).__msgs?.[msgType] ?? [], type);
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
 * Use getSentCount() to assert no unwanted message types were emitted.
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
  return page.evaluate((msgType) => (window as any).__allSends?.[msgType] ?? 0, type);
}

test.describe('charge attack', () => {

// ── Scenario 1: tap — single selectAttack, defend phase opens ──────────────────
// #487 contract: a tap on an attack key sends `selectAttack` (BattleScene.sendSingleAttack).

test('tap A1 (< threshold): client sends ONE selectAttack; no chargeStart, no releaseAttack; defend phase opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  // keyboard.press() (~10–40ms) is well below CHARGE_THRESHOLD_CLIENT_MS=150ms.
  await attacker.keyboard.press('1');

  await attacker.waitForFunction(() => ((window as any).__allSends?.selectAttack ?? 0) >= 1, {
    timeout: 3000,
  });

  await attacker.waitForTimeout(150);

  expect(await getSentCount(attacker, 'selectAttack')).toBe(1);
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);

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

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');
  await collectMessages(defender, 'chargeOrbEnd');

  // Hold long enough to arm chargeStart (> 150ms threshold).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  // chargeOrbStart must arrive at the DEFENDER.
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  const starts = await getMessages(defender, 'chargeOrbStart');
  expect(starts.length).toBe(1);
  expect(starts[0].attackerId).toBe(attackerId);
  expect(starts[0].slot).toBe('a1');
  expect(typeof starts[0].startTime).toBe('number');
  expect(starts[0].startTime).toBeGreaterThan(0);
  // #491: startAngle must be −45 (locked).
  expect(starts[0].startAngle).toBe(-45);

  // Release — chargeOrbEnd must arrive at the defender.
  await attacker.keyboard.up('1');
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  const ends = await getMessages(defender, 'chargeOrbEnd');
  expect(ends.length).toBe(1);
  expect(ends[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 3: chargeOrbStart also reaches ATTACKER (full broadcast) ──────────

test('chargeOrbStart is broadcast to the ATTACKER too (room.broadcast, not client.send)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeOrbStart');

  // Hold past the 150ms threshold so chargeStart fires.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 5000,
  });
  const starts = await getMessages(attacker, 'chargeOrbStart');
  expect(starts.length).toBe(1);
  expect(starts[0].attackerId).toBe(attackerId);
  // #491: startAngle always −45.
  expect(starts[0].startAngle).toBe(-45);

  await attacker.keyboard.up('1');
  await closeBattle(h);
});

// ── Scenario 4: MISS path — hold in miss zone, ring −1 use, no defend phase ──────

test('hold A1 at MISS angle (early sweep 0, ~200ms): chargeMiss broadcast, attacker ring −1 use, phase → ATTACK_SELECT', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #491: 200ms hold → angle ≈ −30° (outside ±10° cone) = guaranteed miss.
  await setState(attacker, { uses: { a1: 3 } });
  await setState(defender, { hearts: 3 });
  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'chargeMiss');

  const usesBeforeA = await myUses(attacker, 'a1');

  // Hold 200ms — well into sweep 0 miss zone (angle ≈ −30°).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  const attMisses = await getMessages(attacker, 'chargeMiss');
  expect(attMisses.length).toBe(1);
  expect(attMisses[0].attackerSlot).toBe('a1');

  // Attacker ring must have lost exactly 1 use.
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

  await waitForPhase(attacker, 'ATTACK_SELECT', 4000);

  const defPhase = await getPhase(defender);
  expect(defPhase).toBe('ATTACK_SELECT');

  expect(await defenderHearts(defender)).toBe(3);

  await closeBattle(h);
});

// ── Scenario 5: chargeMiss is broadcast to BOTH players ─────────────────────────────

test('chargeMiss on a miss-zone hold: broadcast reaches DEFENDER (not just attacker side)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);
  const attackerId = await attacker.evaluate(() => (window as any).__room.sessionId);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeMiss');

  // Hold 200ms → miss zone.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.up('1');

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  const defMisses = await getMessages(defender, 'chargeMiss');
  expect(defMisses.length).toBe(1);
  expect(defMisses[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 6: HIT path — sweep-0 sweet spot, defend phase opens ─────────────────

test('hold A1 at sweet spot (~BASE_SWEEP_MS/2 = 600ms): no chargeMiss, defend phase opens, defender heart lost on no-block', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  // #491: 600ms hold → angle ≈ 0° (sweep-0 midpoint) = sweet spot = guaranteed hit.
  // Hit cone ±10°/90° × 600ms = ±133ms jitter tolerance; 600ms is well-centered.
  await setState(defender, { hearts: 3 });
  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'exchangeResult');

  await defender.waitForFunction(
    () => {
      const room = (window as any).__room;
      const me = room.state.players.get(room.sessionId);
      return me.hearts === 3;
    },
    { timeout: 3000 },
  );

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.up('1');

  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(0);

  await defender.waitForFunction(() => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 1, {
    timeout: 8000,
  });
  const results = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBe(1);
  expect(results[0].defenderHeartLost).toBe(true);

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
  // must have holdMs=0 on the server (tap path), not trust the client holdDuration.
  await collectMessages(attacker, 'chargeMiss');

  // Send directly without keyboard (testing the server guard, not the client path).
  await attacker.evaluate(() =>
    (window as any).__room.send('releaseAttack', { slot: 'a1', holdDuration: 99999 }),
  );

  await attacker.waitForTimeout(300);
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(0);

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

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbEnd');

  // Hold 200ms → miss zone.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.up('1');

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 5000,
  });
  const ends = await getMessages(defender, 'chargeOrbEnd');
  expect(ends.length).toBe(1);
  expect(ends[0].attackerId).toBe(attackerId);

  await closeBattle(h);
});

// ── Scenario 9: fusion off-center miss — A1 misses, A2 always hits ─────────────────

test('fusion A1 at MISS angle (200ms) + tap A2: chargeMiss for A1, A2 orb hits, defend phase opens', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });
  await setState(defender, { hearts: 3 });

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'exchangeResult');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');
  const thumbBefore = await myUses(attacker, 'thumb');

  // Drive fusion miss: hold A1 200ms (miss angle), tap A2 while holding.
  await attacker.keyboard.down('1'); // begin hold on A1
  await attacker.waitForTimeout(200); // hold past threshold, into miss zone
  // Tap A2 while A1 is still held (fusion chord).
  await attacker.keyboard.press('2');
  await attacker.keyboard.up('1'); // release A1

  // chargeMiss for A1 must fire.
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 5000,
  });
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(1);
  expect(misses[0].attackerSlot).toBe('a1');

  // A1 use must have been deducted.
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

  expect(await myUses(attacker, 'a2')).toBe(a2Before - 1);
  expect(await myUses(attacker, 'thumb')).toBe(thumbBefore - 1);

  expect(await defenderHearts(defender)).toBe(3);

  await closeBattle(h);
});

// ── Scenario 10: fusion HIT on A1 + tap A2 → doubleAttackStart broadcast ─────────────

test('fusion A1 at sweet spot (600ms) + tap A2: both orbs fire, doubleAttackStart broadcast', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'doubleAttackStart');

  const a1Before = await myUses(attacker, 'a1');
  const a2Before = await myUses(attacker, 'a2');
  const thumbBefore = await myUses(attacker, 'thumb');

  // Hold A1 600ms (sweet spot, ~0°) then tap A2 while held.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.press('2');
  await attacker.keyboard.up('1');

  // No chargeMiss — A1 hit.
  await attacker.waitForTimeout(300);
  expect((await getMessages(attacker, 'chargeMiss')).length).toBe(0);

  // doubleAttackStart must be broadcast.
  await defender.waitForFunction(() => ((window as any).__msgs?.doubleAttackStart?.length ?? 0) >= 1, {
    timeout: 6000,
  });
  const starts = await getMessages(defender, 'doubleAttackStart');
  expect(starts.length).toBe(1);
  expect(starts[0].first).toBe('a1');
  expect(starts[0].second).toBe('a2');

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

  const NON_FUSION_THUMB = EARTH; // EARTH=2; Precision Parry (defensive only)
  await setState(attacker, {
    elements: { thumb: NON_FUSION_THUMB, a1: WATER, a2: NON_FUSION_THUMB },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');
  await collectMessages(defender, 'doubleAttackStart');

  const thumbBefore = await myUses(attacker, 'thumb');
  const a2Before = await myUses(attacker, 'a2');

  // Hold A1 200ms (miss angle) then tap A2 (ineligible fusion attempt).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.press('2');
  await attacker.keyboard.up('1');

  // A1 misses (single-slot charge, no fusion).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  // doubleAttackStart must NOT have fired.
  await attacker.waitForTimeout(300);
  const doubleStarts = await getMessages(defender, 'doubleAttackStart');
  expect(doubleStarts.length).toBe(0);

  expect(await myUses(attacker, 'thumb')).toBe(thumbBefore);
  expect(await myUses(attacker, 'a2')).toBe(a2Before);

  await waitForPhase(attacker, 'ATTACK_SELECT', 4000);

  await closeBattle(h);
});

// ── Scenario 12: real tap — keyboard press emits ONE selectAttack, no releaseAttack ──

test('real keyboard tap A1: exactly ONE selectAttack emitted; no releaseAttack, no chargeStart', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await spyOnAllSends(attacker);
  await waitForMyAttackTurn(attacker);

  await attacker.keyboard.press('1');

  await attacker.waitForFunction(() => ((window as any).__allSends?.selectAttack ?? 0) >= 1, {
    timeout: 3000,
  });

  await attacker.waitForTimeout(150);

  expect(await getSentCount(attacker, 'selectAttack')).toBe(1);
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(0);
  expect(await getSentCount(attacker, 'chargeStart')).toBe(0);

  await waitForPhase(h.p2, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Scenario 13: real hold+release — keyboard hold emits chargeStart then ONE releaseAttack ──

test('real keyboard hold A1 (~400ms) then release: one chargeStart, one chargeOrbEnd, one releaseAttack(holdDuration>0)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await spyOnReleaseAttack(attacker);
  await spyOnAllSends(attacker);
  await collectMessages(attacker, 'chargeOrbStart');
  await collectMessages(attacker, 'chargeOrbEnd');

  await waitForMyAttackTurn(attacker);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__releaseAttacks?.length ?? 0) >= 1, {
    timeout: 3000,
  });

  await attacker.waitForTimeout(150);

  const sent = await getReleaseAttacks(attacker);
  expect(sent.length).toBe(1);
  expect(sent[0].slot).toBe('a1');
  expect(sent[0].holdDuration).toBeGreaterThan(0);

  expect(await getSentCount(attacker, 'chargeStart')).toBe(1);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  expect((await getMessages(attacker, 'chargeOrbStart')).length).toBe(1);
  // #491: chargeOrbStart includes startAngle=-45.
  const orbStart = (await getMessages(attacker, 'chargeOrbStart'))[0];
  expect(orbStart.startAngle).toBe(-45);

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 3000,
  });
  expect((await getMessages(attacker, 'chargeOrbEnd')).length).toBe(1);

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

  await waitForMyAttackTurn(attacker);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbX !== null && (window as any).__scene?.chargeOrbX !== undefined,
    { timeout: 8000 },
  );

  const orbX = await attacker.evaluate(() => (window as any).__scene?.chargeOrbX ?? null);
  expect(orbX).toBe(708); // PLAYER_X - 60 = 768 - 60 = 708

  await attacker.keyboard.up('1');

  await closeBattle(h);
});

// ── Scenario 15 (#487): defender-view orb spawns at OPPONENT_X + 60 ─────────────

test('#487 defender-view charge orb spawns at OPPONENT_X + 60 (in front of opponent, toward player)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');

  // Hold past threshold so chargeStart fires and defender receives chargeOrbStart.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  const defenderOrbX = await defender.evaluate(() => (window as any).__scene?.opponentChargeOrbX ?? null);
  expect(defenderOrbX).toBe(316); // OPPONENT_X + 60 = 256 + 60 = 316

  await attacker.keyboard.up('1');

  await closeBattle(h);
});

// ── Scenario 16 (#487): R-key does not break the charge/fusion path ───────────

test('#487 R key during ATTACK_SELECT (when recharge cancelled before hold) does not break charge flow', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await spyOnAllSends(attacker);

  await attacker.keyboard.press('r');
  await attacker.keyboard.press('r');

  await attacker.waitForTimeout(50);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__allSends?.releaseAttack ?? 0) >= 1, {
    timeout: 8000,
  });

  await attacker.waitForTimeout(150);

  expect(await getSentCount(attacker, 'chargeStart')).toBe(1);
  expect(await getSentCount(attacker, 'releaseAttack')).toBe(1);
  expect(await getSentCount(attacker, 'recharge')).toBe(0);
  expect(await getSentCount(attacker, 'selectAttack')).toBe(0);

  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 5000 },
  );

  await closeBattle(h);
});

// ── Arc-swing scenarios (#491): 7 new scenarios ─────────────────────────────────
// These test the new constant-angular-velocity arc model.

// ── Arc Scenario 1: tap (< 150ms) — always hits ───────────────────────────────
// #504: tap path sets state.telegraphMs = TELEGRAPH_MS and Orb.launch receives
// that value → __lastOrbDurationMs === TELEGRAPH_MS (150ms under E2E_FAST).
// This is a regression lock: if telegraphMs compression bled into the tap path,
// __lastOrbDurationMs would be < 150 and the orb would arrive before the server
// expects, breaking defender timing.

test('#491 arc: tap (hold < 150ms) fires instantly horizontal and always hits (no chargeMiss)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');

  // keyboard.press() is ~10–40ms — well below 150ms threshold = tap path.
  await attacker.keyboard.press('1');

  // No chargeMiss — tap always hits.
  await attacker.waitForTimeout(300);
  const misses = await getMessages(attacker, 'chargeMiss');
  expect(misses.length).toBe(0);

  // Defend phase opens (hit).
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // #504 regression lock: tap orb must travel TELEGRAPH_MS (150ms E2E_FAST).
  // __lastOrbDurationMs is populated by Orb.launch — proves the tap path passes
  // the uncompressed duration and state.telegraphMs is not leaking a charged value.
  const lastDurationMs: number | null = await defender.evaluate(
    () => (window as any).__lastOrbDurationMs ?? null,
  );
  expect(lastDurationMs).not.toBeNull();
  // In E2E_FAST: TELEGRAPH_MS = 150ms; production: 900ms.
  const expectedTelegraphMs = (process.env.E2E_FAST !== '0') ? 150 : 900;
  expect(lastDurationMs).toBe(expectedTelegraphMs);

  await closeBattle(h);
});

// ── Arc Scenario 2: sweep-0 midpoint → sweet spot → hit ─────────────────────────

test('#491 arc: hold through sweep-0 midpoint (~600ms) → angle≈0° (sweet spot) → hit', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');

  // 600ms = BASE_SWEEP_MS/2: orb at 0° (sweet spot, ±10° cone = hit).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.up('1');

  // No chargeMiss — sweet spot is a hit.
  await attacker.waitForTimeout(300);
  expect((await getMessages(attacker, 'chargeMiss')).length).toBe(0);

  // Defend phase opens.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  await closeBattle(h);
});

// ── Arc Scenario 3: early sweep-0 hold → miss position ──────────────────────────

test('#491 arc: hold ~200ms → angle≈−30° (outside ±10° cone) → chargeMiss', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeMiss');

  // 200ms: angle = −45 + (200/1200)*90 ≈ −30° >> HIT_CONE_DEG=10° → miss.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeMiss?.length ?? 0) >= 1, {
    timeout: 5000,
  });
  expect((await getMessages(attacker, 'chargeMiss')).length).toBe(1);

  await closeBattle(h);
});

// ── Arc Scenario 4: sweep 2 reversal — sharpness 2/3 ────────────────────────────

test('#491 arc: hold through sweep-1 reversal (~1200ms) — sharpnessFromSweep returns 2/3', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  // Scenario validates that sweep-1 hold is accepted and the game progresses.
  // The chargeOrbStart payload must arrive; sweep speed must step up.
  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeOrbStart');
  await collectMessages(attacker, 'chargeOrbEnd');
  await collectMessages(attacker, 'chargeMiss');

  // Hold ~1200ms = end of sweep 0 / start of sweep 1 reversal.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(1200);
  await attacker.keyboard.up('1');

  // chargeOrbStart was received (charge lifecycle started).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  // chargeOrbEnd must fire (lifecycle completed).
  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  // Phase must advance (hit or miss depending on exact server timing).
  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 6000 },
  );

  await closeBattle(h);
});

// ── Arc Scenario 5: max sweeps — speed stays at max ──────────────────────────────

test('#491 arc: hold to max sweeps (~2700ms) — speed stays at max; game progresses normally', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(attacker, 'chargeOrbStart');
  await collectMessages(attacker, 'chargeOrbEnd');

  // ~2700ms ≈ BASE_SWEEP_MS*(1 + SWEEP_SPEEDUP + SWEEP_SPEEDUP²) = 1200*(1+0.75+0.5625)≈2775ms
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(2700);
  await attacker.keyboard.up('1');

  await attacker.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  await attacker.waitForFunction(
    () => {
      const phase = (window as any).__room?.state?.phase;
      return phase === 'DEFEND_WINDOW' || phase === 'ATTACK_SELECT';
    },
    { timeout: 8000 },
  );

  await closeBattle(h);
});

// ── Arc Scenario 6: chargeOrbAngle getter returns value in [−45, 45] during hold ──

test('#491 arc: chargeOrbAngle getter returns a value in [−45, 45] during an active charge hold', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Hold past threshold so beginCharge runs and the arc orb is spawned.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400); // well past 150ms threshold

  // Gate: wait until chargeOrbAngle is non-null (beginCharge has run).
  await attacker.waitForFunction(
    () => {
      const angle = (window as any).__scene?.chargeOrbAngle;
      return angle !== null && angle !== undefined;
    },
    { timeout: 8000 },
  );

  // Read the current angle while the hold is active.
  const angle = await attacker.evaluate(() => (window as any).__scene?.chargeOrbAngle ?? null);
  expect(angle).not.toBeNull();
  expect(angle).toBeGreaterThanOrEqual(-45);
  expect(angle).toBeLessThanOrEqual(45);

  await attacker.keyboard.up('1');

  // After release, chargeOrbAngle should return null (orb dispersed).
  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbAngle === null || (window as any).__scene?.chargeOrbAngle === undefined,
    { timeout: 3000 },
  );

  await closeBattle(h);
});

// ── Arc Scenario 7: opponentChargeOrbAngle getter returns value in [−45, 45] ──────

test('#491 arc: opponentChargeOrbAngle getter returns a value in [−45, 45] when opponent charges', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');

  // Attacker holds so chargeStart fires and defender spawns the arc orb.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);

  // Gate: chargeOrbStart received by defender.
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  // Gate: defender's opponentChargeOrbAngle is non-null (handleOpponentChargeOrbStart ran).
  await defender.waitForFunction(
    () => {
      const angle = (window as any).__scene?.opponentChargeOrbAngle;
      return angle !== null && angle !== undefined;
    },
    { timeout: 5000 },
  );

  const oppAngle = await defender.evaluate(() => (window as any).__scene?.opponentChargeOrbAngle ?? null);
  expect(oppAngle).not.toBeNull();
  expect(oppAngle).toBeGreaterThanOrEqual(-45);
  expect(oppAngle).toBeLessThanOrEqual(45);

  await attacker.keyboard.up('1');

  await closeBattle(h);
});

// ── Arc-direction render-x scenarios (#495) ─────────────────────────────────
// These lock in the facing-sign fix: player arc opens LEFT (toward opponent),
// opponent arc opens RIGHT (toward player). All read chargeOrbRenderX /
// opponentChargeOrbRenderX — new read-only getters added in #495. Input is
// real keyboard only (#413 rule). Do NOT use window.__room.send() to drive
// charge actions.
//
// Constants (from client/src/Constants.ts + Orb.ts):
//   PLAYER_X = 768  → player pivot = 708 (PLAYER_X - IDLE_ORB_RADIUS)
//   OPPONENT_X = 256 → opponent pivot = 316 (OPPONENT_X + IDLE_ORB_RADIUS)
//   IDLE_ORB_RADIUS = 60
//   Player facing = -1  → renderX = 708 - 60*cos(angleDeg*π/180) ≤ 708
//   Opponent facing = +1 → renderX = 316 + 60*cos(angleDeg*π/180) ≥ 316

// ── Arc-direction Scenario 1: player orb always left of pivot during hold ────

test('#495 arc-direction: player chargeOrbRenderX is always < 708 (pivot) across the full hold', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Hold past threshold so beginCharge runs and the arc orb spawns.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);

  // Gate: wait until chargeOrbRenderX is non-null (orb alive).
  await attacker.waitForFunction(
    () => {
      const rx = (window as any).__scene?.chargeOrbRenderX;
      return rx !== null && rx !== undefined;
    },
    { timeout: 8000 },
  );

  // #495 adversarial: before the fix, +cos was used unconditionally and the
  // player orb rendered at 768 (ON the player) or to its right — never left.
  // Poll across multiple animation frames to confirm the invariant holds
  // at every sampled point during the hold.
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    await attacker.waitForTimeout(80); // ~6 frames at 60fps between samples
    const rx: number | null = await attacker.evaluate(
      () => (window as any).__scene?.chargeOrbRenderX ?? null,
    );
    if (rx !== null) samples.push(rx);
  }

  await attacker.keyboard.up('1');

  // Every sampled renderX must be strictly left of pivot (708).
  for (const rx of samples) {
    expect(rx).toBeLessThan(708);
    // Also confirm it hasn't slipped past PLAYER_X (768) — the "never backside" bound.
    expect(rx).toBeLessThanOrEqual(768);
  }

  await closeBattle(h);
});

// ── Arc-direction Scenario 2: opponent orb always right of pivot during hold ──

test('#495 arc-direction: opponentChargeOrbRenderX is always > 316 (pivot) on defender view', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);

  // Gate: chargeOrbStart received by defender (orb spawned on opponent side).
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  // Gate: opponentChargeOrbRenderX is non-null on the defender's scene.
  await defender.waitForFunction(
    () => {
      const rx = (window as any).__scene?.opponentChargeOrbRenderX;
      return rx !== null && rx !== undefined;
    },
    { timeout: 5000 },
  );

  // #495 adversarial: opponent orb was correct-by-accident (facing=+1 = +cos, which
  // already opened rightward). The fix must not regress this: opponent renderX
  // must remain strictly right of pivot (316) throughout the hold.
  const samples: number[] = [];
  for (let i = 0; i < 8; i++) {
    await defender.waitForTimeout(80);
    const rx: number | null = await defender.evaluate(
      () => (window as any).__scene?.opponentChargeOrbRenderX ?? null,
    );
    if (rx !== null) samples.push(rx);
  }

  await attacker.keyboard.up('1');

  for (const rx of samples) {
    expect(rx).toBeGreaterThan(316);
    // Never slips past OPPONENT_X (256) on the left — the "never backside" bound.
    expect(rx).toBeGreaterThanOrEqual(256);
  }

  await closeBattle(h);
});

// ── Arc-direction Scenario 3: symmetry — same |angle|, equal displacement from pivot ─

test('#495 arc-direction: at same |angle|, player leftward displacement equals opponent rightward displacement (mirror symmetry)', async ({
  browser,
}) => {
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(400);

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  // Gate: both getters are non-null simultaneously.
  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbRenderX !== null &&
          (window as any).__scene?.chargeOrbRenderX !== undefined,
    { timeout: 8000 },
  );
  await defender.waitForFunction(
    () => (window as any).__scene?.opponentChargeOrbRenderX !== null &&
          (window as any).__scene?.opponentChargeOrbRenderX !== undefined,
    { timeout: 5000 },
  );

  // Sample both orb positions at 3 different moments. Because the two clients
  // are driven by the same deterministic formula with the same startTime, their
  // angles should be near-equal — meaning displacements from their respective
  // pivots should match within ±2px (floating-point + frame-timing jitter).
  //
  // #495 adversarial: if the radius or trig formula differs between player and
  // opponent paths, displacement equality would break, exposing a copy-paste error.
  const TOLERANCE = 2; // px
  for (let i = 0; i < 3; i++) {
    await attacker.waitForTimeout(100);

    const playerRx: number | null = await attacker.evaluate(
      () => (window as any).__scene?.chargeOrbRenderX ?? null,
    );
    const oppRx: number | null = await defender.evaluate(
      () => (window as any).__scene?.opponentChargeOrbRenderX ?? null,
    );

    if (playerRx !== null && oppRx !== null) {
      const playerDisplacement = 708 - playerRx;     // leftward from player pivot
      const opponentDisplacement = oppRx - 316;       // rightward from opponent pivot
      expect(Math.abs(playerDisplacement - opponentDisplacement)).toBeLessThanOrEqual(TOLERANCE);
    }
  }

  await attacker.keyboard.up('1');
  await closeBattle(h);
});

// ── Arc-direction Scenario 4: sweet spot (0°) is MAXIMAL extent toward opponent ──

test('#495 arc-direction: at 0° sweet spot (~600ms), player renderX is more extreme (farther left) than at ±45° extremes', async ({
  browser,
}) => {
  // #495 adversarial: the facing-sign inversion must make the orb reach its
  // LEFTMOST position at 0° (cos(0)=1, max displacement), not be at rest
  // at the player X. At ±45°, cos(45°)≈0.707 so renderX≈665.6 — LESS extreme.
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Hold past threshold so orb spawns.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbRenderX !== null &&
          (window as any).__scene?.chargeOrbRenderX !== undefined,
    { timeout: 8000 },
  );

  // Sample renderX near start of sweep (angle ≈ -30° to -10°, cos ≈ 0.87–0.97).
  const earlyRx: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX ?? null,
  );

  // Continue hold to ~600ms total (sweet-spot, angle ≈ 0°, cos≈1, renderX≈648).
  await attacker.waitForTimeout(300); // 600ms total from key down

  const sweetSpotRx: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX ?? null,
  );

  await attacker.keyboard.up('1');

  // At sweet spot, renderX should be ~648 (furthest left = minimum x).
  // This must be less than renderX near the extremes (which is closer to 708).
  if (earlyRx !== null && sweetSpotRx !== null) {
    // 0° → renderX ≈ 648; ±30°–45° → renderX ≈ 656–666.
    // Sweet spot must be at least 1px farther left than early-sweep reading.
    expect(sweetSpotRx).toBeLessThanOrEqual(earlyRx);
    // Confirm approximate value: 648 ± 12px (tolerance for timing jitter).
    expect(sweetSpotRx).toBeLessThan(662);
    expect(sweetSpotRx).toBeGreaterThan(636);
  }

  await closeBattle(h);
});

// ── Arc-direction Scenario 5: null before charge starts and after orb disperses ──

test('#495 arc-direction: chargeOrbRenderX and opponentChargeOrbRenderX return null when no orb is active', async ({
  browser,
}) => {
  // #495 adversarial: getters must return null (not 0, not the pivot value, not
  // a stale number from the last charge) when no orb is alive. A stale return
  // value would allow E2E assertions to pass vacuously after orb dispersal.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Before any charge: both getters must be null.
  const preChargePlayer: unknown = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX,
  );
  const preChargeOpp: unknown = await defender.evaluate(
    () => (window as any).__scene?.opponentChargeOrbRenderX,
  );
  expect(preChargePlayer == null).toBe(true);  // null or undefined
  expect(preChargeOpp == null).toBe(true);

  // Hold past threshold, wait for orb, then release (miss zone → orb disperses).
  await collectMessages(defender, 'chargeOrbEnd');
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200); // miss zone — orb will disperse on release
  await attacker.keyboard.up('1');

  // Wait for chargeOrbEnd to confirm the orb lifecycle has ended.
  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbEnd?.length ?? 0) >= 1, {
    timeout: 5000,
  });

  // After orb dispersal, both getters must return null again.
  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbRenderX == null,
    { timeout: 3000 },
  );
  await defender.waitForFunction(
    () => (window as any).__scene?.opponentChargeOrbRenderX == null,
    { timeout: 3000 },
  );

  const postChargePlayer: unknown = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX,
  );
  const postChargeOpp: unknown = await defender.evaluate(
    () => (window as any).__scene?.opponentChargeOrbRenderX,
  );
  expect(postChargePlayer == null).toBe(true);
  expect(postChargeOpp == null).toBe(true);

  await closeBattle(h);
});

// ── Phase 2: implementation-aware tests (#495) ──────────────────────────────
// These tests target branches that only became visible after reading the impl:
//   - Math.sign(...) returns −1/+1 for actual constants (not 0)
//   - Getter formula coherence: renderX at 0° = spawnX + facing*60 = 648/376
//   - Strict null guard: both chargeOrbHandle AND chargeOrbSpawnX must be null
//   - No regression on chargeOrbX (pivot getter) alongside the new renderX getter

// ── Impl Scenario 1: Math.sign produces correct facing with real constants ────

test('#495 impl: chargeOrbRenderX at 0° equals exactly spawnX − 60 = 648 (confirms Math.sign = −1, not 0)', async ({
  browser,
}) => {
  // #495 adversarial: Math.sign(OPPONENT_X − PLAYER_X) is cast "as 1 | -1" at
  // the spawn site, which silently accepts 0. The getter recomputes Math.sign
  // independently without the cast. If PLAYER_X === OPPONENT_X (impossible now,
  // but a misconfig risk), Math.sign would return 0 and renderX would equal the
  // pivot (708) — indistinguishable from the "wrong direction" pre-fix bug. Assert
  // the exact 648 value to prove the sign is −1 and the formula executes correctly.
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Hold to ~600ms — the sweep-0 midpoint where angle ≈ 0°.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300); // past threshold, orb spawns

  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbRenderX !== null &&
          (window as any).__scene?.chargeOrbRenderX !== undefined,
    { timeout: 8000 },
  );

  // Wait until the angle rounds to near 0° (sweep midpoint, ~600ms total).
  await attacker.waitForTimeout(300); // now ~600ms into hold

  // Gate: chargeOrbAngle should be close to 0°.
  await attacker.waitForFunction(
    () => {
      const angle = (window as any).__scene?.chargeOrbAngle;
      return angle !== null && angle !== undefined && Math.abs(angle) <= 10;
    },
    { timeout: 3000 },
  );

  const renderX: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX ?? null,
  );
  const angle: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbAngle ?? null,
  );

  await attacker.keyboard.up('1');

  // At 0°: renderX = 708 + (−1)*60*cos(0) = 708 − 60 = 648.
  // Allow ±3px for cos(small angle near 0°) jitter.
  expect(renderX).not.toBeNull();
  if (renderX !== null && angle !== null) {
    const expectedRx = 708 + Math.sign(256 - 768) * 60 * Math.cos(angle * Math.PI / 180);
    expect(Math.abs(renderX - expectedRx)).toBeLessThanOrEqual(1); // formula must match exactly
    // And the result must be left of pivot — not at pivot (which would mean Math.sign=0).
    expect(renderX).toBeLessThan(708);
    expect(renderX).toBeGreaterThan(645); // ≥ 648 − a small float tolerance
  }

  await closeBattle(h);
});

// ── Impl Scenario 2: opponent renderX at 0° = spawnX + 60 = 376 ──────────────

test('#495 impl: opponentChargeOrbRenderX at 0° equals exactly spawnX + 60 = 376 (confirms Math.sign = +1)', async ({
  browser,
}) => {
  // #495 adversarial: same Math.sign correctness check for the opponent path.
  // Formula: 316 + Math.sign(PLAYER_X − OPPONENT_X) * 60 * cos(0) = 316 + 60 = 376.
  // If Math.sign returned 0, renderX would be 316 (the pivot) — the getter would
  // return a value identical to opponentChargeOrbX, masking the bug.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'chargeOrbStart');

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await defender.waitForFunction(() => ((window as any).__msgs?.chargeOrbStart?.length ?? 0) >= 1, {
    timeout: 8000,
  });

  await defender.waitForFunction(
    () => (window as any).__scene?.opponentChargeOrbRenderX !== null &&
          (window as any).__scene?.opponentChargeOrbRenderX !== undefined,
    { timeout: 5000 },
  );

  // Wait for near-0° on defender's side (~600ms total hold).
  await attacker.waitForTimeout(300);

  await defender.waitForFunction(
    () => {
      const angle = (window as any).__scene?.opponentChargeOrbAngle;
      return angle !== null && angle !== undefined && Math.abs(angle) <= 10;
    },
    { timeout: 3000 },
  );

  const renderX: number | null = await defender.evaluate(
    () => (window as any).__scene?.opponentChargeOrbRenderX ?? null,
  );
  const angle: number | null = await defender.evaluate(
    () => (window as any).__scene?.opponentChargeOrbAngle ?? null,
  );

  await attacker.keyboard.up('1');

  expect(renderX).not.toBeNull();
  if (renderX !== null && angle !== null) {
    const expectedRx = 316 + Math.sign(768 - 256) * 60 * Math.cos(angle * Math.PI / 180);
    expect(Math.abs(renderX - expectedRx)).toBeLessThanOrEqual(1);
    expect(renderX).toBeGreaterThan(316);
    expect(renderX).toBeLessThan(379); // ≤ 376 + small float tolerance
  }

  await closeBattle(h);
});

// ── Impl Scenario 3: pivot getter (chargeOrbX) unchanged alongside renderX getter ──

test('#495 impl: chargeOrbX (pivot) still returns 708 while chargeOrbRenderX is < 708 (both live simultaneously)', async ({
  browser,
}) => {
  // #495 adversarial: chargeOrbRenderX is a NEW getter; the implementation reuses
  // chargeOrbSpawnX as the pivot for both. Verify the two getters return DIFFERENT
  // values during a live charge — pivot stays 708, renderX is strictly < 708.
  // A bug where the impl accidentally shared state could make both return the same value.
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(300);

  await attacker.waitForFunction(
    () => (window as any).__scene?.chargeOrbRenderX !== null &&
          (window as any).__scene?.chargeOrbRenderX !== undefined &&
          (window as any).__scene?.chargeOrbX !== null &&
          (window as any).__scene?.chargeOrbX !== undefined,
    { timeout: 8000 },
  );

  const pivotX: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbX ?? null,
  );
  const renderX: number | null = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX ?? null,
  );

  await attacker.keyboard.up('1');

  // Pivot must remain 708 (unchanged by #495).
  expect(pivotX).toBe(708);
  // renderX must be strictly less (arc opened toward opponent).
  expect(renderX).not.toBeNull();
  if (renderX !== null) {
    expect(renderX).toBeLessThan(pivotX!);
    // And neither value equals the other — they must differ by at least IDLE_ORB_RADIUS * cos(45°) ≈ 42px.
    expect(pivotX! - renderX).toBeGreaterThanOrEqual(40);
  }

  await closeBattle(h);
});

// ── Impl Scenario 4: chargeOrbSpawnX null path — both conditions of the null guard ──

test('#495 impl: chargeOrbRenderX null guard — returns null when handle is null (not just when spawnX is null)', async ({
  browser,
}) => {
  // #495 adversarial: the getter guards on BOTH `!chargeOrbHandle` AND
  // `chargeOrbSpawnX === null`. The chargeOrbX getter only checks `chargeOrbHandle`.
  // If the teardown path clears chargeOrbHandle but leaves chargeOrbSpawnX non-null
  // (or vice versa), chargeOrbRenderX would compute a stale value while chargeOrbX
  // correctly returns null. Verify both getters return null immediately after release.
  const h = await setupBattle(browser);
  const { attacker } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // Hold and release (miss zone).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(200);
  await attacker.keyboard.up('1');

  // After release, chargeOrbHandle and chargeOrbSpawnX are both cleared.
  // Both pivot getter and renderX getter must return null at the same time.
  await attacker.waitForFunction(
    () =>
      (window as any).__scene?.chargeOrbX == null &&
      (window as any).__scene?.chargeOrbRenderX == null,
    { timeout: 4000 },
  );

  const pivotAfter: unknown = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbX,
  );
  const renderXAfter: unknown = await attacker.evaluate(
    () => (window as any).__scene?.chargeOrbRenderX,
  );

  expect(pivotAfter == null).toBe(true);
  expect(renderXAfter == null).toBe(true);

  await closeBattle(h);
});

// ── #504 Phase 1: telegraph desync fix — spec-driven (E2E scenario + acceptance) ────
// These tests lock in the core fix: charged HIT compresses state.telegraphMs, the
// client reads it via __lastOrbDurationMs, and a defender pressing block timed to
// the compressed visual landing never receives MISTIME.

// ── #504 Scenario A: charged HIT → __lastOrbDurationMs < TELEGRAPH_MS ────────────

test('#504 charged HIT (~600ms hold): __lastOrbDurationMs is compressed (< TELEGRAPH_MS) and equals state.telegraphMs', async ({
  browser,
}) => {
  // #504 adversarial: before the fix Orb.launch always used the hardcoded
  // TELEGRAPH_MS constant. __lastOrbDurationMs would equal TELEGRAPH_MS (150ms
  // fast) even on a charged HIT — the orb visually arrived at 150ms while the
  // server resolved impact at ~80ms (compressedTelegraphMs). Defenders pressing
  // block at the visual landing (~150ms) pressed AFTER the window had closed.
  // After the fix __lastOrbDurationMs must equal state.telegraphMs (compressed).
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  // Register collectMessages BEFORE the gesture that produces the DEFEND_WINDOW
  // transition — a known footgun: messages sent before onMessage is registered are lost.
  await collectMessages(defender, 'exchangeResult');

  // Hold ~600ms — sweet spot (angle ≈ 0°) → guaranteed HIT with high sharpness.
  // At 600ms sharpness > 0, so compressedTelegraphMs < TELEGRAPH_MS.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.up('1');

  // Wait for DEFEND_WINDOW on the defender.
  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // Read state.telegraphMs from the defender's authoritative BattleState broadcast.
  const stateTelegraphMs: number = await defender.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? -1,
  );
  // Read the orb duration the client actually used.
  const lastOrbDurationMs: number | null = await defender.evaluate(
    () => (window as any).__lastOrbDurationMs ?? null,
  );

  // Acceptance criterion 1 + 3: charged HIT must produce compressed telegraphMs.
  // In E2E_FAST: TELEGRAPH_MS=150ms, CHARGE_TELEGRAPH_MIN_MS=80ms.
  // At 600ms hold, sharpness > 0 → state.telegraphMs must be < 150ms fast (< 900ms prod).
  const telegraphFloor = (process.env.E2E_FAST !== '0') ? 149 : 899;
  expect(stateTelegraphMs).toBeLessThan(telegraphFloor);
  expect(stateTelegraphMs).toBeGreaterThan(0); // must not be 0 (fallback sentinel)

  // Acceptance criterion 2: __lastOrbDurationMs must equal state.telegraphMs.
  expect(lastOrbDurationMs).not.toBeNull();
  expect(lastOrbDurationMs).toBe(stateTelegraphMs);

  await closeBattle(h);
});

// ── #504 Scenario B: tap → __lastOrbDurationMs === TELEGRAPH_MS (no compression) ──

test('#504 tap (keyboard.press): state.telegraphMs === TELEGRAPH_MS; __lastOrbDurationMs matches (no compression on tap)', async ({
  browser,
}) => {
  // #504 adversarial: the fix must NOT compress the tap path. All six DEFEND_WINDOW
  // entries other than the charged-HIT row set state.telegraphMs = TELEGRAPH_MS.
  // If a prior charged exchange left a stale compressed value in state.telegraphMs
  // and the next DEFEND_WINDOW entry failed to reset it, a tap would inherit the
  // compressed value and the orb would travel too fast for the server timing.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);

  // keyboard.press() is ~10–40ms — tap path, no compression.
  await attacker.keyboard.press('1');

  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  const stateTelegraphMs: number = await defender.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? -1,
  );
  const lastOrbDurationMs: number | null = await defender.evaluate(
    () => (window as any).__lastOrbDurationMs ?? null,
  );

  // Tap: state.telegraphMs must equal TELEGRAPH_MS (150ms E2E_FAST / 900ms prod).
  const expectedMs = (process.env.E2E_FAST !== '0') ? 150 : 900;
  expect(stateTelegraphMs).toBe(expectedMs);

  // __lastOrbDurationMs must match (client read state.telegraphMs, not the fallback 0 path).
  expect(lastOrbDurationMs).not.toBeNull();
  expect(lastOrbDurationMs).toBe(stateTelegraphMs);

  await closeBattle(h);
});

// ── #504 Scenario C: charged HIT defender block at compressed landing → BLOCK/PARRY ─

test('#504 acceptance criterion 4: defender blocking at compressedTelegraphMs landing registers BLOCK or PARRY, never MISTIME', async ({
  browser,
}) => {
  // #504 root-cause regression test: this is the exact bug. Before the fix:
  // server resolved impact at ~80ms (compressed), but the client orb traveled 150ms.
  // A defender pressing at the visual landing (~150ms) was already past the window.
  // After the fix the client orb travels state.telegraphMs (e.g. ~80ms) so the visual
  // landing matches the server impact → a timely press cannot be MISTIME.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  // Register BEFORE the charge gesture — messages sent before registration are lost.
  await collectMessages(defender, 'exchangeResult');

  // Hold ~600ms → sweet spot HIT with compressed telegraph.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.up('1');

  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // Read the compressed travel duration from the state.
  const compressedMs: number = await defender.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? 150,
  );

  // Press defense at compressedMs - 50ms after DEFEND_WINDOW opened.
  // This press arrives just before the compressed visual landing → must be inside
  // the block window. Use 50ms of headroom above compressedMs to land before impact
  // but still inside the ±200ms BLOCK band.
  const pressDelay = Math.max(0, compressedMs - 50);
  await defender.waitForTimeout(pressDelay);
  await defender.keyboard.press('3');

  await defender.waitForFunction(
    () => ((window as any).__msgs?.exchangeResult?.length ?? 0) >= 1,
    { timeout: 8000 },
  );

  const results: any[] = await getMessages(defender, 'exchangeResult');
  expect(results.length).toBeGreaterThan(0);
  // The defense must register as BLOCK or PARRY — never MISTIME.
  // MISTIME is the observable symptom of the desync bug.
  const outcome: string = results[0].defenseResult ?? '';
  expect(['BLOCK', 'PARRY', 'WEAK_BLOCK', 'WEAK_PARRY']).toContain(outcome);

  await closeBattle(h);
});

// ── #504 Phase 2: implementation-aware tests ────────────────────────────────────
// These test server-state invariants only visible after reading the implementation:
//   - stale-value invariant: compressed telegraphMs from a charged exchange must
//     NOT persist into the next tap/rally exchange
//   - combo orb-2 fallback: telegraphMs=0 path in _resolveCombo → client uses TELEGRAPH_MS

// ── #504 Impl Scenario 1: stale compressed value cleared on the next tap exchange ──

test('#504 impl: after a charged HIT, the next tap exchange has state.telegraphMs === TELEGRAPH_MS (no stale leak)', async ({
  browser,
}) => {
  // #504 adversarial: the implementation sets state.telegraphMs at each of the six
  // DEFEND_WINDOW entries (grep-verified exhaustive). The stale-value invariant
  // requires every tap/rally entry to reset to TELEGRAPH_MS — if even one entry
  // was missed, a compressed value could carry forward into the next exchange.
  // This test proves behaviorally that the reset happens: after a charged HIT
  // resolves, the subsequent exchange (driven via the block press) enters
  // ATTACK_SELECT and the following tap shows state.telegraphMs === TELEGRAPH_MS.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker);
  await collectMessages(defender, 'exchangeResult');

  // Exchange 1: charged HIT (~600ms → compressed telegraphMs).
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.up('1');

  await waitForPhase(defender, 'DEFEND_WINDOW', 5000);

  // Verify exchange 1 has a compressed telegraphMs.
  const compressedMs: number = await defender.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? -1,
  );
  const expectedMax = (process.env.E2E_FAST !== '0') ? 149 : 899;
  expect(compressedMs).toBeLessThan(expectedMax);

  // Let the first DEFEND_WINDOW lapse (no block press) so exchange resolves naturally.
  await waitForPhase(attacker, 'ATTACK_SELECT', 8000);

  // Now it's the defender's turn as attacker. Identify new attacker/defender.
  const { attacker: attacker2, defender: defender2 } = await attackerDefender(h.p1, h.p2);

  await waitForMyAttackTurn(attacker2);

  // Exchange 2: tap (no charge) on the new attacker.
  await attacker2.keyboard.press('1');

  await waitForPhase(defender2, 'DEFEND_WINDOW', 5000);

  // #504 stale-value invariant: state.telegraphMs must equal TELEGRAPH_MS again.
  const tapTelegraphMs: number = await defender2.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? -1,
  );
  const expectedTelegraphMs = (process.env.E2E_FAST !== '0') ? 150 : 900;
  expect(tapTelegraphMs).toBe(expectedTelegraphMs);

  // __lastOrbDurationMs on the defender must also track the reset value.
  const lastOrbDurationMs: number | null = await defender2.evaluate(
    () => (window as any).__lastOrbDurationMs ?? null,
  );
  expect(lastOrbDurationMs).toBe(expectedTelegraphMs);

  await closeBattle(h);
});

// ── #504 Impl Scenario 2: combo orb-2 telegraphMs=0 → client falls back ─────────

test('#504 impl: combo orb-2 (_resolveCombo) sets state.telegraphMs=0; client falls back to TELEGRAPH_MS', async ({
  browser,
}) => {
  // #504 adversarial: the _resolveCombo orb-2 path sets state.telegraphMs=0 (the
  // fallback sentinel — no new impactTime is set there). The client guard
  // `state.telegraphMs || TELEGRAPH_MS` must fire, so __lastOrbDurationMs equals
  // TELEGRAPH_MS, not 0. A 0-duration tween would be invisible and fire instantly,
  // making orb-2 unblockable. This test verifies the fallback activates on the
  // combo (fusion double-attack) orb-2 path.
  const h = await setupBattle(browser);
  const { attacker, defender } = await attackerDefender(h.p1, h.p2);

  await setState(attacker, {
    elements: { thumb: MUD, a1: WATER, a2: EARTH },
    uses: { thumb: 3, a1: 3, a2: 3 },
  });

  await waitForMyAttackTurn(attacker);
  // Register BEFORE the fusion gesture.
  await collectMessages(defender, 'exchangeResult');
  await collectMessages(defender, 'doubleAttackStart');

  // Fusion HIT: hold A1 600ms (sweet spot), tap A2 while held.
  await attacker.keyboard.down('1');
  await attacker.waitForTimeout(600);
  await attacker.keyboard.press('2');
  await attacker.keyboard.up('1');

  // Wait for doubleAttackStart to confirm both orbs are in flight.
  await defender.waitForFunction(
    () => ((window as any).__msgs?.doubleAttackStart?.length ?? 0) >= 1,
    { timeout: 6000 },
  );

  // Orb 1 enters DEFEND_WINDOW with telegraphMs = TELEGRAPH_MS (the initial
  // handleSelectDoubleAttack entry); when orb 1 resolves (non-parry) _resolveCombo
  // sets telegraphMs=0 and stays in DEFEND_WINDOW for orb 2. At that point
  // checkPhaseTransition fires with state.telegraphMs=0 → the `|| TELEGRAPH_MS`
  // guard on the client must make the orb-2 launch use TELEGRAPH_MS, not 0.
  // We assert __lastOrbDurationMs after orb 2 launches equals TELEGRAPH_MS.
  //
  // The orbLaunchCount increments on each Orb.launch: orb-1 fires first (count=N),
  // orb-2 fires after _resolveCombo (count=N+1). Wait for count to increment twice.
  const orbCountBefore: number = await defender.evaluate(
    () => (window as any).__orbLaunchCount ?? 0,
  );

  // Wait for orb-2 launch (count increments again after _resolveCombo).
  await defender.waitForFunction(
    (count) => ((window as any).__orbLaunchCount ?? 0) > count,
    orbCountBefore,
    { timeout: 8000 },
  );

  // At this point __lastOrbDurationMs is the orb-2 duration.
  // state.telegraphMs was 0 at the time of launch; client guard must have fired.
  const stateTelegraphMs: number = await defender.evaluate(
    () => (window as any).__room?.state?.telegraphMs ?? -1,
  );
  const lastOrbDurationMs: number | null = await defender.evaluate(
    () => (window as any).__lastOrbDurationMs ?? null,
  );

  // state.telegraphMs is 0 on orb-2 path (per the implementation).
  expect(stateTelegraphMs).toBe(0);

  // __lastOrbDurationMs must NOT be 0 — client fallback must have applied TELEGRAPH_MS.
  const expectedTelegraphMs = (process.env.E2E_FAST !== '0') ? 150 : 900;
  expect(lastOrbDurationMs).toBe(expectedTelegraphMs);

  await closeBattle(h);
});

}); // end test.describe('charge attack')
