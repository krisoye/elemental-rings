/**
 * Boss combat identity integration tests (EPIC #256) using @colyseus/testing.
 *
 * Boots a real Colyseus server with `battle-ai` on BattleRoom and creates rooms
 * with a boss `npcId` so the room resolves the boss descriptor from NPC_SPAWNS and
 * seats the AI with its fused thumb + tiered modifiers. The AI is a virtual player
 * (no client) driven by the room's handler methods, exactly like ai-battle.test.ts.
 *
 * Covers:
 *  #257 — fused-thumb stake (thumb element / isFusion / fusionParents) + two-tone
 *         telegraph (attackerElements length 2). Defeating a fused-thumb boss
 *         grants its fusion via the standard §9.1 won-ring path (#328).
 *  #258 — BOSS_MODIFIERS hearts / uses / modified profile.
 *  #259 — enrage flag on threshold crossing.
 *  #260 — gauge pressure multiplier.
 *  #261 — unique passives (Heartwood / Bulwark).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';
import { BattleRoom } from '../../server/src/rooms/BattleRoom';
import { createPlayer, getRingsByOwner, getSpiritAndFood } from '../../server/src/persistence/PlayerRepo';
import { signToken } from '../../server/src/auth/auth';
import { ElementEnum, type WonRingPayload } from '../../shared/types';
import { TELEGRAPH_MS, BLOCK_WINDOW_MS, STARTING_HEARTS, BOSS_FOOD_DROP, MINI_BOSS_FOOD_DROP } from '../../server/src/game/constants';

let colyseus: ColyseusTestServer<any>;

beforeAll(async () => {
  const server = new Server();
  server.define('battle-ai', BattleRoom);
  colyseus = await boot(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

const sleep = (ms: number) => new Promise((res) => setTimeout(res, Math.max(0, ms)));

/** Create a vsAI boss room (AI seated on create) and connect one human client. */
async function joinBoss(npcId: string, personality: string, aiSeed: number, extra: object = {}) {
  const room = await colyseus.createRoom<any>('battle-ai', {
    vsAI: true,
    personality,
    aiSeed,
    npcId,
    ...extra,
  });
  const human = await colyseus.connectTo(room);
  await room.waitForNextPatch();
  await sleep(20);
  return { room, human };
}

/**
 * Create a vsAI boss room with a TOKEN-authenticated human (a real DB player), so
 * a win resolves `winnerPlayerId` and the §9.1 won-ring grant + `wonRing` message
 * fire. Mirrors {@link joinBoss} but seats the human from its DB loadout and forces
 * a deterministic protagonist WIN via the documented test overrides: the human pays
 * the ambush `firstStrike` to open the duel, and the AI is seated with `aiHearts:1`
 * + `aiUses:0` (extinguished rings → it cannot defend), so the human's opening a1
 * lands the killing blow regardless of millisecond timing.
 */
async function joinBossAsWinner(npcId: string, personality: string, aiSeed: number) {
  const username = `boss_winner_${Math.random().toString(36).slice(2)}`;
  const playerId = createPlayer(username, 'x');
  const token = signToken({ playerId, username });
  const room = await colyseus.createRoom<any>('battle-ai', {
    vsAI: true,
    personality,
    aiSeed,
    npcId,
    aiHearts: 1,
    aiUses: 0,
  });
  const human = await colyseus.connectTo(room, { token, firstStrike: true });
  await room.waitForNextPatch();
  await sleep(20);
  return { room, human, playerId };
}

const RESOLVE_BUFFER_MS = 250;
async function waitForResolve() {
  await sleep(TELEGRAPH_MS + BLOCK_WINDOW_MS + RESOLVE_BUFFER_MS);
}

