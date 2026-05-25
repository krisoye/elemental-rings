import { describe, test, expect } from 'vitest';
import {
  applySetupPassive,
  applyWellspring,
  applyDeepRoots,
  applyTailwind,
} from '../../server/src/game/StakeResolver';
import { PlayerState } from '../../server/src/schemas/PlayerState';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD, STEAM } = ElementEnum;

/** Build a plain Ring with the given element and uses. */
function makeRing(element: number, currentUses: number, maxUses?: number): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = maxUses ?? currentUses;
  r.isExtinguished = currentUses === 0;
  r.isFusion = element >= 5; // ElementEnum fusions start at 5
  return r;
}

/**
 * Build a minimal PlayerState. The thumb slot is taken from `thumb`; each
 * named slot (a1/a2/d1/d2) is wired up from the `slots` map. Unspecified
 * slots default to WATER (element=1) so that Kindling/Bulwark passives do not
 * accidentally buff them and skew assertions.
 */
function makePS(
  thumbEl: number,
  thumbUses: number,
  slots: Partial<Record<'a1' | 'a2' | 'd1' | 'd2', Ring>>,
  thumbFusion = false,
): PlayerState {
  const ps = new PlayerState();
  ps.thumb = makeRing(thumbEl, thumbUses);
  ps.thumb.isFusion = thumbFusion;
  // Default unspecified slots to WATER (neutral element for all passives).
  const defaultRing = () => makeRing(WATER, 3);
  ps.a1 = slots.a1 ?? defaultRing();
  ps.a2 = slots.a2 ?? defaultRing();
  ps.d1 = slots.d1 ?? defaultRing();
  ps.d2 = slots.d2 ?? defaultRing();
  return ps;
}

// ---------------------------------------------------------------------------
// 1. Kindling (Fire thumb)
// ---------------------------------------------------------------------------

