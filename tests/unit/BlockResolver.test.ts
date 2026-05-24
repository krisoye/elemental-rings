import { describe, test, expect } from 'vitest';
import { classifyTiming, resolveBlock } from '../../server/src/game/BlockResolver';
import { Ring } from '../../server/src/schemas/Ring';
import { ElementEnum } from '../../shared/types';
import { fusionParents } from '../../server/src/game/ElementSystem';

const { FIRE, WATER, EARTH, WIND, WOOD, TIDAL, STEAM } = ElementEnum;

function makeRing(element: number, uses: number): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = uses;
  r.maxUses = uses;
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

describe('resolveBlock — base vs base', () => {
  test('NO_BLOCK → heart lost, gauge for the triangle element, ring untouched', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements).toEqual([FIRE]);
    expect(def.currentUses).toBe(3); // never committed
  });

  test('MISTIME → heart lost, gauge, defender ring -1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements).toEqual([FIRE]);
    expect(def.currentUses).toBe(2);
  });

  test('MISTIME with 1 use → extinguished', () => {
    const def = makeRing(WATER, 1);
    resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });

  test('BLOCK + NEUTRAL → safe, -1 use, no gauge', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.gaugeElements).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('BLOCK + STRONG (WATER blocks FIRE) → safe, -1 use, no rally', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('PARRY + STRONG (WATER parries FIRE) → rally, volley = WATER, no heart', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(WATER);
    expect(r.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('PARRY + NEUTRAL → safe, -1 use, no rally', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.rallyContinues).toBe(false);
    expect(r.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('BLOCK + WEAK (WOOD blocks FIRE) → heart lost, -1 use (not -2), no gauge', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'BLOCK');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements).toEqual([]);
    expect(def.currentUses).toBe(2);
  });

  test('PARRY + WEAK → heart lost, -1 use, no rally', () => {
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('Wind defense is always WEAK even on a perfect parry', () => {
    const def = makeRing(WIND, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'PARRY');
    expect(r.relationship).toBe('WEAK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.rallyContinues).toBe(false);
  });

  test('Earth defense is always NEUTRAL — safe, never rallies', () => {
    const def = makeRing(EARTH, 3);
    const r = resolveBlock(makeRing(WOOD, 3), def, 'PARRY');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.rallyContinues).toBe(false);
  });

  test('attacker ring extinguishes when uses already at 0', () => {
    const atk = makeRing(FIRE, 0);
    atk.isExtinguished = false;
    resolveBlock(atk, makeRing(WATER, 3), 'BLOCK');
    expect(atk.isExtinguished).toBe(true);
  });
});

// GDD §3.4: "Forest" = Water + Wood = TIDAL in our enum.
describe('resolveBlock — fusion attack (TIDAL = Water+Wood) vs single defense', () => {
  test('Fire defense (Parry): aligns to Wood (STRONG) → rally·Fire volley; Water lands (-1♥, +Water)', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(true); // Water component lands
    expect(r.gaugeElements).toEqual([WATER]);
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(FIRE);
    expect(def.currentUses).toBe(2); // exactly 1 use for the catch
  });

  test('Fire defense (Block): Wood STRONG block (safe); Water lands (-1♥, +Water); no rally', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements).toEqual([WATER]);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('Water defense (Parry): aligns to Water (NEUTRAL safe); Wood lands (-1♥, +Wood)', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements).toEqual([WOOD]);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('Wood defense (Parry): under v4 triangle, Wood is STRONG vs the Water component', () => {
    // NOTE: the resolved v4 triangle is "Wood beats Water", so a Wood defense
    // auto-aligns to the Water component (STRONG), NOT to the Wood component as
    // the stale GDD §3.4 example table (pre-v4 cycle) shows. STRONG outranks the
    // Wood-vs-Wood NEUTRAL, so Wood parries Water (rally·Wood volley) and the Wood
    // component lands uncontested (-1♥ · +Wood gauge).
    const def = makeRing(WOOD, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(true); // Wood component lands
    expect(r.gaugeElements).toEqual([WOOD]);
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(WOOD);
    expect(def.currentUses).toBe(2);
  });

  test('NO_BLOCK: both components land → -2♥-worth heart flag, gauges [Water, Wood]', () => {
    const r = resolveBlock(makeRing(TIDAL, 3), null, 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    // Both triangle components fill their gauges.
    expect(r.gaugeElements.sort()).toEqual([WATER, WOOD].sort());
  });

  test('MISTIME with Fire defense: both components land; defender ring -1 use', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'MISTIME');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.gaugeElements.sort()).toEqual([WATER, WOOD].sort());
    expect(def.currentUses).toBe(2);
  });
});

describe('resolveBlock — fusion defense (STEAM = Fire+Water) vs fusion attack (TIDAL)', () => {
  test('Parry: Steam fully covers Forest — safe on both, rally·Fire volley', () => {
    // Steam = [Fire, Water]. Greedy in defense order:
    //   Fire vs {Water, Wood}: STRONG vs Wood → engage Wood.
    //   Water vs {Water}:      NEUTRAL → engage Water.
    // Wood caught STRONG (Parry) → rally·Fire volley; Water caught NEUTRAL → safe.
    const def = makeRing(STEAM, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(false); // both components caught safely
    expect(r.gaugeElements).toEqual([]); // nothing landed
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(FIRE);
    expect(def.currentUses).toBe(2); // 1 use total for the fusion catch
  });

  test('Block: Steam covers both (no rally on Block timing)', () => {
    const def = makeRing(STEAM, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'BLOCK');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.gaugeElements).toEqual([]);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });
});
