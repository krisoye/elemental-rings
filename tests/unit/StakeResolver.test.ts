import { describe, test, expect } from 'vitest';
import {
  applySetupPassive,
  applyEarthParry,
  applyTailwind,
} from '../../server/src/game/StakeResolver';
import { PlayerState } from '../../server/src/schemas/PlayerState';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD, STEAM } = ElementEnum;

/** Build a plain Ring with the given element, uses and (optional) XP. */
function makeRing(element: number, currentUses: number, maxUses?: number, xp = 0): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = maxUses ?? currentUses;
  r.xp = xp;
  r.isExtinguished = currentUses === 0;
  r.isFusion = element >= 5; // ElementEnum fusions start at 5
  return r;
}

/**
 * Build a minimal PlayerState. The thumb slot is taken from `thumb`; each
 * named slot (a1/a2/d1/d2) is wired up from the `slots` map. Unspecified
 * slots default to WIND (a neutral element for every passive) so they never
 * accidentally receive the all-in setup distribution and skew assertions.
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
  // Default unspecified slots to WIND — Wind never matches a triangle setup.
  const defaultRing = () => makeRing(WIND, 3);
  ps.a1 = slots.a1 ?? defaultRing();
  ps.a2 = slots.a2 ?? defaultRing();
  ps.d1 = slots.d1 ?? defaultRing();
  ps.d2 = slots.d2 ?? defaultRing();
  return ps;
}

// ---------------------------------------------------------------------------
// 1. All-in setup distributor (Fire / Water / Wood thumb)
// ---------------------------------------------------------------------------

describe('All-in setup — Fire/Water/Wood thumb distributor', () => {
  test('1 matching ring receives the entire pour (Fire, 5 uses, only Fire a1 → a1 +5)', () => {
    const a1 = makeRing(FIRE, 3, 3, 100);
    const ps = makePS(FIRE, 5, { a1 });
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(5);
    expect(ps.a1.currentUses).toBe(8);
    expect(ps.a1.maxUses).toBe(8); // maxUses raised to match
    expect(ps.thumb.currentUses).toBe(0);
    expect(ps.thumb.isExtinguished).toBe(true);
  });

  test('2 matching rings split evenly (Water, 4 uses, a1+a2 → +2 each)', () => {
    const a1 = makeRing(WATER, 3, 3, 700);
    const a2 = makeRing(WATER, 3, 3, 700);
    const ps = makePS(WATER, 4, { a1, a2 });
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(4);
    expect(ps.a1.currentUses).toBe(5);
    expect(ps.a2.currentUses).toBe(5);
    expect(ps.thumb.currentUses).toBe(0);
  });

  test('4 matching rings, 4 uses → +1 each (Wood A1/A2/D1/D2)', () => {
    const a1 = makeRing(WOOD, 3, 3, 800);
    const a2 = makeRing(WOOD, 3, 3, 600);
    const d1 = makeRing(WOOD, 3, 3, 500);
    const d2 = makeRing(WOOD, 3, 3, 500);
    const ps = makePS(WOOD, 4, { a1, a2, d1, d2 });
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(4);
    expect(ps.a1.currentUses).toBe(4);
    expect(ps.a2.currentUses).toBe(4);
    expect(ps.d1.currentUses).toBe(4);
    expect(ps.d2.currentUses).toBe(4);
    expect(ps.thumb.currentUses).toBe(0);
  });

  test('XP ordering — 5th use goes to the highest-XP ring (Wood, 5 uses)', () => {
    // A1(800) A2(600) D1(500) D2(500): round 1 gives +1 each (4 uses),
    // round 2's single remaining use goes back to the highest-XP ring (A1).
    const a1 = makeRing(WOOD, 3, 3, 800);
    const a2 = makeRing(WOOD, 3, 3, 600);
    const d1 = makeRing(WOOD, 3, 3, 500);
    const d2 = makeRing(WOOD, 3, 3, 500);
    const ps = makePS(WOOD, 5, { a1, a2, d1, d2 });
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(5);
    expect(ps.a1.currentUses).toBe(5); // +2
    expect(ps.a2.currentUses).toBe(4); // +1
    expect(ps.d1.currentUses).toBe(4); // +1
    expect(ps.d2.currentUses).toBe(4); // +1
  });

  test('slot-order tiebreak — equal XP fills A1 before A2 before D1 before D2', () => {
    // All four equal XP; with 1 use the only recipient must be A1 (slot order).
    const a1 = makeRing(FIRE, 3, 3, 500);
    const a2 = makeRing(FIRE, 3, 3, 500);
    const d1 = makeRing(FIRE, 3, 3, 500);
    const d2 = makeRing(FIRE, 3, 3, 500);
    const ps = makePS(FIRE, 1, { a1, a2, d1, d2 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(4); // A1 wins the tiebreak
    expect(ps.a2.currentUses).toBe(3);
    expect(ps.d1.currentUses).toBe(3);
    expect(ps.d2.currentUses).toBe(3);
  });

  test('no-matching-rings guard — thumb keeps its uses (Water, 3 uses, no Water rings)', () => {
    const ps = makePS(WATER, 3, {}); // all slots default to WIND
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(0);
    expect(ps.thumb.currentUses).toBe(3); // NOT spent
    expect(ps.thumb.isExtinguished).toBe(false);
  });

  test('clears isExtinguished on a buffed ring', () => {
    const a1 = makeRing(FIRE, 0, 3, 100); // extinguished
    const ps = makePS(FIRE, 2, { a1 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(2);
    expect(ps.a1.isExtinguished).toBe(false);
  });

  test('only base-element rings matching the thumb receive uses (mixed hand)', () => {
    const a1 = makeRing(FIRE, 3, 3, 500); // matches
    const a2 = makeRing(WATER, 3, 3, 999); // higher XP but wrong element
    const ps = makePS(FIRE, 2, { a1, a2 });
    applySetupPassive(ps);
    expect(ps.a1.currentUses).toBe(5); // all 2 uses
    expect(ps.a2.currentUses).toBe(3); // untouched
  });

  test('Earth thumb does NOT use the setup distributor (no setup passive)', () => {
    const d1 = makeRing(EARTH, 3, 3, 500);
    const ps = makePS(EARTH, 3, { d1 });
    const distributed = applySetupPassive(ps);
    expect(distributed).toBe(0);
    expect(ps.d1.currentUses).toBe(3); // untouched
    expect(ps.thumb.currentUses).toBe(3); // not spent
  });

  test('Wind thumb does NOT use the setup distributor', () => {
    const a1 = makeRing(WIND, 3, 3, 500);
    const ps = makePS(WIND, 3, { a1 });
    expect(applySetupPassive(ps)).toBe(0);
    expect(ps.thumb.currentUses).toBe(3);
  });

  test('exhausted thumb (0 uses) → no-op', () => {
    const a1 = makeRing(FIRE, 3, 3, 500);
    const ps = makePS(FIRE, 0, { a1 });
    expect(applySetupPassive(ps)).toBe(0);
    expect(ps.a1.currentUses).toBe(3);
  });

  test('fusion thumb → no-op even with a matching base element', () => {
    const a1 = makeRing(FIRE, 3, 3, 500);
    const ps = makePS(STEAM, 3, { a1 }, true);
    expect(applySetupPassive(ps)).toBe(0);
    expect(ps.a1.currentUses).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2. Precision Parry (Earth thumb) — timing-only refund
// ---------------------------------------------------------------------------

describe('Precision Parry — Earth thumb refund', () => {
  test('refunds 1 use to the defender ring and charges the thumb', () => {
    const defRing = makeRing(WOOD, 2, 3); // already paid 1 for the parry
    const ps = makePS(EARTH, 3, {});
    expect(applyEarthParry(ps, defRing)).toBe(true);
    expect(defRing.currentUses).toBe(3); // refunded
    expect(defRing.isExtinguished).toBe(false);
    expect(ps.thumb.currentUses).toBe(2); // thumb paid
  });

  test('fires regardless of element matchup — defender ring element is irrelevant', () => {
    // The trigger is timing only; the resolver decides the matchup elsewhere.
    // Here we simply confirm the refund fires for any defender ring element.
    for (const el of [FIRE, WATER, EARTH, WIND, WOOD]) {
      const defRing = makeRing(el, 1, 3);
      const ps = makePS(EARTH, 2, {});
      expect(applyEarthParry(ps, defRing)).toBe(true);
      expect(defRing.currentUses).toBe(2);
    }
  });

  test('does not exceed the defender ring maxUses', () => {
    const defRing = makeRing(WOOD, 3, 3); // already at max
    const ps = makePS(EARTH, 3, {});
    applyEarthParry(ps, defRing);
    expect(defRing.currentUses).toBe(3);
    expect(ps.thumb.currentUses).toBe(2); // thumb still pays
  });

  test('fires every time until the thumb is exhausted: 3→2→1→0', () => {
    const ps = makePS(EARTH, 3, {});
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(true);
    expect(ps.thumb.currentUses).toBe(2);
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(true);
    expect(ps.thumb.currentUses).toBe(1);
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(true);
    expect(ps.thumb.currentUses).toBe(0);
    expect(ps.thumb.isExtinguished).toBe(true);
    // 4th call: thumb exhausted → no-op.
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(false);
  });

  test('returns false for a non-Earth thumb', () => {
    const ps = makePS(WATER, 3, {});
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(false);
  });

  test('returns false for an exhausted thumb', () => {
    const ps = makePS(EARTH, 0, {});
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(false);
  });

  test('returns false for a fusion thumb', () => {
    const ps = makePS(EARTH, 3, {}, true);
    expect(applyEarthParry(ps, makeRing(WOOD, 2, 3))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Tailwind (Wind thumb) — UNCHANGED
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

  test('returns false for fusion thumb', () => {
    const ps = makePS(WIND, 3, {}, true);
    expect(applyTailwind(ps, makeRing(FIRE, 3))).toBe(false);
  });
});
