/**
 * Forfeit integration tests using @colyseus/testing (Colyseus 0.17) — issue #24.
 *
 * GDD §6.6: if the current attacker begins their turn with BOTH attack rings
 * (A1 + A2) extinguished, they immediately forfeit and the opponent wins —
 * even with hearts remaining. Before this fix the room sat in ATTACK_SELECT
 * indefinitely (deadlock), since no attack could ever be submitted.
 *
 * These tests boot a real Colyseus server, mutate ring state on the live room
 * (the `room` handle returned by createRoom IS the BattleRoom instance — see
 * battle.test.ts accessing `room.impactTime`), then drive REAL phase
 * transitions through the same client/handler path a duel uses. All assertions
 * read authoritative `room.state`, never mocked values.
 *
 * Default loadout (seatPlayer): thumb=WOOD, a1=FIRE, a2=WATER, d1=WOOD, d2=EARTH.
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';
import { TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../../server/src/game/constants';

const RESOLVE_BUFFER_MS = 250;

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
function defenderClient(room: any, c1: any, c2: any) {
  return room.state.currentAttackerId === c1.sessionId ? c2 : c1;
}

/** Drain both attack rings of a player's PlayerState directly. */
function extinguishAttacks(ps: any) {
  for (const key of ['a1', 'a2']) {
    ps[key].currentUses = 0;
    ps[key].isExtinguished = true;
  }
}

async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

describe('Scenario 1: both attack rings exhausted at turn start → forfeit', () => {
  test('a no-block exchange swaps to an attacker with no usable attacks → ENDED, opponent wins', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const defender = defenderClient(room, c1, c2);
    const attackerId = attacker.sessionId;
    const defenderId = defender.sessionId;

    // The current DEFENDER will become the next attacker after a normal exchange.
    // Drain both of THEIR attack rings so the post-swap checkAttackForfeit fires.
    extinguishAttacks(room.state.players.get(defenderId));

    // Real transition: attacker fires FIRE(a1), defender never blocks → normal
    // (non-rally) resolve swaps roles into ATTACK_SELECT, where the new attacker
    // (former defender) has no usable attack ring.
    attacker.send('selectAttack', { slot: 'a1' });
    await room.waitForNextPatch();
    await waitForResolve();

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(attackerId);
    expect(room.state.winnerId).not.toBe(defenderId);
  });

  test('forfeit can fire at duel start: opening attacker has both attack rings dead', async () => {
    // Seat both players, then (before the 2nd join completes the ATTACK_SELECT
    // entry is hard to interleave) instead create the room, connect one client,
    // drain the seated player's attacks, then connect the second client so the
    // size===2 branch runs checkAttackForfeit at onJoin.
    const room = await colyseus.createRoom<any>('battle', {});
    const c1 = await colyseus.connectTo(room);
    await room.waitForNextPatch();

    // c1 is seated first → will be currentAttackerId (ids[0]) once the 2nd joins.
    extinguishAttacks(room.state.players.get(c1.sessionId));

    const c2 = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(50);

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(c2.sessionId);
    expect(room.state.winnerId).not.toBe(c1.sessionId);
  });
});

describe('Scenario 2: one attack ring usable → no forfeit', () => {
  test('only a1 extinguished; a2 usable → selectAttack(a2) proceeds to DEFEND_WINDOW', async () => {
    const { room, c1, c2 } = await joinBattle();
    const attacker = attackerClient(room, c1, c2);
    const attackerId = attacker.sessionId;

    const ps = room.state.players.get(attackerId);
    // Kill a1 only; leave a2 fully usable.
    ps.a1.currentUses = 0;
    ps.a1.isExtinguished = true;
    expect(ps.a2.isExtinguished).toBe(false);
    expect(ps.a2.currentUses).toBeGreaterThanOrEqual(1);

    // We are already in ATTACK_SELECT with this attacker; no forfeit must have
    // been triggered at join (a2 was usable).
    expect(room.state.phase).toBe('ATTACK_SELECT');

    attacker.send('selectAttack', { slot: 'a2' }); // WATER, usable
    await room.waitForNextPatch();

    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.attackerSlot).toBe('a2');
    expect(room.state.winnerId).toBeFalsy();
  });
});

describe('Scenario 3: AI exhausts its own attack rings → AI loses', () => {
  test('drain the AI attacker rings, then drive a real swap → non-AI wins, ENDED', async () => {
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'DEFENSIVE',
      aiSeed: 4242,
    });
    const human = await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(20);

    // AI is seated first → it is the opening attacker.
    expect(room.state.currentAttackerId).toBe('AI');

    // Drain the AI's attack rings. The AI will become the next attacker after a
    // normal exchange in which the HUMAN is the attacker; so we need the human
    // attacking and the AI defending, then the swap makes the (drained) AI the
    // attacker → forfeit. Force that ordering by extinguishing the AI's attacks
    // and letting the human throw on the AI's defense.
    extinguishAttacks(room.state.players.get('AI'));

    // Wait for it to become the human's turn (the AI may take its opening attack
    // first; since its attack rings are now empty, the AI's own ATTACK_SELECT
    // entry — already past at join — won't re-trigger until a swap). The simplest
    // deterministic path: idle until the AI's scheduled opening attack is blocked
    // by empty rings, leaving the room in ATTACK_SELECT with AI as attacker but
    // unable to throw — except the forfeit check only runs ON ENTRY. So instead,
    // drive a real entry: the AI was the opening attacker BEFORE we drained, so
    // its onJoin ATTACK_SELECT entry already passed. Re-enter ATTACK_SELECT with
    // the AI as attacker by running one full exchange where the human throws and
    // the swap returns the turn to the AI.

    // Make the AI the defender for one exchange: it is currently the attacker, so
    // first let the AI attack the human (it still has its scheduled think-delay,
    // but empty attack rings mean handleSelectAttack is a no-op for it). To avoid
    // depending on AI internals, directly set the human as the current attacker
    // for a clean, real ATTACK_SELECT → DEFEND_WINDOW → swap → forfeit path:
    room.state.currentAttackerId = human.sessionId;

    // Human throws FIRE; AI (DEFENSIVE) may or may not block. Either way the
    // non-rally resolve swaps the attacker to the (drained) AI → forfeit.
    human.send('selectAttack', { slot: 'a1' });
    // Wait through the defend window + resolve + a margin for the AI's press.
    await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + 800);

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(human.sessionId);
    expect(room.state.winnerId).not.toBe('AI');
  }, 15000);
});
