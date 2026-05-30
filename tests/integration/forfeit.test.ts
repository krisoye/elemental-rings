/**
 * Recharge + Forfeit integration tests using @colyseus/testing (Colyseus 0.17)
 * — issue #124 (supersedes the old §6.6 auto-forfeit suite).
 *
 * GDD §6.3 (PR #120 rewrote §6.6): ring exhaustion NO LONGER auto-loses. A
 * player who begins their turn with both attack rings extinguished simply has no
 * `attack` action — they must `recharge` (spend spirit to restore a ring) or
 * `forfeit` (concede: lose the staked ring + GOLD_FORFEIT_PENALTY gold).
 *
 * These tests boot a real Colyseus server and drive the real handler path. State
 * assertions read authoritative `room.state`. Recharge spirit / forfeit gold
 * persistence is exercised by the e2e suite (DB-backed); here we assert the live
 * room state machine (no auto-forfeit, recharge restores + advances turn, an
 * explicit forfeit message ends the duel for the opponent).
 *
 * Default loadout (seatPlayer DEFAULT_LOADOUT): thumb=FIRE, a1=FIRE, a2=WATER,
 * d1=WOOD, d2=EARTH. With a FIRE thumb, Kindling buffs the FIRE a1 to 4 uses.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';

let colyseus: ColyseusTestServer<any>;

beforeAll(async () => {
  const server = new Server();
  server.define('battle', BattleRoom);
  server.define('battle-ai', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

async function joinBattle() {
  const room = await colyseus.createRoom<any>('battle', {});
  const c1 = await colyseus.connectTo(room);
  const c2 = await colyseus.connectTo(room);
  await room.waitForNextPatch();
  await room.waitForNextPatch();
  return { room, c1, c2 };
}

function attackerClient(room: any, c1: any, c2: any) {
  return room.state.currentAttackerId === c1.sessionId ? c1 : c2;
}

/** Drain both attack rings of a player's PlayerState directly. */
function extinguishAttacks(ps: any) {
  for (const key of ['a1', 'a2']) {
    ps[key].currentUses = 0;
    ps[key].isExtinguished = true;
  }
}

describe('No more auto-forfeit (#124)', () => {
  test('both attack rings extinguished at turn start → NOT defeated; stays in ATTACK_SELECT', async () => {
    const room = await colyseus.createRoom<any>('battle', {});
    const c1 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    // c1 is seated first → it becomes currentAttackerId (ids[0]) once c2 joins.
    extinguishAttacks(room.state.players.get(c1.sessionId));

    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(50);

    // No auto-forfeit: the duel stays live in ATTACK_SELECT with c1 as attacker.
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.currentAttackerId).toBe(c1.sessionId);
    expect(room.state.winnerId).toBeFalsy();
  });

  test('a normal exchange that swaps to an attacker with both rings dead does NOT end the duel', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;

    // The current defender becomes the next attacker after a normal no-block
    // exchange. Drain their attack rings — the post-swap entry must NOT forfeit.
    extinguishAttacks(room.state.players.get(defenderId));

    attacker.send('selectAttack', { slot: 'a1' });
    await room.waitForNextPatch();
    await sleep(1400); // telegraph + window + resolve

    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.currentAttackerId).toBe(defenderId);
    expect(room.state.winnerId).toBeFalsy();
  });
});

describe('Recharge (#124)', () => {
  test('recharge restores the ring to max and advances the turn to the opponent', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;
    const ps = room.state.players.get(attacker.sessionId);

    // Drop a1 to 0/its-max so recharge has work to do. (No DB-backed spirit on a
    // no-token integration session → recharge is "free", restoring fully.)
    const max = ps.a1.maxUses;
    ps.a1.currentUses = 0;
    ps.a1.isExtinguished = true;

    attacker.send('recharge', { slot: 'a1' });
    await room.waitForNextPatch();
    await sleep(50);

    const after = room.state.players.get(attacker.sessionId);
    expect(after.a1.currentUses).toBe(max); // restored to max
    expect(after.a1.isExtinguished).toBe(false);
    // Turn consumed → opponent is now the attacker, back in ATTACK_SELECT.
    expect(room.state.currentAttackerId).toBe(defenderId);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });

  test('recharge on a full ring is a no-op that still consumes the turn', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;
    const ps = room.state.players.get(attacker.sessionId);
    const fullUses = ps.a2.currentUses;
    expect(ps.a2.currentUses).toBe(ps.a2.maxUses); // already full

    attacker.send('recharge', { slot: 'a2' });
    await room.waitForNextPatch();
    await sleep(50);

    const after = room.state.players.get(attacker.sessionId);
    expect(after.a2.currentUses).toBe(fullUses); // unchanged
    expect(room.state.currentAttackerId).toBe(defenderId); // turn still consumed
  });

  test('recharge from the wrong sender / wrong phase is silently ignored', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = attacker.sessionId === c1.sessionId ? c2 : c1;
    const attackerId = attacker.sessionId;

    // The non-attacker tries to recharge during ATTACK_SELECT → ignored.
    defender.send('recharge', { slot: 'a1' });
    await sleep(50);
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.currentAttackerId).toBe(attackerId); // turn did NOT advance
  });
});

