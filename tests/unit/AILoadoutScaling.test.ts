import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import {
  generateAILoadout,
  npcEffectiveXp,
  previewOpponent,
  skillRoll,
  PERSONALITY_SPIRIT_MULT,
} from '../../server/src/game/ai/AILoadout';
import { makeRng } from '../../server/src/game/ai/AIProfiles';
import { tierForXp, naturalMaxUses } from '../../server/src/game/Tiers';
import {
  BOSS_MODIFIERS,
  CLASS_OFFSET,
  REGION_STEP,
  BIOME_ORDER,
} from '../../server/src/game/constants';
import {
  ElementEnum,
  DIFFICULTY_MULTIPLIERS,
  type AIPersonality,
  type BossTier,
  type DifficultyTier,
} from '../../shared/types';

/**
 * #244 — generateAILoadout scales the AI's tier / uses / thumb XP off the player's
 * CARRIED battle-hand weighted-average XP. The input is already an average, so it
 * feeds tierForXp directly (the old #196 /5 divisor is gone):
 *   npcEffectiveXp = round(battleHandAvgXp · PERSONALITY_MULTIPLIER[p])
 *   tier           = tierForXp(npcEffectiveXp)
 *   maxUses        = naturalMaxUses(tier)
 *   thumbXp        = max(PERSONALITY_THUMB_XP[p], npcEffectiveXp)   (floor)
 *
 * Per-personality constants (mirrored from AILoadout.ts so a drift breaks here):
 *   MULTIPLIER: AGGRESSIVE 0.8, DEFENSIVE 1.0, STATUS_HUNTER 1.1, RESILIENT 1.3
 *   THUMB_XP (floor): AGGRESSIVE 10, DEFENSIVE 20, STATUS_HUNTER 30, RESILIENT 40
 *
 * A deterministic seed pins the template variant so the assertions are stable.
 */

const MULT: Record<AIPersonality, number> = {
  AGGRESSIVE: 0.8,
  DEFENSIVE: 1.0,
  STATUS_HUNTER: 1.1,
  RESILIENT: 1.3,
};
const FLOOR: Record<AIPersonality, number> = {
  AGGRESSIVE: 10,
  DEFENSIVE: 20,
  STATUS_HUNTER: 30,
  RESILIENT: 40,
};

const SEED = 0x12345678;

describe('npcEffectiveXp (#244)', () => {
  test('rounds battleHandAvgXp × multiplier with no /5 division', () => {
    // 233.33 × 1.0 → 233 (DEFENSIVE). With the old /5 this would have been ~46.
    expect(npcEffectiveXp('DEFENSIVE', 700 / 3)).toBe(233);
    // 300 × 1.3 = 390 (RESILIENT).
    expect(npcEffectiveXp('RESILIENT', 300)).toBe(390);
    // 300 × 0.8 = 240 (AGGRESSIVE).
    expect(npcEffectiveXp('AGGRESSIVE', 300)).toBe(240);
  });

  test('a zero battle hand yields 0', () => {
    expect(npcEffectiveXp('DEFENSIVE', 0)).toBe(0);
  });
});

describe('generateAILoadout scaling (#244)', () => {
  const personalities: AIPersonality[] = [
    'AGGRESSIVE',
    'DEFENSIVE',
    'STATUS_HUNTER',
    'RESILIENT',
  ];

  for (const p of personalities) {
    test(`${p}: tier/uses/thumb XP derive from npcEffectiveXp (no /5)`, () => {
      // A battle-hand average large enough to clear several tiers after scaling.
      const battleHandAvgXp = 2000;
      const npcXp = Math.round(battleHandAvgXp * MULT[p]);
      const expectedTier = tierForXp(npcXp);
      const expectedUses = naturalMaxUses(expectedTier);
      const expectedThumbXp = Math.max(FLOOR[p], npcXp);

      const loadout = generateAILoadout(
        p,
        makeRng(SEED),
        undefined,
        undefined,
        undefined,
        undefined,
        battleHandAvgXp,
      );

      const thumb = loadout.thumb;
      expect(thumb).toBeDefined();
      expect(thumb!.tier).toBe(expectedTier);
      expect(thumb!.maxUses).toBe(expectedUses);
      expect(thumb!.currentUses).toBe(expectedUses);
      expect(thumb!.xp).toBe(expectedThumbXp);

      // Every non-thumb slot shares the scaled tier/uses but carries 0 XP.
      for (const slot of ['a1', 'a2', 'd1', 'd2'] as const) {
        expect(loadout[slot]!.tier).toBe(expectedTier);
        expect(loadout[slot]!.maxUses).toBe(expectedUses);
        expect(loadout[slot]!.xp).toBe(0);
      }
    });
  }

  test('DEFENSIVE at avg 233.33 → thumb XP 233, tier 0 (below T1=500)', () => {
    const battleHandAvgXp = 700 / 3; // 233.33
    const loadout = generateAILoadout(
      'DEFENSIVE',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      undefined,
      battleHandAvgXp,
    );
    expect(loadout.thumb!.xp).toBe(233); // round(233.33 × 1.0)
    expect(loadout.thumb!.tier).toBe(0); // 233 < 500
    expect(loadout.thumb!.maxUses).toBe(naturalMaxUses(0)); // 3
  });

  test('a scaled npcXp below the floor clamps the thumb to the personality floor', () => {
    // DEFENSIVE avg=10 → round(10 × 1.0) = 10, below the floor of 20 → clamp to 20.
    const loadout = generateAILoadout(
      'DEFENSIVE',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      undefined,
      10,
    );
    expect(loadout.thumb!.xp).toBe(FLOOR.DEFENSIVE); // 20
    expect(loadout.thumb!.tier).toBe(tierForXp(10)); // 0
  });

  test('input 0 → unscaled defaults (tier 1, 3 uses, floor thumb XP)', () => {
    const loadout = generateAILoadout('DEFENSIVE', makeRng(SEED)); // no battle-hand arg
    expect(loadout.thumb!.tier).toBe(1); // default tier untouched
    expect(loadout.thumb!.maxUses).toBe(3); // default maxUses untouched
    expect(loadout.thumb!.xp).toBe(FLOOR.DEFENSIVE); // floor at 20
  });
});

describe('previewOpponent scaling (#244)', () => {
  test('stakeXp matches the scaled thumb XP from the same seed', () => {
    const battleHandAvgXp = 700 / 3; // 233.33 → DEFENSIVE stake 233
    const preview = previewOpponent('DEFENSIVE', makeRng(SEED), battleHandAvgXp);
    expect(preview.stakeXp).toBe(233);
    expect(preview.npcEffectiveXp).toBe(233);

    // The preview must equal what generateAILoadout produces under an identical seed.
    const loadout = generateAILoadout(
      'DEFENSIVE',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      undefined,
      battleHandAvgXp,
    );
    expect(preview.stakeXp).toBe(loadout.thumb!.xp);
  });

  test('a zero battle hand previews the floor stake', () => {
    const preview = previewOpponent('DEFENSIVE', makeRng(SEED), 0);
    expect(preview.stakeXp).toBe(FLOOR.DEFENSIVE); // 20
    expect(preview.npcEffectiveXp).toBe(0);
  });
});

// ============================================================================
// computeNpcSpirit (#478/#492) — roamer + boss spirit preview helper
// ============================================================================
//
// computeNpcSpirit is exported from AILoadout.ts. It is the single source of
// truth for NPC spirit pool computation used by both BattleRoom and GET
// /api/overworld/npcs.
//
// Roamer path (#492): max(spiritFloor(biome,'roamer'), floor(spiritMax × PERSONALITY_SPIRIT_MULT))
// Boss path (preserved): floor(spiritMax × BOSS_MODIFIERS[bossTier].spiritMult)
//                       + spiritFloor(biome, bossTier)
//
// Mirror of PERSONALITY_SPIRIT_MULT from AILoadout.ts — a drift here breaks tests:
//   AGGRESSIVE: 0.25, DEFENSIVE: 0.30, STATUS_HUNTER: 0.35, RESILIENT: 0.40
//
// Mirror of BOSS_MODIFIERS.spiritMult from constants.ts:
//   gate: 0.75, sub: 0.60, major: 1.0
//
// Mirror of spiritFloor(biome, npcClass) = CLASS_OFFSET[npcClass] + REGION_STEP * BIOME_ORDER.indexOf(biome):
//   forest: { gate: 15, sub: 25, major: 40, roamer: 0 }
//   snow:   { gate: 40, sub: 50, major: 65, roamer: 25 }
//   swamp:  { gate: 65, sub: 75, major: 90, roamer: 50 }
//   desert: { gate: 90, sub: 100, major: 115, roamer: 75 }
//   volcano:{ gate: 115, sub: 125, major: 140, roamer: 100 }

