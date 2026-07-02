import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { classifyTiming, resolveBlock } from '../../server/src/game/BlockResolver';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';
import { fusionParents } from '../../server/src/game/ElementSystem';
import { tierStartXp, force } from '../../server/src/game/Tiers';

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
    const r = resolveBlock(makeRing(FIRE, 3), def, 'NO_BLOCK', 1);
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.hitGaugeElements).toEqual([FIRE]);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(def.currentUses).toBe(3); // never committed
  });

  test('fused STEAM no-block → 1 heart, hitGaugeElements [FIRE, WATER], blockGaugeDeltas empty', () => {
    const r = resolveBlock(makeRing(STEAM, 3), makeRing(WATER, 3), 'NO_BLOCK', 1);
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.hitGaugeElements).toEqual([FIRE, WATER]);
    expect(r.blockGaugeDeltas).toEqual([]);
  });

  test('MISTIME → 1 heart, gauge, defender ring −1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'MISTIME', 1);
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.hitGaugeElements).toEqual([FIRE]);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('MISTIME with 1 use → extinguished', () => {
    const def = makeRing(WATER, 1);
    resolveBlock(makeRing(FIRE, 3), def, 'MISTIME', 1);
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });
});

describe('resolveBlock — NEUTRAL block (case 2 gauge)', () => {
  test('Tier 0 base WATER blocks WIND (NEUTRAL) → blockGaugeDeltas [{WATER, 1.0}], no heart, −1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartsLost).toBe(0);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('Tier 0 same-element block (FIRE vs FIRE NEUTRAL) → blockGaugeDeltas [{FIRE, 1.0}]', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
  });

  test('Tier-2 STEAM defender NEUTRAL block → [{FIRE, 0.5}, {WATER, 0.5}] (full rate per parent)', () => {
    // Steam vs Steam attacker is fused-vs-fused → NEUTRAL. tierForXp(1500)=2 →
    // force = forceFromTier1(3) = 2 → delta 1/2 = 0.5.
    const def = makeRing(STEAM, 3, tierStartXp(2));
    const r = resolveBlock(makeRing(STEAM, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([
      { element: FIRE, delta: 0.5 },
      { element: WATER, delta: 0.5 },
    ]);
  });

  test('Wind/Earth defender NEUTRAL catch → blockGaugeDeltas empty (no tracked component)', () => {
    // Earth defense is always NEUTRAL and carries no tracked component.
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(EARTH, 3), 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([]);
  });
});

describe('resolveBlock — STRONG block (case 2 + case 3)', () => {
  test('WATER strong-blocks FIRE → blockGaugeDeltas [{WATER, 1.0}], blockedGaugeElement [FIRE], no heart', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.defenderHeartsLost).toBe(0);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([FIRE]);
    expect(r.clearAllGauges).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('WOOD strong-blocks WATER → blockGaugeDeltas [{WOOD, 1.0}], blockedGaugeElement [WATER]', () => {
    const r = resolveBlock(makeRing(WATER, 3), makeRing(WOOD, 3), 'BLOCK', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: WOOD, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([WATER]);
  });

  test('FIRE strong-blocks WOOD → blockedGaugeElement decrements BOTH wood and shadow (#134)', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(FIRE, 3), 'BLOCK', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
    expect(r.blockedGaugeElement.sort()).toEqual([WOOD, ElementEnum.SHADOW].sort());
  });
});

describe('resolveBlock — STRONG parry (case 4) + WEAK catch', () => {
  test('STRONG parry (WATER parries FIRE) → rally, clearAllGauges, volley = WATER, no heart', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.rallyContinues).toBe(true);
    expect(r.clearAllGauges).toBe(true);
    expect(r.volleyedElement).toBe(WATER);
    expect(r.defenderHeartsLost).toBe(0);
    expect(def.currentUses).toBe(2);
  });

  test('NEUTRAL parry does NOT clear gauges, but fills the block gauge (case 2)', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'PARRY', 1);
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
  });

  test('WEAK catch (WOOD blocks FIRE) → 1 heart, no gauge movement, −1 use', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.blockGaugeDeltas).toEqual([]);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('WEAK parry → 1 heart, no rally, no gauge', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WOOD, 3), 'PARRY', 1);
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.rallyContinues).toBe(false);
    expect(r.blockGaugeDeltas).toEqual([]);
  });

  test('Wind defense is always WEAK even on a perfect parry', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WIND, 3), 'PARRY', 1);
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.rallyContinues).toBe(false);
  });

  test('Earth defense is always NEUTRAL — safe, never rallies', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(EARTH, 3), 'PARRY', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartsLost).toBe(0);
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
    resolveBlock(atk, def, 'MISTIME', 1);
    expect(def.currentUses).toBe(2);
    // Attacker uses are untouched by the resolver — the caller manages attack-fire cost.
    expect(atk.currentUses).toBe(3);
  });

  test('NO_BLOCK burns 0 uses on both attacker and defender', () => {
    const atk = makeRing(FIRE, 3);
    const def = makeRing(WATER, 3);
    resolveBlock(atk, def, 'NO_BLOCK', 1);
    expect(atk.currentUses).toBe(3); // attacker untouched
    expect(def.currentUses).toBe(3); // defender never committed a ring — untouched
  });

  test('MISTIME with 2 uses burns to 1, NOT extinguished', () => {
    const def = makeRing(WATER, 2);
    resolveBlock(makeRing(FIRE, 3), def, 'MISTIME', 1);
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
    const r = resolveBlock(makeRing(WOOD, 3), def, 'BLOCK', 1);
    // Both structures must be populated at once — neither replaces the other.
    expect(r.relationship).toBe('STRONG');
    expect(r.defenderHeartsLost).toBe(0);
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 1.0 }]);
    expect(r.blockedGaugeElement.sort()).toEqual([ElementEnum.WOOD, ElementEnum.SHADOW].sort());
    // And rally does NOT trigger on a BLOCK (only PARRY triggers rally).
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
  });

  test('WOOD strong-blocks WATER → case-2 delta [{WOOD,1.0}] AND case-3 decrement [WATER]', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(WATER, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: WOOD, delta: 1.0 }]);
    expect(r.blockedGaugeElement).toEqual([WATER]);
  });
});

