/**
 * BattleRoom integration tests using @colyseus/testing (Colyseus 0.17).
 *
 * These boot a real Colyseus `Server` over the WebSocket transport, connect two
 * SDK clients, and drive a full duel through `selectAttack` / `submitDefense`
 * messages — exercising the room's timing windows, rally swap, and heart logic
 * end-to-end. (Pure resolution math is covered by the unit suite in
 * tests/unit/BlockResolver.test.ts and tests/unit/ElementSystem.test.ts.)
 *
 * API used (verified against @colyseus/testing@0.17.11 source):
 *   - boot(server)              -> Promise<ColyseusTestServer> (server listens on :2568)
 *   - colyseus.createRoom(name) -> server-side Room; `room.state` is the live BattleState
 *   - colyseus.connectTo(room)  -> SDK client Room; `.sessionId`, `.send(type, payload)`
 *   - room.waitForNextPatch()   -> resolves after the next state diff is broadcast
 *   - colyseus.shutdown()       -> gracefully shuts the server down
 *
 * NOTE: the suite is pinned to vitest's `threads` pool in vitest.config.ts. The
 * default `forks` pool crashes serializing colyseus server objects across the
 * worker IPC boundary.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';
import { TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../../server/src/game/constants';

// Buffer added after the server's windowTimer (DEFEND_WINDOW_MS) fires, to let
// the RESOLVE -> ATTACK_SELECT/DEFEND_WINDOW/ENDED diff broadcast back to us.
const RESOLVE_BUFFER_MS = 250;

// Boot the test server ONCE for the whole file. @colyseus/testing reuses a
// fixed port (2568), so booting/shutting-down per test races the port release
// and the SDK matchmaking HTTP endpoint ("MatchMakeError: fetch failed").
// Each test calls createRoom() for an isolated room, so there's no shared state.
let colyseus: ColyseusTestServer<any>;

beforeAll(async () => {
  const server = new Server();
  server.define('battle', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

/** Connect two clients and advance to the ATTACK_SELECT phase. */
async function joinBattle() {
  const room = await colyseus.createRoom<any>('battle', {});
  const c1 = await colyseus.connectTo(room);
  const c2 = await colyseus.connectTo(room);
  // Two joins -> two state patches before ATTACK_SELECT is set.
  await room.waitForNextPatch();
  await room.waitForNextPatch();
  return { room, c1, c2 };
}

function attackerClient(room: any, c1: any, c2: any) {
  return room.state.currentAttackerId === c1.sessionId ? c1 : c2;
}

function defenderClient(room: any, c1: any, c2: any) {
  return room.state.currentAttackerId === c1.sessionId ? c2 : c1;
}

/**
 * Press a defense `offsetMs` from the *server's* real impact time, then wait
 * exactly until that exchange has resolved — and no longer.
 *
 * We read the room's private `impactTime` (set when the server processes
 * `selectAttack`) so timing classification is deterministic and immune to
 * client-clock drift, transport latency, and scheduler jitter that would
 * otherwise flake the tight ±70ms PARRY window. A positive offset is a late
 * press, negative is early; the press lands `offsetMs` from impact.
 *
 * NOTE: the server now timestamps defense timing on message ARRIVAL
 * (`Date.now()` inside the `submitDefense` handler) and IGNORES the supplied
 * `pressTime`. Because this helper sleeps until `impactTime + offsetMs` and
 * sends immediately, the server's arrival time ≈ `impactTime + offsetMs`, so
 * this sleep-then-send model stays compatible. The `pressTime` field is still
 * sent (it's part of the payload), but only as future lag-comp metadata.
 *
 * Bounding the post-press wait matters: on a successful PARRY the server
 * immediately opens a fresh DEFEND_WINDOW for the rally's next exchange. If we
 * slept a full telegraph+window we would overshoot into that next window's
 * auto-resolution (a NO_BLOCK that ends the rally), so we wait only until the
 * *current* window closes (DEFEND_WINDOW_MS after the attack == BLOCK_WINDOW_MS
 * after impact) plus a small buffer for the resolve diff to broadcast back.
 */