const SPIRIT_MULT: Record<AIPersonality, number> = {
  AGGRESSIVE: 0.25,
  DEFENSIVE: 0.30,
  STATUS_HUNTER: 0.35,
  RESILIENT: 0.40,
};

const BOSS_SPIRIT_MULT: Record<string, number> = {
  gate: 0.75,
  sub: 0.60,
  major: 1.0,
};

// #492: spiritFloor(biome, npcClass) = CLASS_OFFSET[npcClass] + REGION_STEP * BIOME_ORDER.indexOf(biome)
const BOSS_BONUS: Record<string, Record<string, number>> = {
  forest:  { gate: 15,  sub: 25,  major: 40  },
  snow:    { gate: 40,  sub: 50,  major: 65  },
  swamp:   { gate: 65,  sub: 75,  major: 90  },
  desert:  { gate: 90,  sub: 100, major: 115 },
  volcano: { gate: 115, sub: 125, major: 140 },
};

// #478 — computeNpcSpirit is loaded via dynamic import so tests fail with a
// clear "not a function" message (not a module-load error) when the helper is
// absent. The top-level static import cannot be used because computeNpcSpirit
// does not exist yet when Phase 1 tests are written (impl runs in parallel).
let computeNpcSpirit: (
  playerSpiritMax: number,
  personality: AIPersonality,
  biome?: string,
  bossTier?: string,
) => number;

beforeAll(async () => {
  const aiLoadout = await import('../../server/src/game/ai/AILoadout');
  computeNpcSpirit = (aiLoadout as any).computeNpcSpirit;
});

describe('computeNpcSpirit — roamer path (#478)', () => {
  // Roamer path: floor(playerSpiritMax × PERSONALITY_SPIRIT_MULT[personality])
  // No boss arguments → no boss bonus applied.

  const ROAMER_CASES: Array<{ personality: AIPersonality; spiritMax: number; expected: number }> = [
    // #478 adversarial: exact floor results must match for each personality.
    // spiritMax=140 chosen to produce clean integer verification anchors.
    { personality: 'AGGRESSIVE',    spiritMax: 140, expected: 35  }, // floor(140 × 0.25)
    { personality: 'DEFENSIVE',     spiritMax: 140, expected: 42  }, // floor(140 × 0.30)
    { personality: 'STATUS_HUNTER', spiritMax: 140, expected: 49  }, // floor(140 × 0.35)
    { personality: 'RESILIENT',     spiritMax: 140, expected: 56  }, // floor(140 × 0.40)
    // spiritMax=100: clean anchor for the spec comment values.
    { personality: 'AGGRESSIVE',    spiritMax: 100, expected: 25  }, // floor(100 × 0.25)
    { personality: 'DEFENSIVE',     spiritMax: 100, expected: 30  }, // floor(100 × 0.30)
    { personality: 'STATUS_HUNTER', spiritMax: 100, expected: 35  }, // floor(100 × 0.35)
    { personality: 'RESILIENT',     spiritMax: 100, expected: 40  }, // floor(100 × 0.40)
  ];

  test.each(ROAMER_CASES)(
    // #478 adversarial: personality multiplier drift would silently miscalibrate the spirit preview
    'personality=$personality spiritMax=$spiritMax → $expected (roamer, no boss bonus)',
    ({ personality, spiritMax, expected }) => {
      // Import is deferred to avoid loading before the module is implemented.
      // computeNpcSpirit loaded in beforeAll above
      const result = computeNpcSpirit(spiritMax, personality);
      expect(result).toBe(expected);
    },
  );

  test('roamer with undefined biome/bossTier receives no bonus', () => {
    // #478 adversarial: passing undefined boss args must not add any bonus.
    // A missing guard on the biome/bossTier check would silently add 0 bonus here
    // but could corrupt if the fallback path hits a wrong table key.
    const spiritMax = 200;
    const roamerResult = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality);
    const expectedBase = Math.floor(spiritMax * SPIRIT_MULT['DEFENSIVE']); // 60
    expect(roamerResult).toBe(expectedBase);
  });

  test('roamer with biome but no bossTier still receives no bonus', () => {
    // #478 adversarial: if biome is provided but bossTier is absent (undefined),
    // the helper must not try to look up a partial key and must return base only.
    // This guards against a biome-present-but-bossTier-missing path.
    const spiritMax = 200;
    const result = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'forest', undefined);
    const expectedBase = Math.floor(spiritMax * SPIRIT_MULT['DEFENSIVE']); // 60
    expect(result).toBe(expectedBase);
  });
});

describe('computeNpcSpirit — boss path (#478)', () => {
  // Boss path: floor(playerSpiritMax × BOSS_MODIFIERS[bossTier].spiritMult)
  //            + BIOME_BOSS_SPIRIT_BONUS[biome][bossTier]
  // Key invariant: floor is applied to the base BEFORE the bonus is added.

  const BOSS_CASES: Array<{
    label: string;
    spiritMax: number;
    personality: AIPersonality;
    biome: string;
    bossTier: string;
    expected: number;
  }> = [
    // forest gate: floor(100 × 0.75) + 15 = 75 + 15 = 90
    {
      label: 'forest/gate spiritMax=100',
      spiritMax: 100,
      personality: 'RESILIENT',
      biome: 'forest',
      bossTier: 'gate',
      expected: 90,
    },
    // forest sub: floor(100 × 0.60) + 25 = 60 + 25 = 85
    {
      label: 'forest/sub spiritMax=100',
      spiritMax: 100,
      personality: 'AGGRESSIVE',
      biome: 'forest',
      bossTier: 'sub',
      expected: 85,
    },
    // forest major: floor(100 × 1.0) + 40 = 100 + 40 = 140
    {
      label: 'forest/major spiritMax=100',
      spiritMax: 100,
      personality: 'DEFENSIVE',
      biome: 'forest',
      bossTier: 'major',
      expected: 140,
    },
    // desert major: floor(100 × 1.0) + 115 = 100 + 115 = 215
    {
      label: 'desert/major spiritMax=100',
      spiritMax: 100,
      personality: 'RESILIENT',
      biome: 'desert',
      bossTier: 'major',
      expected: 215,
    },
    // desert gate: floor(200 × 0.75) + 90 = 150 + 90 = 240
    {
      label: 'desert/gate spiritMax=200',
      spiritMax: 200,
      personality: 'STATUS_HUNTER',
      biome: 'desert',
      bossTier: 'gate',
      expected: 240,
    },
  ];

  test.each(BOSS_CASES)(
    // #478 adversarial: boss spirit must use BOSS_MODIFIERS.spiritMult (not PERSONALITY_SPIRIT_MULT)
    // and must add BIOME_BOSS_SPIRIT_BONUS AFTER the floor — wrong order silently differs on fractional inputs
    '$label → $expected (boss path)',
    ({ spiritMax, personality, biome, bossTier, expected }) => {
      // computeNpcSpirit loaded in beforeAll above
      const result = computeNpcSpirit(spiritMax, personality, biome, bossTier);
      expect(result).toBe(expected);
    },
  );

  test('boss path uses BOSS_MODIFIERS.spiritMult, NOT PERSONALITY_SPIRIT_MULT', () => {
    // #478 adversarial: the roamer and boss paths use DIFFERENT multipliers.
    // Roamer DEFENSIVE: 0.30. Gate boss: 0.75. If the boss path accidentally used
    // PERSONALITY_SPIRIT_MULT it would produce floor(100 × 0.30) + 15 = 45, not 90.
    const spiritMax = 100;
    const roamerResult = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality);
    const bossResult = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'forest', 'gate');
    // roamer: floor(100 × 0.30) = 30
    expect(roamerResult).toBe(30);
    // boss: floor(100 × 0.75) + 15 = 75 + 15 = 90 (NOT floor(100 × 0.30) + 15 = 45)
    expect(bossResult).toBe(90);
    expect(bossResult).not.toBe(roamerResult + 15); // guard against wrong-multiplier path
  });

  test('bonus is added AFTER the floor, not inside it', () => {
    // #478 adversarial: the floor must be applied to the base product alone, then
    // the integer bonus is added. This tests the order invariant on a spiritMax that
    // produces a fractional product.
    // spiritMax=101, gate spiritMult=0.75: 101 × 0.75 = 75.75 → floor=75 → +15=90.
    // If bonus were inside the floor: floor(75.75 + 15) = floor(90.75) = 90 — same here.
    // Use sub (0.60): spiritMax=3 → 3×0.60=1.8 → floor=1 → +25=26.
    // Inside: floor(1.8+25) = floor(26.8) = 26. Same.
    // The true adversarial case: non-integer product where adding the integer bonus
    // before flooring would cross a boundary is algebraically impossible for integer
    // bonuses. The contract tested is the spec expression:
    //   result === Math.floor(spiritMax x bossMult) + bonus
    const spiritMax = 101;
    // sub (0.60): floor(101 × 0.60) + 25 = floor(60.6) + 25 = 60 + 25 = 85
    const result = computeNpcSpirit(101, 'AGGRESSIVE' as AIPersonality, 'forest', 'sub');
    expect(result).toBe(85);
    // Verify: floor(60.6) = 60, not 61.
    expect(Math.floor(101 * BOSS_SPIRIT_MULT['sub'])).toBe(60);
  });
});

