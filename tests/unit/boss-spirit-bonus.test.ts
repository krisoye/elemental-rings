/**
 * #492 — Region difficulty floor + tiered skill distribution.
 *
 * Rewrites the #464 BIOME_BOSS_SPIRIT_BONUS test suite to assert the new
 * spiritFloor / floorTier parameterized formula. The same 12 numerical values
 * from the old table are reproduced; roamer class and volcano biome rows are
 * added. All BattleRoom integration tests are updated to assert the new formula.
 *
 * Post-implementation regression and adversarial test suite organised in layers:
 *
 *   1. spiritFloor / floorTier constants — all spec values.
 *   2. Formula arithmetic — pure arithmetic verification; no room needed.
 *   3. BattleRoom integration — formula is applied to _npcSpirit in onJoin.
 *   4. Spec conformance — acceptance criteria from #492.
 *   5. Impl-aware — guard combinations, roamer path, personality threading.
 *   6. computeNpcSpirit parity — helper === BattleRoom aiPs.spiritMax.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer } from '@colyseus/testing';
import { Server } from 'colyseus';

// ---------------------------------------------------------------------------
// Lazy imports (same pattern as BattleRoomGates.test.ts) so DB_PATH is set
// before the db singleton is initialised.
// ---------------------------------------------------------------------------

let colyseus: ColyseusTestServer<any>;
let repo: typeof import('../../server/src/persistence/PlayerRepo');
let db: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];
let spiritFloor: (biome: string, npcClass: string) => number;
let floorTier: (biome: string) => number;
let BOSS_MODIFIERS: Record<string, { spiritMult: number }>;
let NPC_SPAWNS: Array<{ id: string; biome: string; boss?: { tier: string } }>;
let computeNpcSpirit: (playerSpiritMax: number, personality: string, biome?: string, bossTier?: string) => number;

beforeAll(async () => {
  const dbFile = path.join(
    os.tmpdir(),
    `er-region-difficulty-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  db = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const constants = await import('../../server/src/game/constants');
  spiritFloor = (constants as any).spiritFloor;
  floorTier = (constants as any).floorTier;
  BOSS_MODIFIERS = (constants as any).BOSS_MODIFIERS;
  const spawns = await import('../../server/src/persistence/NpcSpawns');
  NPC_SPAWNS = (spawns as any).NPC_SPAWNS;
  const aiLoadout = await import('../../server/src/game/ai/AILoadout');
  computeNpcSpirit = (aiLoadout as any).computeNpcSpirit;

  const { BattleRoom } = await import('../../server/src/rooms/BattleRoom');
  const server = new Server();
  server.define('battle', BattleRoom);
  // Use port 2569 instead of the default 2568 so this suite does not collide
  // with ai-battle.test.ts when both run in the same --pool=threads invocation.
  // boot() ignores the port arg when given a Server instance, so we call
  // server.listen() directly and wrap in ColyseusTestServer ourselves.
  await server.listen(2569);
  colyseus = new ColyseusTestServer(server);
});

afterAll(async () => {
  await colyseus.shutdown();
});

/** Create a starter player and return its id + a signed token. */
function makePlayer(): { playerId: string; token: string } {
  const username = `u_${Math.random().toString(36).slice(2)}`;
  const playerId = repo.createPlayer(username, 'x');
  return { playerId, token: signToken({ playerId, username }) };
}

/** Force the player's spirit_max to a specific value via direct DB write. */
function setSpiritMax(playerId: string, spiritMax: number): void {
  db.prepare(`UPDATE players SET spirit_max = ? WHERE id = ?`).run(spiritMax, playerId);
}

// ============================================================================
// 1 — spiritFloor: reproduce the 12 original BIOME_BOSS_SPIRIT_BONUS values
// ============================================================================