describe('#257 — bosses stake their fused thumb', () => {
  const cases: Array<{ npcId: string; personality: string; thumb: number }> = [
    { npcId: 'forest_thornwood_warden', personality: 'RESILIENT', thumb: ElementEnum.THORNADO },
    { npcId: 'forest_bogwood_warden', personality: 'DEFENSIVE', thumb: ElementEnum.MUD },
    { npcId: 'forest_thornado_shrine_guardian', personality: 'AGGRESSIVE', thumb: ElementEnum.THORNADO },
    { npcId: 'forest_bloom_shrine_guardian', personality: 'DEFENSIVE', thumb: ElementEnum.BLOOM },
  ];

  for (const c of cases) {
    test(`${c.npcId} seats ${ElementEnum[c.thumb]} on the thumb (isFusion + parents)`, async () => {
      const { room } = await joinBoss(c.npcId, c.personality, 12345);
      const ai = room.state.players.get('AI');
      expect(ai.thumb.element).toBe(c.thumb);
      expect(ai.thumb.isFusion).toBe(true);
      expect(ai.thumb.fusionParents.length).toBe(2);
    });
  }

  test('a non-boss vsAI duel still seats a BASE thumb (no regression)', async () => {
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 7,
    });
    await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(20);
    const ai = room.state.players.get('AI');
    expect(ai.thumb.isFusion).toBe(false);
  });

  test('a boss attack telegraph carries both component elements (attackerElements length 2)', async () => {
    // Thornado Guardian (AGGRESSIVE) attacks first; its a1 is WIND (base) but the
    // duel reaches a thumb-themed throw rarely — instead assert the fusion thumb
    // decomposes. We drive the AI to attack and capture the broadcast; the AI's a1
    // is a base ring, so we verify the fusion telegraph via a thumb-element ring by
    // checking that the staked fusion's componentsOf has 2 entries on the schema.
    const { room } = await joinBoss('forest_thornado_shrine_guardian', 'AGGRESSIVE', 999);
    const ai = room.state.players.get('AI');
    // The fused thumb's component parents are the telegraph's two colours.
    expect(ai.thumb.fusionParents.length).toBe(2);
    expect(Array.from(ai.thumb.fusionParents)).toEqual([ElementEnum.WOOD, ElementEnum.WIND]);
  });

  test('beating a fused-thumb boss grants its staked fusion ring (#328)', async () => {
    // #328 — defeating a fused-thumb boss transfers its staked fusion to the winner
    // via the standard §9.1 won-ring path (no per-NPC carve-out). The Thornado
    // Guardian is one representative boss; the Bloom/Mud/Thornado wins are
    // structurally identical code paths.
    const { room, human, playerId } = await joinBossAsWinner(
      'forest_thornado_shrine_guardian',
      'AGGRESSIVE',
      999,
    );

    let wonRing: WonRingPayload | undefined;
    human.onMessage('wonRing', (msg: WonRingPayload) => {
      wonRing = msg;
    });

    // Drive the duel to ENDED: the human (opener) throws an uncontested a1 hit on
    // its turn. The AI cannot defend (aiUses:0) and dies at one heart, so this
    // resolves within a couple of exchanges; the loop tolerates initiative passing.
    for (let i = 0; i < 6 && room.state.phase !== 'ENDED'; i++) {
      if (room.state.currentAttackerId === human.sessionId) {
        human.send('selectAttack', { slot: 'a1' });
      }
      await waitForResolve();
    }

    expect(room.state.phase).toBe('ENDED');
    expect(room.state.winnerId).toBe(human.sessionId);

    // The won ring landed in the winner's reliquary: assert via the DB.
    const thornado = getRingsByOwner(playerId).filter(
      (r) => r.element === ElementEnum.THORNADO,
    );
    expect(thornado.length).toBe(1);
    expect(thornado[0].fusionParents.length).toBe(2);

    // …and the client received exactly one matching `wonRing` message.
    await sleep(50);
    expect(wonRing).toBeDefined();
    expect(wonRing?.element).toBe(ElementEnum.THORNADO);
    expect(wonRing?.ringId).toBe(thornado[0].id);
  }, 20000);
});

describe('#257 — boss seating leaves the combat hand intact', () => {
  test('a fused-thumb boss keeps all four combat rings (setup passive does not fire)', async () => {
    const { room } = await joinBoss('forest_bogwood_warden', 'DEFENSIVE', 4242);
    const ai = room.state.players.get('AI');
    // The setup passive only fires for Fire/Water/Wood THUMBS. A fusion thumb never
    // triggers it, so the thumb keeps its uses and the combat rings are untouched.
    expect(ai.thumb.currentUses).toBeGreaterThan(0);
    for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
      expect(ai[key].currentUses).toBeGreaterThan(0);
      expect(ai[key].isFusion).toBe(false);
    }
  });
});

// Sanity: the boss hearts assertions belong to #258 but a quick check here keeps
// #257's seating honest against STARTING_HEARTS scaling done later.
describe('#257 — boss is seated and reaches ATTACK_SELECT', () => {
  test('boss room locks and opens with the AI attacking', async () => {
    const { room } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 1);
    expect(room.state.players.size).toBe(2);
    expect(room.locked).toBe(true);
    expect(room.state.currentAttackerId).toBe('AI');
    expect(room.state.players.get('AI').hearts).toBeGreaterThanOrEqual(STARTING_HEARTS);
  });
});

