import { describe, test, expect, beforeAll } from 'vitest';
import {
  generateAILoadout,
  npcEffectiveXp,
  previewOpponent,
} from '../../server/src/game/ai/AILoadout';
import { makeRng } from '../../server/src/game/ai/AIProfiles';
import { tierForXp, naturalMaxUses } from '../../server/src/game/Tiers';
import type { AIPersonality } from '../../shared/types';

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
// computeNpcSpirit (#478) — roamer + boss spirit preview helper
// ============================================================================
//
// computeNpcSpirit is extracted from the BattleRoom.onJoin inline formula and
// exported from AILoadout.ts. It is the single source of truth for NPC spirit
// pool computation used by both BattleRoom and GET /api/overworld/npcs.
//
// Roamer path: floor(playerSpiritMax × PERSONALITY_SPIRIT_MULT[personality])
// Boss path:   floor(playerSpiritMax × BOSS_MODIFIERS[bossTier].spiritMult)
//              + BIOME_BOSS_SPIRIT_BONUS[biome][bossTier]
//
// Mirror of PERSONALITY_SPIRIT_MULT from AILoadout.ts — a drift here breaks tests:
//   AGGRESSIVE: 0.25, DEFENSIVE: 0.30, STATUS_HUNTER: 0.35, RESILIENT: 0.40
//
// Mirror of BOSS_MODIFIERS.spiritMult from constants.ts:
//   gate: 0.75, sub: 0.60, major: 1.0
//
// Mirror of BIOME_BOSS_SPIRIT_BONUS from constants.ts:
//   forest: { gate: 15, sub: 25, major: 40 }
//   snow:   { gate: 40, sub: 50, major: 65 }
//   swamp:  { gate: 65, sub: 75, major: 90 }
//   desert: { gate: 90, sub: 100, major: 115 }

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

const BOSS_BONUS: Record<string, Record<string, number>> = {
  forest: { gate: 15,  sub: 25,  major: 40  },
  snow:   { gate: 40,  sub: 50,  major: 65  },
  swamp:  { gate: 65,  sub: 75,  major: 90  },
  desert: { gate: 90,  sub: 100, major: 115 },
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

  test('unknown biome with valid bossTier returns base only (no bonus, no crash)', () => {
    // #478 adversarial: a newly-authored biome not yet in BIOME_BOSS_SPIRIT_BONUS
    // must not crash. The ?. + ?? 0 fallback must produce 0 bonus.
    // biome='volcano' not in the table → bonus = 0 → result = base only.
    const spiritMax = 100;
    const result = computeNpcSpirit(spiritMax, 'DEFENSIVE' as AIPersonality, 'volcano', 'gate');
    // base: floor(100 × 0.75) = 75; bonus: 0 (unknown biome)
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

  test('AC: boss path adds BIOME_BOSS_SPIRIT_BONUS AFTER the floor', () => {
    // Spec §Design: "floor applied to the base before the bonus is added — this
    // matches the existing inline behavior exactly (floor(playerSpiritMax × mult) + bonus)."
    // Test: forest/gate, spiritMax=100 → floor(100×0.75) + 15 = 75 + 15 = 90.
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