describe('spiritFloor — reproduces original 12 boss table values (#492)', () => {
  // #492: CLASS_OFFSET[npcClass] + REGION_STEP * BIOME_ORDER.indexOf(biome)
  // Verification that the formula produces the exact same numbers as the old table.
  const EXPECTED: Array<{ biome: string; npcClass: string; value: number }> = [
    { biome: 'forest', npcClass: 'gate',  value: 15  },
    { biome: 'forest', npcClass: 'sub',   value: 25  },
    { biome: 'forest', npcClass: 'major', value: 40  },
    { biome: 'snow',   npcClass: 'gate',  value: 40  },
    { biome: 'snow',   npcClass: 'sub',   value: 50  },
    { biome: 'snow',   npcClass: 'major', value: 65  },
    { biome: 'swamp',  npcClass: 'gate',  value: 65  },
    { biome: 'swamp',  npcClass: 'sub',   value: 75  },
    { biome: 'swamp',  npcClass: 'major', value: 90  },
    { biome: 'desert', npcClass: 'gate',  value: 90  },
    { biome: 'desert', npcClass: 'sub',   value: 100 },
    { biome: 'desert', npcClass: 'major', value: 115 },
  ];

  test.each(EXPECTED)(
    'spiritFloor($biome, $npcClass) === $value',
    ({ biome, npcClass, value }) => {
      expect(spiritFloor(biome, npcClass)).toBe(value);
    },
  );
});

describe('spiritFloor — new roamer class rows (#492)', () => {
  // #492: CLASS_OFFSET.roamer = 0 is LOCKED. Forest roamers floor-free.
  test('spiritFloor(forest, roamer) === 0 (CLASS_OFFSET.roamer locked)', () => {
    expect(spiritFloor('forest', 'roamer')).toBe(0);
  });

  test('spiritFloor(desert, roamer) === 75 (0 + 25*3)', () => {
    expect(spiritFloor('desert', 'roamer')).toBe(75);
  });

  test('spiritFloor(volcano, roamer) === 100 (0 + 25*4)', () => {
    expect(spiritFloor('volcano', 'roamer')).toBe(100);
  });
});

describe('spiritFloor — new volcano biome rows (#492)', () => {
  test('spiritFloor(volcano, gate) === 115 (15 + 25*4)', () => {
    expect(spiritFloor('volcano', 'gate')).toBe(115);
  });

  test('spiritFloor(volcano, sub) === 125 (25 + 25*4)', () => {
    expect(spiritFloor('volcano', 'sub')).toBe(125);
  });

  test('spiritFloor(volcano, major) === 140 (40 + 25*4)', () => {
    expect(spiritFloor('volcano', 'major')).toBe(140);
  });
});

describe('spiritFloor — unknown biome safe fallback (#492)', () => {
  test('unknown biome returns 0 (safe default)', () => {
    expect(spiritFloor('cavern', 'gate')).toBe(0);
    expect(spiritFloor('cavern', 'roamer')).toBe(0);
  });
});

// ============================================================================
// 2 — floorTier: biome → minimum effective tier
// ============================================================================

describe('floorTier — per-biome floor tier (#492)', () => {
  const EXPECTED: Array<{ biome: string; tier: number }> = [
    { biome: 'forest',  tier: 1 },
    { biome: 'snow',    tier: 2 },
    { biome: 'swamp',   tier: 3 },
    { biome: 'desert',  tier: 4 },
    { biome: 'volcano', tier: 5 },
  ];

  test.each(EXPECTED)(
    'floorTier($biome) === $tier',
    ({ biome, tier }) => {
      expect(floorTier(biome)).toBe(tier);
    },
  );

  test('unknown biome returns 1 (safe default)', () => {
    expect(floorTier('unknown')).toBe(1);
  });
});

// ============================================================================
// 3 — Formula arithmetic (pure, no room)
// ============================================================================

describe('boss spirit formula — additive floor preserved (#492)', () => {
  // Boss path: floor(playerSpiritMax × spiritMult) + spiritFloor(biome, tier).
  // The boss additive formula is PRESERVED (not converted to max-floor).

  test('forest gate boss: floor(spiritMax × 0.75) + spiritFloor(forest,gate)', () => {
    const spiritMax = 100;
    const mult = BOSS_MODIFIERS['gate'].spiritMult; // 0.75
    const floor = spiritFloor('forest', 'gate');    // 15
    const result = Math.floor(spiritMax * mult) + floor;
    expect(mult).toBe(0.75);
    expect(floor).toBe(15);
    expect(result).toBe(90); // floor(100 × 0.75) = 75 + 15 = 90
  });

  test('forest major boss: floor(spiritMax × 1.0) + spiritFloor(forest,major)', () => {
    const spiritMax = 100;
    const mult = BOSS_MODIFIERS['major'].spiritMult; // 1.0
    const floor = spiritFloor('forest', 'major');    // 40
    const result = Math.floor(spiritMax * mult) + floor;
    expect(result).toBe(140); // 100 + 40 = 140
  });

  test('volcano major boss has higher floor than forest major at same spiritMax', () => {
    const spiritMax = 100;
    const forestResult = Math.floor(spiritMax * BOSS_MODIFIERS['major'].spiritMult) + spiritFloor('forest', 'major');
    const volcanoResult = Math.floor(spiritMax * BOSS_MODIFIERS['major'].spiritMult) + spiritFloor('volcano', 'major');
    expect(volcanoResult).toBeGreaterThan(forestResult);
    expect(volcanoResult).toBe(240); // 100 + 140
    expect(forestResult).toBe(140); // 100 + 40
  });
});

