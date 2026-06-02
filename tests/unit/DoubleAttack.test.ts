/**
 * Unit tests for canDoubleAttack — the fusion-thumb double-attack eligibility
 * predicate (EPIC #264 / #265). Pure: builds PlayerState fixtures and asserts the
 * boolean predicate, with NO Colyseus room. Eligibility is:
 *   thumb.isFusion
 *   && sameSet([a1.element, a2.element], componentsOf(thumb.element))
 *   && a1.currentUses > 0 && a2.currentUses > 0 && thumb.currentUses > 0
 */
import { describe, test, expect } from 'vitest';
import { canDoubleAttack } from '../../server/src/game/DoubleAttack';
import { PlayerState } from '../../server/src/schemas/PlayerState';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';
import { isFusion } from '../../server/src/game/Fusions';

const { FIRE, WATER, EARTH, WIND, WOOD, MUD, STEAM } = ElementEnum;

/** Build a Ring with element + uses; isFusion is derived from the element. */
function makeRing(element: number, currentUses: number, maxUses?: number): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = currentUses;
  r.maxUses = maxUses ?? Math.max(currentUses, 3);
  r.isExtinguished = currentUses === 0;
  r.isFusion = isFusion(element);
  return r;
}

/**
 * Build a PlayerState with the given thumb/a1/a2 rings (d1/d2 are irrelevant to
 * the predicate, defaulted to WIND).
 */
function makePS(thumb: Ring, a1: Ring, a2: Ring): PlayerState {
  const ps = new PlayerState();
  ps.thumb = thumb;
  ps.a1 = a1;
  ps.a2 = a2;
  ps.d1 = makeRing(WIND, 3);
  ps.d2 = makeRing(WIND, 3);
  return ps;
}

describe('canDoubleAttack — eligible', () => {
  // MUD = WATER + EARTH (Fusions.componentsOf).
  test('fusion thumb (MUD) + A1=WATER A2=EARTH, all lit → eligible', () => {
    const ps = makePS(makeRing(MUD, 3), makeRing(WATER, 3), makeRing(EARTH, 3));
    expect(canDoubleAttack(ps)).toBe(true);
  });

  test('order-independent: A1=EARTH A2=WATER for MUD thumb → eligible', () => {
    const ps = makePS(makeRing(MUD, 3), makeRing(EARTH, 3), makeRing(WATER, 3));
    expect(canDoubleAttack(ps)).toBe(true);
  });

  test('STEAM thumb (FIRE+WATER) + A1=FIRE A2=WATER → eligible', () => {
    const ps = makePS(makeRing(STEAM, 2), makeRing(FIRE, 1), makeRing(WATER, 1));
    expect(canDoubleAttack(ps)).toBe(true);
  });

  test('minimum uses: thumb/a1/a2 all at exactly 1 use → eligible', () => {
    const ps = makePS(makeRing(MUD, 1), makeRing(WATER, 1), makeRing(EARTH, 1));
    expect(canDoubleAttack(ps)).toBe(true);
  });
});

describe('canDoubleAttack — ineligible', () => {
  test('base (non-fusion) thumb → ineligible even if A1/A2 are its would-be parts', () => {
    // FIRE thumb is a base element; isFusion=false.
    const ps = makePS(makeRing(FIRE, 3), makeRing(FIRE, 3), makeRing(WATER, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('A1/A2 do not match the fusion components (STEAM thumb, A1=WATER A2=EARTH)', () => {
    // STEAM = FIRE + WATER, but A2 is EARTH → set mismatch.
    const ps = makePS(makeRing(STEAM, 3), makeRing(WATER, 3), makeRing(EARTH, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('correct elements but duplicated (A1=WATER A2=WATER for MUD) → mismatch', () => {
    const ps = makePS(makeRing(MUD, 3), makeRing(WATER, 3), makeRing(WATER, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('thumb out of uses → ineligible', () => {
    const ps = makePS(makeRing(MUD, 0), makeRing(WATER, 3), makeRing(EARTH, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('A1 out of uses → ineligible', () => {
    const ps = makePS(makeRing(MUD, 3), makeRing(WATER, 0), makeRing(EARTH, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('A2 out of uses → ineligible', () => {
    const ps = makePS(makeRing(MUD, 3), makeRing(WATER, 3), makeRing(EARTH, 0));
    expect(canDoubleAttack(ps)).toBe(false);
  });

  test('WILDFIRE thumb (FIRE+WOOD) but A1=FIRE A2=EARTH → mismatch', () => {
    const ps = makePS(makeRing(ElementEnum.WILDFIRE, 3), makeRing(FIRE, 3), makeRing(EARTH, 3));
    expect(canDoubleAttack(ps)).toBe(false);
  });
});