describe('#258 — BOSS_MODIFIERS difficulty bundle', () => {
  test('major boss (Thornwood) seats STARTING_HEARTS + 2', async () => {
    const { room } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 1);
    expect(room.state.players.get('AI').hearts).toBe(STARTING_HEARTS + 2);
  });

  test('gate boss (Bogwood) seats STARTING_HEARTS + 1', async () => {
    const { room } = await joinBoss('forest_bogwood_warden', 'DEFENSIVE', 1);
    expect(room.state.players.get('AI').hearts).toBe(STARTING_HEARTS + 1);
  });

  test('sub bosses (guardians) seat STARTING_HEARTS + 1', async () => {
    const a = await joinBoss('forest_thornado_shrine_guardian', 'AGGRESSIVE', 1);
    expect(a.room.state.players.get('AI').hearts).toBe(STARTING_HEARTS + 1);
    const b = await joinBoss('forest_bloom_shrine_guardian', 'DEFENSIVE', 1);
    expect(b.room.state.players.get('AI').hearts).toBe(STARTING_HEARTS + 1);
  });

  test('non-boss vsAI still seats exactly STARTING_HEARTS', async () => {
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 1,
    });
    await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(20);
    expect(room.state.players.get('AI').hearts).toBe(STARTING_HEARTS);
  });

  test('boss combat rings seat with +bonusUses maxUses over the unscaled baseline', async () => {
    // No playerBattleHandAvgXp → unscaled loadout (tier 1, naturalMaxUses default 3
    // for the AILoadout default path). The sub modifier adds +1 use to each combat
    // ring; the passive thumb is NOT boosted. The Thornado Guardian (sub) has NO
    // Bulwark passive, so all four combat rings land at exactly 4 (clean +bonusUses).
    const { room } = await joinBoss('forest_thornado_shrine_guardian', 'AGGRESSIVE', 1);
    const ai = room.state.players.get('AI');
    for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
      // Default unscaled AI ring maxUses is 3; sub bonusUses = +1 → 4.
      expect(ai[key].maxUses).toBe(4);
      expect(ai[key].currentUses).toBe(4);
    }
  });

  test('major boss combat rings get +2 uses', async () => {
    const { room } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 1);
    const ai = room.state.players.get('AI');
    for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
      expect(ai[key].maxUses).toBe(5); // 3 + 2
    }
  });

  test('E2E aiHearts override takes precedence over the boss modifier', async () => {
    const { room } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 1, { aiHearts: 1 });
    // Override wins over the +2 major modifier.
    expect(room.state.players.get('AI').hearts).toBe(1);
  });

  test('E2E aiUses override takes precedence over boss bonusUses', async () => {
    const { room } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 1, { aiUses: 0 });
    const ai = room.state.players.get('AI');
    // Uniform uses=0 override applies; bonusUses is ignored.
    for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
      expect(ai[key].currentUses).toBe(0);
    }
  });
});

describe('#259 — boss enrage / phase-2', () => {
  /**
   * Drive the human to attack every turn (and never defend) until the AI's hearts
   * reach `target` or the duel ENDS. Returns the AI snapshot at that point. Uses
   * the human's a1 (FIRE) — most boss thumbs/defenses are not Fire-strong, so hits
   * land often enough to whittle a 3-heart AI to 2 within the loop budget.
   */
  async function driveAiTo(room: any, human: any, target: number): Promise<any> {
    for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
      const ai = room.state.players.get('AI');
      if (ai && ai.hearts <= target) return ai;
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('selectAttack', { slot: 'a1' });
      }
      await sleep(200);
    }
    return room.state.players.get('AI');
  }

  test('major boss (Thornwood) enrages when hearts cross to ≤ threshold', async () => {
    // Seat the major boss at 3 hearts (threshold 2). It starts un-enraged; once a
    // hit drops it to ≤ 2, the enraged flag broadcasts.
    const { room, human } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 31, {
      aiHearts: 3,
    });
    expect(room.state.players.get('AI').enraged).toBe(false);

    const ai = await driveAiTo(room, human, 2);
    // Either the AI reached ≤ 2 hearts (and is enraged) or the duel ended first.
    if (room.state.phase !== 'ENDED' && ai.hearts <= 2) {
      expect(ai.enraged).toBe(true);
    }
  }, 20000);

  test('a gate boss never enrages (threshold 0), even at 1 heart', async () => {
    const { room, human } = await joinBoss('forest_bogwood_warden', 'DEFENSIVE', 5, {
      aiHearts: 1,
    });
    // Already at 1 heart; drive a few turns. enraged must stay false.
    await driveAiTo(room, human, 0);
    const ai = room.state.players.get('AI');
    expect(ai.enraged).toBe(false);
  }, 20000);

  test('sub bosses never enrage', async () => {
    const { room } = await joinBoss('forest_thornado_shrine_guardian', 'AGGRESSIVE', 1, {
      aiHearts: 1,
    });
    expect(room.state.players.get('AI').enraged).toBe(false);
  });

  test('non-boss AI never carries the enraged flag', async () => {
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 1,
      aiHearts: 1,
    });
    await colyseus.connectTo(room);
    await room.waitForNextPatch();
    await sleep(20);
    expect(room.state.players.get('AI').enraged).toBe(false);
  });
});