describe('roamer spirit formula — max-floor NEW (#492)', () => {
  // Roamer path: max(spiritFloor(biome,'roamer'), floor(spiritMax × personalityMult)).
  // For forest roamers spiritFloor=0, so player-scaling always wins.

  test('forest roamer: floor-free because spiritFloor(forest,roamer)=0', () => {
    // floor(100 × 0.25) = 25; max(0, 25) = 25 — player-scaling wins.
    const result = computeNpcSpirit(100, 'AGGRESSIVE', 'forest', undefined);
    expect(result).toBe(25);
  });

  test('desert roamer with low spiritMax: floor of 75 is applied', () => {
    // player spiritMax=100: floor(100 × 0.25) = 25; spiritFloor=75 → max(75, 25) = 75.
    const result = computeNpcSpirit(100, 'AGGRESSIVE', 'desert', undefined);
    expect(result).toBe(75);
  });

  test('desert roamer with high spiritMax: player-scaling wins over floor', () => {
    // player spiritMax=400: floor(400 × 0.25) = 100; spiritFloor=75 → max(75, 100) = 100.
    const result = computeNpcSpirit(400, 'AGGRESSIVE', 'desert', undefined);
    expect(result).toBe(100);
  });
});

// ============================================================================
// 4 — SPEC CONFORMANCE (acceptance criteria)
// ============================================================================

describe('spec-conformance: acceptance criteria assertions (#492)', () => {
  test('AC: spiritFloor(forest, gate) === 15', () => {
    expect(spiritFloor('forest', 'gate')).toBe(15);
  });

  test('AC: spiritFloor(desert, major) === 115', () => {
    expect(spiritFloor('desert', 'major')).toBe(115);
  });

  test('AC: spiritFloor(volcano, major) === 140', () => {
    expect(spiritFloor('volcano', 'major')).toBe(140);
  });

  test('AC: spiritFloor(forest, roamer) === 0 (locked floor-free)', () => {
    expect(spiritFloor('forest', 'roamer')).toBe(0);
  });

  test('AC: spiritFloor(desert, roamer) === 75', () => {
    expect(spiritFloor('desert', 'roamer')).toBe(75);
  });

  test('AC: spiritFloor(volcano, roamer) === 100', () => {
    expect(spiritFloor('volcano', 'roamer')).toBe(100);
  });

  test('AC: frost_sentinel biome is forest — receives spiritFloor=15, not 40', () => {
    const spawn = NPC_SPAWNS.find(s => s.id === 'forest_frost_sentinel');
    expect(spawn?.biome).toBe('forest');
    expect(spiritFloor(spawn!.biome, spawn!.boss!.tier)).toBe(15);
    expect(spiritFloor(spawn!.biome, spawn!.boss!.tier)).not.toBe(40);
  });
});

// ============================================================================
// 5 — BATTLEROOM INTEGRATION: formula applied to _npcSpirit in onJoin
// ============================================================================

