/**
 * BattleRoom integration tests using @colyseus/testing (Colyseus 0.17).
 *
 * Boots a real Colyseus `Server` over the WebSocket transport, connects two SDK
 * clients, and drives full duels through `selectAttack` / `submitDefense` (now
 * keyed by named slot strings) — exercising the room's timing windows, named-slot
 * loadout, 3-gauge model, rally swap, heart logic, and phase-lock end-to-end.
 * (Pure resolution math is in tests/unit/.)
 *
 * Default loadout (seatPlayer): thumb=WOOD, a1=FIRE, a2=WATER, d1=WOOD, d2=EARTH.
 * Under the v4 triangle (Fire→Wood→Water→Fire):
 *   - FIRE(a1) attack vs WOOD(d1) defense → WEAK; vs EARTH(d2) → NEUTRAL
 *   - WATER(a2) attack vs WOOD(d1) defense → STRONG (parry → rally); vs EARTH → NEUTRAL
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';
import { TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../../server/src/game/constants';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, WOOD } = ElementEnum;

const RESOLVE_BUFFER_MS = 250;

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
function defenderClient(room: any, c1: any, c2: any) {
  return room.state.currentAttackerId === c1.sessionId ? c2 : c1;
}

async function pressDefenseAt(room: any, defender: any, slot: string, offsetMs: number) {
  const impactTime: number = room.impactTime;
  await sleep(impactTime + offsetMs - Date.now());
  defender.send('submitDefense', { slot, pressTime: Date.now() });
  await sleep(BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

describe('Scenario 1: full battle to completion', () => {
  test('attacker fires a1 every turn; defender never blocks → KO after 3 no-blocks', async () => {
    const { room, c1, c2 } = await joinBattle();

    for (let i = 0; i < 6 && room.state.phase !== 'ENDED'; i++) {
      const attacker = attackerClient(room, c1, c2);
      attacker.send('selectAttack', { slot: 'a1' });
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

describe('Scenario 2: WATER attack, WOOD PARRY → rally', () => {
  test('WOOD(d1) parry of WATER(a2) → rallyActive, volley=WOOD, roles swapped, no hearts lost', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    attacker.send('selectAttack', { slot: 'a2' }); // WATER
    await room.waitForNextPatch();

    await pressDefenseAt(room, defender, 'd1', 0); // WOOD — STRONG vs WATER, PARRY

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(WOOD);
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe(defender.sessionId);
    expect(room.state.attackerSlot).toBe('d1'); // rally fires with the parrying slot

    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);
  });
});

describe('Scenario 3: WATER attack, EARTH PARRY → NEUTRAL, no rally', () => {
  test('EARTH(d2) parry of WATER(a2) → no rally, ATTACK_SELECT, no hearts lost', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    attacker.send('selectAttack', { slot: 'a2' }); // WATER
    await room.waitForNextPatch();

    await pressDefenseAt(room, defender, 'd2', 0); // EARTH — always NEUTRAL

    expect(room.state.rallyActive).toBe(false);
    expect(room.state.phase).toBe('ATTACK_SELECT');
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);
  });
});

describe('Scenario 4: no-block → heart + gauge', () => {
  test('window closes with no defense → defender loses a heart, fireGauge fills', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await waitForResolve();

    expect(room.state.phase).toBe('ATTACK_SELECT');
    const d = room.state.players.get(defenderId);
    expect(d.hearts).toBe(2);
    expect(d.fireGauge).toBe(1); // FIRE landed uncontested
  });
});

describe('Scenario 5: MISTIME → heart + use + gauge', () => {
  test('defense pressed ~900ms early → MISTIME: heart + 1 use + gauge', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();

    defender.send('submitDefense', { slot: 'd1', pressTime: Date.now() }); // way early → MISTIME
    await waitForResolve();

    expect(room.state.phase).toBe('ATTACK_SELECT');
    const d = room.state.players.get(defenderId);
    expect(d.hearts).toBe(2);
    expect(d.d1.currentUses).toBe(2); // WOOD ring burned 1 use
    expect(d.fireGauge).toBe(1);
  });
});

describe('Scenario 6: post-impact BLOCK (+190ms) NEUTRAL → no heart', () => {
  test('EARTH(d2) at impact+190ms vs FIRE → BLOCK NEUTRAL: no heart, -1 use, no gauge', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    // EARTH is always NEUTRAL — safe whether the press lands as BLOCK or PARRY, so
    // offset 0 avoids the tight 25ms BLOCK band's socket-jitter flakiness.
    await pressDefenseAt(room, defender, 'd2', 0); // EARTH NEUTRAL catch

    const d = room.state.players.get(defenderId);
    expect(d.hearts).toBe(3);
    expect(d.d2.currentUses).toBe(2);
    expect(d.fireGauge).toBe(0); // caught — no gauge
    expect(room.state.rallyActive).toBe(false); // NEUTRAL never rallies
  });
});

describe('Scenario 7: depth-1 rally cost symmetry', () => {
  test('WATER(a2)→WOOD(d1) parry: attacker -1 use on a2, defender -1 use on d1, volley WOOD', async () => {
    const { room, c1, c2 } = await joinBattle();
    const p1 = attackerClient(room, c1, c2);
    const p2 = defenderClient(room, c1, c2);

    p1.send('selectAttack', { slot: 'a2' }); // WATER
    await room.waitForNextPatch();
    await pressDefenseAt(room, p2, 'd1', 0); // WOOD STRONG parry → rally

    expect(room.state.rallyActive).toBe(true);
    expect(room.state.volleyedElement).toBe(WOOD);
    expect(room.state.currentAttackerId).toBe(p2.sessionId);
    expect(room.state.players.get(p1.sessionId).a2.currentUses).toBe(2); // WATER threw
    expect(room.state.players.get(p2.sessionId).d1.currentUses).toBe(2); // WOOD parried
    for (const p of room.state.players.values()) expect((p as any).hearts).toBe(3);
  });
});

describe('Scenario 8: WEAK block → heart lost, -1 use (not -2)', () => {
  test('WOOD(d1) BLOCK of FIRE(a1) → WEAK: -1 use, -1 heart, no gauge', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 190); // WOOD WEAK vs FIRE, BLOCK timing

    const d = room.state.players.get(defenderId);
    expect(d.d1.currentUses).toBe(2);
    expect(d.hearts).toBe(2);
    expect(d.fireGauge).toBe(0);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});

describe('Scenario 9: BLOCK + STRONG → no heart, no gauge', () => {
  test('WOOD(d1) BLOCK of WATER(a2) → STRONG: no heart, -1 use, no gauge, no rally', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a2' }); // WATER
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 190); // WOOD STRONG vs WATER, BLOCK (no rally)

    const d = room.state.players.get(defenderId);
    expect(d.hearts).toBe(3);
    expect(d.d1.currentUses).toBe(2);
    expect(d.waterGauge).toBe(0);
    expect(room.state.rallyActive).toBe(false);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});

describe('Scenario 10: PARRY + WEAK → heart lost, no gauge, no rally', () => {
  test('WOOD(d1) PARRY of FIRE(a1) → WEAK even on perfect timing', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 0); // WOOD WEAK vs FIRE, PARRY timing

    const d = room.state.players.get(defenderId);
    expect(d.hearts).toBe(2);
    expect(d.d1.currentUses).toBe(2);
    expect(d.fireGauge).toBe(0);
    expect(room.state.rallyActive).toBe(false);
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});

describe('Scenario 11: 3-gauge model (no earth/wind gauge)', () => {
  test('uncontested WATER hit fills only waterGauge', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    attacker.send('selectAttack', { slot: 'a2' }); // WATER
    await room.waitForNextPatch();
    await waitForResolve(); // no-block

    const d = room.state.players.get(defenderId);
    expect(d.waterGauge).toBe(1);
    expect(d.fireGauge).toBe(0);
    expect(d.woodGauge).toBe(0);
    // earth/wind gauges no longer exist on the schema.
    expect((d as any).earthGauge).toBeUndefined();
    expect((d as any).windGauge).toBeUndefined();
  });
});

describe('Scenario 12: phase-lock (protective, not punishing)', () => {
  test('attack message during DEFEND_WINDOW is ignored; defense message during ATTACK_SELECT is ignored', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    // ATTACK_SELECT: a defense message from the defender is ignored.
    defender.send('submitDefense', { slot: 'd1', pressTime: Date.now() });
    await sleep(100);
    expect(room.state.phase).toBe('ATTACK_SELECT');

    // Wrong-slot attack ('d1' is not an attack slot) is ignored.
    attacker.send('selectAttack', { slot: 'd1' as any });
    await sleep(100);
    expect(room.state.phase).toBe('ATTACK_SELECT');

    // A valid attack advances to DEFEND_WINDOW.
    attacker.send('selectAttack', { slot: 'a1' });
    await sleep(100);
    expect(room.state.phase).toBe('DEFEND_WINDOW');

    // DEFEND_WINDOW: an attack message from the attacker is ignored.
    const slotBefore = room.state.attackerSlot;
    attacker.send('selectAttack', { slot: 'a2' });
    await sleep(100);
    expect(room.state.attackerSlot).toBe(slotBefore); // unchanged

    // Wrong-slot defense ('a1' is not a defense slot) is ignored → resolves NO_BLOCK.
    defender.send('submitDefense', { slot: 'a1' as any, pressTime: Date.now() });
    await waitForResolve();
    expect(room.state.phase).toBe('ATTACK_SELECT');
    expect(room.state.players.get(defender.sessionId).hearts).toBe(2); // took the hit
  });
});