describe('resolveBlock — WEAK catch invariants (C5 adversarial)', () => {
  // Spec (C5): a WEAK catch → defenderHeartsLost=1, blockGaugeDeltas=[], rallyContinues=false.
  // All three must hold on BOTH BLOCK and PARRY timing for a weak pair.

  test('PARRY timing on a WEAK pair → heart lost, no gauge, no rally, no clearAllGauges', () => {
    // FIRE attacks WOOD — WOOD is WEAK to FIRE in the triangle.
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY', 1);
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartsLost).toBe(1);
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
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 0.5 }]);
  });

  test('Tier-2 STEAM strong-blocks WOOD → case-2 [{FIRE,0.5},{WATER,0.5}] AND case-3 [WOOD,SHADOW]', () => {
    // WOOD attack vs STEAM defense: STEAM has FIRE+WATER parents. FIRE strongly
    // beats Wood (fusionBeats), so the defense is STRONG. tierForXp(1500)=2 →
    // force = forceFromTier1(3) = 2 → delta 0.5 each.
    // Case 3: FIRE beats WOOD → WOOD+SHADOW decremented.
    const def = makeRing(STEAM, 3, tierStartXp(2));
    const r = resolveBlock(makeRing(WOOD, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([
      { element: FIRE, delta: 0.5 },
      { element: WATER, delta: 0.5 },
    ]);
    expect(r.blockedGaugeElement.sort()).toEqual([ElementEnum.WOOD, ElementEnum.SHADOW].sort());
    expect(r.defenderHeartsLost).toBe(0);
  });
});

describe('resolveBlock — 1/force gauge dampening: old vs new formula divergence (#512 adversarial)', () => {
  // #512: the case-2 (NEUTRAL) and case-2-within-STRONG+BLOCK gauge delta
  // changed from `1/2^tierForXp(xp)` to `1/force(xp)`. The two formulas
  // coincide at tierForXp 0 and 1 (force(T0)=1=2^0, force(T1)=2=2^1) but
  // provably diverge from tierForXp 2 onward. These tests lock in BOTH halves
  // of that claim: the "unchanged" floor (regression-proofing against a future
  // "cleanup" that reverts to the exponential formula without any test
  // failing) and the "changed" ceiling (proving the new formula actually took
  // effect, not just that some fraction was returned).

  test('tierForXp 0 delta is UNCHANGED (1.0) — force(0)=1 coincides with the old 2^0', () => {
    const def = makeRing(WATER, 3, tierStartXp(0));
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 0);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1 / force(tierStartXp(0)) }]);
    expect(r.blockGaugeDeltas[0].delta).toBe(oldFormulaDelta); // still 1.0 under both formulas
  });

  test('tierForXp 1 delta is UNCHANGED (0.5) — force(T1)=2 coincides with the old 2^1', () => {
    const def = makeRing(WATER, 3, tierStartXp(1));
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 1);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 1 / force(tierStartXp(1)) }]);
    expect(r.blockGaugeDeltas[0].delta).toBe(oldFormulaDelta); // still 0.5 under both formulas
  });

  test('tierForXp 2 defender fills at 0.50 (new 1/force), NOT the old 0.25 (1/2^tier) — the exact bite point the spec calls out', () => {
    // adversarial #512: if BlockResolver regressed to 1/Math.pow(2, tier) this
    // assertion fails at 0.25, proving the formula switch actually happened.
    const def = makeRing(WATER, 3, tierStartXp(2));
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 2); // 0.25 — must NOT be what we observe
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 0.5 }]);
    expect(r.blockGaugeDeltas[0].delta).not.toBe(oldFormulaDelta);
  });

  test('tierForXp 3 defender fills at 1/3 (force 3), the old formula would have given 1/8 = 0.125', () => {
    const def = makeRing(WATER, 3, tierStartXp(3));
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 3);
    expect(r.blockGaugeDeltas[0].delta).toBeCloseTo(1 / 3, 10);
    expect(r.blockGaugeDeltas[0].delta).not.toBe(oldFormulaDelta);
  });

  test('tierForXp 5 defender fills at 0.25 (force 4), the old formula would have given 1/32 = 0.03125', () => {
    const def = makeRing(WATER, 3, tierStartXp(5));
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 5);
    expect(r.blockGaugeDeltas).toEqual([{ element: WATER, delta: 0.25 }]);
    expect(r.blockGaugeDeltas[0].delta).not.toBe(oldFormulaDelta);
  });

  test('STRONG+BLOCK at tierForXp 2 applies the SAME 1/force divisor as NEUTRAL — the divisor change must land on BOTH branches', () => {
    // adversarial #512: NEUTRAL and STRONG+BLOCK are two separate code
    // branches in BlockResolver.ts, each with its own `const delta = ...`
    // line. This test would still pass if only the NEUTRAL branch were fixed
    // and STRONG+BLOCK were accidentally left on the old formula, UNLESS we
    // assert the observed value is not what the old formula would produce.
    const def = makeRing(FIRE, 3, tierStartXp(2)); // WOOD attacks FIRE → FIRE is STRONG
    const r = resolveBlock(makeRing(WOOD, 3), def, 'BLOCK', 1);
    const oldFormulaDelta = 1 / Math.pow(2, 2); // 0.25
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeDeltas).toEqual([{ element: FIRE, delta: 0.5 }]);
    expect(r.blockGaugeDeltas[0].delta).not.toBe(oldFormulaDelta);
    expect(r.blockedGaugeElement.sort()).toEqual([ElementEnum.WOOD, ElementEnum.SHADOW].sort());
  });

  test('divide-by-zero guard: a brand-new (xp=0) defender ring never produces an Infinity or NaN gauge delta on its very first block', () => {
    // adversarial #512: xp=0 is the game's actual floor, not a theoretical
    // edge — every ring starts here and can be blocked before earning any XP.
    const def = makeRing(WATER, 3, 0);
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    expect(Number.isFinite(r.blockGaugeDeltas[0].delta)).toBe(true);
    expect(r.blockGaugeDeltas[0].delta).toBeGreaterThan(0);
  });
});