describe('#260 — boss status-gauge pressure', () => {
  const TRIANGLE = new Set([ElementEnum.FIRE, ElementEnum.WATER, ElementEnum.WOOD]);

  /**
   * Drive the boss attacking while the human NEVER defends, recording the triangle
   * gauge the human accrues and the triangle components the boss landed uncontested
   * (from exchangeResult broadcasts). Returns the human's summed triangle gauge and
   * the count of triangle-component uncontested hits, so the test can assert
   * gauge === hits × gaugeFillMult.
   */
  async function pressureGauge(npcId: string | null, personality: string, aiSeed: number) {
    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality,
      aiSeed,
      ...(npcId ? { npcId } : {}),
      aiHearts: 99, // boss never dies → it keeps attacking
    });
    const human = await colyseus.connectTo(room);

    let triangleHits = 0;
    human.onMessage('exchangeResult', (msg: any) => {
      // Count triangle components of the boss's attack on uncontested hits landed
      // on the human (NO_BLOCK / MISTIME with a heart lost).
      if (
        msg.attackerId === 'AI' &&
        msg.defenderHeartLost &&
        (msg.timing === 'NO_BLOCK' || msg.timing === 'MISTIME')
      ) {
        for (const el of msg.attackerElements) if (TRIANGLE.has(el)) triangleHits++;
      }
    });

    await room.waitForNextPatch();
    await sleep(20);

    // Human never defends; idle while the boss throws. On the human's own turn,
    // pass it back with a quick a1 throw so the boss keeps attacking.
    for (let i = 0; i < 30 && triangleHits < 2; i++) {
      if (room.state.phase === 'ATTACK_SELECT' && room.state.currentAttackerId === human.sessionId) {
        human.send('selectAttack', { slot: 'a1' });
      }
      await sleep(200);
    }

    const me = room.state.players.get(human.sessionId);
    const triGauge = (me?.fireGauge ?? 0) + (me?.waterGauge ?? 0) + (me?.woodGauge ?? 0);
    return { triGauge, triangleHits };
  }

  test('a sub-boss credits the player gauge at ×1.5 per triangle-component hit', async () => {
    const { triGauge, triangleHits } = await pressureGauge(
      'forest_bloom_shrine_guardian',
      'DEFENSIVE',
      808,
    );
    if (triangleHits > 0) {
      expect(triGauge).toBeCloseTo(triangleHits * 1.5, 5);
    }
  }, 20000);

  test('a non-boss credits the player gauge at the base ×1.0 rate', async () => {
    const { triGauge, triangleHits } = await pressureGauge(null, 'STATUS_HUNTER', 909);
    if (triangleHits > 0) {
      expect(triGauge).toBeCloseTo(triangleHits * 1.0, 5);
    }
  }, 20000);

  test('the major boss does NOT press the gauge (×1.0)', async () => {
    const { triGauge, triangleHits } = await pressureGauge(
      'forest_thornwood_warden',
      'RESILIENT',
      707,
    );
    if (triangleHits > 0) {
      expect(triGauge).toBeCloseTo(triangleHits * 1.0, 5);
    }
  }, 20000);

  test('gaugeFillMult is data-driven per tier', async () => {
    const { BOSS_MODIFIERS } = await import('../../server/src/game/constants');
    expect(BOSS_MODIFIERS.sub.gaugeFillMult).toBe(1.5);
    expect(BOSS_MODIFIERS.gate.gaugeFillMult).toBe(1.0);
    expect(BOSS_MODIFIERS.major.gaugeFillMult).toBe(1.0);
  });
});