async function pressDefenseAt(
  room: any,
  defender: any,
  slot: number,
  offsetMs: number,
) {
  const impactTime: number = room.impactTime;
  await sleep(impactTime + offsetMs - Date.now());
  defender.send('submitDefense', { slot, pressTime: Date.now() });
  // Window closes BLOCK_WINDOW_MS after impact; resolve, then broadcast.
  await sleep(BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

/**
 * No-defense path: wait the full telegraph + block window from the attack so
 * the server's timer fires NO_BLOCK and resolves.
 */
async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

describe('Scenario 1: full battle to completion', () => {
  test('attacker hits slot 0 every turn; defender never blocks -> KO after 3 no-blocks', async () => {
    const { room, c1, c2 } = await joinBattle();

    for (let i = 0; i < 6 && room.state.phase !== 'ENDED'; i++) {
      // Whoever is currently the attacker throws; the other never defends.
      const attacker = attackerClient(room, c1, c2);
      attacker.send('selectAttack', { slot: 0 });
      await waitForResolve();
    }

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBeTruthy();

    const loser = [...room.state.players.values()].find(
      (p: any) => p.playerId !== room.state.winnerId,
    );
    expect((loser as any)?.hearts).toBe(0);
  });
});

describe('Scenario 2: FIRE attack, WATER PARRY -> rally', () => {
  test('WATER parry of FIRE -> rallyActive, volleyedElement=WATER, roles swapped, no hearts lost', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch(); // -> DEFEND_WINDOW

    // Center of the PARRY window (offset 0) -> WATER beats FIRE -> STRONG PARRY.
    await pressDefenseAt(room, defender, 1, 0); // WATER

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(1); // WATER
    expect(room.state.phase).toBe('DEFEND_WINDOW'); // rally -> immediate DEFEND_WINDOW
    expect(room.state.currentAttackerId).toBe(defender.sessionId); // former defender now attacks

    for (const p of room.state.players.values()) {
      expect((p as any).hearts).toBe(3);
    }
  });
});

describe('Scenario 3: FIRE attack, FIRE PARRY -> no rally', () => {
  test('FIRE parry of FIRE (NEUTRAL) -> no rally, ATTACK_SELECT, no hearts lost', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    // PARRY-window press, but FIRE vs FIRE = NEUTRAL -> no rally even on a parry.
    await pressDefenseAt(room, defender, 0, 0); // FIRE vs FIRE = NEUTRAL

    expect(room.state.rallyActive).toBe(false);
    expect(room.state.phase).toBe('ATTACK_SELECT');
    for (const p of room.state.players.values()) {
      expect((p as any).hearts).toBe(3);
    }
  });
});

describe('Scenario 4: no-block -> heart lost', () => {
  test('window closes with no defense -> defender loses a heart, phase=ATTACK_SELECT', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 });
    await room.waitForNextPatch(); // DEFEND_WINDOW

    // No defense — let the window expire.
    await waitForResolve();

    expect(room.state.phase).toBe('ATTACK_SELECT');
    const defenderState4 = room.state.players.get(defenderId);
    expect(defenderState4.hearts).toBe(2);
    expect(defenderState4.fireGauge).toBe(1); // gauge fills on uncontested FIRE hit
  });
});

describe('Scenario 5: MISTIME -> heart + use lost', () => {
  test('defense pressed ~900ms early -> MISTIME: defender loses a heart and 1 ring use', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 });
    await room.waitForNextPatch(); // DEFEND_WINDOW

    // Press immediately: impact is ~900ms out, so offset ~ -900ms -> MISTIME.
    defender.send('submitDefense', { slot: 1, pressTime: Date.now() });

    await waitForResolve();

    expect(room.state.phase).toBe('ATTACK_SELECT');
    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hearts).toBe(2);
    expect(defenderState.hand[1].currentUses).toBe(2); // 3 -> 2 (1 use burned on MISTIME)
    expect(defenderState.fireGauge).toBe(1); // gauge fills on MISTIME (attack not caught)
  });
});

describe('Scenario 6: post-impact BLOCK (+150ms) -> no heart lost', () => {
  test('defense at impact+150ms -> BLOCK timing (NEUTRAL): no heart lost, use decremented', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    // impact + 190ms: |190| > 175 (PARRY_WINDOW_MS) but <= 200 (BLOCK_WINDOW_MS). FIRE vs FIRE = NEUTRAL.
    await pressDefenseAt(room, defender, 0, 190);

    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hearts).toBe(3);
    expect(defenderState.hand[0].currentUses).toBe(2); // 3 -> 2 on a clean block
    expect(defenderState.fireGauge).toBe(0); // attack was caught — gauge does NOT fill
  });
});