describe('computeNpcSpirit — adversarial edge cases (#478)', () => {
  test('spiritMax=0 returns 0 for roamer path', () => {
    // #478 adversarial: a player with no Reliquary rings has spirit_max=0.
    // The route omits npcSpirit for such players, but the helper itself must not
    // crash and must return 0 (floor(0 × anything) = 0).
    for (const personality of ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'] as AIPersonality[]) {
      expect(computeNpcSpirit(0, personality)).toBe(0);
    }
  });

  test('spiritMax=0 boss path returns just the boss bonus', () => {
    // #478 adversarial: floor(0 × bossMult) = 0, so result equals the flat bonus alone.
    // This verifies the helper does not short-circuit to 0 for boss path when spiritMax=0.
    const forestGateBonus = BOSS_BONUS['forest']['gate']; // 15
    const result = computeNpcSpirit(0, 'RESILIENT' as AIPersonality, 'forest', 'gate');
    expect(result).toBe(forestGateBonus); // 0 + 15 = 15
  });

  test('volcano biome with valid bossTier returns base + spiritFloor(volcano,gate)=115', () => {
    // #492: volcano is now in BIOME_ORDER (index 4), so spiritFloor('volcano','gate')=115.
    // floor(100 × 0.75) + 115 = 75 + 115 = 190.
    const spiritMax = 100;
    const result = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'volcano', 'gate');
    const expected = Math.floor(spiritMax * BOSS_SPIRIT_MULT['gate']) + BOSS_BONUS['volcano']['gate'];
    expect(result).toBe(expected); // 75 + 115 = 190
  });

  test('unknown biome (not in BIOME_ORDER) with valid bossTier returns base only (no bonus, no crash)', () => {
    // #492: a biome not in BIOME_ORDER returns spiritFloor=0 safely.
    const spiritMax = 100;
    const result = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'cavern', 'gate');
    // base: floor(100 × 0.75) = 75; spiritFloor('cavern','gate') = 0
    const expected = Math.floor(spiritMax * BOSS_SPIRIT_MULT['gate']) + 0;
    expect(result).toBe(expected); // 75
  });

  test('undefined bossTier with valid biome returns base only (roamer fallback)', () => {
    // #478 adversarial: both biome and bossTier must be present for boss path.
    // Passing only biome (no bossTier) must not add any bonus.
    const spiritMax = 100;
    const result = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'forest', undefined);
    // Must use roamer path: floor(100 × 0.30) = 30
    const expectedRoamer = Math.floor(spiritMax * SPIRIT_MULT['DEFENSIVE']); // 30
    expect(result).toBe(expectedRoamer);
  });

  test('non-integer spiritMax multiplied by personality mult floors down, not rounds', () => {
    // #478 adversarial: Math.floor must be used, not Math.round.
    // spiritMax=199, RESILIENT: 199 × 0.40 = 79.6 → floor=79 (not round=80).
    const spiritMax = 199;
    const result = computeNpcSpirit(spiritMax, 'RESILIENT' as AIPersonality);
    expect(result).toBe(79); // floor(199 × 0.40) = floor(79.6) = 79, not 80
    expect(result).not.toBe(80); // explicit guard against rounding
  });

  test('personality does not affect result on boss path (boss uses bossMult, not personality mult)', () => {
    // #478 adversarial: different personality values must NOT change boss path output
    // because the boss path resolves BOSS_MODIFIERS[bossTier].spiritMult exclusively.
    const spiritMax = 100;
    // All personalities → same result for forest/gate boss
    const results = (['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'] as AIPersonality[])
      .map((p) => computeNpcSpirit(spiritMax, p, 'forest', 'gate'));
    // All four must be equal (boss path ignores personality)
    for (const r of results) {
      expect(r).toBe(results[0]);
    }
    // And the value must be the boss formula: floor(100 × 0.75) + 15 = 90
    expect(results[0]).toBe(90);
  });
});

describe('computeNpcSpirit — spec conformance (#478)', () => {
  // These tests tie directly to the acceptance criteria in issue #478.
  // They fail if the implementation diverges from the spec even if E2E passed.

  test('AC: computeNpcSpirit is exported from AILoadout', () => {
    // Spec AC: "computeNpcSpirit is exported from server/src/game/ai/AILoadout.ts"
    // computeNpcSpirit is assigned in beforeAll; if it's undefined the impl is missing.
    expect(typeof computeNpcSpirit).toBe('function');
  });

  test('AC: roamer DEFENSIVE spiritMax=140 → floor(140x0.30)=42', () => {
    // Spec §Design: "floor(playerSpiritMax × PERSONALITY_SPIRIT_MULT[personality])"
    // with DEFENSIVE=0.30. Confirmed value: 140 × 0.30 = 42.0 → 42.
    expect(computeNpcSpirit(140, 'DEFENSIVE' as AIPersonality)).toBe(42);
  });

  test('AC: boss path adds spiritFloor AFTER the floor (additive preserved)', () => {
    // Spec §Design: "floor applied to the base before the bonus is added — this
    // matches the existing inline behavior exactly (floor(playerSpiritMax × mult) + spiritFloor)."
    // Test: forest/gate, spiritMax=100 → floor(100×0.75) + spiritFloor(forest,gate) = 75 + 15 = 90.
    expect(computeNpcSpirit(100, 'DEFENSIVE' as AIPersonality, 'forest', 'gate')).toBe(90);
  });

  test('AC: parity — computeNpcSpirit(spiritMax, personality, biome, bossTier) equals BattleRoom inline formula', () => {
    // Spec AC: "npcSpirit for a given roamer equals _npcSpirit BattleRoom would set
    // for the same player + personality + biome + boss tier"
    // Verify algebraic equivalence: the helper replicates floor(spiritMax × mult) + bonus.

    // Roamer case: inline was floor(spirit_max * PERSONALITY_SPIRIT_MULT[personality])
    const spiritMax = 180;
    const personality: AIPersonality = 'STATUS_HUNTER';
    const inlineRoamer = Math.floor(spiritMax * SPIRIT_MULT[personality]); // floor(180×0.35)=63
    expect(computeNpcSpirit(spiritMax, personality)).toBe(inlineRoamer);

    // Boss case: inline was floor(spirit_max * BOSS_MODIFIERS[tier].spiritMult) + bonus
    const bossSpiritMult = BOSS_SPIRIT_MULT['sub']; // 0.60
    const bossBonus = BOSS_BONUS['forest']['sub']; // 25
    const inlineBoss = Math.floor(spiritMax * bossSpiritMult) + bossBonus; // floor(180×0.60)+25=108+25=133
    expect(computeNpcSpirit(spiritMax, personality, 'forest', 'sub')).toBe(inlineBoss);
  });
});

// ============================================================================
// skillRoll — generic spawnId fallback (#492 impl-aware)
// ============================================================================
//
// BattleRoom.ts line 400: spawnIdForSkill = options.npcId ?? `generic_${personality}`
// When no npcId is provided (generic vsAI from the AI-battle integration test),
// the spawn id is `generic_AGGRESSIVE`, `generic_DEFENSIVE`, etc.
// Two different personalities must yield different skill rolls so their scaled
// profiles differ — otherwise the distinction between personalities is lost at the
// skill dimension.

describe('skillRoll — generic spawnId personality fallback (#492 impl-aware)', () => {
  test('generic_AGGRESSIVE and generic_DEFENSIVE yield different skill rolls (roamer)', () => {
    // #492 impl-aware: BattleRoom falls back to `generic_${personality}` when no npcId
    // is provided. Different personalities must hash to different skill values so the
    // difficulty ladder still applies for generic duels.
    const aggressiveSkill = skillRoll('generic_AGGRESSIVE', 'roamer');
    const defensiveSkill  = skillRoll('generic_DEFENSIVE',  'roamer');
    expect(aggressiveSkill).not.toBe(defensiveSkill);
  });

  test('generic spawnIds still produce rolls within class band (#492 impl-aware)', () => {
    // #492 impl-aware: the generic fallback spawnIds must still land within the
    // roamer SKILL_BAND [0.20, 0.70]. A hash collision or out-of-bounds would
    // silently bypass the difficulty floor.
    const personalities = ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'];
    for (const p of personalities) {
      const skill = skillRoll(`generic_${p}`, 'roamer');
      expect(skill).toBeGreaterThanOrEqual(0.20);
      expect(skill).toBeLessThanOrEqual(0.70);
    }
  });

  test('generic spawnId is deterministic (same personality always same skill) (#492 impl-aware)', () => {
    // #492 impl-aware: generic duels must be repeatable — same personality seed
    // produces the same skill on every call (mulberry32 is seeded from hash, no state).
    expect(skillRoll('generic_RESILIENT', 'roamer')).toBe(skillRoll('generic_RESILIENT', 'roamer'));
  });
});