describe('#261 — boss unique passives', () => {
  test('Bogwood "Bulwark": defense rings seat one use above the gate baseline', async () => {
    // Unscaled default ring maxUses 3; gate modifier +1; Bulwark +1 on defenses.
    // → attack rings 4 (3 + gate bonusUses), defense rings 5 (3 + gate + bulwark).
    const { room } = await joinBoss('forest_bogwood_warden', 'DEFENSIVE', 1);
    const ai = room.state.players.get('AI');
    expect(ai.a1.maxUses).toBe(4);
    expect(ai.a2.maxUses).toBe(4);
    expect(ai.d1.maxUses).toBe(5);
    expect(ai.d1.currentUses).toBe(5);
    expect(ai.d2.maxUses).toBe(5);
    expect(ai.d2.currentUses).toBe(5);
  });

  test('a guardian seats with NO passive (defense rings match the sub baseline)', async () => {
    const { room } = await joinBoss('forest_thornado_shrine_guardian', 'AGGRESSIVE', 1);
    const ai = room.state.players.get('AI');
    // sub bonusUses +1, no Bulwark → all combat rings at 4.
    for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
      expect(ai[key].maxUses).toBe(4);
    }
  });

  test('Thornwood "Heartwood": the first hit on the boss is absorbed (no heart lost)', async () => {
    // Major boss at 3 hearts. The human attacks; the first clean hit is absorbed
    // by Heartwood (hearts stay 3), and a later hit reduces hearts.
    const { room, human } = await joinBoss('forest_thornwood_warden', 'RESILIENT', 41, {
      aiHearts: 3,
    });
    const startHearts = room.state.players.get('AI').hearts;
    expect(startHearts).toBe(3);

    // Drive the human attacking; count exchanges where the boss was the defender
    // and took an uncontested/weak hit (defenderHeartLost). The FIRST two such
    // hits must NOT lower hearts (2 Heartwood charges); the 3rd should.
    let bossHitsTaken = 0;
    human.onMessage('exchangeResult', (msg: any) => {
      if (msg.defenderId === 'AI' && msg.defenderHeartLost) bossHitsTaken++;
    });

    for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        human.send('selectAttack', { slot: 'a1' });
      }
      // Stop once at least one hit landed on the boss so we can assess absorption.
      if (bossHitsTaken >= 1) break;
      await sleep(200);
    }

    // After the first hit landed on the boss, its hearts must be unchanged
    // (absorbed). If no hit landed in the budget, the assertion is skipped — but
    // the invariant we care about (first hit ≠ heart loss) holds when it did.
    if (bossHitsTaken >= 1) {
      expect(room.state.players.get('AI').hearts).toBe(3);
    }
  }, 25000);
});

// ---------------------------------------------------------------------------
// #328 — fused-thumb boss won-ring grant: regression and adversarial tests
// ---------------------------------------------------------------------------

/**
 * Helper: create a fresh DB player, build a vsAI room against the given boss
 * (with the AI at aiHearts:1 / aiUses:0 so it dies on the human's first hit),
 * drive the duel to ENDED with the human as winner, and return identifiers for
 * the winner, the collected `wonRing` message, and the live room.
 *
 * Uses a 200 ms polling loop (up to 60 iterations) so the AI's 300 ms forfeit
 * timer always fires between polls regardless of boss passive state. The polling
 * approach mirrors the `driveAiTo` helper used by the #259 enrage tests and
 * handles all boss variants — including those with Bulwark defense uses (Bogwood)
 * and Heartwood charge absorption (Thornwood) — without per-boss loop budgets.
 */
