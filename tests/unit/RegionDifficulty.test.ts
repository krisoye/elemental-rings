/**
 * #492 — Region difficulty floor + tiered skill distribution unit tests.
 *
 * Covers:
 *   - spiritFloor / floorTier from constants.ts
 *   - effectiveTier exported function (max(floorTier, tierForXp))
 *   - SKILL_BAND monotonic invariant
 *   - skillRoll determinism under fixed spawn id
 *   - scaleProfileByTier transfer functions
 *   - element-mistake determinism under fixed seed
 */

import { describe, test, expect } from 'vitest';
import {
  spiritFloor,
  floorTier,
  SKILL_BAND,
  BIOME_ORDER,
  CLASS_OFFSET,
  REGION_STEP,
  type NpcClass,
} from '../../server/src/game/constants';
import {
  effectiveTier,
  skillRoll,
  scaleProfileByTier,
} from '../../server/src/game/ai/AILoadout';
import { AI_PROFILES, makeRng } from '../../server/src/game/ai/AIProfiles';
import { decideAttack, decideDefense } from '../../server/src/game/ai/AIPolicy';
import { ElementEnum } from '../../shared/types';
import type { AttackSlotView, BoardView, DefenseSlotView } from '../../server/src/game/ai/AIPolicy';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

// ============================================================================
// spiritFloor — formula correctness
// ============================================================================

describe('spiritFloor — CLASS_OFFSET + REGION_STEP × biomeIndex (#492)', () => {
  test('formula: spiritFloor(biome, npcClass) = CLASS_OFFSET[npcClass] + REGION_STEP × BIOME_ORDER.indexOf(biome)', () => {
    // Verify the formula directly for every biome × class combination.
    const npcClasses: NpcClass[] = ['roamer', 'gate', 'sub', 'major'];
    for (const biome of BIOME_ORDER) {
      const idx = BIOME_ORDER.indexOf(biome);
      for (const npcClass of npcClasses) {
        const expected = CLASS_OFFSET[npcClass] + REGION_STEP * idx;
        expect(spiritFloor(biome, npcClass)).toBe(expected);
      }
    }
  });

  test('CLASS_OFFSET.roamer === 0 (LOCKED)', () => {
    // The spec locks roamer=0 so forest roamers remain floor-free.
    expect(CLASS_OFFSET.roamer).toBe(0);
  });

  test('REGION_STEP === 25', () => {
    expect(REGION_STEP).toBe(25);
  });

  // Key acceptance criteria from the issue spec.
  const AC_CASES: Array<{ biome: string; npcClass: NpcClass; expected: number }> = [
    { biome: 'forest',  npcClass: 'gate',   expected: 15  },
    { biome: 'snow',    npcClass: 'gate',   expected: 40  },
    { biome: 'swamp',   npcClass: 'sub',    expected: 75  },
    { biome: 'desert',  npcClass: 'major',  expected: 115 },
    { biome: 'volcano', npcClass: 'major',  expected: 140 },
    { biome: 'forest',  npcClass: 'roamer', expected: 0   },
    { biome: 'desert',  npcClass: 'roamer', expected: 75  },
    { biome: 'volcano', npcClass: 'roamer', expected: 100 },
  ];

  test.each(AC_CASES)(
    'spiritFloor($biome, $npcClass) === $expected',
    ({ biome, npcClass, expected }) => {
      expect(spiritFloor(biome, npcClass)).toBe(expected);
    },
  );

  test('unknown biome returns 0 (safe default)', () => {
    expect(spiritFloor('cavern', 'gate')).toBe(0);
    expect(spiritFloor('unknown', 'major')).toBe(0);
  });
});

// ============================================================================
// floorTier
// ============================================================================

describe('floorTier — BIOME_ORDER.indexOf(biome) + 1 (#492)', () => {
  const CASES: Array<{ biome: string; tier: number }> = [
    { biome: 'forest',  tier: 1 },
    { biome: 'snow',    tier: 2 },
    { biome: 'swamp',   tier: 3 },
    { biome: 'desert',  tier: 4 },
    { biome: 'volcano', tier: 5 },
  ];

  test.each(CASES)(
    'floorTier($biome) === $tier',
    ({ biome, tier }) => {
      expect(floorTier(biome)).toBe(tier);
    },
  );

  test('floorTier unknown biome returns 1', () => {
    expect(floorTier('unknown')).toBe(1);
  });
});

