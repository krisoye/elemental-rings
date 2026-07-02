import { describe, test, expect } from 'vitest';
import { classifyTiming, resolveBlock } from '../../server/src/game/BlockResolver';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';
import { fusionParents } from '../../server/src/game/ElementSystem';
import { tierStartXp } from '../../server/src/game/Tiers';

const { FIRE, WATER, EARTH, WIND, WOOD, TIDAL, STEAM } = ElementEnum;

function makeRing(element: number, uses: number, xp = 0): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = uses;
  r.maxUses = uses;
  r.xp = xp;
  r.isExtinguished = false;
  const parents = fusionParents(element);
  if (parents) {
    r.isFusion = true;
    r.fusionParents.push(parents[0], parents[1]);
  }
  return r;
}

describe('classifyTiming', () => {
  test('not pressed → NO_BLOCK', () => expect(classifyTiming(0, false)).toBe('NO_BLOCK'));
  test('pressed at 0 → PARRY', () => expect(classifyTiming(0, true)).toBe('PARRY'));
  test('pressed at +70 → PARRY boundary', () => expect(classifyTiming(70, true)).toBe('PARRY'));
  test('pressed at +71 → BLOCK', () => expect(classifyTiming(71, true)).toBe('BLOCK'));
  test('pressed at +180 → BLOCK boundary', () => expect(classifyTiming(180, true)).toBe('BLOCK'));
  test('pressed at +181 → MISTIME', () => expect(classifyTiming(181, true)).toBe('MISTIME'));
});

// Compound model (GDD §3.4, §7.1): a ring resolves as ONE element, never
// decomposed per component. A fusion attack costs exactly 1 heart.
describe('resolveBlock — NO_BLOCK / MISTIME (uncontested hit)', () => {
  test('base FIRE no-block → 1 heart, hitGaugeElements [FIRE], blockGaugeDeltas empty, ring untouched', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([FIRE]);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(def.currentUses).toBe(3); // never committed
  });

  test('fused STEAM no-block → 1 heart, hitGaugeElements [FIRE, WATER], blockGaugeDeltas empty', () => {
    const r = resolveBlock(makeRing(STEAM, 3), makeRing(WATER, 3), 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([FIRE, WATER]);
    expect(r.blockGaugeDeltas).toEqual([]);
  });

  test('MISTIME → 1 heart, gauge, defender ring −1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([FIRE]);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('MISTIME with 1 use → extinguished', () => {
    const def = makeRing(WATER, 1);
    resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });
});

describe('resolveBlock — NEUTRAL block (case 2 gauge)', () => {
  test('Tier 0 base WATER blocks WIND (NEUTRAL) → blockGaugeDeltas [{WATER, 1.0}], no heart, −1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('Tier 0 same-element block (FIRE vs FIRE NEUTRAL) → blockGaugeDeltas [{FIRE, 1.0}]', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
  });

  test('Tier-2 STEAM defender NEUTRAL block → [{FIRE, 0.5}, {WATER, 0.5}] (full rate per parent)', () => {
    // Steam vs Steam attacker is fused-vs-fused → NEUTRAL. tierForXp(1500)=2 →
    // force = forceFromTier1(3) = 2 → delta 1/2 = 0.5.
    const def = makeRing(STEAM, 3, tierStartXp(2));
    const r = resolveBlock(makeRing(STEAM, 3), def, 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([
      { element: FIRE, delta: 0.5 },
      { element: WATER, delta: 0.5 },
    ]);
  });

  test('Wind/Earth defender NEUTRAL catch → blockGaugeDeltas empty (no tracked component)', () => {
    // Earth defense is always NEUTRAL and carries no tracked component.
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(EARTH, 3), 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([]);
  });
});

