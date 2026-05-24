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
 * press, negative is early; `pressTime - impactTime` lands on `offsetMs`.
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
    expect(room.state.players.get(defenderId).hearts).toBe(2);
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

    // impact + 130ms: |130| > 70 (not PARRY) but <= 180 (BLOCK). FIRE vs FIRE = NEUTRAL.
    await pressDefenseAt(room, defender, 0, 130);

    const defenderState = room.state.players.get(defenderId);
    expect(defenderState.hearts).toBe(3);
    expect(defenderState.hand[0].currentUses).toBe(2); // 3 -> 2 on a clean block
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

    // Round 2: P2 now volleys WATER; P1 (defending) parries WIND(3).
    // WIND beats WATER -> STRONG PARRY from P1's view -> rally continues, volley = WIND.
    // The rally swap already set impactTime for round 2, so press relative to it.
    await pressDefenseAt(room, p1, 3, 0); // WIND

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(3); // WIND
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe(p1.sessionId);

    for (const p of room.state.players.values()) {
      expect((p as any).hearts).toBe(3);
    }
  });
});

describe('Scenario 8: WEAK block use-overflow -> heart lost', () => {
  /**
   * The "ring runs out of uses while blocking a strong attack -> heart lost"
   * overflow path is fully and deterministically covered in the unit suite
   * (tests/unit/BlockResolver.test.ts), because depleting a specific ring to a
   * single use in integration would require many timed round-trips (and the
   * role swap after every clean block makes that brittle).
   *
   * Here we verify the integration-relevant invariant instead: a WEAK block
   * (defender's element loses to the attacker's element) burns TWO ring uses
   * in a single exchange and that the depletion is reflected in broadcast
   * state. FIRE(0) attack vs WOOD(4) defense is WEAK (FIRE beats WOOD), so a
   * clean BLOCK should drop WOOD's uses by 2 (3 -> 1).
   */
  test('WEAK block burns two ring uses; broadcast state reflects depletion', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 0 }); // FIRE
    await room.waitForNextPatch();

    // BLOCK timing (impact + 130ms), WOOD(4) defense vs FIRE attack = WEAK.
    await pressDefenseAt(room, defender, 4, 130); // WOOD

    const defenderState = room.state.players.get(defenderId);
    // WEAK block: -1 (base) -1 (weak penalty) = WOOD 3 -> 1. Uses still > 0,
    // so the heart survives this exchange (overflow-past-zero is the unit test).
    expect(defenderState.hand[4].currentUses).toBe(1);
    expect(defenderState.hearts).toBe(3);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});