// #188: defense rings (d1/d2) are rechargeable in-duel via the attack-phase
// double-tap, symmetric to the attack-ring recharge above. The accepted slot
// domain widens to {a1,a2,d1,d2}; the Thumb stays non-rechargeable. Spirit
// gating (partial restore on insufficient spirit) is DB-backed → e2e-covered.
describe('Defense recharge (#188)', () => {
  test('recharge on d1 restores the ring to max and advances the turn to the opponent', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;
    const ps = room.state.players.get(attacker.sessionId);

    const max = ps.d1.maxUses;
    ps.d1.currentUses = 0;
    ps.d1.isExtinguished = true;

    attacker.send('recharge', { slot: 'd1' });
    await room.waitForNextPatch();
    await sleep(50);

    const after = room.state.players.get(attacker.sessionId);
    expect(after.d1.currentUses).toBe(max); // restored to max (free, no-token session)
    expect(after.d1.isExtinguished).toBe(false);
    // Turn consumed → opponent is now the attacker, back in ATTACK_SELECT.
    expect(room.state.currentAttackerId).toBe(defenderId);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });

  test('recharge on a depleted d2 restores uses and still consumes the turn', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;
    const ps = room.state.players.get(attacker.sessionId);

    const max = ps.d2.maxUses;
    ps.d2.currentUses = 0;
    ps.d2.isExtinguished = true;

    attacker.send('recharge', { slot: 'd2' });
    await room.waitForNextPatch();
    await sleep(50);

    const after = room.state.players.get(attacker.sessionId);
    expect(after.d2.currentUses).toBe(max);
    expect(after.d2.isExtinguished).toBe(false);
    expect(room.state.currentAttackerId).toBe(defenderId); // turn consumed
  });

  test('recharge of d1 by the wrong sender during ATTACK_SELECT is silently ignored', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = attacker.sessionId === c1.sessionId ? c2 : c1;
    const attackerId = attacker.sessionId;

    defender.send('recharge', { slot: 'd1' });
    await sleep(50);
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.currentAttackerId).toBe(attackerId); // turn did NOT advance
  });

  test('recharge of d1 during DEFEND_WINDOW (wrong phase) is silently ignored', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const attackerId = attacker.sessionId;

    // Open the defend window so the room is no longer in ATTACK_SELECT.
    attacker.send('selectAttack', { slot: 'a1' });
    await room.waitForNextPatch();
    await sleep(50);
    expect(room.state.phase).toBe('DEFEND_WINDOW');

    attacker.send('recharge', { slot: 'd1' });
    await sleep(50);
    // Still in the defend window with the same attacker — recharge was ignored.
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe(attackerId);
  });

  test('recharge of the Thumb slot is rejected (not a combat ring) and does NOT consume the turn', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const attackerId = attacker.sessionId;
    const ps = room.state.players.get(attackerId);

    // Deplete the thumb so a (wrongful) recharge would visibly restore it.
    ps.thumb.currentUses = 0;

    attacker.send('recharge', { slot: 'thumb' });
    await sleep(50);

    const after = room.state.players.get(attackerId);
    expect(after.thumb.currentUses).toBe(0); // unchanged — thumb is non-rechargeable
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.currentAttackerId).toBe(attackerId); // turn NOT consumed
  });
});

describe('Forfeit (#124)', () => {
  test('forfeit by the attacker → phase ENDED, opponent wins', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defenderId = (attacker.sessionId === c1.sessionId ? c2 : c1).sessionId;

    attacker.send('forfeit');
    await room.waitForNextPatch();
    await sleep(50);

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(defenderId);
    expect(room.state.winnerId).not.toBe(attacker.sessionId);
  });

  test('forfeit from the wrong sender (defender) is silently ignored', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = attacker.sessionId === c1.sessionId ? c2 : c1;

    defender.send('forfeit');
    await sleep(50);
    expect(room.state.phase).toBe('ATTACK_SELECT'); // not ended
    expect(room.state.winnerId).toBeFalsy();
  });

  test('forfeit works even with both attack rings exhausted (the intended escape hatch)', async () => {
    const room = await colyseus.createRoom<any>('battle', {});
    const c1 = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    extinguishAttacks(room.state.players.get(c1.sessionId));
    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(50);

    // c1 (no attacks) is the attacker, not auto-defeated. It forfeits explicitly.
    expect(room.state.currentAttackerId).toBe(c1.sessionId);
    c1.send('forfeit');
    await room.waitForNextPatch();
    await sleep(50);

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(c2.sessionId);
  });
});