// ============================================================================
// #521 (EPIC #511 Contract F) — NPC/AI spirit re-tune under the inflated
// spirit_max range.
// ============================================================================
//
// #520 changed the player's spirit_max from `SUM(max_uses) × difficulty` to
// `SUM(max_uses × force) × difficulty`. A Tier-10 ring now contributes 6× what
// it did, so late-game spirit_max inflates up to ~5.62×. NPC/AI spirit derives
// from that value via computeNpcSpirit(), so this section answers the question
// #521 exists to close: does the inflation break NPC pacing, and if so which
// constants (PERSONALITY_SPIRIT_MULT / BOSS_MODIFIERS.spiritMult / CLASS_OFFSET
// / REGION_STEP) must be retuned?
//
// DELIVERABLE / DECISION (proven by the assertions below):
//   NO constant is changed. The drift the additive boss/roamer floors introduce
//   is CORRECTIVE, not destructive:
//     - Roamers (forest floor=0, and every mult-dominated non-forest case):
//       npc/spiritMax == the personality mult EXACTLY (modulo ≤1-unit floor()
//       rounding), invariant to inflation (drift ratio ≈ 1.00). The "3-5 roamers
//       before resting" calibration is preserved untouched.
//     - Non-forest floor-dominated roamers and every boss: the additive floor's
//       relative weight SHRINKS as spiritMax inflates, so npc/spiritMax converges
//       DOWN toward the designed multiplier (PERSONALITY_SPIRIT_MULT /
//       BOSS_MODIFIERS.spiritMult) from above. The pacing metric never drops
//       BELOW the designed multiplier and never rises ABOVE its pre-#520 value —
//       the NPC never gets relatively harder, and over-long pre-#520 fights
//       (several bosses had pools EXCEEDING the player's, pacOld > 1.0) are
//       corrected toward intent. Retuning the floors UP to hold drift ≈ 1.00
//       would REINTRODUCE those oppressive fights, so the values are held.
//
// TOLERANCE: drift ratio = (npcNew/npcOld) / (spiritMaxNew/spiritMaxOld). 1.00 =
//   NPC scales exactly with the player. Tolerance band ±15% → [0.85, 1.15]. Boss
//   cases outside the band are ACCEPTED (not retuned) under the rationale above,
//   asserted quantitatively per cell (pacNew ∈ [mult, pacOld]).
//
// The spirit_max numbers here are the REAL getSpiritStats() output (seeded
// scratch DB, same harness as spirit-formula.test.ts) — not hand-derived; the
// getSpiritStats path is the #520 formula under test. The pre-#520 baseline is
// the documented old formula SUM(max_uses)×difficulty (no code path survives for
// it), computed inline exactly as spirit-formula.test.ts does for its own
// old-formula sanity checks. computeNpcSpirit is the existing module-level
// dynamic-import handle populated in the beforeAll above; SPIRIT_MULT /
// BOSS_SPIRIT_MULT are the file's existing production mirrors (re-guarded below).

let spiritRepo: typeof import('../../server/src/persistence/PlayerRepo');
let spiritDb: import('better-sqlite3').Database;

function makeSpiritPlayer(difficulty: DifficultyTier): string {
  const id = `p_${Math.random().toString(36).slice(2)}`;
  spiritDb
    .prepare(`INSERT INTO players (id, username, password_hash, difficulty) VALUES (?, ?, ?, ?)`)
    .run(id, `u_${id}`, 'x', difficulty);
  spiritDb
    .prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(id);
  return id;
}