describe('BlockResolver.ts — no HEART_LOSS_CAP or clamp introduced alongside the force divisor (#512 adversarial)', () => {
  test('source contains no HEART_LOSS_CAP constant, and the gauge delta is never clamped via Math.min', () => {
    // adversarial #512: EPIC decision 1 explicitly forbids adding any
    // heart-loss cap or clamp in this change. A well-intentioned "safety
    // clamp" added later on the new, larger 1/force deltas would silently
    // violate that EPIC contract without any behavioral test catching it,
    // since a clamp would only ever narrow the range of values observed.
    const src = fs.readFileSync(
      path.join(__dirname, '../../server/src/game/BlockResolver.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/HEART_LOSS_CAP/);
    expect(src).not.toMatch(/Math\.min\(\s*delta/);
  });
});

// ---------------------------------------------------------------------------
// Phase 2 (implementation-aware) — targets the actual branch structure now
// visible in the finished BlockResolver.ts: `1 / force(defenderRing.xp)` is
// written as TWO separate literal expressions (one in the `rel === 'NEUTRAL'`
// branch, one inside the STRONG-but-not-PARRY branch), and is NOT evaluated
// at all inside the WEAK branch or the STRONG+PARRY (case 4) branch.
// ---------------------------------------------------------------------------

describe('resolveBlock — NEUTRAL and STRONG+BLOCK branches stay numerically in sync (#512 Phase 2 impl-aware)', () => {
  test('at every tested defender tier, a NEUTRAL block and a STRONG block produce the identical per-parent delta for identical defender xp', () => {
    // BlockResolver.ts has TWO independent `const delta = 1 / force(defenderRing.xp);`
    // lines — one per branch, not a shared helper. A future edit to only one
    // of them (e.g. hand-tuning the STRONG+BLOCK case for "balance") would
    // silently desync the two relationship outcomes without any single-branch
    // test catching it. Compare WATER-vs-WIND (NEUTRAL) against WATER-vs-FIRE
    // (STRONG, Water beats Fire) at identical defender xp across several tiers.
    for (const xp of [0, tierStartXp(1), tierStartXp(2), tierStartXp(3), tierStartXp(5)]) {
      const neutralDef = makeRing(WATER, 3, xp);
      const neutralResult = resolveBlock(makeRing(WIND, 3), neutralDef, 'BLOCK', 1);
      expect(neutralResult.relationship).toBe('NEUTRAL');

      const strongDef = makeRing(WATER, 3, xp);
      const strongResult = resolveBlock(makeRing(FIRE, 3), strongDef, 'BLOCK', 1);
      expect(strongResult.relationship).toBe('STRONG');

      expect(strongResult.blockGaugeDeltas[0].delta).toBe(neutralResult.blockGaugeDeltas[0].delta);
    }
  });
});

describe('resolveBlock — WEAK and STRONG+PARRY branches never evaluate force(xp) (#512 Phase 2 impl-aware)', () => {
  test('a WEAK catch with a NaN-xp defender still resolves correctly — force() is unreachable on this code path', () => {
    // adversarial #512 (impl-aware): the actual control flow in
    // BlockResolver.ts shows `1 / force(defenderRing.xp)` only inside the
    // `rel === 'NEUTRAL'` branch and the STRONG-but-not-PARRY branch. The WEAK
    // branch only sets defenderHeartsLost and never reads defenderRing.xp. A
    // corrupted/NaN xp on a WEAK-catching ring must not derail the result —
    // if force() were accidentally hoisted above the WEAK check, this NaN
    // would leak into a NaN gauge delta.
    const def = makeRing(WOOD, 3, NaN); // WOOD blocking FIRE → WEAK
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.blockGaugeDeltas).toEqual([]);
  });

  test('a STRONG parry with a NaN-xp defender still rallies correctly — case 4 never computes a force-based delta', () => {
    // adversarial #512 (impl-aware): the STRONG+PARRY branch (case 4) takes
    // the rallyContinues/clearAllGauges path and returns before the
    // `1 / force(...)` expression that only exists in the STRONG-but-not-PARRY
    // else-branch. A NaN xp here must not contaminate the rally result.
    const def = makeRing(WATER, 3, NaN); // WATER parries FIRE → STRONG parry
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY', 1);
    expect(r.relationship).toBe('STRONG');
    expect(r.rallyContinues).toBe(true);
    expect(r.clearAllGauges).toBe(true);
    expect(r.blockGaugeDeltas).toEqual([]);
  });
});

describe('resolveBlock — realistic Ring.xp ceiling: uint32, not MAX_SAFE_INTEGER (#512 Phase 2 impl-aware)', () => {
  test('a defender at the maximum representable uint32 xp (2**32 - 1) still resolves a finite, positive gauge delta', () => {
    // server/src/schemas/Ring.ts declares `@type('uint32') xp: number` — this
    // is the actual ceiling the Colyseus schema will ever let defenderRing.xp
    // reach in production, not Number.MAX_SAFE_INTEGER (the pure-function
    // bound the tiers-force.test.ts Phase-1 pass probed).
    const UINT32_MAX = 2 ** 32 - 1;
    const def = makeRing(WATER, 3, UINT32_MAX);
    const r = resolveBlock(makeRing(WIND, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(Number.isFinite(r.blockGaugeDeltas[0].delta)).toBe(true);
    expect(r.blockGaugeDeltas[0].delta).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// #513 — QA Phase 1 (spec-driven adversarial): the pre-migration boolean fields
// were retyped to defenderHeartsLost/attackerHeartsLost integer counts.
// Behavior-preserving migration — value range is exactly {0,1} today (force
// scaling to N>1 lands in the next sub-issue, #514). These tests lock in the
// integer-count contract and guard against the old boolean names resurfacing.
// ---------------------------------------------------------------------------

describe('resolveBlock — defenderHeartsLost/attackerHeartsLost integer-count invariants (#513 adversarial)', () => {
  // #513 adversarial: the field was retyped boolean→number. A regression that
  // reintroduces `true`/`false` (e.g. a careless `r.defenderHeartsLost = true as any`)
  // would still pass loose `.toBe(1)`/`.toBe(0)` assertions in JS test runners that
  // don't distinguish — vitest's toBe uses Object.is, which DOES distinguish 1
  // from true, but this test makes the type contract explicit and central rather
  // than incidental to five separate describe blocks above.
  test.each([
    ['NO_BLOCK uncontested hit', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'NO_BLOCK', 1)],
    ['MISTIME uncontested hit', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'MISTIME', 1)],
    ['WEAK catch (BLOCK timing)', () => resolveBlock(makeRing(FIRE, 3), makeRing(WOOD, 3), 'BLOCK', 1)],
    ['WEAK catch (PARRY timing)', () => resolveBlock(makeRing(FIRE, 3), makeRing(WOOD, 3), 'PARRY', 1)],
    ['NEUTRAL block', () => resolveBlock(makeRing(WIND, 3), makeRing(WATER, 3), 'BLOCK', 1)],
    ['STRONG block', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'BLOCK', 1)],
    ['STRONG parry (case 4)', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'PARRY', 1)],
  ] as const)('%s → defenderHeartsLost is a strict {0,1} number, never boolean-like', (_label, run) => {
    const r = run();
    expect(typeof r.defenderHeartsLost).toBe('number');
    expect(Number.isInteger(r.defenderHeartsLost)).toBe(true);
    expect([0, 1]).toContain(r.defenderHeartsLost);
  });

  // #513 adversarial: attackerHeartsLost is a forward-compat placeholder (future
  // rally counter-damage) — BlockResolver never wires it to anything today. A
  // future edit that accidentally sets it on the rally/case-4 branch (the most
  // plausible place someone would add "counter damage") must fail this guard.
  test.each([
    ['NO_BLOCK', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'NO_BLOCK', 1)],
    ['WEAK catch', () => resolveBlock(makeRing(FIRE, 3), makeRing(WOOD, 3), 'BLOCK', 1)],
    ['NEUTRAL block', () => resolveBlock(makeRing(WIND, 3), makeRing(WATER, 3), 'BLOCK', 1)],
    ['STRONG block', () => resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'BLOCK', 1)],
    ['STRONG parry / rally (case 4 — the most plausible future wire-up site)', () =>
      resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'PARRY', 1)],
  ] as const)('%s → attackerHeartsLost stays exactly 0', (_label, run) => {
    const r = run();
    expect(r.attackerHeartsLost).toBe(0);
  });
});

describe('#513 structural regression guard — old boolean field names purged from the entire codebase', () => {
  // #513 acceptance criterion: the pre-migration boolean fields ("defender" +
  // "HeartLost" / "attacker" + "HeartLost", no "s" before "Lost" — distinct from
  // the surviving "...HeartsLost" count fields) must appear nowhere in server/,
  // client/, shared/, or tests/. This walks the real directory tree rather than
  // trusting any single file's diff, so a missed call site anywhere (including a
  // file nobody thought to check) fails loudly instead of silently shipping a
  // stale boolean read.
  //
  // The needles are built via concatenation (not a contiguous literal) so this
  // guard test's OWN source — which must describe what it searches for — can
  // never accidentally match itself and produce a false failure.
  const OLD_DEFENDER_FIELD = ['defender', 'Heart', 'Lost'].join('');
  const OLD_ATTACKER_FIELD = ['attacker', 'Heart', 'Lost'].join('');
  const SELF_FILE = path.resolve(__filename);

  function walkFiles(dir: string, exts: string[], out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkFiles(full, exts, out);
      else if (exts.some((e) => entry.name.endsWith(e))) out.push(full);
    }
    return out;
  }

  test('the old boolean field names appear in zero files under server/, client/, shared/, tests/', () => {
    const root = path.join(__dirname, '../..');
    const offenders: string[] = [];
    for (const d of ['server', 'client', 'shared', 'tests']) {
      const full = path.join(root, d);
      if (!fs.existsSync(full)) continue;
      for (const file of walkFiles(full, ['.ts', '.tsx'])) {
        if (path.resolve(file) === SELF_FILE) continue; // this guard's own needles would self-match
        const content = fs.readFileSync(file, 'utf8');
        if (content.includes(OLD_DEFENDER_FIELD) || content.includes(OLD_ATTACKER_FIELD)) {
          offenders.push(path.relative(root, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// A fusion ring is a single compound element: 1 heart per use, no per-component
// heart loss, fused-vs-fused is always NEUTRAL.
describe('resolveBlock — compound fusion behaviour', () => {
  test('fused TIDAL attack on a no-block → exactly 1 heart, gauges [WATER, WOOD]', () => {
    const r = resolveBlock(makeRing(TIDAL, 3), null, 'NO_BLOCK', 1);
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.hitGaugeElements).toEqual([WATER, WOOD]);
  });

  test('fused-vs-fused (STEAM atk vs TIDAL def) BLOCK → NEUTRAL, 1 use, block gauge fills', () => {
    const def = makeRing(TIDAL, 3);
    const r = resolveBlock(makeRing(STEAM, 3), def, 'BLOCK', 1);
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartsLost).toBe(0);
    // TIDAL = Water+Wood, both tracked → two full-rate entries at Tier 0.
    expect(r.blockGaugeDeltas).toEqual([
      { element: WATER, delta: 1.0 },
      { element: WOOD, delta: 1.0 },
    ]);
    expect(def.currentUses).toBe(2);
  });

  test('fused-vs-fused on a no-block → 1 heart, both attacker tracked gauges fill', () => {
    const r = resolveBlock(makeRing(STEAM, 3), makeRing(TIDAL, 3), 'NO_BLOCK', 1);
    expect(r.defenderHeartsLost).toBe(1);
    expect(r.hitGaugeElements).toEqual([FIRE, WATER]);
  });

  test('attacker ring extinguishes when uses already at 0', () => {
    const atk = makeRing(FIRE, 0);
    atk.isExtinguished = false;
    resolveBlock(atk, makeRing(WATER, 3), 'BLOCK', 1);
    expect(atk.isExtinguished).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #514 — force-scaled, hp_force-mitigated, ceil()-rounded Contract B heart loss.
// Tier→force ladder (1-indexed T, ring xp = tierStartXp(T-1)): T1→1, T2→2, T3→2,
// T4→3, T5→3. Every count uses ceilDiv(a,b)=floor((a+b-1)/b).
// ---------------------------------------------------------------------------
describe('resolveBlock — force-scaled heart loss (#514 Contract B)', () => {
  // Convenience: a ring of 1-indexed tier T (xp at that tier's floor).
  const tierRing = (el: number, tier1: number) => makeRing(el, 3, tierStartXp(tier1 - 1));

  describe('EPIC worked example — T3 Wind vs T1 Earth, T1 heart (hpForce=1) → 1, block == parry', () => {
    // atkForce=force(T3)=2, defForce=force(T1)=1, hpForce=1.
    // max(0, ceilDiv(2−1, 1)) = 1. Earth defense is always NEUTRAL, so BLOCK and
    // PARRY take the identical (neutral) formula and yield the identical count.
    test('BLOCK → NEUTRAL, exactly 1 heart', () => {
      const r = resolveBlock(tierRing(WIND, 3), tierRing(EARTH, 1), 'BLOCK', 1);
      expect(r.relationship).toBe('NEUTRAL');
      expect(r.defenderHeartsLost).toBe(1);
    });
    test('PARRY → NEUTRAL, exactly 1 heart (identical to BLOCK)', () => {
      const r = resolveBlock(tierRing(WIND, 3), tierRing(EARTH, 1), 'PARRY', 1);
      expect(r.relationship).toBe('NEUTRAL');
      expect(r.defenderHeartsLost).toBe(1);
    });
    test('block and parry produce the SAME count for the same rings', () => {
      const block = resolveBlock(tierRing(WIND, 3), tierRing(EARTH, 1), 'BLOCK', 1);
      const parry = resolveBlock(tierRing(WIND, 3), tierRing(EARTH, 1), 'PARRY', 1);
      expect(parry.defenderHeartsLost).toBe(block.defenderHeartsLost);
    });
  });

  describe('WEAK catch bleeds the FULL max(1, ceilDiv(atkForce, hpForce)) — zero def_force credit', () => {
    // Fire (strong) attacks Wood (weak-triangle defense). atkForce=force(T2)=2,
    // hpForce=1 → max(1, ceilDiv(2,1)) = 2, regardless of Wood's own tier.
    test('T2 Fire vs T4 Wood, hpForce=1 → WEAK, 2 hearts', () => {
      const r = resolveBlock(tierRing(FIRE, 2), tierRing(WOOD, 4), 'BLOCK', 1);
      expect(r.relationship).toBe('WEAK');
      expect(r.defenderHeartsLost).toBe(2);
    });
    test("Wood's own tier gives zero credit — count is independent of the defender tier", () => {
      const vsT1 = resolveBlock(tierRing(FIRE, 2), tierRing(WOOD, 1), 'BLOCK', 1);
      const vsT5 = resolveBlock(tierRing(FIRE, 2), tierRing(WOOD, 5), 'BLOCK', 1);
      expect(vsT1.defenderHeartsLost).toBe(2);
      expect(vsT5.defenderHeartsLost).toBe(2);
    });
    test('WEAK on PARRY timing bleeds the same full count', () => {
      const r = resolveBlock(tierRing(FIRE, 2), tierRing(WOOD, 4), 'PARRY', 1);
      expect(r.relationship).toBe('WEAK');
      expect(r.defenderHeartsLost).toBe(2);
    });
    // #514 QA Phase 1 adversarial: push "zero credit" to its most tempting-to-
    // get-wrong extreme — a VERY high-force Wood ring (T10, force 6) that WOULD
    // swing the NEUTRAL/STRONG clamp all the way to 0 if its force were
    // mistakenly credited here (max(0, ceilDiv(max(0, 4−6), 1)) = 0, same shape
    // as the NEUTRAL/STRONG branches above). The actual WEAK formula must ignore
    // defForce entirely and still bleed the full max(1, ceilDiv(4,1)) = 4 — a
    // stark 4-vs-0 contrast that would catch even a partial-credit regression
    // (e.g. someone averaging in a fraction of defForce "for balance").
    test('T6 Fire (force 4) vs a T10 Wood (force 6) — full 4-heart cost lands despite Wood dwarfing the attacker in force', () => {
      const r = resolveBlock(tierRing(FIRE, 6), tierRing(WOOD, 10), 'BLOCK', 1);
      expect(r.relationship).toBe('WEAK');
      expect(r.defenderHeartsLost).toBe(4);
    });
  });

  describe('No-block / Mistime — max(1, ceilDiv(atkForce, hpForce)), hp_force mitigates', () => {
    test('T4 attack (force 3), hpForce=1 → 3 hearts (NO_BLOCK)', () => {
      const r = resolveBlock(tierRing(FIRE, 4), makeRing(WATER, 3), 'NO_BLOCK', 1);
      expect(r.defenderHeartsLost).toBe(3);
    });
    test('T4 attack (force 3), hpForce=2 → ceilDiv(3,2)=2 hearts', () => {
      const r = resolveBlock(tierRing(FIRE, 4), makeRing(WATER, 3), 'NO_BLOCK', 2);
      expect(r.defenderHeartsLost).toBe(2);
    });
    test('T1 attack (force 1), hpForce=3 → floored at 1 (never 0 on a landed hit)', () => {
      const r = resolveBlock(tierRing(FIRE, 1), makeRing(WATER, 3), 'NO_BLOCK', 3);
      expect(r.defenderHeartsLost).toBe(1);
    });
    test('MISTIME force-scales identically to NO_BLOCK', () => {
      const r = resolveBlock(tierRing(FIRE, 4), makeRing(WATER, 3), 'MISTIME', 1);
      expect(r.defenderHeartsLost).toBe(3);
    });
    test('no defender ring (null) also force-scales', () => {
      const r = resolveBlock(tierRing(FIRE, 4), null, 'NO_BLOCK', 1);
      expect(r.defenderHeartsLost).toBe(3);
    });
  });

  describe('NEUTRAL block — max(0, ceilDiv(max(0, atkForce − defForce), hpForce)), def_force is a real shield', () => {
    test('atkForce ≤ defForce → 0 hearts (Wind T3 force 2 vs Water T3 force 2)', () => {
      const r = resolveBlock(tierRing(WIND, 3), tierRing(WATER, 3), 'BLOCK', 1);
      expect(r.relationship).toBe('NEUTRAL');
      expect(r.defenderHeartsLost).toBe(0);
    });
    // #514 QA Phase 1 adversarial: the case above uses EQUAL force (2 vs 2) — the
    // boundary, but not the clamp's interior. It would still pass even if the
    // outer `max(0, ...)` were accidentally dropped, since atkForce − defForce is
    // exactly 0 either way. A defender whose force STRICTLY EXCEEDS the
    // attacker's (a well-invested defensive ring facing a weaker attacker) is the
    // case that actually exercises the clamp: without `max(0, ...)`, ceilDiv would
    // floor-divide a NEGATIVE numerator and could silently produce a negative
    // heart count (i.e. heal the defender) instead of correctly flooring at 0.
    test('defForce STRICTLY greater than atkForce (well-invested defender vs a weaker attacker) → exactly 0 hearts, never negative (Wind T1 force 1 vs Water T10 force 6)', () => {
      const r = resolveBlock(tierRing(WIND, 1), tierRing(WATER, 10), 'BLOCK', 1);
      expect(r.relationship).toBe('NEUTRAL');
      expect(r.defenderHeartsLost).toBe(0);
      expect(r.defenderHeartsLost).toBeGreaterThanOrEqual(0);
    });
    test('atkForce > defForce → bled count (Wind T4 force 3 vs Water T1 force 1, hp 1 → 2)', () => {
      const r = resolveBlock(tierRing(WIND, 4), tierRing(WATER, 1), 'BLOCK', 1);
      expect(r.relationship).toBe('NEUTRAL');
      expect(r.defenderHeartsLost).toBe(2);
    });
    test('same gap, hpForce=2 → ceilDiv(2,2)=1 heart', () => {
      const r = resolveBlock(tierRing(WIND, 4), tierRing(WATER, 1), 'BLOCK', 2);
      expect(r.defenderHeartsLost).toBe(1);
    });
    test('NEUTRAL parry uses the SAME formula as NEUTRAL block (no flat-0 special case)', () => {
      const block = resolveBlock(tierRing(WIND, 4), tierRing(EARTH, 1), 'BLOCK', 1);
      const parry = resolveBlock(tierRing(WIND, 4), tierRing(EARTH, 1), 'PARRY', 1);
      expect(parry.relationship).toBe('NEUTRAL');
      expect(parry.defenderHeartsLost).toBe(block.defenderHeartsLost);
      expect(parry.defenderHeartsLost).toBe(2); // ceilDiv(3−1, 1)
    });
  });

  describe('STRONG block — subtractive shield, same formula as NEUTRAL block', () => {
    test('atkForce > defForce → bled count (Fire T4 force 3 strong-blocked by Water T1 force 1, hp 1 → 2)', () => {
      const r = resolveBlock(tierRing(FIRE, 4), tierRing(WATER, 1), 'BLOCK', 1);
      expect(r.relationship).toBe('STRONG');
      expect(r.defenderHeartsLost).toBe(2);
      // case-3 decrement still layers on top, untouched.
      expect(r.blockedGaugeElement).toEqual([FIRE]);
    });
    test('same gap, hpForce=2 → ceilDiv(2,2)=1 heart', () => {
      const r = resolveBlock(tierRing(FIRE, 4), tierRing(WATER, 1), 'BLOCK', 2);
      expect(r.defenderHeartsLost).toBe(1);
    });
    test('atkForce ≤ defForce → still 0 hearts (Fire T2 force 2 vs Water T3 force 2)', () => {
      const r = resolveBlock(tierRing(FIRE, 2), tierRing(WATER, 3), 'BLOCK', 1);
      expect(r.relationship).toBe('STRONG');
      expect(r.defenderHeartsLost).toBe(0);
    });
    // #514 QA Phase 1 adversarial: same clamp-interior argument as the NEUTRAL
    // suite above, but for the STRONG+BLOCK branch's INDEPENDENT `max(0, ...)`
    // call — a separate literal expression in BlockResolver.ts, not a shared
    // helper (see the Phase 2 branch-desync guard near the end of this file). A
    // well-invested Water ring strong-blocking a much weaker Fire attack must
    // clamp to 0, not go negative.
    test('defForce STRICTLY greater than atkForce on a STRONG block → exactly 0 hearts, never negative (Fire T1 force 1 strong-blocked by Water T10 force 6)', () => {
      const r = resolveBlock(tierRing(FIRE, 1), tierRing(WATER, 10), 'BLOCK', 1);
      expect(r.relationship).toBe('STRONG');
      expect(r.defenderHeartsLost).toBe(0);
    });
  });

  describe('STRONG parry stays 0 hearts regardless of force gap', () => {
    test('big attacker force does not bleed a heart on a strong parry', () => {
      const r = resolveBlock(tierRing(FIRE, 4), tierRing(WATER, 1), 'PARRY', 1);
      expect(r.relationship).toBe('STRONG');
      expect(r.defenderHeartsLost).toBe(0);
      expect(r.rallyContinues).toBe(true);
      expect(r.clearAllGauges).toBe(true);
    });
  });

  describe('integer-safe ceil — never a fractional heart', () => {
    test('NO_BLOCK ceilDiv(3,2) resolves to the integer 2, not 1.5', () => {
      const r = resolveBlock(tierRing(FIRE, 4), makeRing(WATER, 3), 'NO_BLOCK', 2);
      expect(Number.isInteger(r.defenderHeartsLost)).toBe(true);
      expect(r.defenderHeartsLost).toBe(2);
    });
    test('NEUTRAL ceilDiv(3,2) resolves to the integer 2', () => {
      // Wind T5 force 3 vs Water T1 force 1 → gap 2? force(T5)=3, gap=3−1=2 no.
      // Use Wind T6 (force 4) vs Water T1 (force 1) → gap 3, ceilDiv(3,2)=2.
      const r = resolveBlock(tierRing(WIND, 6), tierRing(WATER, 1), 'BLOCK', 2);
      expect(Number.isInteger(r.defenderHeartsLost)).toBe(true);
      expect(r.defenderHeartsLost).toBe(2);
    });

    // #514 QA Phase 1 adversarial: ceilDiv(a,b) = floor((a+b-1)/b) is the ONE
    // load-bearing arithmetic primitive behind every heart-loss formula in this
    // resolver, but it is not exported — these cases drive it indirectly through
    // the formula that exposes it 1:1 (NO_BLOCK's max(1, ceilDiv(atkForce,
    // hpForce))). The sweep specifically targets the boundary shapes most likely
    // to hide an off-by-one in a hand-rolled integer ceil: a===b exactly (small
    // AND large), and a exactly one less than a clean multiple of b (the shape a
    // naive `Math.ceil(a/b)` float implementation is most prone to mis-round due
    // to floating-point representation error — precisely why this resolver avoids
    // Math.ceil in favor of the integer-only formula).
    test.each([
      ['ceilDiv(1,1)=1 — a=b at the minimum (T1 atk, hpForce 1)', 1, 1, 1],
      ['ceilDiv(2,1)=2 — no mitigation (T2 atk, hpForce 1)', 2, 1, 2],
      ['ceilDiv(2,2)=1 — a=b exact, small (T2 atk, hpForce 2)', 2, 2, 1],
      ['ceilDiv(3,3)=1 — a=b exact, larger (T4 atk, hpForce 3)', 4, 3, 1],
      ['ceilDiv(5,3)=2 — a is exactly one less than 2×b (T8 atk, hpForce 3)', 8, 3, 2],
      ['ceilDiv(5,2)=3 — a is exactly one less than 3×b (T8 atk, hpForce 2)', 8, 2, 3],
      ['ceilDiv(5,6)=1 — a one less than b itself still ceils to 1, never 0 (T8 atk, hpForce 6)', 8, 6, 1],
      ['ceilDiv(6,1)=6 — ladder-ceiling force, no mitigation (T10 atk, hpForce 1)', 10, 1, 6],
    ] as const)('%s', (_label, atkTier1, hpForce, expected) => {
      const r = resolveBlock(tierRing(FIRE, atkTier1), makeRing(WATER, 3), 'NO_BLOCK', hpForce);
      expect(r.defenderHeartsLost).toBe(expected);
    });
  });
});

// ---------------------------------------------------------------------------
// #514 — QA Phase 2 (implementation-aware): targets the actual branch structure
// now visible in the finished resolveBlock — the `rel === 'NEUTRAL'` branch
// computes `defenderHeartsLost` with a SINGLE literal expression that is never
// gated on `timing`, which is exactly what makes Block-Neutral and Parry-Neutral
// "literally the same code path" (per the code review). A future edit that
// "cleans up" this branch by splitting it into a BLOCK sub-case and a PARRY
// sub-case (e.g. to hand-tune one of them) would silently break OQ-1's
// no-flat-0-special-case guarantee without any single-timing test catching it,
// since each half would still individually look correct.
// ---------------------------------------------------------------------------
describe('resolveBlock — Neutral-block and Neutral-parry share ONE literal branch, not two (#514 Phase 2 impl-aware structural guard)', () => {
  test('the `rel === \'NEUTRAL\'` branch source never references `timing` — proving BLOCK and PARRY cannot silently diverge inside it', () => {
    const src = fs.readFileSync(
      path.join(__dirname, '../../server/src/game/BlockResolver.ts'),
      'utf8',
    );
    const match = src.match(/else if \(rel === 'NEUTRAL'\) \{([\s\S]*?)\} else \{/);
    expect(match).not.toBeNull();
    const neutralBranchSrc = match![1];
    expect(neutralBranchSrc).not.toMatch(/timing/);
    // Sanity: the extracted snippet is actually the heart-loss formula, not an
    // empty/mismatched capture (guards the regex itself against silent drift if
    // the surrounding source is reformatted).
    expect(neutralBranchSrc).toMatch(/defenderHeartsLost = Math\.max\(0, ceilDiv\(Math\.max\(0, atkForce - defForce\), hpForce\)\)/);
  });
});