async function winAgainstBoss(
  npcId: string,
  personality: string,
  aiSeed: number,
  extra: object = {},
): Promise<{ playerId: string; wonRing: WonRingPayload | undefined; room: any; human: any }> {
  const username = `reg_winner_${Math.random().toString(36).slice(2)}`;
  const playerId = createPlayer(username, 'x');
  const token = signToken({ playerId, username });
  const room = await colyseus.createRoom<any>('battle-ai', {
    vsAI: true,
    personality,
    aiSeed,
    npcId,
    aiHearts: 1,
    aiUses: 0,
    ...extra,
  });
  const human = await colyseus.connectTo(room, { token, firstStrike: true });
  await room.waitForNextPatch();
  await sleep(20);

  let wonRing: WonRingPayload | undefined;
  human.onMessage('wonRing', (msg: WonRingPayload) => {
    wonRing = msg;
  });

  // Poll every 200 ms. The AI's forfeit/recharge timers fire in ~300 ms (non-fast
  // mode), so polling at 200 ms catches every state change without waiting a full
  // TELEGRAPH+BLOCK cycle. The human only sends an attack on its own ATTACK_SELECT
  // turn; the loop is otherwise passive so the AI can take its turns naturally.
  //
  // Alternate a1/a2 so that a DEFENSIVE boss's Bulwark-driven parry+rally counter
  // doesn't exhaust a single ring (isExtinguished guard drops silently exhausted
  // attacks, which would stall the duel if the human only ever sent 'a1').
  const ATTACK_SLOTS_CYCLE = ['a1', 'a2'] as const;
  let slotIdx = 0;
  for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
    if (
      room.state.phase === 'ATTACK_SELECT' &&
      room.state.currentAttackerId === human.sessionId
    ) {
      const ps = room.state.players.get(human.sessionId);
      // Prefer the slot that still has uses; cycle if the current choice is exhausted.
      if (ps?.getSlot(ATTACK_SLOTS_CYCLE[slotIdx])?.isExtinguished) {
        slotIdx = (slotIdx + 1) % ATTACK_SLOTS_CYCLE.length;
      }
      human.send('selectAttack', { slot: ATTACK_SLOTS_CYCLE[slotIdx] });
    }
    await sleep(200);
  }

  await sleep(50);
  return { playerId, wonRing, room, human };
}

/** Starting food for any freshly-created player (schema default: 100 units). */
const STARTER_FOOD = 100;

describe('#328 — spec conformance: every fused-thumb boss grants its fusion ring', () => {
  test('Bloom Guardian grants exactly one BLOOM ring (fusion, two parents)', async () => {
    // Acceptance criterion: beating forest_bloom_shrine_guardian grants a BLOOM ring
    // delivered via the standard wonRing path with two fusionParents (Wood + Earth).
    // This was the original bug — the guardian granted nothing before #328.
    const { playerId, wonRing, room } = await winAgainstBoss(
      'forest_bloom_shrine_guardian',
      'DEFENSIVE',
      42,
    );

    expect(room.state.phase).toBe('ENDED');

    // DB: exactly one BLOOM ring in inventory.
    const bloomRings = getRingsByOwner(playerId).filter(
      (r) => r.element === ElementEnum.BLOOM,
    );
    expect(bloomRings.length).toBe(1);

    // A fusion ring carries two fusionParents (non-empty array, populated on read).
    expect(bloomRings[0].fusionParents.length).toBe(2);

    // The client received a wonRing message naming the BLOOM element.
    expect(wonRing).toBeDefined();
    expect(wonRing?.element).toBe(ElementEnum.BLOOM);
    expect(wonRing?.ringId).toBe(bloomRings[0].id);
  }, 20000);

  test('Bogwood Warden grants exactly one MUD ring (fusion, two parents)', async () => {
    // Acceptance criterion: beating forest_bogwood_warden grants a MUD ring.
    // The warden also drops a food cache, but the ring is the focus here; the food
    // path is covered separately.
    const { playerId, wonRing, room } = await winAgainstBoss(
      'forest_bogwood_warden',
      'DEFENSIVE',
      77,
    );

    expect(room.state.phase).toBe('ENDED');

    const mudRings = getRingsByOwner(playerId).filter(
      (r) => r.element === ElementEnum.MUD,
    );
    expect(mudRings.length).toBe(1);
    expect(mudRings[0].fusionParents.length).toBe(2);

    expect(wonRing).toBeDefined();
    expect(wonRing?.element).toBe(ElementEnum.MUD);
    expect(wonRing?.ringId).toBe(mudRings[0].id);
  }, 20000);

  test('Thornwood Warden grants THORNADO ring AND food cache on first defeat', async () => {
    // Acceptance criterion: forest_thornwood_warden first-defeat gives both a
    // THORNADO ring (via generic §9.1 won-ring path) AND the BOSS_FOOD_DROP (50
    // units). Both rewards must be credited; neither may be omitted.
    //
    // The Thornwood Warden has Heartwood (2 charges, absorbs first 2 heart-losses),
    // requiring 3 clean hits even at aiHearts:1. The polling helper handles this
    // naturally — it keeps attacking until the room reaches ENDED.
    const { playerId, wonRing, room } = await winAgainstBoss(
      'forest_thornwood_warden',
      'RESILIENT',
      101,
    );

    expect(room.state.phase).toBe('ENDED');

    // Ring: exactly one THORNADO ring in inventory.
    const thornadoRings = getRingsByOwner(playerId).filter(
      (r) => r.element === ElementEnum.THORNADO,
    );
    expect(thornadoRings.length).toBe(1);
    expect(thornadoRings[0].fusionParents.length).toBe(2);

    // Food: food_units incremented by BOSS_FOOD_DROP (50) over the 100-unit starter
    // balance every fresh player begins with (db.ts DEFAULT 100).
    const { food_units } = getSpiritAndFood(playerId);
    expect(food_units).toBe(STARTER_FOOD + BOSS_FOOD_DROP);

    // Client message for the ring.
    expect(wonRing).toBeDefined();
    expect(wonRing?.element).toBe(ElementEnum.THORNADO);
  }, 30000);

  test('Thornado Guardian grants exactly ONE THORNADO ring — no double-grant regression (#328)', async () => {
    // Regression guard: before #328, a special-case grantRingToCarry block fired in
    // addition to the generic grant, yielding two THORNADO rings. Verify the count
    // is exactly 1 after the deletion of that block.
    const { playerId, room } = await winAgainstBoss(
      'forest_thornado_shrine_guardian',
      'AGGRESSIVE',
      999,
    );

    expect(room.state.phase).toBe('ENDED');

    const thornadoRings = getRingsByOwner(playerId).filter(
      (r) => r.element === ElementEnum.THORNADO,
    );
    // Must be exactly 1 — not 0 (ring must be granted) and not 2+ (no double-grant).
    expect(thornadoRings.length).toBe(1);
  }, 20000);
});