describe('Scenario 7: pentagon depth-2 rally', () => {
  test('FIRE -> WATER parry (rally) -> WIND parry of WATER -> still rallying, no hearts lost', async () => {
    const { room, c1, c2 } = await joinBattle();

    const p1 = attackerClient(room, c1, c2); // original attacker
    const p2 = defenderClient(room, c1, c2); // original defender

    // Round 1: P1 attacks FIRE(0); P2 parries WATER(1) -> STRONG PARRY -> rally.
    p1.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, p2, 1, 0); // WATER

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(1); // WATER
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe(p2.sessionId);
    // P1's FIRE ring: 3 - 1 (throw). P2's WATER ring: 3 - 1 (parry only; volley is free).
    expect(room.state.players.get(p1.sessionId).hand[0].currentUses).toBe(2);
    expect(room.state.players.get(p2.sessionId).hand[1].currentUses).toBe(2);

    // Round 2: P2 now volleys WATER; P1 (defending) parries WIND(3).
    // WIND beats WATER -> STRONG PARRY from P1's view -> rally continues, volley = WIND.
    // The rally swap already set impactTime for round 2, so press relative to it.
    await pressDefenseAt(room, p1, 3, 0); // WIND

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(3); // WIND
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe(p1.sessionId);
    // P1's WIND ring: 3 - 1 (parry only; volley is free).
    expect(room.state.players.get(p1.sessionId).hand[3].currentUses).toBe(2);

    for (const p of room.state.players.values()) {
      expect((p as any).hearts).toBe(3);
    }
  });
});

describe('Scenario 8: WEAK block -> heart lost, -1 use (not -2)', () => {
  /**
   * WEAK block rule: defender catches the attack but with the wrong element.
   * Costs 1 use (not 2) and always loses a heart — the ring absorbed the blow
   * but the elemental mismatch still hurts. The gauge does NOT increase
   * (attack was caught). FIRE(0) attack vs WOOD(4) defense = WEAK.
   */
  test('WEAK block costs 1 use and loses a heart; gauge does not increase', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    await pressDefenseAt(room, defender, 4, 190); // WOOD, BLOCK timing (190ms > PARRY_WINDOW_MS=175)

    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hand[4].currentUses).toBe(2); // 3 - 1 (not 3 - 2)
    expect(defenderState.hearts).toBe(2);              // heart lost (WEAK)
    expect(defenderState.fireGauge).toBe(0);           // attack caught — gauge does NOT fill
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});

describe('Scenario 9: BLOCK + STRONG -> no heart, no gauge', () => {
  test('FIRE attack, WATER defense at BLOCK timing: no heart lost, use decremented, no gauge', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    // WATER(1) beats FIRE(0) -> STRONG. Offset +190ms > PARRY_WINDOW_MS(175) -> BLOCK (no rally).
    await pressDefenseAt(room, defender, 1, 190); // WATER, BLOCK timing

    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hearts).toBe(3);              // no heart lost on STRONG catch
    expect(defenderState.hand[1].currentUses).toBe(2); // -1 use for the block
    expect(defenderState.fireGauge).toBe(0);           // attack caught — gauge does NOT fill
    expect(room.state.rallyActive).toBe(false);        // no rally (BLOCK, not PARRY)
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});

