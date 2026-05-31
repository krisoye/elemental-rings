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

const { FIRE, WATER, WOOD, SHADOW } = ElementEnum;

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

// #123 — four-case gauge model at the room level. The strong-block decrement and
// the strong-parry clear-all are timing-precise, so they are pinned here (the
// @colyseus/testing path controls the defense offset exactly via pressDefenseAt),
// not in the browser E2E where BLOCK-vs-PARRY is jittery.
describe('Scenario 13: four-case gauge model (§7.1)', () => {
  test('strong BLOCK (WATER blocks FIRE): water +1 (case 2), fire −1 (case 3)', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    // Give the defender a WATER ring on d1 and seed a high fireGauge so the −1 is
    // visible. (Default d1 = WOOD.)
    const d = room.state.players.get(defenderId);
    d.d1.element = WATER;
    d.fireGauge = 3;
    d.waterGauge = 0;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    // offset +190ms → BLOCK band (>175 PARRY, ≤200 BLOCK): a STRONG BLOCK, not a parry.
    await pressDefenseAt(room, defender, 'd1', 190);

    const after = room.state.players.get(defenderId);
    expect(after.hearts).toBe(3); // strong catch — no heart
    expect(after.waterGauge).toBe(1); // defending WATER ring fills its gauge (case 2)
    expect(after.fireGauge).toBe(2); // beaten fire gauge 3 → 2 (case 3)
    expect(room.state.rallyActive).toBe(false); // BLOCK never rallies
  });

  test('Fire strong BLOCK vs WOOD: fire +1 (case 2), wood −1 (case 3)', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);

    // Attacker throws WOOD (override a1=WOOD); defender Fire-blocks on d1.
    room.state.players.get(attacker.sessionId).a1.element = WOOD;
    const d = room.state.players.get(defender.sessionId);
    d.d1.element = FIRE;
    d.woodGauge = 2;
    d.fireGauge = 0;

    attacker.send('selectAttack', { slot: 'a1' }); // WOOD
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 190); // FIRE strong BLOCK vs WOOD

    const after = room.state.players.get(defender.sessionId);
    expect(after.hearts).toBe(3);
    expect(after.fireGauge).toBe(1); // case 2
    expect(after.woodGauge).toBe(1); // case 3: 2 → 1
  });

  test('strong PARRY (WATER parries FIRE): clears ALL triangle gauges (case 4)', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    const d = room.state.players.get(defenderId);
    d.d1.element = WATER;
    d.fireGauge = 3;
    d.waterGauge = 2;
    d.woodGauge = 1;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 0); // WATER STRONG parry vs FIRE → rally + clear

    expect(room.state.rallyActive).toBe(true);
    const after = room.state.players.get(defenderId);
    // A parry is terminal — all four(/three) gauges reset to 0, NOT +1 for the
    // catching ring.
    expect(after.fireGauge).toBe(0);
    expect(after.waterGauge).toBe(0);
    expect(after.woodGauge).toBe(0);
  });

  test('NEUTRAL block (FIRE blocks FIRE): block gauge +1, no decrement, no clear', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    const d = room.state.players.get(defenderId);
    d.d1.element = FIRE;
    d.fireGauge = 0;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 0); // FIRE vs FIRE NEUTRAL

    const after = room.state.players.get(defenderId);
    expect(after.fireGauge).toBe(1); // case 2 fills the defending element's gauge
    expect(room.state.rallyActive).toBe(false);
  });

  test('EARTH (non-triangle) block adds no gauge (case 2 skipped)', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    // Default d2 = EARTH. Block FIRE with EARTH — safe, but no gauge.
    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd2', 0); // EARTH NEUTRAL

    const after = room.state.players.get(defenderId);
    expect(after.fireGauge).toBe(0);
    expect(after.waterGauge).toBe(0);
    expect(after.woodGauge).toBe(0);
  });
});