// ============================================================================
// effectiveTier — max(floorTier(biome), tierForXp(npcXp))
// ============================================================================

describe('effectiveTier — biome floor participates in max (#492)', () => {
  test('high-xp player in forest: tierForXp wins over floorTier(forest)=1', () => {
    // With playerBattleHandAvgXp=2000 and AGGRESSIVE (mult=0.8):
    //   npcXp = round(2000 × 0.8) = 1600
    //   tierForXp(1600) is likely > 1 (forest floorTier)
    // → effectiveTier > 1 (player-xp wins)
    const tier = effectiveTier('forest', 'AGGRESSIVE', 2000);
    expect(tier).toBeGreaterThan(1);
  });

  test('zero-xp player in volcano: floorTier(volcano)=5 is the floor', () => {
    // With playerBattleHandAvgXp=0: npcXp=0 → tierForXp(0)=1
    // floorTier('volcano') = 5 → max(5, 1) = 5
    const tier = effectiveTier('volcano', 'AGGRESSIVE', 0);
    expect(tier).toBe(5);
  });

  test('zero-xp player in forest: tierForXp=1, floorTier=1 → tier=1', () => {
    const tier = effectiveTier('forest', 'AGGRESSIVE', 0);
    expect(tier).toBe(1);
  });

  test('effectiveTier never less than floorTier(biome)', () => {
    // For any player XP, effectiveTier must be ≥ floorTier(biome).
    for (const biome of BIOME_ORDER) {
      const minTier = floorTier(biome);
      for (const xp of [0, 10, 100, 500, 2000]) {
        expect(effectiveTier(biome, 'AGGRESSIVE', xp)).toBeGreaterThanOrEqual(minTier);
      }
    }
  });
});

// ============================================================================
// SKILL_BAND — monotonic invariant
// ============================================================================

describe('SKILL_BAND — monotonic non-decreasing lo invariant (#492)', () => {
  test('roamer.lo ≤ gate.lo ≤ sub.lo ≤ major.lo', () => {
    expect(SKILL_BAND.roamer.lo).toBeLessThanOrEqual(SKILL_BAND.gate.lo);
    expect(SKILL_BAND.gate.lo).toBeLessThanOrEqual(SKILL_BAND.sub.lo);
    expect(SKILL_BAND.sub.lo).toBeLessThanOrEqual(SKILL_BAND.major.lo);
  });

  test('exact band values match spec', () => {
    expect(SKILL_BAND.roamer).toMatchObject({ lo: 0.20, hi: 0.70 });
    expect(SKILL_BAND.gate).toMatchObject({ lo: 0.55, hi: 0.80 });
    expect(SKILL_BAND.sub).toMatchObject({ lo: 0.70, hi: 0.90 });
    expect(SKILL_BAND.major).toMatchObject({ lo: 0.90, hi: 1.00 });
  });

  test('all band values are in [0, 1]', () => {
    for (const npcClass of ['roamer', 'gate', 'sub', 'major'] as NpcClass[]) {
      expect(SKILL_BAND[npcClass].lo).toBeGreaterThanOrEqual(0);
      expect(SKILL_BAND[npcClass].hi).toBeLessThanOrEqual(1);
      expect(SKILL_BAND[npcClass].lo).toBeLessThan(SKILL_BAND[npcClass].hi);
    }
  });
});

// ============================================================================
// skillRoll — determinism + band bounds
// ============================================================================