describe('resolveBlock — STRONG block (case 2 + case 3)', () => {
  test('WATER strong-blocks FIRE → blockGaugeDeltas [{WATER, 1.0}], blockedGaugeElement [FIRE], no heart', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([FIRE]);
    expect(r.clearAllGauges).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('WOOD strong-blocks WATER → blockGaugeDeltas [{WOOD, 1.0}], blockedGaugeElement [WATER]', () => {
    const r = resolveBlock(makeRing(WATER, 3), makeRing(WOOD, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: WOOD, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([WATER]);
  });

  test('FIRE strong-blocks WOOD → blockedGaugeElement decrements BOTH wood and shadow (#134)', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
    expect(r.blockedGaugeElement.sort()).toEqual([WOOD, ElementEnum.SHADOW].sort());
  });
});

describe('resolveBlock — STRONG parry (case 4) + WEAK catch', () => {
  test('STRONG parry (WATER parries FIRE) → rally, clearAllGauges, volley = WATER, no heart', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.relationship).toBe('STRONG');
    expect(r.rallyContinues).toBe(true);
    expect(r.clearAllGauges).toBe(true);
    expect(r.volleyedElement).toBe(WATER);
    expect(r.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('NEUTRAL parry does NOT clear gauges, but fills the block gauge (case 2)', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'PARRY');
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
  });

  test('WEAK catch (WOOD blocks FIRE) → 1 heart, no gauge movement, −1 use', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('WEAK parry → 1 heart, no rally, no gauge', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WOOD, 3), 'PARRY');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.rallyContinues).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([]);
  });

  test('Wind defense is always WEAK even on a perfect parry', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WIND, 3), 'PARRY');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.rallyContinues).toBe(false);
  });

  test('Earth defense is always NEUTRAL — safe, never rallies', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(EARTH, 3), 'PARRY');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Regression / adversarial tests — QA pass (post-implementation, post-E2E).
// These lock in spec-level guarantees that the happy-path suites above exercise
// only implicitly, and probe edge cases that would be silent in E2E scenarios.
// ---------------------------------------------------------------------------

describe('resolveBlock — use-spend asymmetry (C5 adversarial)', () => {
  // Spec (C5): MISTIME burns exactly 1 DEFENDER use; NO_BLOCK burns 0 on both sides.
  // The attacker never has uses deducted by resolveBlock — that is the game's
  // responsibility after the exchange (spend on attack-fire, not on landing).

  test('MISTIME burns exactly 1 defender use, never touches attacker uses', () => {
    const atk = makeRing(FIRE, 3);
    const def = makeRing(WATER, 3);
    resolveBlock(atk, def, 'MISTIME');
    expect(def.currentUses).toBe(2);
    // Attacker uses are untouched by the resolver — the caller manages attack-fire cost.
    expect(atk.currentUses).toBe(3);
  });

  test('NO_BLOCK burns 0 uses on both attacker and defender', () => {
    const atk = makeRing(FIRE, 3);
    const def = makeRing(WATER, 3);
    resolveBlock(atk, def, 'NO_BLOCK');
    expect(atk.currentUses).toBe(3); // attacker untouched
    expect(def.currentUses).toBe(3); // defender never committed a ring — untouched
  });

  test('MISTIME with 2 uses burns to 1, NOT extinguished', () => {
    const def = makeRing(WATER, 2);
    resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(def.currentUses).toBe(1);
    expect(def.isExtinguished).toBe(false);
  });
});

describe('resolveBlock — STRONG+BLOCK simultaneous case-2 AND case-3 (C5 adversarial)', () => {
  // Spec (C5): STRONG + BLOCK produces BOTH the case-2 blockGaugeDeltas AND the
  // case-3 blockedGaugeElement in the SAME BlockResult. These must co-exist, not
  // replace each other. This test uses FIRE strong-blocking WOOD so that the
  // STRONG_BLOCK_DECREMENT table produces two entries (WOOD and SHADOW) — the
  // hardest case because the spec says Fire beats BOTH Wood and Shadow simultaneously.

  test('FIRE strong-blocks WOOD → blockGaugeDeltas [FIRE] AND blockedGaugeElement [WOOD, SHADOW] simultaneously', () => {
    // WOOD attacks (FIRE is its weak element); FIRE defends → FIRE is STRONG vs WOOD.
    const def = makeRing(FIRE, 3); // Tier 0, delta = 1/2^0 = 1.0
    const r = resolveBlock(makeRing(WOOD, 3), def, 'BLOCK');
    // Both structures must be populated at once — neither replaces the other.
    expect(r.relationship).toBe('STRONG');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
    expect(r.blockedGaugeElement.sort()).toEqual([ElementEnum.WOOD, ElementEnum.SHADOW].sort());
    // And rally does NOT trigger on a BLOCK (only PARRY triggers rally).
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
  });

  test('WOOD strong-blocks WATER → case-2 delta [{WOOD,1.0}] AND case-3 decrement [WATER]', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(WATER, 3), def, 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: WOOD, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([WATER]);
  });
});