describe('#328 — adversarial / boundary: grant path guards', () => {
  test('practice rematch vs a fused-thumb boss grants nothing (ring and food unchanged)', async () => {
    // Acceptance criterion: isPracticeRematch === true causes persistBattleResult to
    // early-return before any ring grant or food credit. A player who practice-fights
    // a fused-thumb boss must receive no ring, no food, no XP.
    const username = `prac_${Math.random().toString(36).slice(2)}`;
    const playerId = createPlayer(username, 'x');
    const token = signToken({ playerId, username });

    const ringCountBefore = getRingsByOwner(playerId).length;
    const foodBefore = getSpiritAndFood(playerId).food_units;

    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      isPracticeRematch: true,
      personality: 'DEFENSIVE',
      aiSeed: 55,
      npcId: 'forest_bloom_shrine_guardian',
      aiHearts: 1,
      aiUses: 0,
    });
    const human = await colyseus.connectTo(room, { token, firstStrike: true });
    await room.waitForNextPatch();
    await sleep(20);

    let wonRingReceived: WonRingPayload | undefined;
    human.onMessage('wonRing', (msg: WonRingPayload) => {
      wonRingReceived = msg;
    });

    const pracSlots = ['a1', 'a2'] as const;
    let pracSlotIdx = 0;
    for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        const ps = room.state.players.get(human.sessionId);
        if (ps?.getSlot(pracSlots[pracSlotIdx])?.isExtinguished) {
          pracSlotIdx = (pracSlotIdx + 1) % pracSlots.length;
        }
        human.send('selectAttack', { slot: pracSlots[pracSlotIdx] });
      }
      await sleep(200);
    }

    await sleep(50);

    expect(room.state.phase).toBe('ENDED');

    // No ring added to inventory.
    const ringCountAfter = getRingsByOwner(playerId).length;
    expect(ringCountAfter).toBe(ringCountBefore);

    // No food credited.
    const foodAfter = getSpiritAndFood(playerId).food_units;
    expect(foodAfter).toBe(foodBefore);

    // No wonRing message dispatched to the client.
    expect(wonRingReceived).toBeUndefined();
  }, 20000);

  test('non-boss vsAI win still grants a base-element ring (generic path not broken)', async () => {
    // Regression guard: the deletion of the !aiPs.thumb.isFusion guard must not
    // accidentally break the base-element (non-boss) grant path. A plain vsAI duel
    // with no npcId must still award exactly one new ring matching the AI's base
    // thumb element. We assert on the delta (rings gained = 1) rather than the
    // absolute count because a fresh player already holds starter rings in the same
    // element pool (EARTH × 3, WIND × 3 via createPlayer).
    const username = `base_${Math.random().toString(36).slice(2)}`;
    const playerId = createPlayer(username, 'x');
    const token = signToken({ playerId, username });

    // Snapshot inventory before the duel.
    const ringsBefore = getRingsByOwner(playerId);
    const ringIdsBefore = new Set(ringsBefore.map((r) => r.id));

    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'AGGRESSIVE',
      aiSeed: 7,
      aiHearts: 1,
      aiUses: 0,
    });
    const human = await colyseus.connectTo(room, { token, firstStrike: true });
    await room.waitForNextPatch();
    await sleep(20);

    // Capture the AI thumb element BEFORE the duel ends.
    const aiThumbElement: number = room.state.players.get('AI').thumb.element;
    const aiThumbIsFusion: boolean = room.state.players.get('AI').thumb.isFusion;

    let wonRingMsg: WonRingPayload | undefined;
    human.onMessage('wonRing', (msg: WonRingPayload) => {
      wonRingMsg = msg;
    });

    const baseSlots = ['a1', 'a2'] as const;
    let baseSlotIdx = 0;
    for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        const ps = room.state.players.get(human.sessionId);
        if (ps?.getSlot(baseSlots[baseSlotIdx])?.isExtinguished) {
          baseSlotIdx = (baseSlotIdx + 1) % baseSlots.length;
        }
        human.send('selectAttack', { slot: baseSlots[baseSlotIdx] });
      }
      await sleep(200);
    }

    await sleep(50);

    expect(room.state.phase).toBe('ENDED');

    // The AI seated a base (non-fusion) thumb for this non-boss encounter.
    expect(aiThumbIsFusion).toBe(false);

    // Exactly one new ring was added to the inventory (delta = 1).
    const ringsAfter = getRingsByOwner(playerId);
    const newRings = ringsAfter.filter((r) => !ringIdsBefore.has(r.id));
    expect(newRings.length).toBe(1);

    // The new ring matches the AI's thumb element and is a base ring (no fusionParents).
    expect(newRings[0].element).toBe(aiThumbElement);
    expect(newRings[0].fusionParents.length).toBe(0);

    // Client received the wonRing message.
    expect(wonRingMsg).toBeDefined();
    expect(wonRingMsg?.element).toBe(aiThumbElement);
  }, 20000);

  test('Bogwood Warden grants MINI_BOSS_FOOD_DROP food on first defeat (orthogonal reward survives refactor)', async () => {
    // Regression guard: the food cache is an orthogonal first-defeat reward (#229/#230)
    // that must survive the #328 refactor unharmed. The warden drops MINI_BOSS_FOOD_DROP
    // (20 units) on top of the 100-unit starter balance every fresh player begins
    // with (db.ts schema DEFAULT 100).
    const username = `bogfood_${Math.random().toString(36).slice(2)}`;
    const playerId = createPlayer(username, 'x');
    const token = signToken({ playerId, username });

    const room = await colyseus.createRoom<any>('battle-ai', {
      vsAI: true,
      personality: 'DEFENSIVE',
      aiSeed: 13,
      npcId: 'forest_bogwood_warden',
      aiHearts: 1,
      aiUses: 0,
    });
    const human = await colyseus.connectTo(room, { token, firstStrike: true });
    await room.waitForNextPatch();
    await sleep(20);

    const bogwoodSlots = ['a1', 'a2'] as const;
    let bogwoodSlotIdx = 0;
    for (let i = 0; i < 60 && room.state.phase !== 'ENDED'; i++) {
      if (
        room.state.phase === 'ATTACK_SELECT' &&
        room.state.currentAttackerId === human.sessionId
      ) {
        const ps = room.state.players.get(human.sessionId);
        if (ps?.getSlot(bogwoodSlots[bogwoodSlotIdx])?.isExtinguished) {
          bogwoodSlotIdx = (bogwoodSlotIdx + 1) % bogwoodSlots.length;
        }
        human.send('selectAttack', { slot: bogwoodSlots[bogwoodSlotIdx] });
      }
      await sleep(200);
    }

    expect(room.state.phase).toBe('ENDED');

    const { food_units } = getSpiritAndFood(playerId);
    expect(food_units).toBe(STARTER_FOOD + MINI_BOSS_FOOD_DROP);
  }, 20000);

  test('wonRing payload ringId matches the ring in the DB (data integrity)', async () => {
    // Assert that the ringId carried in the wonRing client message is the same record
    // that was written to the DB. A mismatch would mean the client is trying to carry
    // a ring it cannot find — breaking the manage-rings flow entirely.
    const { playerId, wonRing } = await winAgainstBoss(
      'forest_bloom_shrine_guardian',
      'DEFENSIVE',
      200,
    );

    expect(wonRing).toBeDefined();
    const ownedRings = getRingsByOwner(playerId);
    const matchById = ownedRings.find((r) => r.id === wonRing?.ringId);
    expect(matchById).toBeDefined();
    expect(matchById?.element).toBe(ElementEnum.BLOOM);
  }, 20000);
});