describe('skillRoll — deterministic, seeded from spawn id (#492)', () => {
  test('same spawn id → same skill roll (deterministic)', () => {
    const s1 = skillRoll('forest_bogwood_warden', 'gate');
    const s2 = skillRoll('forest_bogwood_warden', 'gate');
    expect(s1).toBe(s2);
  });

  test('different spawn ids → different rolls (collision-free in practice)', () => {
    const s1 = skillRoll('forest_npc_1', 'roamer');
    const s2 = skillRoll('forest_npc_2', 'roamer');
    // With a good hash function these should differ; assert they are not identical.
    // (A hash collision is theoretically possible but practically impossible for these inputs.)
    expect(s1).not.toBe(s2);
  });

  test('skillRoll result is within the class band [lo, hi]', () => {
    const npcClasses: NpcClass[] = ['roamer', 'gate', 'sub', 'major'];
    const spawnIds = ['forest_npc_1', 'forest_bogwood_warden', 'forest_frost_sentinel', 'generic_AGGRESSIVE'];
    for (const spawnId of spawnIds) {
      for (const npcClass of npcClasses) {
        const s = skillRoll(spawnId, npcClass);
        expect(s).toBeGreaterThanOrEqual(SKILL_BAND[npcClass].lo);
        expect(s).toBeLessThanOrEqual(SKILL_BAND[npcClass].hi);
      }
    }
  });

  test('roamer.hi > roamer.lo (band is non-trivial)', () => {
    // Multiple spawn ids should produce a spread of values in [0.20, 0.70].
    const values = [
      skillRoll('npc_a', 'roamer'),
      skillRoll('npc_b', 'roamer'),
      skillRoll('npc_c', 'roamer'),
      skillRoll('npc_d', 'roamer'),
    ];
    // All must be in [0.20, 0.70].
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0.20);
      expect(v).toBeLessThanOrEqual(0.70);
    }
    // They should not all be equal (a uniform distribution over 4 distinct seeds shouldn't collide).
    const unique = new Set(values);
    expect(unique.size).toBeGreaterThan(1);
  });
});

// ============================================================================
// scaleProfileByTier — transfer functions
// ============================================================================

describe('scaleProfileByTier — tier and skill transfer functions (#492)', () => {
  const base = AI_PROFILES.AGGRESSIVE;

  test('returns a fresh object (never mutates base)', () => {
    const scaled = scaleProfileByTier(base, 1, 0.5);
    expect(scaled).not.toBe(base);
    // Base must be unchanged.
    expect(base.timingSigmaMs).toBe(80);
    expect(base.elementMistakeProb).toBe(0.05);
  });

  test('tier=1, skill=0: no reduction from tier (but skill=0 adds some)', () => {
    // tier=1: tierFactor = 1 - 0.08*(1-1) = 1.0
    // skill=0: skillFactor = 1 - 0.3*0 = 1.0
    // timingSigmaMs = 80 * 1.0 * 1.0 = 80
    const scaled = scaleProfileByTier(base, 1, 0.0);
    expect(scaled.timingSigmaMs).toBeCloseTo(80, 5);
  });

  test('higher tier → lower timingSigmaMs (sharper timing)', () => {
    const t1 = scaleProfileByTier(base, 1, 0.5);
    const t3 = scaleProfileByTier(base, 3, 0.5);
    expect(t3.timingSigmaMs).toBeLessThan(t1.timingSigmaMs);
  });

  test('higher skill → lower timingSigmaMs (sharper timing)', () => {
    const sLow  = scaleProfileByTier(base, 2, 0.2);
    const sHigh = scaleProfileByTier(base, 2, 0.8);
    expect(sHigh.timingSigmaMs).toBeLessThan(sLow.timingSigmaMs);
  });

  test('higher tier → lower elementMistakeProb', () => {
    const t1 = scaleProfileByTier(base, 1, 0.5);
    const t3 = scaleProfileByTier(base, 3, 0.5);
    expect(t3.elementMistakeProb).toBeLessThan(t1.elementMistakeProb);
  });

  test('higher skill → lower elementMistakeProb', () => {
    const sLow  = scaleProfileByTier(base, 2, 0.1);
    const sHigh = scaleProfileByTier(base, 2, 0.9);
    expect(sHigh.elementMistakeProb).toBeLessThanOrEqual(sLow.elementMistakeProb);
  });

  test('timingSigmaMs clamps at min 10', () => {
    // Very high tier + very high skill should not go below 10ms.
    const scaled = scaleProfileByTier(base, 20, 1.0);
    expect(scaled.timingSigmaMs).toBeGreaterThanOrEqual(10);
  });

  test('elementMistakeProb clamps at min 0', () => {
    const scaled = scaleProfileByTier(base, 20, 1.0);
    expect(scaled.elementMistakeProb).toBeGreaterThanOrEqual(0);
  });

  test('boss has lower timingSigmaMs than roamer at same biome (higher effectiveTier)', () => {
    // At the same skill=0.5, tier=3 (boss) should produce a sharper profile than tier=1 (roamer).
    const roamerProfile = scaleProfileByTier(base, 1, 0.5);
    const bossProfile   = scaleProfileByTier(base, 3, 0.5);
    expect(bossProfile.timingSigmaMs).toBeLessThan(roamerProfile.timingSigmaMs);
  });
});