describe('Scenario 11: full pentagon rally chain — 5 STRONG parries then NO_BLOCK', () => {
  /**
   * Walks the complete element pentagon via STRONG parries:
   *   P1 throws FIRE → P2 parries WATER → P1 parries WIND → P2 parries EARTH
   *   → P1 parries WOOD → P2 parries FIRE → P1 NO_BLOCK (heart + gauge)
   *
   * Verifies:
   *   - No hearts lost across all 5 parry steps
   *   - Each parry costs exactly 1 use on the parrying ring
   *   - gaugeIncreases=false on every caught exchange (gauge only moves on final NO_BLOCK)
   *   - rallyActive and volleyedElement update correctly at each step
   *   - After NO_BLOCK termination: P1 loses 1 heart, P1.fireGauge=1, phase=ATTACK_SELECT
   */
  test('FIRE→WATER→WIND→EARTH→WOOD→FIRE pentagon chain terminates on NO_BLOCK', async () => {
    const { room, c1, c2 } = await joinBattle();
    const p1 = attackerClient(room, c1, c2); // original attacker
    const p2 = defenderClient(room, c1, c2);
    const p1Id = p1.sessionId;
    const p2Id = p2.sessionId;

    // ── Step 1: P1 throws FIRE(0); P2 parries WATER(1) → STRONG ──────────
    p1.send('selectAttack', { slot: 0 }); // FIRE, P1.FIRE: 3→2
    await room.waitForNextPatch(); // DEFEND_WINDOW
    await pressDefenseAt(room, p2, 1, 0); // WATER parry; P2.WATER: 3→2
    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(1); // WATER volley
    expect(room.state.currentAttackerId).toBe(p2Id);
    expect(room.state.players.get(p1Id).hearts).toBe(3);
    expect(room.state.players.get(p2Id).hearts).toBe(3);
    expect(room.state.players.get(p1Id).hand[0].currentUses).toBe(2); // FIRE threw
    expect(room.state.players.get(p2Id).hand[1].currentUses).toBe(2); // WATER parried
    expect(room.state.players.get(p1Id).fireGauge).toBe(0); // caught, no gauge
    expect(room.state.players.get(p2Id).fireGauge).toBe(0);

    // ── Step 2: P2 volleys WATER; P1 parries WIND(3) → STRONG ────────────
    await pressDefenseAt(room, p1, 3, 0); // WIND parry; P1.WIND: 3→2
    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(3); // WIND volley
    expect(room.state.currentAttackerId).toBe(p1Id);
    expect(room.state.players.get(p1Id).hand[3].currentUses).toBe(2); // WIND parried
    expect(room.state.players.get(p1Id).waterGauge).toBe(0);
    expect(room.state.players.get(p2Id).waterGauge).toBe(0);
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);

    // ── Step 3: P1 volleys WIND; P2 parries EARTH(2) → STRONG ────────────
    await pressDefenseAt(room, p2, 2, 0); // EARTH parry; P2.EARTH: 3→2
    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(2); // EARTH volley
    expect(room.state.currentAttackerId).toBe(p2Id);
    expect(room.state.players.get(p2Id).hand[2].currentUses).toBe(2); // EARTH parried
    expect(room.state.players.get(p1Id).windGauge).toBe(0);
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);

    // ── Step 4: P2 volleys EARTH; P1 parries WOOD(4) → STRONG ────────────
    await pressDefenseAt(room, p1, 4, 0); // WOOD parry; P1.WOOD: 3→2
    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(4); // WOOD volley
    expect(room.state.currentAttackerId).toBe(p1Id);
    expect(room.state.players.get(p1Id).hand[4].currentUses).toBe(2); // WOOD parried
    expect(room.state.players.get(p2Id).earthGauge).toBe(0);
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);

    // ── Step 5: P1 volleys WOOD; P2 parries FIRE(0) → STRONG ─────────────
    await pressDefenseAt(room, p2, 0, 0); // FIRE parry; P2.FIRE: 3→2
    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(0); // FIRE volley — full pentagon cycle
    expect(room.state.currentAttackerId).toBe(p2Id);
    expect(room.state.players.get(p2Id).hand[0].currentUses).toBe(2); // FIRE parried
    expect(room.state.players.get(p1Id).woodGauge).toBe(0);
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);

    // ── Step 6: P2 volleys FIRE; P1 NO_BLOCK → rally ends ────────────────
    await waitForResolve(); // P1 doesn't press; window expires
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.rallyActive).toBe(false);
    // P1 (rally-defender) loses 1 heart from the uncontested FIRE hit
    expect(room.state.players.get(p1Id).hearts).toBe(2);
    expect(room.state.players.get(p2Id).hearts).toBe(3);
    // P1's fireGauge fills because FIRE landed uncontested
    expect(room.state.players.get(p1Id).fireGauge).toBe(1);
    expect(room.state.players.get(p2Id).fireGauge).toBe(0);
    // Role swap: P1 becomes next attacker
    expect(room.state.currentAttackerId).toBe(p1Id);
  });
});

describe('Scenario 10: PARRY + WEAK -> heart lost, no gauge, no rally', () => {
  test('FIRE attack, WOOD defense at PARRY timing: heart lost, use decremented, no gauge, no rally', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    // FIRE(0) beats WOOD(4) -> WEAK for defender. Offset 0ms -> PARRY timing.
    // WEAK catch: heart lost regardless of timing; no gauge (attack was caught); no rally.
    await pressDefenseAt(room, defender, 4, 0); // WOOD, PARRY timing

    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hearts).toBe(2);              // heart lost (WEAK, even on PARRY)
    expect(defenderState.hand[4].currentUses).toBe(2); // -1 use for the catch
    expect(defenderState.fireGauge).toBe(0);           // attack caught — gauge does NOT fill
    expect(room.state.rallyActive).toBe(false);        // WEAK: no rally even on perfect timing
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});