function makeSpiritRing(playerId: string, tier: number, maxUses: number): void {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  spiritDb
    .prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, 0)`,
    )
    .run(id, playerId, ElementEnum.FIRE, tier, maxUses, maxUses);
}

// The three acceptance-table compositions from #520's spirit-formula.test.ts
// (stored 0-indexed tier; human "Tier N" = stored tier N-1).
const SPIRIT_COMPOSITIONS: Record<'Early' | 'Mid' | 'Late', Array<{ tier: number; maxUses: number }>> = {
  Early: Array.from({ length: 5 }, () => ({ tier: 0, maxUses: 3 })), // 5× Tier-1
  Mid: [
    { tier: 3, maxUses: 6 },
    { tier: 3, maxUses: 6 },
    { tier: 3, maxUses: 6 },
    { tier: 4, maxUses: 7 },
    { tier: 4, maxUses: 7 },
  ], // 3× Tier-4 + 2× Tier-5
  Late: [
    { tier: 9, maxUses: 12 },
    { tier: 9, maxUses: 12 },
    { tier: 9, maxUses: 12 },
    { tier: 8, maxUses: 11 },
    { tier: 8, maxUses: 11 },
  ], // 3× Tier-10 + 2× Tier-9
};
type SpiritBand = keyof typeof SPIRIT_COMPOSITIONS;
const SPIRIT_BANDS: SpiritBand[] = ['Early', 'Mid', 'Late'];

/** Pre-#520 spirit_max: SUM(max_uses) × difficulty (no force weighting). */
function oldSpiritMax(band: SpiritBand, difficulty: DifficultyTier): number {
  const usesSum = SPIRIT_COMPOSITIONS[band].reduce((s, r) => s + r.maxUses, 0);
  return usesSum * DIFFICULTY_MULTIPLIERS[difficulty];
}
/** Post-#520 spirit_max from the REAL getSpiritStats path (seeded DB). */
function newSpiritMax(band: SpiritBand, difficulty: DifficultyTier): number {
  const p = makeSpiritPlayer(difficulty);
  for (const r of SPIRIT_COMPOSITIONS[band]) makeSpiritRing(p, r.tier, r.maxUses);
  return spiritRepo.getSpiritStats(p).spiritMax;
}

// Independent reference reimplementation of computeNpcSpirit's two branches,
// built off the file's existing production mirrors (SPIRIT_MULT /
// BOSS_SPIRIT_MULT) plus the imported CLASS_OFFSET / REGION_STEP / BIOME_ORDER.
// Cross-checks that computeNpcSpirit produces the exact integer, and derives the
// ratio grid WITHOUT re-deriving through the code under test.
function spiritFloorRef(biome: string, cls: 'roamer' | BossTier): number {
  const idx = BIOME_ORDER.indexOf(biome);
  if (idx < 0) return 0;
  return CLASS_OFFSET[cls] + REGION_STEP * idx;
}
function roamerRef(S: number, p: AIPersonality, biome: string): number {
  return Math.max(spiritFloorRef(biome, 'roamer'), Math.floor(S * SPIRIT_MULT[p]));
}
function bossRef(S: number, tier: BossTier, biome: string): number {
  return Math.floor(S * BOSS_SPIRIT_MULT[tier]) + spiritFloorRef(biome, tier);
}

const SPIRIT_P: AIPersonality[] = ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'];
const SPIRIT_BOSS_TIERS: BossTier[] = ['gate', 'sub', 'major'];
const SPIRIT_DIFFICULTIES: DifficultyTier[] = ['wanderer', 'seeker', 'ascendant', 'ascetic', 'void'];

// The NPC ratio grid uses seeker (×4) — the difficulty the #520 acceptance table
// and this issue's worked examples are stated at. Inflation R is difficulty-
// invariant (asserted below), so seeker is representative; the void (×1)
// worst-case for floor weight is bounded separately at the end.
const RATIO_DIFFICULTY: DifficultyTier = 'seeker';
const SPIRIT_TOLERANCE = 0.15; // drift within [0.85, 1.15] "tracks the player".

beforeAll(async () => {
  const dbFile = path.join(os.tmpdir(), `er-spirit-retune-test-${process.pid}-${Date.now()}.db`);
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  spiritRepo = await import('../../server/src/persistence/PlayerRepo');
  const dbMod = await import('../../server/src/persistence/db');
  spiritDb = dbMod.db;
});

// ---------------------------------------------------------------------------
// 1. spirit_max before/after — Early/Mid/Late × all 5 DifficultyTiers, asserted
//    against REAL getSpiritStats output (AC #1).
// ---------------------------------------------------------------------------
describe('#521 — spirit_max before/after (real getSpiritStats, all difficulties)', () => {
  // Post-#520 force-weighted per-difficulty sums (pre-multiplier): Early 15,
  // Mid 96, Late 326. Pre-#520 sums: 15, 32, 58.
  const NEW_SUM: Record<SpiritBand, number> = { Early: 15, Mid: 96, Late: 326 };
  const OLD_SUM: Record<SpiritBand, number> = { Early: 15, Mid: 32, Late: 58 };

  test.each(SPIRIT_DIFFICULTIES)(
    'difficulty=%s: getSpiritStats matches SUM(max_uses×force)×mult for every band',
    (difficulty) => {
      const mult = DIFFICULTY_MULTIPLIERS[difficulty];
      for (const band of SPIRIT_BANDS) {
        expect(newSpiritMax(band, difficulty), `${band} new @${difficulty}`).toBe(
          NEW_SUM[band] * mult,
        );
        expect(oldSpiritMax(band, difficulty), `${band} old @${difficulty}`).toBe(
          OLD_SUM[band] * mult,
        );
      }
    },
  );

  test('the seeker worked-examples reproduce the #520 acceptance table exactly', () => {
    expect(newSpiritMax('Early', 'seeker')).toBe(60);
    expect(oldSpiritMax('Early', 'seeker')).toBe(60);
    expect(newSpiritMax('Mid', 'seeker')).toBe(384);
    expect(oldSpiritMax('Mid', 'seeker')).toBe(128);
    expect(newSpiritMax('Late', 'seeker')).toBe(1304);
    expect(oldSpiritMax('Late', 'seeker')).toBe(232);
  });

  test('player inflation R is difficulty-invariant per band (1.00 / 3.00 / 5.62)', () => {
    for (const difficulty of SPIRIT_DIFFICULTIES) {
      expect(newSpiritMax('Early', difficulty) / oldSpiritMax('Early', difficulty)).toBeCloseTo(1.0, 6);
      expect(newSpiritMax('Mid', difficulty) / oldSpiritMax('Mid', difficulty)).toBeCloseTo(3.0, 6);
      expect(newSpiritMax('Late', difficulty) / oldSpiritMax('Late', difficulty)).toBeCloseTo(326 / 58, 6);
    }
    expect(326 / 58).toBeCloseTo(5.62, 2); // the "5.62x" of the acceptance table.
  });
});

// ---------------------------------------------------------------------------
// 2. computeNpcSpirit parity — must equal the independent reference for BOTH old
//    and new spiritMax inputs (proves the ratio grid uses the real helper), and
//    the production constants match the values this analysis assumed.
// ---------------------------------------------------------------------------
describe('#521 — computeNpcSpirit matches the independent reference (old & new inputs)', () => {
  test('roamer & boss parity across the full grid at every band', () => {
    for (const band of SPIRIT_BANDS) {
      const oldS = oldSpiritMax(band, RATIO_DIFFICULTY);
      const newS = newSpiritMax(band, RATIO_DIFFICULTY);
      for (const biome of BIOME_ORDER) {
        for (const p of SPIRIT_P) {
          expect(computeNpcSpirit(oldS, p, biome)).toBe(roamerRef(oldS, p, biome));
          expect(computeNpcSpirit(newS, p, biome)).toBe(roamerRef(newS, p, biome));
        }
        for (const tier of SPIRIT_BOSS_TIERS) {
          expect(computeNpcSpirit(oldS, 'DEFENSIVE', biome, tier)).toBe(bossRef(oldS, tier, biome));
          expect(computeNpcSpirit(newS, 'DEFENSIVE', biome, tier)).toBe(bossRef(newS, tier, biome));
        }
      }
    }
  });

  test('production BOSS_MODIFIERS.spiritMult / CLASS_OFFSET / REGION_STEP / PERSONALITY_SPIRIT_MULT are the values this analysis assumed', () => {
    // Guards the reference mirrors above from silently drifting from production.
    expect(BOSS_MODIFIERS.gate.spiritMult).toBe(0.75);
    expect(BOSS_MODIFIERS.sub.spiritMult).toBe(0.6);
    expect(BOSS_MODIFIERS.major.spiritMult).toBe(1.0);
    expect(CLASS_OFFSET).toEqual({ roamer: 0, gate: 15, sub: 25, major: 40 });
    expect(REGION_STEP).toBe(25);
    expect(PERSONALITY_SPIRIT_MULT).toEqual({
      AGGRESSIVE: 0.25,
      DEFENSIVE: 0.3,
      STATUS_HUNTER: 0.35,
      RESILIENT: 0.4,
    });
    // The file's local mirrors used to build the reference match production too.
    expect(SPIRIT_MULT).toEqual(PERSONALITY_SPIRIT_MULT);
    for (const t of SPIRIT_BOSS_TIERS) expect(BOSS_SPIRIT_MULT[t]).toBe(BOSS_MODIFIERS[t].spiritMult);
  });
});

// ---------------------------------------------------------------------------
// 3. ROAMER ratio grid — every personality × every biome × Mid/Late. Forest
//    (floor=0) and every mult-dominated case: drift ≈ 1.00 (AC #3). Floor-
//    dominated non-forest cases: drift < 1.00, explicitly called out — the
//    roamer becomes relatively CHEAPER (converges to mult), never harder.
// ---------------------------------------------------------------------------
describe('#521 — roamer NPC-inflation ratio grid', () => {
  // Early has R=1.00 (Tier-1 rings, force=1, no inflation) → old==new spiritMax,
  // so every Early ratio is trivially 1.00; Mid/Late carry the real inflation.
  const grid: Array<{ band: SpiritBand; biome: string; p: AIPersonality }> = [];
  for (const band of ['Mid', 'Late'] as SpiritBand[])
    for (const biome of BIOME_ORDER) for (const p of SPIRIT_P) grid.push({ band, biome, p });

  test.each(grid)('$band roamer $biome/$p — ratio computed & no relative hardening', ({ band, biome, p }) => {
    const oldS = oldSpiritMax(band, RATIO_DIFFICULTY);
    const newS = newSpiritMax(band, RATIO_DIFFICULTY);
    const R = newS / oldS;
    const npcOld = computeNpcSpirit(oldS, p, biome);
    const npcNew = computeNpcSpirit(newS, p, biome);
    const drift = npcNew / npcOld / R;
    const pacNew = npcNew / newS; // npc pool as a fraction of the player's pool
    const pacOld = npcOld / oldS;
    const mult = SPIRIT_MULT[p];
    const floor = spiritFloorRef(biome, 'roamer');
    const multDominatedNew = Math.floor(newS * mult) >= floor;
    const multDominatedOld = Math.floor(oldS * mult) >= floor;

    // Universal invariant: a roamer never gets relatively HARDER under inflation
    // (max-floor can only ADD, so npc inflation ≤ player inflation). Stated to
    // within integer floor() rounding: floor(S×mult) loses at most 1 spirit unit,
    // nudging the exact-integer ratios a hair above ideal (max drift ~1.015) —
    // combat-irrelevant. Drift wobble scales as 1/npcOld, pacing wobble as 1/oldS.
    const driftSlack = 1 / npcOld;
    const pacSlack = 1 / oldS;
    expect(drift).toBeLessThanOrEqual(1.0 + driftSlack);
    expect(pacNew).toBeLessThanOrEqual(pacOld + pacSlack);

    if (multDominatedNew) {
      // At the new spiritMax the mult term wins → npc/spiritMax == the personality
      // mult (modulo floor() rounding). The anchor the "3-5" pacing target uses.
      expect(Math.abs(pacNew - mult)).toBeLessThan(0.01);
      if (multDominatedOld) {
        // Both eras mult-dominated (forest always; all non-forest at the Late
        // pool) → the ratio tracks the player exactly. The ≈1.00 AC case.
        expect(Math.abs(drift - 1.0)).toBeLessThanOrEqual(SPIRIT_TOLERANCE);
      } else {
        // Old floor-pinned, new mult-dominated → drift < 1 but CORRECTIVE: the
        // roamer was over-costed for an under-levelled player pre-#520 and now
        // settles to its designed mult. pacNew < pacOld.
        expect(pacNew).toBeLessThan(pacOld);
      }
    } else {
      // Still floor-dominated at the new spiritMax (only volcano/AGGRESSIVE at
      // Mid): the floor pins npcNew, so drift < 1. Accepted — pacNew ≥ mult
      // (biome floor keeps it non-trivial) and < pacOld (cheaper than pre-#520).
      expect(pacNew).toBeGreaterThanOrEqual(mult - 1e-9);
      expect(pacNew).toBeLessThan(pacOld);
    }
  });

  test('the ONLY floor-dominated roamer cell in the seeker grid is volcano/AGGRESSIVE at Mid', () => {
    // Called out explicitly (AC #3): everywhere else the mult term dominates at
    // the new spiritMax, so those ratios are the ≈1.00 case. Only volcano (floor
    // 100) with the lowest mult (0.25) at the modest Mid pool (384) is still
    // floor-pinned: floor(384×0.25)=96 < 100.
    const floorDominated: string[] = [];
    for (const band of ['Mid', 'Late'] as SpiritBand[]) {
      const newS = newSpiritMax(band, RATIO_DIFFICULTY);
      for (const biome of BIOME_ORDER)
        for (const p of SPIRIT_P)
          if (Math.floor(newS * SPIRIT_MULT[p]) < spiritFloorRef(biome, 'roamer'))
            floorDominated.push(`${band}/${biome}/${p}`);
    }
    expect(floorDominated).toEqual(['Mid/volcano/AGGRESSIVE']);
  });
});

// ---------------------------------------------------------------------------
// 4. "3-5 roamers before resting" re-verification (AC #5). The target is
//    preserved because the forest-roamer npc/spiritMax ratio == the personality
//    mult EXACTLY and is INVARIANT to inflation (identical old vs new).
// ---------------------------------------------------------------------------
describe('#521 — "3-5 roamers before resting" invariance (forest, floor=0)', () => {
  test.each(SPIRIT_P)('forest roamer %s: npc/spiritMax == mult, invariant old vs new', (p) => {
    for (const band of SPIRIT_BANDS) {
      const oldS = oldSpiritMax(band, RATIO_DIFFICULTY);
      const newS = newSpiritMax(band, RATIO_DIFFICULTY);
      const npcOld = computeNpcSpirit(oldS, p, 'forest');
      const npcNew = computeNpcSpirit(newS, p, 'forest');
      expect(Math.abs(npcNew / newS - SPIRIT_MULT[p])).toBeLessThan(0.01);
      expect(Math.abs(npcOld / oldS - SPIRIT_MULT[p])).toBeLessThan(0.01);
      // Invariance: the fraction the pre-#520 "3-5" target was calibrated on is
      // unchanged (both equal the mult modulo ≤1-unit floor()), so the
      // calibration holds without any constant retune.
      expect(Math.abs(npcNew / newS - npcOld / oldS)).toBeLessThan(0.01);
    }
  });

  test('forest roamer pool-fraction ⇒ the same ~2.5-4.0 rough-fight-count band as pre-#520', () => {
    // Rough fights-before-rest ≈ spiritMax / npcRoamer = 1/mult, identical old &
    // new: AGGRESSIVE 4.0, DEFENSIVE 3.33, STATUS_HUNTER 2.86, RESILIENT 2.5. A
    // property of PERSONALITY_SPIRIT_MULT alone (unchanged by #520), so the
    // docstring target is preserved by construction.
    const newS = newSpiritMax('Late', RATIO_DIFFICULTY);
    for (const p of SPIRIT_P) {
      const fights = newS / computeNpcSpirit(newS, p, 'forest');
      expect(fights).toBeCloseTo(1 / SPIRIT_MULT[p], 1);
    }
  });

  test('docstring "3-5 roamers before resting" is a rough claim, not exact: RESILIENT computes 2.5, below the stated floor of 3 (pre-existing #478 mismatch, locked here so it cannot silently widen further)', () => {
    // #521 adversarial: the computeNpcSpirit docstring (AILoadout.ts ~L152) says
    // "Calibrated so the player can fight 3-5 roamers before needing to rest."
    // The actual computed proxy above (fights ≈ 1/mult) is 2.5-4.0, not 3-5 — the
    // reviewer flagged this as a minor mismatch that PRE-DATES #521 (not
    // introduced here, and out of scope to retune under this issue). This test
    // does not fix it — it locks the CURRENT numeric gap so a future PR that
    // widens the mismatch further (e.g. retunes PERSONALITY_SPIRIT_MULT without
    // updating the docstring, or vice versa) fails loudly instead of drifting
    // silently past this analysis's stated invariance claim.
    const fightsByPersonality: Record<AIPersonality, number> = {
      AGGRESSIVE: 1 / SPIRIT_MULT.AGGRESSIVE, // 4.0
      DEFENSIVE: 1 / SPIRIT_MULT.DEFENSIVE, // 3.33
      STATUS_HUNTER: 1 / SPIRIT_MULT.STATUS_HUNTER, // 2.86
      RESILIENT: 1 / SPIRIT_MULT.RESILIENT, // 2.5
    };
    expect(fightsByPersonality.AGGRESSIVE).toBeCloseTo(4.0, 1);
    expect(fightsByPersonality.DEFENSIVE).toBeCloseTo(3.33, 1);
    expect(fightsByPersonality.STATUS_HUNTER).toBeCloseTo(2.86, 1);
    expect(fightsByPersonality.RESILIENT).toBeCloseTo(2.5, 1);
    // The docstring's literal "3" and "5" bounds do NOT tightly contain the whole
    // range: RESILIENT (2.5) sits below the docstring's stated floor of 3.
    expect(fightsByPersonality.RESILIENT).toBeLessThan(3);
    // AGGRESSIVE (4.0) DOES sit within [3,5] — the mismatch is partial, not total,
    // which is exactly why it is easy to miss without an explicit test.
    expect(fightsByPersonality.AGGRESSIVE).toBeGreaterThanOrEqual(3);
    expect(fightsByPersonality.AGGRESSIVE).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// 5. BOSS ratio grid — every (biome, bossTier) × Mid/Late. Report every ratio;
//    accept sub-tolerance cells with the asserted corrective-decay rationale
//    (AC #4). NO constant is changed.
// ---------------------------------------------------------------------------
describe('#521 — boss NPC-inflation ratio grid (additive-floor decay)', () => {
  const grid: Array<{ band: SpiritBand; biome: string; tier: BossTier }> = [];
  for (const band of ['Mid', 'Late'] as SpiritBand[])
    for (const biome of BIOME_ORDER) for (const tier of SPIRIT_BOSS_TIERS) grid.push({ band, biome, tier });

  test.each(grid)('$band boss $biome/$tier — ratio reported; drift accepted as corrective', ({ band, biome, tier }) => {
    const oldS = oldSpiritMax(band, RATIO_DIFFICULTY);
    const newS = newSpiritMax(band, RATIO_DIFFICULTY);
    const R = newS / oldS;
    const npcOld = computeNpcSpirit(oldS, 'DEFENSIVE', biome, tier);
    const npcNew = computeNpcSpirit(newS, 'DEFENSIVE', biome, tier);
    const drift = npcNew / npcOld / R;
    const pacNew = npcNew / newS;
    const pacOld = npcOld / oldS;
    const mult = BOSS_SPIRIT_MULT[tier];

    // Every boss drift ≤ 1 (additive floor can only lag the multiplicative player
    // scaling) — a boss NEVER inflates faster than the player.
    expect(drift).toBeLessThanOrEqual(1.0 + 1e-9);

    if (Math.abs(drift - 1.0) <= SPIRIT_TOLERANCE) {
      // Within ±15% — low-floor biome / high mult; tracks the player. No action.
      expect(pacNew).toBeGreaterThanOrEqual(mult - 1e-9);
    } else {
      // ACCEPTED sub-tolerance drift (NOT retuned). Rationale, asserted:
      //  (a) pacNew ≥ mult — the boss pool never drops below its designed
      //      multiplier-length fight; the floor only ever ADDED to it.
      //  (b) pacNew ≤ pacOld — the pool converges DOWN toward that designed
      //      multiplier as spiritMax inflates; never grows relatively longer.
      //  (c) the floor is the shrinking addend: pacNew - mult < pacOld - mult.
      // Retuning CLASS_OFFSET/REGION_STEP/spiritMult UP to force drift→1.00 would
      // re-inflate the floor's weight and REINTRODUCE the over-long pre-#520
      // fights (many had pacOld > 1.0 — boss pool exceeding the player's).
      expect(drift).toBeLessThan(1.0 - SPIRIT_TOLERANCE);
      expect(pacNew).toBeGreaterThanOrEqual(mult - 1e-9);
      expect(pacNew).toBeLessThan(pacOld);
      expect(pacNew - mult).toBeLessThan(pacOld - mult + 1e-9);
    }
  });

  test('anchor: volcano/major at Late reproduces the issue worked example (372 → 1444, drift ≈ 0.69)', () => {
    const oldS = oldSpiritMax('Late', 'seeker'); // 232
    const newS = newSpiritMax('Late', 'seeker'); // 1304
    const npcOld = computeNpcSpirit(oldS, 'DEFENSIVE', 'volcano', 'major');
    const npcNew = computeNpcSpirit(newS, 'DEFENSIVE', 'volcano', 'major');
    expect(npcOld).toBe(372); // 232×1.0 + 140
    expect(npcNew).toBe(1444); // 1304×1.0 + 140
    expect(npcNew / npcOld / (newS / oldS)).toBeCloseTo(0.69, 2);
  });

  test('pre-#520 over-long fights (pacOld > 1.0) are corrected toward intent, none newly over-long', () => {
    // Concretely proves the "corrective" claim: several bosses had a spirit pool
    // LARGER than the player's before #520 (pacOld > 1.0, up to ~2.09× for
    // volcano/major at Mid). After #520 every boss pacNew is closer to its mult
    // and NO boss that was ≤ player pool becomes > player pool.
    let correctedOverLong = 0;
    for (const band of ['Mid', 'Late'] as SpiritBand[]) {
      const oldS = oldSpiritMax(band, 'seeker');
      const newS = newSpiritMax(band, 'seeker');
      for (const biome of BIOME_ORDER)
        for (const tier of SPIRIT_BOSS_TIERS) {
          const pacOld = computeNpcSpirit(oldS, 'DEFENSIVE', biome, tier) / oldS;
          const pacNew = computeNpcSpirit(newS, 'DEFENSIVE', biome, tier) / newS;
          if (pacOld > 1.0) {
            correctedOverLong++;
            expect(pacNew).toBeLessThan(pacOld);
          }
          expect(pacNew).toBeLessThanOrEqual(pacOld + 1e-9); // none newly over-long
        }
    }
    expect(correctedOverLong).toBeGreaterThan(5); // effect is real & widespread
  });
});

// ---------------------------------------------------------------------------
// 6. Worst-case floor-weight bound (void ×1). At the smallest spirit_max the
//    additive floor carries its LARGEST relative weight — the harshest test of
//    the "no retune" decision. The conclusion holds even stronger: every boss
//    pacNew still converges toward its mult and improves on pacOld.
// ---------------------------------------------------------------------------
describe('#521 — void (×1) worst-case floor-weight bound', () => {
  test('at void, every Late boss still has pacNew ≥ mult and pacNew ≤ pacOld', () => {
    const oldS = oldSpiritMax('Late', 'void'); // 58 — smallest realistic late pool
    const newS = newSpiritMax('Late', 'void'); // 326
    for (const biome of BIOME_ORDER)
      for (const tier of SPIRIT_BOSS_TIERS) {
        const pacOld = computeNpcSpirit(oldS, 'DEFENSIVE', biome, tier) / oldS;
        const pacNew = computeNpcSpirit(newS, 'DEFENSIVE', biome, tier) / newS;
        expect(pacNew).toBeGreaterThanOrEqual(BOSS_SPIRIT_MULT[tier] - 1e-9);
        expect(pacNew).toBeLessThanOrEqual(pacOld + 1e-9);
      }
  });

  test('void volcano/major: the most floor-heavy boss is corrected from 3.41× to 1.43× the player pool', () => {
    const oldS = oldSpiritMax('Late', 'void'); // 58
    const newS = newSpiritMax('Late', 'void'); // 326
    const pacOld = computeNpcSpirit(oldS, 'DEFENSIVE', 'volcano', 'major') / oldS; // 198/58
    const pacNew = computeNpcSpirit(newS, 'DEFENSIVE', 'volcano', 'major') / newS; // 466/326
    expect(pacOld).toBeCloseTo(3.414, 2); // boss pool was 3.4× the player's — oppressive
    expect(pacNew).toBeCloseTo(1.429, 2); // corrected toward the mult=1.0 intent
    expect(pacNew).toBeLessThan(pacOld);
  });
});

// ---------------------------------------------------------------------------
// 7. ADVERSARIAL — Early-tier floor-domination sweep. Section 3's "the ONLY
//    floor-dominated roamer cell" test scopes its sweep to Mid/Late only
//    (Early is skipped there because R=1.00 makes the *ratio* trivial). That
//    skip could hide floor-dominated cells at Early going unexamined entirely
//    — Early has the smallest spiritMax of any band (60 @ seeker), so it is
//    where the biome floors are MOST likely to pin the roamer. Sweep it
//    explicitly rather than assume "ratio=1.00 ⇒ nothing to check".
// ---------------------------------------------------------------------------
describe('#521 adversarial — Early-tier floor-domination sweep (not assumed safe just because R=1.00)', () => {
  test('every non-forest biome is floor-dominated at every personality at Early — only forest is mult-dominated', () => {
    // #521 adversarial: contrasts sharply with the Mid/Late grid (only ONE
    // floor-dominated cell total: Mid/volcano/AGGRESSIVE). At Early, 16 of the
    // 20 (biome × personality) roamer cells are floor-dominated — the floor
    // safety net, not the personality mult, decides the NPC's spirit almost
    // everywhere outside forest. This is expected biome-gating behavior (not a
    // #520/#521 regression, see the next test), but it must be an asserted fact,
    // not an assumption inherited from the Mid/Late-only sweep.
    const S = newSpiritMax('Early', RATIO_DIFFICULTY);
    expect(S).toBe(oldSpiritMax('Early', RATIO_DIFFICULTY)); // R=1.00 at Early
    const floorDominated: string[] = [];
    const multDominated: string[] = [];
    for (const biome of BIOME_ORDER) {
      for (const p of SPIRIT_P) {
        const base = Math.floor(S * SPIRIT_MULT[p]);
        const floor = spiritFloorRef(biome, 'roamer');
        (base >= floor ? multDominated : floorDominated).push(`${biome}/${p}`);
      }
    }
    expect(multDominated.sort()).toEqual(SPIRIT_P.map((p) => `forest/${p}`).sort());
    expect(floorDominated).toHaveLength(BIOME_ORDER.length * SPIRIT_P.length - SPIRIT_P.length);
  });

  test('Early-band npc spirit is EXACTLY unchanged old vs new for every biome/personality/bossTier (R=1.00, no floor()-rounding wobble hiding a drift)', () => {
    // #521 adversarial: at Early, oldSpiritMax === newSpiritMax (Tier-1 rings
    // carry force=1, so #520's force-weighting is a no-op at this tier). Any
    // drift here — even sub-1-unit floor() wobble — would mean the "R is
    // difficulty/band invariant" claim asserted earlier in this file is wrong
    // for the smallest band, which is exactly where a rounding edge case would
    // first surface. Checked across the FULL grid, not just the anchor cells.
    const oldS = oldSpiritMax('Early', RATIO_DIFFICULTY);
    const newS = newSpiritMax('Early', RATIO_DIFFICULTY);
    expect(newS).toBe(oldS);
    for (const biome of BIOME_ORDER) {
      for (const p of SPIRIT_P) {
        expect(computeNpcSpirit(newS, p, biome)).toBe(computeNpcSpirit(oldS, p, biome));
      }
      for (const tier of SPIRIT_BOSS_TIERS) {
        expect(computeNpcSpirit(newS, 'DEFENSIVE', biome, tier)).toBe(
          computeNpcSpirit(oldS, 'DEFENSIVE', biome, tier),
        );
      }
    }
  });

  test(`floor-dominated Early roamers can exceed the player's OWN spirit pool (volcano/RESILIENT: pac≈1.67x) — a pre-existing biome-gating fact, unaffected by #520/#521`, () => {
    // #521 adversarial: in isolation this looks alarming (an NPC roamer with
    // MORE spirit than the player has at all). It is NOT a #520/#521
    // regression — it is bit-for-bit identical old vs new (R=1.00 at Early), so
    // it predates the spirit_max formula change entirely and is a property of
    // the pre-existing biome-gating floors alone. Locking it in as a named,
    // asserted fact prevents a future reader from "fixing" it under this
    // issue's banner (out of scope — this issue only evaluates the #520 delta).
    const S = newSpiritMax('Early', RATIO_DIFFICULTY); // 60
    const npc = computeNpcSpirit(S, 'RESILIENT', 'volcano'); // max(100, floor(60×0.4)=24) = 100
    expect(npc).toBe(100);
    expect(npc / S).toBeCloseTo(1.667, 2);
    expect(computeNpcSpirit(S, 'RESILIENT', 'volcano')).toBe(
      computeNpcSpirit(oldSpiritMax('Early', RATIO_DIFFICULTY), 'RESILIENT', 'volcano'),
    );
  });
});

