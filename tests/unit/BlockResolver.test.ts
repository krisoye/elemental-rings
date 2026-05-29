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
    expect(r.hitGaugeElements).toEqual([FIRE]);
    expect(def.currentUses).toBe(3); // never committed
  });

  test('MISTIME → heart lost, gauge, defender ring -1 use', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(FIRE, 3), def, 'MISTIME');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([FIRE]);
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
    expect(r.hitGaugeElements).toEqual([]);
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
    expect(r.hitGaugeElements).toEqual([]);
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
    expect(r.hitGaugeElements).toEqual([WATER]);
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(FIRE);
    expect(def.currentUses).toBe(2); // exactly 1 use for the catch
  });

  test('Fire defense (Block): Wood STRONG block (safe); Water lands (-1♥, +Water); no rally', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([WATER]);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('Water defense (Parry): aligns to Water (NEUTRAL safe); Wood lands (-1♥, +Wood)', () => {
    const def = makeRing(WATER, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'PARRY');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([WOOD]);
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
    expect(r.hitGaugeElements).toEqual([WOOD]);
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(WOOD);
    expect(def.currentUses).toBe(2);
  });

  test('NO_BLOCK: both components land → -2♥-worth heart flag, gauges [Water, Wood]', () => {
    const r = resolveBlock(makeRing(TIDAL, 3), null, 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    // Both triangle components fill their gauges.
    expect(r.hitGaugeElements.sort()).toEqual([WATER, WOOD].sort());
  });

  test('MISTIME with Fire defense: both components land; defender ring -1 use', () => {
    const def = makeRing(FIRE, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'MISTIME');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements.sort()).toEqual([WATER, WOOD].sort());
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
    expect(r.hitGaugeElements).toEqual([]); // nothing landed
    expect(r.rallyContinues).toBe(true);
    expect(r.volleyedElement).toBe(FIRE);
    expect(def.currentUses).toBe(2); // 1 use total for the fusion catch
  });

  test('Block: Steam covers both (no rally on Block timing)', () => {
    const def = makeRing(STEAM, 3);
    const r = resolveBlock(makeRing(TIDAL, 3), def, 'BLOCK');
    expect(r.defenderHeartLost).toBe(false);
    expect(r.hitGaugeElements).toEqual([]);
    expect(r.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });
});

// #123 — four-case gauge model. hitGaugeElements covered above; these pin the
// block (+1), strong-block (−1), and strong-parry (clear-all) directives.
describe('resolveBlock — four-case gauge directives (§7.1)', () => {
  test('NO_BLOCK: block/blocked/clear directives are all empty', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'NO_BLOCK');
    expect(r.blockGaugeElement).toBeNull();
    expect(r.blockedGaugeElement).toEqual([]);
    expect(r.clearAllGauges).toBe(false);
  });

  test('block with a triangle ring → its own gauge +1 (case 2)', () => {
    // Fire blocks Fire (NEUTRAL): no decrement, but the Fire ring fills FIRE +1.
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.blockGaugeElement).toBe(FIRE);
    expect(r.blockedGaugeElement).toEqual([]);
    expect(r.clearAllGauges).toBe(false);
  });

  test('Wind/Earth defense → no block gauge (case 2 skipped)', () => {
    const wind = resolveBlock(makeRing(FIRE, 3), makeRing(WIND, 3), 'BLOCK');
    expect(wind.blockGaugeElement).toBeNull();
    const earth = resolveBlock(makeRing(WOOD, 3), makeRing(EARTH, 3), 'BLOCK');
    expect(earth.blockGaugeElement).toBeNull();
  });

  test('Water strong block vs Fire → water +1, fire −1 (case 3)', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeElement).toBe(WATER);
    expect(r.blockedGaugeElement).toEqual([FIRE]);
    expect(r.clearAllGauges).toBe(false);
  });

  test('Wood strong block vs Water → wood +1, water −1 (case 3)', () => {
    const r = resolveBlock(makeRing(WATER, 3), makeRing(WOOD, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeElement).toBe(WOOD);
    expect(r.blockedGaugeElement).toEqual([WATER]);
  });

  test('Fire strong block vs Wood → fire +1, decrements wood (and shadow, #134)', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeElement).toBe(FIRE);
    // #134 extended Fire's strong block to decrement BOTH wood and shadow.
    expect(r.blockedGaugeElement).toContain(WOOD);
  });

  test('STRONG parry → clearAllGauges true (case 4)', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(WATER, 3), 'PARRY');
    expect(r.rallyContinues).toBe(true);
    expect(r.clearAllGauges).toBe(true);
    // The parrying Water ring still fills its own gauge (+1) on the catch.
    expect(r.blockGaugeElement).toBe(WATER);
  });

  test('NEUTRAL parry does NOT clear gauges', () => {
    const r = resolveBlock(makeRing(FIRE, 3), makeRing(FIRE, 3), 'PARRY');
    expect(r.rallyContinues).toBe(false);
    expect(r.clearAllGauges).toBe(false);
  });
});

// #134 — Shadow extends the four-case gauge directives.
describe('resolveBlock — Shadow gauge directives (§7.1 / §3.5)', () => {
  const SHADOW = ElementEnum.SHADOW;

  test('uncontested Shadow hit → hitGaugeElements [SHADOW]', () => {
    const r = resolveBlock(makeRing(SHADOW, 3), makeRing(WOOD, 3), 'NO_BLOCK');
    expect(r.defenderHeartLost).toBe(true);
    expect(r.hitGaugeElements).toEqual([SHADOW]);
  });

  test('blocking with a Shadow ring → blockGaugeElement SHADOW (+1)', () => {
    // Shadow vs Water is NEUTRAL — a safe catch that fills the Shadow ring's gauge.
    const r = resolveBlock(makeRing(WATER, 3), makeRing(SHADOW, 3), 'BLOCK');
    expect(r.relationship).toBe('NEUTRAL');
    expect(r.blockGaugeElement).toBe(SHADOW);
    expect(r.blockedGaugeElement).toEqual([]);
  });

  test('Fire strong block vs Shadow → fire +1, decrements BOTH wood and shadow', () => {
    const r = resolveBlock(makeRing(SHADOW, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG'); // Fire dispels Shadow
    expect(r.blockGaugeElement).toBe(FIRE);
    expect(r.blockedGaugeElement.sort()).toEqual([WOOD, SHADOW].sort());
  });

  test('Fire strong block vs Wood → fire +1, decrements BOTH wood and shadow (#134)', () => {
    const r = resolveBlock(makeRing(WOOD, 3), makeRing(FIRE, 3), 'BLOCK');
    expect(r.relationship).toBe('STRONG');
    expect(r.blockGaugeElement).toBe(FIRE);
    expect(r.blockedGaugeElement.sort()).toEqual([WOOD, SHADOW].sort());
  });
});
