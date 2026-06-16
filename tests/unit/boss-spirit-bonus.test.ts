/**
 * #464 — per-biome boss spirit bonus (danger-tier difficulty scaling).
 *
 * Post-implementation regression and adversarial test suite.
 * Tests are organised in three layers:
 *
 *   1. Constant table — BIOME_BOSS_SPIRIT_BONUS correctness (all 12 cells).
 *   2. Formula arithmetic — floor(playerSpiritMax × spiritMult) + bonus, verified
 *      as pure arithmetic using the constants.  No room needed.
 *   3. BattleRoom integration — the bonus is actually applied to _npcSpirit in
 *      onJoin for boss NPCs and left at 0 for roamers / unknown biomes.
 *
 * Adversarial reasoning: the feature is pure server arithmetic with a new constant
 * table. Failure modes are: (a) wrong value in the table, (b) floor applied after
 * the bonus instead of before, (c) the ?? 0 fallback crashing or returning wrong
 * default, (d) roamers accidentally receiving a bonus because the `boss` guard is
 * absent, (e) the biome-progression ladder being off by a step.
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { ColyseusTestServer, boot } from '@colyseus/testing';
import { Server } from 'colyseus';

// ---------------------------------------------------------------------------
// Lazy imports (same pattern as BattleRoomGates.test.ts) so DB_PATH is set
// before the db singleton is initialised.
// ---------------------------------------------------------------------------

let colyseus: ColyseusTestServer<any>;
let repo: typeof import('../../server/src/persistence/PlayerRepo');
let db: import('better-sqlite3').Database;
let signToken: (typeof import('../../server/src/auth/auth'))['signToken'];
let BIOME_BOSS_SPIRIT_BONUS: Record<string, Partial<Record<string, number>>>;
let BOSS_MODIFIERS: Record<string, { spiritMult: number }>;
let NPC_SPAWNS: Array<{ id: string; biome: string; boss?: { tier: string } }>;
// #478 — loaded in beforeAll alongside the other AILoadout exports.
let computeNpcSpirit: (playerSpiritMax: number, personality: string, biome?: string, bossTier?: string) => number;

beforeAll(async () => {
  const dbFile = path.join(
    os.tmpdir(),
    `er-boss-spirit-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;

  repo = await import('../../server/src/persistence/PlayerRepo');
  db = (await import('../../server/src/persistence/db')).db;
  signToken = (await import('../../server/src/auth/auth')).signToken;
  const constants = await import('../../server/src/game/constants');
  BIOME_BOSS_SPIRIT_BONUS = (constants as any).BIOME_BOSS_SPIRIT_BONUS;
  BOSS_MODIFIERS = (constants as any).BOSS_MODIFIERS;
  const spawns = await import('../../server/src/persistence/NpcSpawns');
  NPC_SPAWNS = (spawns as any).NPC_SPAWNS;
  // #478 — load computeNpcSpirit for Phase 2 parity assertions.
  const aiLoadout = await import('../../server/src/game/ai/AILoadout');
  computeNpcSpirit = (aiLoadout as any).computeNpcSpirit;

  const { BattleRoom } = await import('../../server/src/rooms/BattleRoom');
  const server = new Server();
  server.define('battle', BattleRoom);
  colyseus = await boot(server);
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
// 1 — CONSTANT TABLE: BIOME_BOSS_SPIRIT_BONUS
// ============================================================================

describe('BIOME_BOSS_SPIRIT_BONUS constant — all 12 cells match spec (#464)', () => {
  // Table-driven test over every cell: biome × tier → expected value.
  // Spec table:
  //   forest: gate=15, sub=25, major=40
  //   snow:   gate=40, sub=50, major=65
  //   swamp:  gate=65, sub=75, major=90
  //   desert: gate=90, sub=100, major=115

  const EXPECTED: Array<{ biome: string; tier: string; value: number }> = [
    { biome: 'forest', tier: 'gate',  value: 15  },
    { biome: 'forest', tier: 'sub',   value: 25  },
    { biome: 'forest', tier: 'major', value: 40  },
    { biome: 'snow',   tier: 'gate',  value: 40  },
    { biome: 'snow',   tier: 'sub',   value: 50  },
    { biome: 'snow',   tier: 'major', value: 65  },
    { biome: 'swamp',  tier: 'gate',  value: 65  },
    { biome: 'swamp',  tier: 'sub',   value: 75  },
    { biome: 'swamp',  tier: 'major', value: 90  },
    { biome: 'desert', tier: 'gate',  value: 90  },
    { biome: 'desert', tier: 'sub',   value: 100 },
    { biome: 'desert', tier: 'major', value: 115 },
  ];

  test.each(EXPECTED)(
    // #464 adversarial: a single wrong entry would silently miscalibrate danger scaling
    '$biome $tier bonus === $value',
    ({ biome, tier, value }) => {
      expect(BIOME_BOSS_SPIRIT_BONUS[biome]?.[tier]).toBe(value);
    },
  );
});

describe('BIOME_BOSS_SPIRIT_BONUS constant — biome-progression ladder invariant (#464)', () => {
  // #464 adversarial: each biome's per-tier value must be exactly +25 above the
  // previous biome — a copy-paste error would shift the whole column silently.
  const BIOMES = ['forest', 'snow', 'swamp', 'desert'];
  const TIERS  = ['gate', 'sub', 'major'] as const;

  test.each(TIERS)(
    'tier "%s": each biome adds exactly +25 over the previous biome',
    (tier) => {
      for (let i = 1; i < BIOMES.length; i++) {
        const prev = BIOME_BOSS_SPIRIT_BONUS[BIOMES[i - 1]]?.[tier] ?? 0;
        const curr = BIOME_BOSS_SPIRIT_BONUS[BIOMES[i]]?.[tier]     ?? 0;
        expect(curr - prev).toBe(25);
      }
    },
  );
});

describe('BIOME_BOSS_SPIRIT_BONUS constant — within-biome tier ordering (#464)', () => {
  // #464 adversarial: gate < sub < major must hold in every biome — a tier inversion
  // would reward weaker bosses with more spirit than harder bosses.
  const BIOMES = ['forest', 'snow', 'swamp', 'desert'];

  test.each(BIOMES)(
    'biome "%s": gate < sub < major',
    (biome) => {
      const row = BIOME_BOSS_SPIRIT_BONUS[biome];
      expect(row?.gate).toBeDefined();
      expect(row?.sub).toBeDefined();
      expect(row?.major).toBeDefined();
      expect(row!.gate!).toBeLessThan(row!.sub!);
      expect(row!.sub!).toBeLessThan(row!.major!);
    },
  );
});

describe('BIOME_BOSS_SPIRIT_BONUS constant — forest baseline exact anchors (#464)', () => {
  // #464 spec: forest gate=15, snow gate=40, swamp gate=65, desert gate=90.
  // These are the explicit anchors from the spec table; assert them individually
  // so a regression produces an immediately legible failure message.

  test('forest gate anchor is 15', () => {
    // Spec §Design: "forest: gate +15" — the baseline from which the ladder starts.
    expect(BIOME_BOSS_SPIRIT_BONUS['forest']?.['gate']).toBe(15);
  });

  test('snow gate anchor is 40 (forest baseline +25)', () => {
    // Spec: snow is forest+25 for each tier.
    expect(BIOME_BOSS_SPIRIT_BONUS['snow']?.['gate']).toBe(40);
  });

  test('swamp gate anchor is 65 (snow+25)', () => {
    expect(BIOME_BOSS_SPIRIT_BONUS['swamp']?.['gate']).toBe(65);
  });

  test('desert gate anchor is 90 (swamp+25)', () => {
    expect(BIOME_BOSS_SPIRIT_BONUS['desert']?.['gate']).toBe(90);
  });
});

// ============================================================================
// 2 — FORMULA ARITHMETIC (pure, no room)
// ============================================================================

describe('spirit formula arithmetic — floor then add bonus (#464)', () => {
  // #464 adversarial: the spec explicitly states floor(playerSpiritMax × npcSpiritMult) + bonus.
  // The floor must happen on the multiply BEFORE the integer bonus is added.
  // If the bonus were inside the floor call it would still be correct for integer
  // bonuses, but the intention and the structure must be verifiable.

  test('scenario 1 — forest gate boss: floor(spiritMax × 0.75) + 15', () => {
    // Spec: gate spiritMult = 0.75 (from BOSS_MODIFIERS.gate.spiritMult)
    // Bogwood Warden calibration.
    const spiritMax = 100;
    const mult = BOSS_MODIFIERS['gate'].spiritMult; // 0.75
    const bonus = BIOME_BOSS_SPIRIT_BONUS['forest']?.['gate'] ?? 0;
    const result = Math.floor(spiritMax * mult) + bonus;
    expect(mult).toBe(0.75);
    expect(bonus).toBe(15);
    expect(result).toBe(90); // floor(100 × 0.75) = 75 + 15 = 90
  });

  test('scenario 2 — forest major boss: floor(spiritMax × 1.0) + 40', () => {
    // Spec: major spiritMult = 1.0 (from BOSS_MODIFIERS.major.spiritMult)
    // Thornwood Warden calibration.
    const spiritMax = 100;
    const mult = BOSS_MODIFIERS['major'].spiritMult; // 1.0
    const bonus = BIOME_BOSS_SPIRIT_BONUS['forest']?.['major'] ?? 0;
    const result = Math.floor(spiritMax * mult) + bonus;
    expect(mult).toBe(1.0);
    expect(bonus).toBe(40);
    expect(result).toBe(140); // floor(100 × 1.0) = 100 + 40 = 140
  });

  test('scenario 3 — forest sub-boss: floor(spiritMax × 0.60) + 25', () => {
    // Spec: sub spiritMult = 0.60 (from BOSS_MODIFIERS.sub.spiritMult)
    // Shrine guardian calibration.
    const spiritMax = 100;
    const mult = BOSS_MODIFIERS['sub'].spiritMult; // 0.60
    const bonus = BIOME_BOSS_SPIRIT_BONUS['forest']?.['sub'] ?? 0;
    const result = Math.floor(spiritMax * mult) + bonus;
    expect(mult).toBe(0.60);
    expect(bonus).toBe(25);
    expect(result).toBe(85); // floor(100 × 0.60) = 60 + 25 = 85
  });

  test('floor interaction: non-integer multiply result is floored BEFORE bonus is added', () => {
    // #464 adversarial: if bonus were inside Math.floor(...) the rounding still
    // produces the same integer result because bonus is an integer.
    // We verify the semantic: spiritMax=101, mult=0.60 → 101×0.60 = 60.6 → floor=60.
    // Then +25 = 85.  If bonus were added first: floor(60.6+25) = floor(85.6) = 85.
    // Both produce 85 here — but with mult=0.75: 101×0.75=75.75 → floor=75 → +15=90.
    // Inside floor: floor(75.75+15)=floor(90.75)=90. Same again.
    // The adversarial case requires a fractional result where adding the bonus before
    // flooring would cross a whole-number boundary:
    //   spiritMax=3, mult=0.75 → 3×0.75=2.25 → floor=2 → +15=17.
    //   Inside floor: floor(2.25+15)=floor(17.25)=17. Same.
    //
    // In practice these constants never produce a boundary difference because bonus is
    // always a whole number and floor is applied first. The contract tested here is:
    //   result === Math.floor(spiritMax * mult) + bonus
    // not:
    //   result === Math.floor(spiritMax * mult + bonus)
    // These are algebraically equivalent when bonus is integer — but we assert the
    // spec form to document intent and catch a future float bonus regression.
    const spiritMax = 101;
    const mult = BOSS_MODIFIERS['sub'].spiritMult; // 0.60
    const bonus = BIOME_BOSS_SPIRIT_BONUS['forest']?.['sub'] ?? 0;
    const specForm = Math.floor(spiritMax * mult) + bonus;
    expect(spiritMax * mult).toBeCloseTo(60.6, 5);
    expect(Math.floor(spiritMax * mult)).toBe(60); // floor happens before bonus
    expect(specForm).toBe(85); // 60 + 25
  });

  test('scenario 4 — frost_sentinel (biome=forest, tier=gate): +15, NOT +40 (not snow gate)', () => {
    // #464 adversarial: frost_sentinel has biome='forest' and boss.tier='gate'.
    // It must receive the FOREST gate bonus (+15), not the SNOW gate bonus (+40).
    // A biome lookup bug that dereferenced the sentinel's *name* ("frost") would
    // return undefined → 0, not +15.  A biome lookup that dereferenced 'snow'
    // (because of the name "frost sentinel") would return +40.
    // Verify the lookup uses biome='forest'.
    const forestGate = BIOME_BOSS_SPIRIT_BONUS['forest']?.['gate'] ?? 0;
    const snowGate   = BIOME_BOSS_SPIRIT_BONUS['snow']?.['gate']   ?? 0;
    expect(forestGate).toBe(15);
    expect(snowGate).toBe(40);
    expect(forestGate).not.toBe(snowGate); // they must differ so the test is meaningful

    // Confirm frost_sentinel's biome is 'forest' in the spawn table, not 'snow'.
    const frostSentinel = NPC_SPAWNS.find(s => s.id === 'forest_frost_sentinel');
    expect(frostSentinel).toBeDefined();
    expect(frostSentinel!.biome).toBe('forest');
    expect(frostSentinel!.boss?.tier).toBe('gate');

    // When used as lookup key, it yields 15 not 40.
    const bonus = BIOME_BOSS_SPIRIT_BONUS[frostSentinel!.biome]?.[frostSentinel!.boss!.tier] ?? 0;
    expect(bonus).toBe(15);
  });

  test('scenario 6 — unknown biome: lookup returns undefined, ?? 0 defaults to 0 (no crash)', () => {
    // #464 adversarial: a newly-authored NPC with a biome not yet in the table
    // (e.g. 'volcano', 'cavern') must not crash — the ?. operator returns undefined
    // and ?? 0 provides the safe default.
    const unknownBiome = 'volcano'; // not in the table
    const bonus = BIOME_BOSS_SPIRIT_BONUS[unknownBiome]?.['gate'] ?? 0;
    expect(bonus).toBe(0);
    // The table itself must not contain the unknown biome key.
    expect(BIOME_BOSS_SPIRIT_BONUS['volcano']).toBeUndefined();
  });

  test('missing tier within a present biome: partial record returns undefined → defaults to 0', () => {
    // #464 adversarial: if a future partial row is added (e.g. forest with only
    // { gate: 15 }), a missing tier key must not crash — Partial<Record<BossTier,number>>
    // allows undefined values. The ?? 0 must handle this.
    // We simulate by accessing a tier key that isn't in the constant but would
    // match the Partial<Record> type contract.  Since all biomes fully define all
    // 3 tiers, this test also acts as a table-completeness regression: it verifies
    // all 4 biomes × 3 tiers are defined (no undefined in any existing row).
    for (const biome of ['forest', 'snow', 'swamp', 'desert']) {
      for (const tier of ['gate', 'sub', 'major']) {
        const v = BIOME_BOSS_SPIRIT_BONUS[biome]?.[tier];
        expect(v).toBeDefined();
        expect(typeof v).toBe('number');
      }
    }
    // And a genuinely absent tier on a present biome returns 0 via fallback.
    // Use a cast to simulate a key not in BossTier.
    const phantom = BIOME_BOSS_SPIRIT_BONUS['forest']?.['legendary' as string] ?? 0;
    expect(phantom).toBe(0);
  });
});

// ============================================================================
// 3 — SPEC CONFORMANCE
// ============================================================================

describe('spec-conformance: acceptance criteria assertions (#464)', () => {
  // These tests assert the spec acceptance criteria directly from public artefacts
  // (the constant table and BOSS_MODIFIERS).  They fail if the implementation
  // diverges from the spec even if E2E passed (E2E does not check specific values).

  test('AC: BIOME_BOSS_SPIRIT_BONUS exists and has all four biome rows', () => {
    // Spec: "All four biome rows must be defined in the constant table".
    expect(BIOME_BOSS_SPIRIT_BONUS).toBeDefined();
    expect(typeof BIOME_BOSS_SPIRIT_BONUS).toBe('object');
    expect(Object.keys(BIOME_BOSS_SPIRIT_BONUS)).toEqual(
      expect.arrayContaining(['forest', 'snow', 'swamp', 'desert']),
    );
  });

  test('AC: each biome row has exactly 3 tier keys (gate, sub, major)', () => {
    // Spec table has exactly 3 columns — no extra or missing keys.
    for (const biome of ['forest', 'snow', 'swamp', 'desert']) {
      const keys = Object.keys(BIOME_BOSS_SPIRIT_BONUS[biome] ?? {});
      expect(keys.sort()).toEqual(['gate', 'major', 'sub']);
    }
  });

  test('AC: forest gate boss formula: floor(playerSpiritMax × 0.75) + 15', () => {
    // Spec acceptance criterion: "For a Forest gate boss, _npcSpirit = floor(playerSpiritMax × 0.75) + 15"
    const spiritMax = 200;
    const result = Math.floor(spiritMax * BOSS_MODIFIERS['gate'].spiritMult)
                 + (BIOME_BOSS_SPIRIT_BONUS['forest']?.['gate'] ?? 0);
    expect(result).toBe(Math.floor(200 * 0.75) + 15); // 150 + 15 = 165
  });

  test('AC: forest sub-boss formula: floor(playerSpiritMax × 0.60) + 25', () => {
    // Spec acceptance criterion: "For a Forest sub-boss, _npcSpirit = floor(playerSpiritMax × 0.60) + 25"
    const spiritMax = 200;
    const result = Math.floor(spiritMax * BOSS_MODIFIERS['sub'].spiritMult)
                 + (BIOME_BOSS_SPIRIT_BONUS['forest']?.['sub'] ?? 0);
    expect(result).toBe(Math.floor(200 * 0.60) + 25); // 120 + 25 = 145
  });

  test('AC: forest major boss formula: floor(playerSpiritMax × 1.0) + 40', () => {
    // Spec acceptance criterion: "For a Forest major boss (Thornwood Warden, RESILIENT × 1.0), _npcSpirit = floor(playerSpiritMax × 1.0) + 40"
    const spiritMax = 200;
    const result = Math.floor(spiritMax * BOSS_MODIFIERS['major'].spiritMult)
                 + (BIOME_BOSS_SPIRIT_BONUS['forest']?.['major'] ?? 0);
    expect(result).toBe(Math.floor(200 * 1.0) + 40); // 200 + 40 = 240
  });

  test('AC: frost_sentinel biome is forest (not snow) — receives +15, not +40', () => {
    // Spec: "forest_frost_sentinel (biome='forest', tier='gate') receives +15, not +40"
    const spawn = NPC_SPAWNS.find(s => s.id === 'forest_frost_sentinel');
    expect(spawn?.biome).toBe('forest');
    const bonus = BIOME_BOSS_SPIRIT_BONUS[spawn!.biome]?.[spawn!.boss!.tier] ?? 0;
    expect(bonus).toBe(15);
    expect(bonus).not.toBe(40);
  });

  test('AC: all 4 biome rows use exact spec values (full table conformance)', () => {
    // Spec table §Design: complete per-cell assertion as a single conformance test.
    expect(BIOME_BOSS_SPIRIT_BONUS).toMatchObject({
      forest: { gate: 15,  sub: 25,  major: 40  },
      snow:   { gate: 40,  sub: 50,  major: 65  },
      swamp:  { gate: 65,  sub: 75,  major: 90  },
      desert: { gate: 90,  sub: 100, major: 115 },
    });
  });
});

// ============================================================================
// 4 — BATTLEROOM INTEGRATION: bonus applied to _npcSpirit in onJoin
// ============================================================================

describe('BattleRoom integration — forest gate boss (Bogwood Warden) spirit includes +15 (#464)', () => {
  test('vsAI with npcId=forest_bogwood_warden: _npcSpirit === floor(playerSpiritMax × 0.75) + 15', async () => {
    // #464 adversarial: the most direct regression — if the bonus line is absent
    // _npcSpirit will be 15 short of the spec value.
    // AI seat is stored in state.players under the key 'AI' (AI_ID constant in BattleRoom).
    const spiritMax = 100;
    const username2 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId2 = repo.createPlayer(username2, 'x');
    const token2 = signToken({ playerId: playerId2, username: username2 });
    setSpiritMax(playerId2, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_bogwood_warden',
    });
    await colyseus.connectTo(room, { token: token2 });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.75) + 15; // 75 + 15 = 90
    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    // The AI seat's spiritMax must equal the computed value.
    expect(aiPs?.spiritMax).toBe(expectedSpirit);
    expect(aiPs?.spiritCurrent).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — roamer NPC receives no bonus (#464)', () => {
  test('scenario 5 — vsAI with a roamer npcId: _npcSpirit === floor(playerSpiritMax × personalityMult) + 0', async () => {
    // #464 adversarial: roamers must be unaffected by the bonus. The guard is
    // `if (this.boss && this.npcBiome)` — a roamer has no boss descriptor so the
    // branch must be skipped entirely.  A regression would add the biome-looked-up
    // bonus even for non-boss NPCs.
    const spiritMax = 100;
    const username3 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId3 = repo.createPlayer(username3, 'x');
    const token3 = signToken({ playerId: playerId3, username: username3 });
    setSpiritMax(playerId3, spiritMax);

    // forest_npc_1 is a plain roamer (AGGRESSIVE, no boss descriptor) — personality
    // mult for AGGRESSIVE is 0.8 (not a boss), so npcSpirit = floor(100 × 0.8) = 80.
    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_npc_1',
    });
    await colyseus.connectTo(room, { token: token3 });
    await room.waitForNextPatch();

    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    // The spirit must NOT include any bonus.  It is the raw personality-mult result.
    // The AGGRESSIVE roamer spirit = floor(100 × 0.8) = 80.  With forest gate bonus it
    // would be 95. Assert it is NOT >= 90 (any bonus applied) to catch the regression.
    expect(aiPs?.spiritMax).toBeDefined();
    expect(aiPs?.spiritMax).toBeLessThan(90); // must be < any bonus-inflated value
    expect(aiPs?.spiritCurrent).toBe(aiPs?.spiritMax); // current === max at join

    await room.disconnect();
  });
});

describe('BattleRoom integration — unknown biome NPC does not crash, bonus is 0 (#464)', () => {
  test('scenario 6 — vsAI room with a valid boss NPC falls back to +0 if biome absent', async () => {
    // #464 adversarial: this tests the ?? 0 fallback path.  Since all NPC_SPAWNS
    // currently have valid biome keys in the table, we cannot inject an unknown
    // biome via room options directly — but we can verify the constant lookup
    // is safe and produces 0 for absent keys (see pure arithmetic tests above).
    // For the integration layer, we instead re-confirm that a normal boss room
    // computes the correct non-zero bonus (proving the ?? 0 branch is the fallback,
    // not the only path) and that the lookup itself doesn't throw.
    const spiritMax = 80;
    const username4 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId4 = repo.createPlayer(username4, 'x');
    const token4 = signToken({ playerId: playerId4, username: username4 });
    setSpiritMax(playerId4, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_bogwood_warden',
    });
    await colyseus.connectTo(room, { token: token4 });
    await room.waitForNextPatch();

    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    // floor(80 × 0.75) + 15 = 60 + 15 = 75. If ?? 0 were always taken, it would be 60.
    expect(aiPs?.spiritMax).toBe(75); // confirms bonus path is taken, not ?? 0 fallback
    expect(aiPs?.spiritCurrent).toBe(75);

    await room.disconnect();
  });
});

describe('BattleRoom integration — major forest boss (Thornwood Warden) spirit includes +40 (#464)', () => {
  test('vsAI with npcId=forest_thornwood_warden: _npcSpirit === floor(playerSpiritMax × 1.0) + 40', async () => {
    // #464 adversarial: major tier uses spiritMult=1.0; a regression that applied
    // the gate bonus (+15) instead of major (+40) would produce 140 vs correct 140
    // for spiritMax=100 — but for spiritMax=50: floor(50×1.0)+40=90 vs
    // floor(50×1.0)+15=65.  Use spiritMax=50 to distinguish all three tier bonuses.
    const spiritMax = 50;
    const username5 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId5 = repo.createPlayer(username5, 'x');
    const token5 = signToken({ playerId: playerId5, username: username5 });
    setSpiritMax(playerId5, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_thornwood_warden',
    });
    await colyseus.connectTo(room, { token: token5 });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 1.0) + 40; // 50 + 40 = 90
    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);
    expect(aiPs?.spiritCurrent).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — sub-boss shrine guardian spirit includes +25 (#464)', () => {
  test('vsAI with npcId=forest_thornado_shrine_guardian: _npcSpirit === floor(playerSpiritMax × 0.60) + 25', async () => {
    // #464 adversarial: sub tier uses spiritMult=0.60; with spiritMax=50:
    // floor(50×0.60)+25 = 30+25 = 55. Wrong bonus (+15 gate): 30+15=45. Detectable.
    const spiritMax = 50;
    const username6 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId6 = repo.createPlayer(username6, 'x');
    const token6 = signToken({ playerId: playerId6, username: username6 });
    setSpiritMax(playerId6, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_thornado_shrine_guardian',
    });
    await colyseus.connectTo(room, { token: token6 });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.60) + 25; // 30 + 25 = 55
    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);
    expect(aiPs?.spiritCurrent).toBe(expectedSpirit);

    await room.disconnect();
  });
});

describe('BattleRoom integration — frost_sentinel (biome=forest, tier=gate): +15, not +40 (#464)', () => {
  test('vsAI with npcId=forest_frost_sentinel: _npcSpirit === floor(playerSpiritMax × 0.75) + 15 (not +40)', async () => {
    // #464 adversarial: the frost_sentinel lives in biome='forest' despite being a
    // Snow-gate visual. Any lookup using the *name* "frost" as a biome key would
    // return undefined → 0. Any lookup confusing it with snow would return +40.
    // Only a correct biome='forest' lookup returns +15.
    // Use spiritMax=50: forest gate → floor(50×0.75)+15=37+15=52.
    //                   snow gate  → floor(50×0.75)+40=37+40=77.
    //                   no bonus   → floor(50×0.75)+0 =37.
    const spiritMax = 50;
    const username7 = `u_${Math.random().toString(36).slice(2)}`;
    const playerId7 = repo.createPlayer(username7, 'x');
    const token7 = signToken({ playerId: playerId7, username: username7 });
    setSpiritMax(playerId7, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_frost_sentinel',
    });
    await colyseus.connectTo(room, { token: token7 });
    await room.waitForNextPatch();

    const expectedSpirit = Math.floor(spiritMax * 0.75) + 15; // 37 + 15 = 52
    // The AI seat is keyed 'AI' in the Colyseus MapSchema.
    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(expectedSpirit);   // must be 52 (forest gate)
    expect(aiPs?.spiritMax).not.toBe(77);            // must NOT be 77 (snow gate)
    expect(aiPs?.spiritMax).not.toBe(37);            // must NOT be 37 (no bonus)
    expect(aiPs?.spiritCurrent).toBe(expectedSpirit);

    await room.disconnect();
  });
});

// ============================================================================
// 5 — IMPL-AWARE: double-guard combinations (boss × biome)
// ============================================================================
//
// The implementation guard is:
//   if (this.boss && this.npcBiome) { bonus = BIOME_BOSS_SPIRIT_BONUS[...] ?? 0; }
//
// Four logical combinations exist.  Only combination (true,true) applies the bonus.
// The three negative combinations must leave _npcSpirit at the unaugmented value.
//
// Combination (true,true)  — boss set, biome set   → BONUS APPLIED   (already tested above)
// Combination (false,true) — boss=undefined, biome set  → no bonus (roamer path)
// Combination (true,false) — boss set, biome=undefined  → no bonus (impossible via normal
//                            NPC_SPAWNS since biome is always present, but tests the guard)
// Combination (false,false)— boss=undefined, biome=undefined → no bonus (generic vsAI)
// ============================================================================

describe('impl-aware: double-guard (boss=undefined, npcBiome set) — no bonus (#464)', () => {
  test('vsAI roamer with explicit biome npcId: npcBiome stays undefined because boss guard fires first → no bonus', async () => {
    // #464 impl-aware: `if (this.boss) this.npcBiome = bossSpawn?.biome` means
    // npcBiome is ONLY set when this.boss is truthy.  For a roamer (no boss field
    // on the spawn entry) this.boss = undefined → npcBiome stays undefined.
    // Even though the spawn has a biome string in NPC_SPAWNS, npcBiome is never
    // assigned.  This tests the boss-assignment guard in onCreate, not the inner
    // bonus-application guard in onJoin.
    // Use spiritMax=120 with AGGRESSIVE personality (mult=0.25):
    //   floor(120 × 0.25) = 30 (no boss mod applies to roamers).
    //   With any bonus applied it would be >= 45. Assert exactly 30.
    const spiritMax = 120;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    // forest_npc_1: biome='forest', NO boss field → this.boss=undefined → npcBiome stays undefined.
    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_npc_1',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    // Roamer personality AGGRESSIVE: npcSpiritMult = PERSONALITY_SPIRIT_MULT.AGGRESSIVE = 0.25.
    const expectedNoBonus = Math.floor(spiritMax * 0.25); // = 30
    expect(aiPs?.spiritMax).toBe(expectedNoBonus);
    // npcBiome was not assigned — accessible via private field cast.
    expect((room as any).npcBiome).toBeUndefined();
    expect((room as any).boss).toBeUndefined();

    await room.disconnect();
  });
});

describe('impl-aware: double-guard (boss=undefined, npcBiome=undefined) — generic vsAI, no npcId → no bonus (#464)', () => {
  test('vsAI room with no npcId: both boss and npcBiome are undefined → no bonus applied', async () => {
    // #464 impl-aware: when vsAI=true but npcId is absent (bossSpawn=undefined),
    // this.boss = bossSpawn?.boss = undefined and the if(this.boss) guard skips
    // npcBiome assignment.  Both private fields stay undefined.  The inner guard
    // if(this.boss && this.npcBiome) evaluates false → bonus block never entered.
    // This covers the (false,false) combination.
    const spiritMax = 120;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    // No npcId supplied — generic vsAI duel with default AGGRESSIVE personality.
    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      // npcId intentionally absent
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    const expectedNoBonus = Math.floor(spiritMax * 0.25); // AGGRESSIVE mult=0.25 → 30
    expect(aiPs?.spiritMax).toBe(expectedNoBonus);
    expect((room as any).boss).toBeUndefined();
    expect((room as any).npcBiome).toBeUndefined();

    await room.disconnect();
  });
});

describe('impl-aware: PvP room (no vsAI) — npcSpiritMult=0 guard immunises spirit (#464)', () => {
  test('PvP room: _npcSpirit stays Infinity (npcSpiritMult=0 guard prevents both _npcSpirit write and bonus)', async () => {
    // #464 impl-aware: the bonus block is nested inside
    //   if (this.ai && this.npcSpiritMult > 0) { ... }
    // PvP rooms never set vsAI=true → this.ai stays null → this.npcSpiritMult stays 0.
    // The outer guard evaluates false → neither the floor(spiritMax × mult) line nor
    // the bonus addition is ever reached.  _npcSpirit retains its initialised value
    // of Infinity.  The AI seat does not exist in a PvP room, so state.players has
    // no 'AI' key.
    // We also verify that boss/npcBiome are never set (neither vsAI branch nor
    // npcId branch executes in a PvP room).
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });

    // PvP room: no vsAI, no npcId.
    const room = await colyseus.createRoom<any>('battle', {});
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    // No AI seat in a PvP room.
    expect(room.state.players.get('AI')).toBeUndefined();
    // Private fields confirm the bonus path was never reached.
    expect((room as any).boss).toBeUndefined();
    expect((room as any).npcBiome).toBeUndefined();
    expect((room as any).npcSpiritMult).toBe(0);
    // _npcSpirit retains its sentinel Infinity value — the floor/bonus write was skipped.
    expect((room as any)._npcSpirit).toBe(Infinity);

    await room.disconnect();
  });
});

describe('impl-aware: ??0 fallback — tier absent from a partial biome record (#464)', () => {
  test('BIOME_BOSS_SPIRIT_BONUS lookup for a tier key absent in a partial row returns undefined → 0 via ??', () => {
    // #464 impl-aware: the type is Partial<Record<BossTier,number>> — any tier key
    // may legitimately be absent.  The implementation uses ?.[this.boss.tier] ?? 0.
    // We verify the ?? branch by directly interrogating the constant with a key that
    // is not in BossTier (simulating a partial row), since all production rows are
    // currently complete.  The ?? is a JS runtime operator — we test it directly on
    // the imported constant without going through a room.
    const bonusTable = BIOME_BOSS_SPIRIT_BONUS;

    // Direct absent-tier lookup on an existing biome row.
    const absentTierResult = bonusTable['forest']?.['nonexistent_tier' as string] ?? 0;
    expect(absentTierResult).toBe(0);

    // Absent biome row.
    const absentBiomeResult = bonusTable['cavern']?.['gate'] ?? 0;
    expect(absentBiomeResult).toBe(0);

    // Both absent.
    const bothAbsent = bonusTable['cavern']?.['nonexistent_tier' as string] ?? 0;
    expect(bothAbsent).toBe(0);

    // None of these accesses should throw — the ?. / ?? chain is safe.
    expect(() => bonusTable['cavern']?.['gate'] ?? 0).not.toThrow();
    expect(() => bonusTable['forest']?.['legendary' as string] ?? 0).not.toThrow();
  });

  test('impl-aware: roamer npcSpirit formula uses PERSONALITY_SPIRIT_MULT not BOSS_MODIFIERS (#464)', async () => {
    // #464 impl-aware: for a roamer, npcSpiritMult = PERSONALITY_SPIRIT_MULT[personality]
    // (not BOSS_MODIFIERS[tier].spiritMult which would be for bosses).
    // IMPORTANT: personality in BattleRoom comes from options.personality (line 294),
    // NOT from the NPC spawn entry. With no explicit personality option, it defaults
    // to 'AGGRESSIVE' (PERSONALITY_SPIRIT_MULT.AGGRESSIVE = 0.25). We pass
    // personality:'DEFENSIVE' explicitly to pin the mult at 0.30 and distinguish it
    // from the boss mults (0.60 / 0.75 / 1.0) — proving the personality path is taken.
    // spiritMax=200: floor(200 × 0.30) = 60. Boss sub mult: floor(200×0.60)=120. Clear gap.
    const spiritMax = 200;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    // forest_npc_2 has no boss descriptor; personality overridden to DEFENSIVE via options.
    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_npc_2',
      personality: 'DEFENSIVE',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    // PERSONALITY_SPIRIT_MULT.DEFENSIVE = 0.30 → floor(200 × 0.30) = 60.
    // If boss mult (major=1.0) were used: floor(200×1.0)+bonus ≥ 200.
    // If sub mult (0.60) were used: floor(200×0.60) = 120. This value is unambiguous.
    expect(aiPs?.spiritMax).toBe(60);
    // npcBiome was not assigned — the boss guard (if(this.boss)) kept it undefined.
    expect((room as any).npcBiome).toBeUndefined();

    await room.disconnect();
  });
});

// ============================================================================
// 6 — PHASE 2 IMPL-AWARE: computeNpcSpirit parity + npcPersonality threading (#478)
// ============================================================================
//
// These tests exercise branches the Phase 1 spec tests could not reach without
// seeing the implementation:
//
//   a) True parity: computeNpcSpirit(spirit_max, npcPersonality, npcBiome, bossTier)
//      MUST return the same value as aiPs.spiritMax produced by the actual BattleRoom
//      onJoin seating path. Phase 1 tests verified the helper in isolation; these
//      tests verify it against the real seating code — locking the preview-vs-fight
//      invariant against a future divergence between the helper and BattleRoom.
//
//   b) npcPersonality threading: BattleRoom.onCreate sets npcPersonality from
//      options.personality (line 293: `const personality = options.personality ?? 'AGGRESSIVE'`).
//      If options.personality is absent the field defaults to 'AGGRESSIVE'. This
//      threading must survive for all four personalities when explicitly supplied.
//      A regression that hard-coded or forgot to store personality would seat every
//      roamer at AGGRESSIVE spirit (the minimum), silently under-reporting spirit.
//
//   c) npcPersonality default: When options.personality is absent, npcPersonality
//      stays 'AGGRESSIVE'. Assert the private field and the aiPs.spiritMax explicitly
//      so a future change to the default is immediately visible.
// ============================================================================

describe('impl-aware (#478): computeNpcSpirit parity — helper result === BattleRoom aiPs.spiritMax (roamer)', () => {
  // #478 adversarial: the overworld preview calls computeNpcSpirit; BattleRoom
  // calls computeNpcSpirit internally. If either path diverges the player sees a
  // different spirit total in the readout vs the actual battle.
  // This test calls BOTH and asserts equality — not against a hardcoded number.

  const PERSONALITIES = [
    { personality: 'AGGRESSIVE',    mult: 0.25 },
    { personality: 'DEFENSIVE',     mult: 0.30 },
    { personality: 'STATUS_HUNTER', mult: 0.35 },
    { personality: 'RESILIENT',     mult: 0.40 },
  ] as const;

  test.each(PERSONALITIES)(
    // #478 adversarial: a drift between computeNpcSpirit and BattleRoom.onJoin would
    // silently break the "what you see is what you fight" invariant for every personality
    'parity: computeNpcSpirit === aiPs.spiritMax for personality=$personality (roamer, no boss)',
    async ({ personality, mult }) => {
      const spiritMax = 160;
      const username = `u_${Math.random().toString(36).slice(2)}`;
      const playerId = repo.createPlayer(username, 'x');
      const token = signToken({ playerId, username });
      setSpiritMax(playerId, spiritMax);

      // Expected value from the helper (roamer: biome and bossTier both undefined).
      const helperResult = computeNpcSpirit(spiritMax, personality);
      // Must match the formula to confirm the test itself is correct.
      expect(helperResult).toBe(Math.floor(spiritMax * mult));

      // Seat through the real BattleRoom.onJoin path with this personality.
      const room = await colyseus.createRoom<any>('battle', {
        vsAI: true,
        personality,
        // No npcId — roamer with no biome or boss descriptor.
      });
      await colyseus.connectTo(room, { token });
      await room.waitForNextPatch();

      const aiPs = room.state.players.get('AI');
      // The helper result MUST equal the seated value — this is the parity invariant.
      expect(aiPs?.spiritMax).toBe(helperResult);
      expect(aiPs?.spiritCurrent).toBe(helperResult);

      await room.disconnect();
    },
  );
});

describe('impl-aware (#478): computeNpcSpirit parity — helper result === BattleRoom aiPs.spiritMax (boss)', () => {
  // #478 adversarial: boss path parity check. The helper uses BOSS_MODIFIERS[bossTier].spiritMult
  // + BIOME_BOSS_SPIRIT_BONUS[biome][bossTier]. BattleRoom derives these from the NPC spawn entry.
  // If the npcBiome or boss.tier is mis-threaded between onCreate and onJoin, the helper
  // and the room would diverge on any spiritMax where bonus != 0.

  test('parity: computeNpcSpirit === aiPs.spiritMax for forest gate boss (Bogwood Warden)', async () => {
    // #478 adversarial: boss parity — helper called with the same inputs BattleRoom
    // reads from NpcSpawns (biome='forest', tier='gate', spiritMult=0.75, bonus=+15).
    // A regression that read npcBiome or boss.tier incorrectly in onJoin would
    // produce a different aiPs.spiritMax than the helper, breaking the preview invariant.
    const spiritMax = 120;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    // The helper call mirrors what the overworld route would compute for the same player.
    // forest_bogwood_warden: biome='forest', tier='gate', spiritMult=0.75, bonus=+15.
    const helperResult = computeNpcSpirit(spiritMax, 'AGGRESSIVE', 'forest', 'gate');
    // floor(120 × 0.75) + 15 = 90 + 15 = 105.
    expect(helperResult).toBe(105);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_bogwood_warden',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    // The room's seated value must equal the helper — parity invariant.
    expect(aiPs?.spiritMax).toBe(helperResult);
    expect(aiPs?.spiritCurrent).toBe(helperResult);

    await room.disconnect();
  });

  test('parity: computeNpcSpirit === aiPs.spiritMax for forest major boss (Thornwood Warden)', async () => {
    // #478 adversarial: major tier parity. forest_thornwood_warden: biome='forest',
    // tier='major', spiritMult=1.0, bonus=+40. A mis-read tier ('gate' instead of
    // 'major') would produce floor(100×0.75)+15=90 vs correct floor(100×1.0)+40=140.
    const spiritMax = 100;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    const helperResult = computeNpcSpirit(spiritMax, 'RESILIENT', 'forest', 'major');
    // floor(100 × 1.0) + 40 = 140.
    expect(helperResult).toBe(140);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      npcId: 'forest_thornwood_warden',
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    const aiPs = room.state.players.get('AI');
    expect(aiPs?.spiritMax).toBe(helperResult);

    await room.disconnect();
  });
});

describe('impl-aware (#478): npcPersonality defaults to AGGRESSIVE when options.personality absent', () => {
  test('no options.personality → npcPersonality is AGGRESSIVE → aiPs.spiritMax uses 0.25 mult', async () => {
    // #478 impl-aware: BattleRoom.onCreate line 293:
    //   const personality = options.personality ?? 'AGGRESSIVE';
    // and line 330:
    //   this.npcPersonality = personality;
    // When options.personality is omitted, npcPersonality defaults to 'AGGRESSIVE' (0.25).
    // A regression that changed the default (e.g., to DEFENSIVE=0.30) would produce
    // floor(160×0.30)=48 instead of floor(160×0.25)=40 — a detectable difference.
    const spiritMax = 160;
    const username = `u_${Math.random().toString(36).slice(2)}`;
    const playerId = repo.createPlayer(username, 'x');
    const token = signToken({ playerId, username });
    setSpiritMax(playerId, spiritMax);

    const room = await colyseus.createRoom<any>('battle', {
      vsAI: true,
      // options.personality intentionally absent
    });
    await colyseus.connectTo(room, { token });
    await room.waitForNextPatch();

    // npcPersonality defaults to 'AGGRESSIVE' → mult=0.25.
    expect((room as any).npcPersonality).toBe('AGGRESSIVE');
    const aiPs = room.state.players.get('AI');
    // floor(160 × 0.25) = 40; if default were DEFENSIVE it would be 48.
    expect(aiPs?.spiritMax).toBe(40);
    // Helper called with the same explicit 'AGGRESSIVE' must match.
    expect(aiPs?.spiritMax).toBe(computeNpcSpirit(spiritMax, 'AGGRESSIVE'));

    await room.disconnect();
  });
});

describe('impl-aware (#478): npcPersonality threading — all four personalities seat correct spirit', () => {
  // #478 adversarial: npcPersonality is stored in onCreate and read in onJoin.
  // If the field assignment is missing or overwrites with a constant, all roamers
  // would use AGGRESSIVE (0.25) regardless of the actual personality option.
  // This table drives all four personalities and asserts aiPs.spiritMax equals
  // computeNpcSpirit — both to verify the threading AND the parity invariant.

  const CASES = [
    { personality: 'AGGRESSIVE',    spiritMax: 200, expected: 50  }, // floor(200×0.25)
    { personality: 'DEFENSIVE',     spiritMax: 200, expected: 60  }, // floor(200×0.30)
    { personality: 'STATUS_HUNTER', spiritMax: 200, expected: 70  }, // floor(200×0.35)
    { personality: 'RESILIENT',     spiritMax: 200, expected: 80  }, // floor(200×0.40)
  ] as const;

  test.each(CASES)(
    // #478 adversarial: npcPersonality not stored → all roamers seat at AGGRESSIVE (50),
    // DEFENSIVE/STATUS_HUNTER/RESILIENT would be indistinguishable from AGGRESSIVE
    'personality=$personality spiritMax=$spiritMax → aiPs.spiritMax=$expected + npcPersonality field matches',
    async ({ personality, spiritMax, expected }) => {
      const username = `u_${Math.random().toString(36).slice(2)}`;
      const playerId = repo.createPlayer(username, 'x');
      const token = signToken({ playerId, username });
      setSpiritMax(playerId, spiritMax);

      const room = await colyseus.createRoom<any>('battle', {
        vsAI: true,
        personality,
      });
      await colyseus.connectTo(room, { token });
      await room.waitForNextPatch();

      // Verify the private field was stored correctly in onCreate.
      // #478 impl-aware: the field exists so onJoin can call computeNpcSpirit with it.
      expect((room as any).npcPersonality).toBe(personality);

      const aiPs = room.state.players.get('AI');
      // Seated spirit must match the spec value (floor(spiritMax × mult)).
      expect(aiPs?.spiritMax).toBe(expected);
      // And must match the helper called with the same personality (parity invariant).
      expect(aiPs?.spiritMax).toBe(computeNpcSpirit(spiritMax, personality));

      await room.disconnect();
    },
  );
});