// ---------------------------------------------------------------------------
// 8. ADVERSARIAL — `pacNew ≥ mult` asymptotic stress test. The boss invariant
//    "a boss never drops below its own designed multiplier-length fight" is
//    asserted only at the three sampled Early/Mid/Late bands elsewhere in this
//    file (largest realistic spiritMax ≈ 1304 @ seeker Late). Because the boss
//    formula is `floor(S×mult) + floor`, the invariant is easy to STATE as
//    "true asymptotically" but that needs checking well past the sampled
//    range, not assumed. computeNpcSpirit takes a raw number — no DB needed to
//    probe synthetic S values far beyond any realistic composition.
// ---------------------------------------------------------------------------
describe('#521 adversarial — pacNew ≥ mult invariant at extreme (well beyond "Late") tiers', () => {
  const EXTREME_S = [10_000, 100_000, 1_000_000, 1_000_000_000];

  test.each(EXTREME_S)(
    'S=%i: every boss matches the exact additive formula, and pacNew never drops below mult',
    (S) => {
      for (const biome of BIOME_ORDER) {
        for (const tier of SPIRIT_BOSS_TIERS) {
          const mult = BOSS_SPIRIT_MULT[tier];
          const floorAddend = BOSS_BONUS[biome][tier];
          const expectedNpc = Math.floor(S * mult) + floorAddend;
          const npc = computeNpcSpirit(S, 'DEFENSIVE', biome, tier);
          expect(npc).toBe(expectedNpc);
          const pac = npc / S;
          expect(pac).toBeGreaterThanOrEqual(mult - 1e-9);
          // Upper bound: floor() can only shave the multiplicative term DOWN,
          // never up, so pac never exceeds mult + floorAddend/S.
          expect(pac).toBeLessThanOrEqual(mult + floorAddend / S + 1e-9);
        }
      }
    },
  );

  test('the gap (pacNew − mult) is monotonically non-increasing as S grows, for every (biome, bossTier) — a genuine asymptotic check, not two endpoints that happen to satisfy the bound', () => {
    // #521 adversarial: confirms "converges asymptotically" holds across the
    // whole extreme range, not just at isolated sampled points. The fixed
    // floorAddend's SHARE of the total pool must shrink monotonically as the
    // player's own pool grows without bound — that IS the "corrective, not
    // destructive" claim this whole issue's decision rests on.
    for (const biome of BIOME_ORDER) {
      for (const tier of SPIRIT_BOSS_TIERS) {
        const mult = BOSS_SPIRIT_MULT[tier];
        const gaps = EXTREME_S.map((S) => computeNpcSpirit(S, 'DEFENSIVE', biome, tier) / S - mult);
        for (let i = 1; i < gaps.length; i++) {
          expect(gaps[i]).toBeLessThanOrEqual(gaps[i - 1] + 1e-9);
        }
      }
    }
  });

  test('at S=1e9 every boss pac is within 1e-6 of its designed mult (practically converged, not just bounded)', () => {
    const S = 1_000_000_000;
    for (const biome of BIOME_ORDER) {
      for (const tier of SPIRIT_BOSS_TIERS) {
        const pac = computeNpcSpirit(S, 'DEFENSIVE', biome, tier) / S;
        expect(pac).toBeCloseTo(BOSS_SPIRIT_MULT[tier], 6);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 9. IMPL-AWARE (#521 Phase 2) — computeNpcSpirit branch-shape guards. The
//    whole #521 "no constant change" decision assumes computeNpcSpirit's
//    CURRENT branch shapes stay exactly as they are: boss = ADDITIVE
//    (base + floor), roamer = MAX (max(base, floor)) — see AILoadout.ts
//    L158-169. Code review flagged that Sections 3/5's grid assertions above
//    are largely algebraic consequences of the formula shape THEY THEMSELVES
//    ENCODE (roamerRef/bossRef mirror the same additive/max split, and the
//    parity test in Section 2 compares against those same mirrors) — a
//    "fix" that flipped one branch's shape and its test-local mirror
//    together would stay internally consistent and could slip through.
//    These tests instead hard-code literal expected integers computed BY
//    HAND directly from the raw formula (not via roamerRef/bossRef, and not
//    via any test-local mirror), at input values deliberately chosen so
//    additive and max() diverge — the only way to pin the branch SHAPE
//    itself, independent of whatever the test's own reference helpers do.
// ---------------------------------------------------------------------------
describe('#521 impl-aware — computeNpcSpirit branch-shape guards (additive boss / max roamer must not be swapped)', () => {
  test('boss path is ADDITIVE (base + floor), not max(base, floor): volcano/major spiritMax=100 -> 240, not 140', () => {
    // #521 adversarial: base=floor(100x1.0)=100, floor=140 (base < floor). A
    // "fix" that changed the boss branch to max(base, floor) — mirroring the
    // roamer branch, which is the exact kind of "simplification" a future PR
    // might make without realizing the shapes are intentionally different —
    // would silently return 140 here instead of 240. Hand-computed, not via
    // bossRef (which would move together with such a regression).
    const result = computeNpcSpirit(100, 'DEFENSIVE', 'volcano', 'major');
    expect(result).toBe(240);
    expect(result).not.toBe(Math.max(100, 140)); // the max()-branch regression value
  });

  test('boss path is ADDITIVE even when the floor exceeds the base term: forest/major spiritMax=10 -> 50, not 40', () => {
    // #521 adversarial: base=floor(10x1.0)=10 < floor=40. Both a max()-shape
    // regression AND a "silently drop the floor" regression would coincide at
    // 40 here (max(10,40)=40, and a bug that only kept the floor would also
    // read 40) — additive is the only shape that produces 50. Complements the
    // previous test (there base > floor; here floor > base), pinning both
    // orderings of the additive terms.
    const result = computeNpcSpirit(10, 'DEFENSIVE', 'forest', 'major');
    expect(result).toBe(50);
    expect(result).not.toBe(40);
  });

  test('boss path is ADDITIVE even when the base term exceeds the floor: forest/gate spiritMax=1000 -> 765, not 750', () => {
    // #521 adversarial: base=floor(1000x0.75)=750, floor=15. A regression that
    // dropped the "+ floor" term entirely (returning base alone — e.g. an
    // accidental `return base;` early-return "cleanup") would give 750;
    // additive gives 765. The complementary base>floor case to the previous
    // test.
    const result = computeNpcSpirit(1000, 'DEFENSIVE', 'forest', 'gate');
    expect(result).toBe(765);
    expect(result).not.toBe(750);
  });

  test('roamer path is MAX (max(base, floor)), not additive: volcano/AGGRESSIVE spiritMax=1000 -> 250, not 350', () => {
    // #521 adversarial: base=floor(1000x0.25)=250 > floor=100. A "fix" that
    // changed the roamer branch to additive (mirroring the boss branch) would
    // silently return 350 here. The entire Section 3 ratio-grid's "drift ~
    // 1.00 once mult-dominated" claim depends on the roamer branch staying
    // max()-shaped so the mult term ALONE determines pacNew once it exceeds
    // the floor — additive would instead keep adding the floor forever and
    // that claim would be false without this test noticing via a shape flip
    // (as opposed to a value retune, which the ratio-grid tests DO catch).
    const result = computeNpcSpirit(1000, 'AGGRESSIVE', 'volcano');
    expect(result).toBe(250);
    expect(result).not.toBe(350); // the additive-branch regression value
  });

  test('roamer path is MAX even when the floor exceeds the base term: volcano/AGGRESSIVE spiritMax=200 -> 100, not 150', () => {
    // #521 adversarial: base=floor(200x0.25)=50 < floor=100. Additive would
    // silently give 150 — the value the "Mid/volcano/AGGRESSIVE is the ONLY
    // floor-dominated roamer cell" test elsewhere in this file implicitly
    // assumes is IMPOSSIBLE under the current max()-shape (a floor-dominated
    // cell under max() returns exactly the floor, 100, never floor+base).
    // Complements the previous test (there base > floor; here floor > base).
    const result = computeNpcSpirit(200, 'AGGRESSIVE', 'volcano');
    expect(result).toBe(100);
    expect(result).not.toBe(150);
  });

  test('the issue worked example (232->372, 1304->1444 for volcano/major) is re-derived straight from BOSS_MODIFIERS/CLASS_OFFSET/REGION_STEP, not through bossRef', () => {
    // #521 adversarial: closes the reviewer's specific gap — bossRef (used by
    // the parity/anchor tests in Sections 2 and 5) encodes the same additive
    // shape as production, so a shape regression in BOTH places at once could
    // theoretically stay self-consistent there. This test reads the raw
    // exported constants directly with no shared helper function at all,
    // giving an independent, hand-assembled oracle for the issue's own
    // headline numbers.
    const majorMult = BOSS_MODIFIERS.major.spiritMult;
    const volcanoMajorFloor = CLASS_OFFSET.major + REGION_STEP * BIOME_ORDER.indexOf('volcano');
    expect(volcanoMajorFloor).toBe(140);
    expect(Math.floor(232 * majorMult) + volcanoMajorFloor).toBe(372);
    expect(Math.floor(1304 * majorMult) + volcanoMajorFloor).toBe(1444);
    expect(computeNpcSpirit(232, 'DEFENSIVE', 'volcano', 'major')).toBe(372);
    expect(computeNpcSpirit(1304, 'DEFENSIVE', 'volcano', 'major')).toBe(1444);
  });
});
