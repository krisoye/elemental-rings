import { describe, test, expect } from 'vitest';
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