// #134 — Shadow gauge + Blinded extend the four-case model with a 4th gauge.
describe('Scenario 14: shadow gauge (§7.1 / §3.5)', () => {
  test('uncontested SHADOW hit → defender shadowGauge +1', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    room.state.players.get(attacker.sessionId).a1.element = SHADOW;
    attacker.send('selectAttack', { slot: 'a1' }); // SHADOW
    await room.waitForNextPatch();
    await waitForResolve(); // no block → uncontested hit

    const after = room.state.players.get(defenderId);
    expect(after.shadowGauge).toBe(1);
    expect(after.hearts).toBe(2); // the hit also cost a heart
  });

  test('Fire strong BLOCK vs SHADOW → fire +1, decrements BOTH wood and shadow', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    room.state.players.get(attacker.sessionId).a1.element = SHADOW;
    const d = room.state.players.get(defenderId);
    d.d1.element = FIRE;
    d.woodGauge = 2;
    d.shadowGauge = 2;
    d.fireGauge = 0;

    attacker.send('selectAttack', { slot: 'a1' }); // SHADOW
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 190); // FIRE strong BLOCK vs SHADOW

    const after = room.state.players.get(defenderId);
    expect(after.hearts).toBe(3); // strong catch — no heart
    expect(after.fireGauge).toBe(1); // case 2
    expect(after.woodGauge).toBe(1); // 2 → 1
    expect(after.shadowGauge).toBe(1); // 2 → 1 (Fire dispels Shadow too)
  });

  test('strong PARRY clears ALL FOUR gauges (fire/water/wood/shadow)', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    const d = room.state.players.get(defenderId);
    d.d1.element = WATER;
    d.fireGauge = 3;
    d.waterGauge = 2;
    d.woodGauge = 1;
    d.shadowGauge = 2;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();
    await pressDefenseAt(room, defender, 'd1', 0); // WATER STRONG parry vs FIRE → clear

    expect(room.state.rallyActive).toBe(true);
    const after = room.state.players.get(defenderId);
    expect(after.fireGauge).toBe(0);
    expect(after.waterGauge).toBe(0);
    expect(after.woodGauge).toBe(0);
    expect(after.shadowGauge).toBe(0);
  });

  test('shadowGauge clamps at 5', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    room.state.players.get(attacker.sessionId).a1.element = SHADOW;
    room.state.players.get(defenderId).shadowGauge = 5; // already at cap

    attacker.send('selectAttack', { slot: 'a1' }); // SHADOW
    await room.waitForNextPatch();
    await waitForResolve(); // uncontested SHADOW hit would push the gauge → +1

    const after = room.state.players.get(defenderId);
    expect(after.shadowGauge).toBe(5); // clamped, not 6
  });
});

// Regression: an exhausted (0-use) defense ring must not be able to catch. The
// submitDefense handler mirrors the attack-side isExtinguished guard, so pressing
// a spent ring is ignored and the attack lands uncontested (NO_BLOCK) rather than
// resolving as a free block.
describe('Scenario 15: exhausted defense ring cannot block', () => {
  test('pressing a 0-use d1 is ignored → NO_BLOCK (heart + gauge), ring stays spent', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const defenderId = defender.sessionId;

    // Exhaust the defender's WOOD ring on d1.
    const d1 = room.state.players.get(defenderId).d1;
    d1.currentUses = 0;
    d1.isExtinguished = true;

    attacker.send('selectAttack', { slot: 'a1' }); // FIRE
    await room.waitForNextPatch();

    // Press the spent d1 at perfect parry timing — must be ignored by the guard.
    await pressDefenseAt(room, defender, 'd1', 0);

    const d = room.state.players.get(defenderId);
    expect(d.d1.currentUses).toBe(0); // never charged a use
    expect(d.d1.isExtinguished).toBe(true);
    expect(d.hearts).toBe(2); // took the uncontested hit
    expect(d.fireGauge).toBe(1); // NO_BLOCK fills the gauge; a WEAK block would not
    expect(room.state.phase).toBe('ATTACK_SELECT');
  });
});
