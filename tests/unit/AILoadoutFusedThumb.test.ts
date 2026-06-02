/**
 * #257 — fused-thumb AI loadouts. A boss stakes its thematic FUSION on the thumb;
 * generateAILoadout must route a FUSION `thumbElement` to a fused-thumb loadout
 * (FUSED_THUMB_TEMPLATES) instead of falling through the base-template filter to a
 * random base stake (the bug this fixes).
 *
 * The fused thumb keeps `isFusion`-relevant element values; the four combat slots
 * stay BASE elements (the setup passive only fires for Fire/Water/Wood THUMBS, so a
 * fusion thumb never disturbs the combat hand).
 */
import { describe, test, expect } from 'vitest';
import { generateAILoadout } from '../../server/src/game/ai/AILoadout';
import { makeRng } from '../../server/src/game/ai/AIProfiles';
import { isFusion, componentsOf } from '../../server/src/game/Fusions';
import { ElementEnum } from '../../shared/types';

const { WATER, EARTH, WIND, WOOD } = ElementEnum;
const SEED = 0xabcdef;

describe('generateAILoadout fused-thumb routing (#257)', () => {
  // EPIC #268 — A1/A2 = the fusion's two components (componentsOf), so the boss
  // satisfies canDoubleAttack. THORNADO = Wood+Wind, MUD = Water+Earth,
  // BLOOM = Wood+Earth.
  const cases: Array<{ thumb: number; a1: number; a2: number; d1: number; d2: number }> = [
    { thumb: ElementEnum.THORNADO, a1: WIND, a2: WOOD, d1: WOOD, d2: EARTH },
    { thumb: ElementEnum.MUD, a1: WATER, a2: EARTH, d1: WATER, d2: EARTH },
    { thumb: ElementEnum.BLOOM, a1: WOOD, a2: EARTH, d1: WOOD, d2: EARTH },
  ];

  for (const c of cases) {
    test(`${ElementEnum[c.thumb]} thumb stakes the fusion with its curated base hand`, () => {
      const loadout = generateAILoadout(
        'RESILIENT',
        makeRng(SEED),
        undefined,
        undefined,
        undefined,
        c.thumb,
      );
      // Thumb is the FUSION itself, not a base fallback.
      expect(loadout.thumb!.element).toBe(c.thumb);
      expect(isFusion(loadout.thumb!.element)).toBe(true);
      // Combat hand is the curated base ring set (all base elements).
      expect(loadout.a1!.element).toBe(c.a1);
      expect(loadout.a2!.element).toBe(c.a2);
      expect(loadout.d1!.element).toBe(c.d1);
      expect(loadout.d2!.element).toBe(c.d2);
      for (const slot of ['a1', 'a2', 'd1', 'd2'] as const) {
        expect(isFusion(loadout[slot]!.element)).toBe(false);
      }
      // EPIC #268 — A1/A2 must equal the fusion's two components (unordered) so the
      // boss satisfies canDoubleAttack and can fire its signature double attack.
      const aSlots = [loadout.a1!.element, loadout.a2!.element].sort();
      const comps = componentsOf(c.thumb).sort();
      expect(aSlots).toEqual(comps);
    });
  }

  test('a fusion thumb does NOT fall back to a base template (regression for the #257 filter bug)', () => {
    // Across every personality and seed, a fusion thumbElement always yields a
    // fusion thumb — never a base element from TEMPLATES.
    const personalities = ['AGGRESSIVE', 'DEFENSIVE', 'STATUS_HUNTER', 'RESILIENT'] as const;
    for (const p of personalities) {
      for (let seed = 1; seed <= 20; seed++) {
        const loadout = generateAILoadout(
          p,
          makeRng(seed),
          undefined,
          undefined,
          undefined,
          ElementEnum.MUD,
        );
        expect(loadout.thumb!.element).toBe(ElementEnum.MUD);
        expect(isFusion(loadout.thumb!.element)).toBe(true);
      }
    }
  });

  test('an unmapped fusion thumb still stakes the fusion with a safe default hand', () => {
    // STEAM has no curated boss template → FUSED_THUMB_DEFAULT (Wind/Earth).
    const loadout = generateAILoadout(
      'AGGRESSIVE',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      ElementEnum.STEAM,
    );
    expect(loadout.thumb!.element).toBe(ElementEnum.STEAM);
    expect(loadout.a1!.element).toBe(WIND);
    expect(loadout.a2!.element).toBe(WIND);
    expect(loadout.d1!.element).toBe(EARTH);
    expect(loadout.d2!.element).toBe(EARTH);
  });

  test('a BASE thumbElement is unaffected (existing #199 base-template filter)', () => {
    // WIND thumb → AGGRESSIVE Wind-Aggressor template (thumb WIND).
    const loadout = generateAILoadout(
      'AGGRESSIVE',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      WIND,
    );
    expect(loadout.thumb!.element).toBe(WIND);
    expect(isFusion(loadout.thumb!.element)).toBe(false);
  });

  test('the fused thumb scales tier/uses with the player battle-hand average like base thumbs', () => {
    // A large battle-hand average lifts the whole loadout's tier; the fusion thumb
    // and its base combat rings share the scaled tier/uses.
    const battleHandAvgXp = 2000;
    const loadout = generateAILoadout(
      'RESILIENT',
      makeRng(SEED),
      undefined,
      undefined,
      undefined,
      ElementEnum.THORNADO,
      battleHandAvgXp,
    );
    const tier = loadout.thumb!.tier;
    expect(tier).toBeGreaterThan(0);
    for (const slot of ['a1', 'a2', 'd1', 'd2'] as const) {
      expect(loadout[slot]!.tier).toBe(tier);
    }
  });
});