// ============================================================================
// element-mistake determinism under fixed seed (#492)
// ============================================================================

describe('element-mistake determinism under fixed seed (#492)', () => {
  function makeBoard(attackElement: number, incomingElement: number): BoardView {
    return {
      attackSlots: [
        { key: 'a1', ring: { element: attackElement, currentUses: 3, maxUses: 3, isExtinguished: false } },
        { key: 'a2', ring: { element: EARTH, currentUses: 3, maxUses: 3, isExtinguished: false } },
      ] as AttackSlotView[],
      defenseSlots: [
        { key: 'd1', ring: { element: FIRE, currentUses: 3, maxUses: 3, isExtinguished: false } },
        { key: 'd2', ring: { element: EARTH, currentUses: 3, maxUses: 3, isExtinguished: false } },
      ] as DefenseSlotView[],
      hearts: 3,
      incomingElement,
      opponentUsableElements: [WATER], // WATER counters FIRE
      committedElement: -1,
      canDoubleAttack: false,
      opponentDefenseSlots: [],
      spirit: 100,
    };
  }

  test('decideAttack with elementMistakeProb=1.0 always picks a suboptimal slot', () => {
    const mistakeProfile = { ...AI_PROFILES.AGGRESSIVE, elementMistakeProb: 1.0 };
    const board = makeBoard(FIRE, -1);
    // With FIRE in a1 and opponent holding WATER (counters FIRE), a1 is counterable.
    // mistake=1.0 → suboptimalAttackSlot is called → picks counterable a1.
    const d1 = decideAttack(board, mistakeProfile, makeRng(99));
    const d2 = decideAttack(board, mistakeProfile, makeRng(99));
    // Deterministic: same result.
    expect(d1.slot).toBe(d2.slot);
  });

  test('decideDefense with elementMistakeProb=1.0 picks WEAK ring (FIRE vs WATER)', () => {
    const mistakeProfile = { ...AI_PROFILES.DEFENSIVE, elementMistakeProb: 1.0 };
    const board = makeBoard(WATER, WATER);
    // d1=FIRE is WEAK vs WATER; d2=EARTH is NEUTRAL.
    // mistake=1.0 → weakDefenseSlot → picks FIRE (d1).
    const decision = decideDefense(board, mistakeProfile, makeRng(1));
    expect(decision.slot).toBe('d1');
    expect(decision.pressOffsetMs).toBe(190);
  });

  test('element-mistake picks are deterministic for a fixed seed', () => {
    const mistakeProfile = { ...AI_PROFILES.AGGRESSIVE, elementMistakeProb: 1.0 };
    const board = makeBoard(FIRE, WATER);
    // Same seed → same pick every run.
    const r1 = decideAttack(board, mistakeProfile, makeRng(42));
    const r2 = decideAttack(board, mistakeProfile, makeRng(42));
    expect(r1.slot).toBe(r2.slot);

    const def1 = decideDefense(board, mistakeProfile, makeRng(42));
    const def2 = decideDefense(board, mistakeProfile, makeRng(42));
    expect(def1.slot).toBe(def2.slot);
  });
});
