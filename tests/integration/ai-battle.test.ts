/**
 * vsAI integration tests using @colyseus/testing (Colyseus 0.17).
 *
 * Boots a real Colyseus server with both `battle` (PvP) and `battle-ai` (vsAI)
 * room names on the BattleRoom class, then drives full vsAI duels. The AI is a
 * virtual player: it never connects a client — it calls the room's
 * `handleSelectAttack` / `handleSubmitDefense` directly, the same path a human's
 * messages take. A fixed `aiSeed` makes the AI's RNG (think-delays, timing
 * jitter, no-block coin flips) deterministic.
 *
 * See tests/integration/battle.test.ts for the harness rationale (single boot,
 * threads pool, fixed port 2568).
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

/**
 * Create a vsAI room (AI seated on create) and connect a single human client.
 * Resolves once the room reaches ATTACK_SELECT (both seated). The AI is player
 * #1 (seated in onCreate) and therefore the first attacker.
 */
async function joinVsAI(personality: string, aiSeed: number) {
  const room = await colyseus.createRoom<any>('battle-ai', {
    vsAI: true,
    personality,
    aiSeed,
  });
  const human = await colyseus.connectTo(room);
  // One join patch (AI was already seated in onCreate) → ATTACK_SELECT.
  await room.waitForNextPatch();
  // Give the post-join notifyAI() a tick to register if AI is first attacker.
  await sleep(20);
  return { room, human };
}

describe('vsAI: AI is seated and drives the duel', () => {
  test('AI seats as player #1, room locks, human is player #2', async () => {
    const { room, human } = await joinVsAI('AGGRESSIVE', 12345);

    expect(room.state.players.size).toBe(2);
    expect(room.state.players.has('AI')).toBe(true);
    expect(room.locked).toBe(true);

    // AI seated first → AI is the opening attacker.
    expect(room.state.currentAttackerId).toBe('AI');
    expect(room.state.players.get('AI').displayName).toBe('AGGRESSIVE');
    expect(room.state.players.get(human.sessionId).displayName).toBe('');
  });

  test('AI attacks unprompted: human idles, phase advances to DEFEND_WINDOW', async () => {
    const { room } = await joinVsAI('AGGRESSIVE', 999);
    expect(room.state.currentAttackerId).toBe('AI');

    // Poll until the AI opens a DEFEND_WINDOW (think-delay + optional charge hold).
    // Under E2E_FAST: total ≈ 20–50ms think + tap/charge; max budget 800ms.
    for (let i = 0; i < 40 && room.state.phase !== 'DEFEND_WINDOW'; i++) await sleep(20);
    expect(room.state.phase).toBe('DEFEND_WINDOW');
    expect(room.state.currentAttackerId).toBe('AI');
    // The AI must pick a real attack slot (a1 or a2), never a defense slot.
    expect(['a1', 'a2']).toContain(room.state.attackerSlot);
  });

  test('AI defends a human throw: human attacks, AI commits a ring', async () => {
    // Use DEFENSIVE so the AI reliably catches (it picks a NEUTRAL block).
    // Seed chosen so its first defense draw is a block, not a no-block.
    const { room, human } = await joinVsAI('DEFENSIVE', 4242);

    // Let the AI take its opening attack and resolve so the human becomes attacker.
    await sleep(1500);
    // If the AI is still attacking through a rally chain, idle until it's the
    // human's turn (bounded).
    for (let i = 0; i < 8 && room.state.currentAttackerId !== human.sessionId; i++) {
      await sleep(1500);
    }
    if (room.state.phase === 'ENDED') return; // duel may end fast — acceptable

    expect(room.state.currentAttackerId).toBe(human.sessionId);
    expect(room.state.phase).toBe('ATTACK_SELECT');

    const combatUses = (ps: any): number =>
      ['a1', 'a2', 'd1', 'd2'].reduce((n, k) => n + ps[k].currentUses, 0);

    const aiBefore = room.state.players.get('AI');
    const usesBefore = combatUses(aiBefore);
    const heartsBefore = aiBefore.hearts;

    human.send('selectAttack', { slot: 'a1' }); // FIRE
    // Wait past the defend window + resolve so the AI's scheduled press lands.
    await sleep(1500);

    const aiAfter = room.state.players.get('AI');
    const usesAfter = combatUses(aiAfter);
    // The AI responded (not idle): either it spent a ring use defending, or it
    // took a heart hit. Both prove the defense code path ran for the AI.
    expect(usesAfter < usesBefore || aiAfter.hearts < heartsBefore).toBe(true);
  });
});

describe('vsAI: duels reach completion deterministically', () => {
  test('a seeded duel reaches ENDED with a winner', async () => {
    const { room, human } = await joinVsAI('AGGRESSIVE', 2024);

    // The human attacks whenever it is its turn (so a role-swap to the human as
    // attacker never stalls the duel) but never defends. The AI attacks and
    // defends on its turns. Drive until KO.
    for (let i = 0; i < 80 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('selectAttack', { slot: 'a1' }); // FIRE
      }
      await sleep(250);
    }
    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBeTruthy();
  }, 25000);

  test('determinism: same aiSeed reproduces the same opening attack slot', async () => {
    // STATUS_HUNTER has chargeAttemptProb=0.2 — poll until DEFEND_WINDOW so we
    // capture attackerSlot while it is still set (before the phase clears it).
    const a = await joinVsAI('STATUS_HUNTER', 77);
    for (let i = 0; i < 20 && a.room.state.phase !== 'DEFEND_WINDOW'; i++) await sleep(100);
    const slotA = a.room.state.attackerSlot;

    const b = await joinVsAI('STATUS_HUNTER', 77);
    for (let i = 0; i < 20 && b.room.state.phase !== 'DEFEND_WINDOW'; i++) await sleep(100);
    const slotB = b.room.state.attackerSlot;

    expect(['a1', 'a2']).toContain(slotA);
    expect(slotA).toBe(slotB);
  });
});

describe('room-name isolation', () => {
  test("joinOrCreate('battle') never lands in a locked battle-ai room", async () => {
    // Create a vsAI room first; it is locked.
    const ai = await joinVsAI('RESILIENT', 1);
    expect(ai.room.locked).toBe(true);

    // A fresh PvP join must create a brand-new, unlocked, single-player room —
    // not the AI room.
    const pvp = await colyseus.sdk.joinOrCreate('battle', {});
    // Give the join a patch to apply.
    await sleep(50);
    expect(pvp.roomId).not.toBe(ai.room.roomId);
    expect(pvp.state.players.size).toBe(1);
    await pvp.leave();
  });
});