describe('resolveBlock — WEAK catch invariants (C5 adversarial)', () => {
  // Spec (C5): a WEAK catch → defenderHeartLost=true, blockGaugeDeltas=[], rallyContinues=false.
  // All three must hold on BOTH BLOCK and PARRY timing for a weak pair.

  test('PARRY timing on a WEAK pair → heart lost, no gauge, no rally, no clearAllGauges', () => {
    // FIRE attacks WOOD — WOOD is WEAK to FIRE in the triangle.
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
  });
});

describe('resolveBlock — fractional force deltas (C5/C6 regression, re-derived #512)', () => {
  // #512 mandates delta = 1/force(defender.xp) per tracked parent.
  // Tier-1 base ring → force 2 → delta 0.5 (unchanged from the old 1/2^tier
  // formula, since force(T1)=2=2^1). Tier-2 Steam → force 2 → each parent
  // delta 0.5 (changed from the old 1/2^tier value of 0.25, since
  // force(T2)=2 != 2^2=4).
  // The Tier-2 Steam case is already in the NEUTRAL block suite above; this
  // suite adds Tier-1 base and Tier-2 STEAM strong-block to complete the tier
  // ladder and lock in the formula.

  test('Tier-1 WATER base neutral block → blockGaugeDeltas [{WATER, 0.5}]', () => {
    // Tier 1 starts at 500 XP; tierForXp=1 → force = forceFromTier1(2) = 2 → delta 0.5.
    const def = makeRing(WATER, 3, tierStartXp(1));
    // WIND attack vs WATER defense → NEUTRAL (Wind is always neutral).
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 0.5 }]);
  });

  test('Tier-2 STEAM strong-blocks WOOD → case-2 [{FIRE,0.5},{WATER,0.5}] AND case-3 [WOOD,SHADOW]', () => {
    // WOOD attack vs STEAM defense: STEAM has FIRE+WATER parents. FIRE strongly
    // beats Wood (fusionBeats), so the defense is STRONG. tierForXp(1500)=2 →
    // force = forceFromTier1(3) = 2 → delta 0.5 each.
    // Case 3: FIRE beats WOOD → WOOD+SHADOW decremented.
    const def = makeRing(STEAM, 3, tierStartXp(2));
    const r = resolveBlock(makeRing(WOOD, 3), def, 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([
      { element: FIRE, delta: 0.5 },
      { element: WATER, delta: 0.5 },
    ]);
    expect(r.blockedGaugeElement.sort()).toEqual([ElementEnum.WOOD, ElementEnum.SHADOW].sort());
    expect(r.defenderHeartLost).toBe(false);
  });
});

// A fusion ring is a single compound element: 1 heart per use, no per-component
// heart loss, fused-vs-fused is always NEUTRAL.
describe('resolveBlock — compound fusion behaviour', () => {
  test('fused TIDAL attack on a no-block → exactly 1 heart, gauges [WATER, WOOD]', () => {
    const r = resolveBlock(makeRing(TIDAL, 3), null, 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([WATER, WOOD]);
  });

  test('fused-vs-fused (STEAM atk vs TIDAL def) BLOCK → NEUTRAL, 1 use, block gauge fills', () => {
    const def = makeRing(TIDAL, 3);
    const r = resolveBlock(makeRing(STEAM, 3), def, 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartLost).toBe(false);
    // TIDAL = Water+Wood, both tracked → two full-rate entries at Tier 0.
    expect(r.blockGaugeDeltas).toEqual([
      { element: WATER, delta: 1.0 },
      { element: WOOD, delta: 1.0 },
    ]);
    expect(def.currentUses).toBe(2);
  });

  test('fused-vs-fused on a no-block → 1 heart, both attacker tracked gauges fill', () => {
    const r = resolveBlock(makeRing(STEAM, 3), makeRing(TIDAL, 3), 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([FIRE, WATER]);
  });

  test('attacker ring extinguishes when uses already at 0', () => {
    const atk = makeRing(FIRE, 0);
    atk.isExtinguished = false;
    resolveBlock(atk, makeRing(WATER, 3), 'BLOCK');
    expect(atk.isExtinguished).toBe(true);
  });
});