describe('BattleRoom integration — forest gate boss spirit includes spiritFloor(forest,gate)=15 (#492)', () => {
  test('vsAI with npcId=forest_bogwood_warden: _npcSpirit === floor(spiritMax × 0.75) + 15', async () => {
    const { playerId, token } = makePlayer();
    const spiritMax = 100;
    setSpiritMax(playerId, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_bogwood_warden',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.75) + 15; // 75 + 15 = 90
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);
    expect(aiPs?.spiritCurrent).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — roamer NPC forest: spiritFloor=0, no floor applied (#492)', () => {
  test('forest roamer AGGRESSIVE spiritMax=100: spirit === floor(100 × 0.25) = 25 (floor-free)', async () => {
    const { playerId, token } = makePlayer();
    setSpiritMax(playerId, 100);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_npc_1',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    // Forest roamer: spiritFloor=0, so max(0, floor(100×0.25)) = 25.
    expect(aiPs?.spiritMax).toBe(25);

    await room.disconnect();
  });
});

describe('BattleRoom integration — major forest boss (Thornwood Warden) spirit includes +40 (#492)', () => {
  test('vsAI with npcId=forest_thornwood_warden: _npcSpirit === floor(spiritMax × 1.0) + 40', async () => {
    const { playerId, token } = makePlayer();
    const spiritMax = 50;
    setSpiritMax(playerId, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_thornwood_warden',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 1.0) + 40; // 50 + 40 = 90
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — sub-boss spirit includes spiritFloor(forest,sub)=25 (#492)', () => {
  test('vsAI with npcId=forest_thornado_shrine_guardian: _npcSpirit === floor(spiritMax × 0.60) + 25', async () => {
    const { playerId, token } = makePlayer();
    const spiritMax = 50;
    setSpiritMax(playerId, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_thornado_shrine_guardian',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.60) + 25; // 30 + 25 = 55
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — frost_sentinel (biome=forest, tier=gate): +15 not +40 (#492)', () => {
  test('vsAI with npcId=forest_frost_sentinel: spiritMax=50 → floor(50×0.75)+15=52', async () => {
    const { playerId, token } = makePlayer();
    const spiritMax = 50;
    setSpiritMax(playerId, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_frost_sentinel',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.75) + 15; // 37 + 15 = 52
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);  // 52 (forest gate)
    expect(aiPs?.spiritMax).not.toBe(77);           // NOT snow gate (+40)
    expect(aiPs?.spiritMax).not.toBe(37);           // NOT no bonus

    await room.disconnect();
  });
});

// ============================================================================
// 6 — IMPL-AWARE: guard combinations + computeNpcSpirit parity
// ============================================================================

describe('impl-aware: roamer receives no boss bonus (#492)', () => {
  test('vsAI roamer: spirit === floor(spiritMax × 0.25) (no boss additive)', async () => {
    const { playerId, token } = makePlayer();
    setSpiritMax(playerId, 120);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_npc_1',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    const expectedNoBonus = Math.floor(120 * 0.25); // 30
    expect(aiPs?.spiritMax).toBe(expectedNoBonus);
    expect((room as any).boss).toBeUndefined();

    await room.disconnect();
  });
});

describe('impl-aware: PvP room has no AI spirit (#492)', () => {
  test('PvP room: no AI seat, _npcSpirit stays Infinity', async () => {
    const { token } = makePlayer();

    const room = await colyseus.createRoom<any>('battle', {});
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    expect(room.state.players.get('AI')).toBeUndefined();
    expect((room as any)._npcSpirit).toBe(Infinity);

    await room.disconnect();
  });
});

describe('impl-aware (#492): computeNpcSpirit parity — boss and roamer', () => {
  test('parity: computeNpcSpirit === aiPs.spiritMax for forest gate boss', async () => {
    const { playerId, token } = makePlayer();
    const spiritMax = 120;
    setSpiritMax(playerId, spiritMax);

    const helperResult = computeNpcSpirit(spiritMax, 'AGGRESSIVE', 'forest', 'gate');
    // floor(120 × 0.75) + spiritFloor(forest,gate) = 90 + 15 = 105.
    expect(helperResult).toBe(105);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_bogwood_warden',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(helperResult);

    await room.disconnect();
  });

  test('parity: computeNpcSpirit === aiPs.spiritMax for roamer (all personalities)', async () => {
    const PERSONALITIES = [
      { personality: 'AGGRESSIVE',    mult: 0.25 },
      { personality: 'DEFENSIVE',     mult: 0.30 },
      { personality: 'STATUS_HUNTER', mult: 0.35 },
      { personality: 'RESILIENT',     mult: 0.40 },
    ] as const;

    for (const { personality, mult } of PERSONALITIES) {
      const { playerId, token } = makePlayer();
      const spiritMax = 160;
      setSpiritMax(playerId, spiritMax);

      const helperResult = computeNpcSpirit(spiritMax, personality);
      expect(helperResult).toBe(Math.floor(spiritMax * mult));

      const room = await colyseus.createRoom<any>('battle', {
        vsAI: true,
        personality,
      });
      await colyseus.connectTo(room, { token });
      await room.waitForNextPatch();

      const aiPs = room.state.players.get('AI');
      expect(aiPs?.spiritMax).toBe(helperResult);

      await room.disconnect();
    }
  });
});