describe('Kindling — Fire thumb setup passive', () => {
  test('thumb(3), a1=Fire, a2=Fire → a1=4, a2=4, thumb=1', () => {
    const a1 = makeRing(FIRE, 3);
    const a2 = makeRing(FIRE, 3);
    const ps = makePS(FIRE, 3, { a1, a2 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(4);
    expect(ps.a2.currentUses).toBe(4);
    expect(ps.thumb.currentUses).toBe(1);
  });

  test('attack slots buffed before defense — thumb=2, a1/a2/d1 all Fire → d1 unbuffed', () => {
    const a1 = makeRing(FIRE, 3);
    const a2 = makeRing(FIRE, 3);
    const d1 = makeRing(FIRE, 3);
    const ps = makePS(FIRE, 2, { a1, a2, d1 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(4); // buffed
    expect(ps.a2.currentUses).toBe(4); // buffed
    expect(ps.d1.currentUses).toBe(3); // NOT buffed — thumb exhausted
    expect(ps.thumb.currentUses).toBe(0);
    expect(ps.thumb.isExtinguished).toBe(true);
  });

  test('non-Fire slots are skipped', () => {
    const a1 = makeRing(WATER, 3); // not FIRE
    const a2 = makeRing(FIRE, 3);
    const ps = makePS(FIRE, 3, { a1, a2 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(3); // skipped
    expect(ps.a2.currentUses).toBe(4); // buffed
    expect(ps.thumb.currentUses).toBe(2); // only 1 use consumed
  });
});

// ---------------------------------------------------------------------------
// 2. Bulwark (Earth thumb)
// ---------------------------------------------------------------------------

describe('Bulwark — Earth thumb setup passive', () => {
  test('thumb(3), d1=Earth, d2=Earth → d1=4, d2=4, thumb=1', () => {
    const d1 = makeRing(EARTH, 3);
    const d2 = makeRing(EARTH, 3);
    const ps = makePS(EARTH, 3, { d1, d2 });
    applySetupPassive(ps);
    expect(ps.d1.currentUses).toBe(4);
    expect(ps.d2.currentUses).toBe(4);
    expect(ps.thumb.currentUses).toBe(1);
  });

  test('defense buffed before attack — thumb=2, d1/d2/a1 all Earth → a1 unbuffed', () => {
    const d1 = makeRing(EARTH, 3);
    const d2 = makeRing(EARTH, 3);
    const a1 = makeRing(EARTH, 3);
    const ps = makePS(EARTH, 2, { d1, d2, a1 });
    applySetupPassive(ps);
    expect(ps.d1.currentUses).toBe(4);
    expect(ps.d2.currentUses).toBe(4);
    expect(ps.a1.currentUses).toBe(3); // NOT buffed
    expect(ps.thumb.currentUses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. Wellspring (Water thumb)
// ---------------------------------------------------------------------------

describe('Wellspring — Water thumb passive', () => {
  test('refunds 1 use to the defender ring and charges thumb', () => {
    const defRing = makeRing(WATER, 2, 3); // maxUses=3, currentUses=2 (already paid 1 for parry)
    const ps = makePS(WATER, 3, {});
    const result = applyWellspring(ps, defRing);
    expect(result).toBe(true);
    expect(defRing.currentUses).toBe(3); // refunded back to max
    expect(defRing.isExtinguished).toBe(false);
    expect(ps.thumb.currentUses).toBe(2); // thumb paid
  });

  test('does not exceed maxUses when refunding', () => {
    const defRing = makeRing(WATER, 3, 3); // already at max
    const ps = makePS(WATER, 3, {});
    applyWellspring(ps, defRing);
    expect(defRing.currentUses).toBe(3);
  });

  test('returns false for non-Water thumb', () => {
    const defRing = makeRing(WATER, 2, 3);
    const ps = makePS(FIRE, 3, {});
    expect(applyWellspring(ps, defRing)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Deep Roots (Wood thumb)
// ---------------------------------------------------------------------------

describe('Deep Roots — Wood thumb passive', () => {
  test('3 calls absorb 3 blows: thumb 3→2→1→0', () => {
    const ps = makePS(WOOD, 3, {});
    expect(applyDeepRoots(ps)).toBe(true);
    expect(ps.thumb.currentUses).toBe(2);
    expect(applyDeepRoots(ps)).toBe(true);
    expect(ps.thumb.currentUses).toBe(1);
    expect(applyDeepRoots(ps)).toBe(true);
    expect(ps.thumb.currentUses).toBe(0);
    expect(ps.thumb.isExtinguished).toBe(true);
  });

  test('4th call returns false when thumb exhausted', () => {
    const ps = makePS(WOOD, 3, {});
    applyDeepRoots(ps);
    applyDeepRoots(ps);
    applyDeepRoots(ps);
    expect(applyDeepRoots(ps)).toBe(false);
    expect(ps.thumb.currentUses).toBe(0);
  });

  test('returns false for non-Wood thumb', () => {
    const ps = makePS(FIRE, 3, {});
    expect(applyDeepRoots(ps)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Tailwind (Wind thumb)
// ---------------------------------------------------------------------------

describe('Tailwind — Wind thumb passive', () => {
  test('3 calls return true, each charges thumb: 3→2→1→0', () => {
    const ps = makePS(WIND, 3, {});
    const atk = makeRing(FIRE, 3);
    expect(applyTailwind(ps, atk)).toBe(true);
    expect(ps.thumb.currentUses).toBe(2);
    expect(applyTailwind(ps, atk)).toBe(true);
    expect(ps.thumb.currentUses).toBe(1);
    expect(applyTailwind(ps, atk)).toBe(true);
    expect(ps.thumb.currentUses).toBe(0);
    expect(ps.thumb.isExtinguished).toBe(true);
  });

  test('4th call returns false when thumb exhausted', () => {
    const ps = makePS(WIND, 3, {});
    const atk = makeRing(FIRE, 3);
    applyTailwind(ps, atk);
    applyTailwind(ps, atk);
    applyTailwind(ps, atk);
    expect(applyTailwind(ps, atk)).toBe(false);
  });

  test('returns false for non-Wind thumb', () => {
    const ps = makePS(WATER, 3, {});
    expect(applyTailwind(ps, makeRing(FIRE, 3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Exhausted passive — thumb at 0 uses → all passives no-op
// ---------------------------------------------------------------------------

describe('Exhausted thumb (0 uses) — all passives no-op', () => {
  test('applySetupPassive: Fire thumb at 0 → a1 stays 3', () => {
    const a1 = makeRing(FIRE, 3);
    const ps = makePS(FIRE, 0, { a1 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(3); // untouched
  });

  test('applyWellspring returns false', () => {
    const ps = makePS(WATER, 0, {});
    expect(applyWellspring(ps, makeRing(WATER, 2, 3))).toBe(false);
  });

  test('applyDeepRoots returns false', () => {
    const ps = makePS(WOOD, 0, {});
    expect(applyDeepRoots(ps)).toBe(false);
  });

  test('applyTailwind returns false', () => {
    const ps = makePS(WIND, 0, {});
    expect(applyTailwind(ps, makeRing(FIRE, 3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Fusion stake — thumb.isFusion → all passives no-op
// ---------------------------------------------------------------------------

describe('Fusion thumb (e.g. STEAM) — all passives no-op', () => {
  test('applySetupPassive: fusion thumb → Fire a1 stays 3', () => {
    const a1 = makeRing(FIRE, 3);
    // STEAM=5 would normally trigger nothing, but we set isFusion to true too.
    const ps = makePS(STEAM, 3, { a1 }, true);
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(3); // no-op
  });

  test('applyWellspring returns false', () => {
    const ps = makePS(WATER, 3, {}, true);
    expect(applyWellspring(ps, makeRing(WATER, 2, 3))).toBe(false);
  });

  test('applyDeepRoots returns false', () => {
    const ps = makePS(WOOD, 3, {}, true);
    expect(applyDeepRoots(ps)).toBe(false);
  });

  test('applyTailwind returns false', () => {
    const ps = makePS(WIND, 3, {}, true);
    expect(applyTailwind(ps, makeRing(FIRE, 3))).toBe(false);
  });
});
