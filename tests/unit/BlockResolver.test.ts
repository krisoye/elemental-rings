import { describe, test, expect } from 'vitest';
import { classifyTiming, resolveBlock } from '../../server/src/game/BlockResolver';
import { Ring } from '../../server/src/schemas/Ring';

function makeRing(element: number, uses: number): Ring {
  const r = new Ring();
  r.element = element;
  r.currentUses = uses;
  r.maxUses = uses;
  r.isExtinguished = false;
  return r;
}

describe('classifyTiming', () => {
  test('not pressed → NO_BLOCK', () => expect(classifyTiming(0, false)).toBe('NO_BLOCK'));
  test('pressed at 0 → PARRY', () => expect(classifyTiming(0, true)).toBe('PARRY'));
  test('pressed at +70 → PARRY boundary', () => expect(classifyTiming(70, true)).toBe('PARRY'));
  test('pressed at -70 → PARRY boundary', () => expect(classifyTiming(-70, true)).toBe('PARRY'));
  test('pressed at +71 → BLOCK', () => expect(classifyTiming(71, true)).toBe('BLOCK'));
  test('pressed at +180 → BLOCK boundary', () => expect(classifyTiming(180, true)).toBe('BLOCK'));
  test('pressed at -180 → BLOCK boundary', () => expect(classifyTiming(-180, true)).toBe('BLOCK'));
  test('pressed at +181 → MISTIME', () => expect(classifyTiming(181, true)).toBe('MISTIME'));
  test('pressed at +600 → MISTIME', () => expect(classifyTiming(600, true)).toBe('MISTIME'));
});

describe('resolveBlock — gauge behaviour', () => {
  test('NO_BLOCK → gauge increases', () => {
    const result = resolveBlock(makeRing(0, 3), null, 'NO_BLOCK', 'NEUTRAL');
    expect(result.gaugeIncreases).toBe(true);
  });
  test('MISTIME → gauge increases', () => {
    const result = resolveBlock(makeRing(0, 3), makeRing(1, 3), 'MISTIME', 'STRONG');
    expect(result.gaugeIncreases).toBe(true);
  });
  test('BLOCK + NEUTRAL → gauge does not increase', () => {
    const result = resolveBlock(makeRing(0, 3), makeRing(0, 3), 'BLOCK', 'NEUTRAL');
    expect(result.gaugeIncreases).toBe(false);
  });
  test('BLOCK + WEAK → gauge does not increase (attack caught, wrong element)', () => {
    const result = resolveBlock(makeRing(0, 3), makeRing(4, 3), 'BLOCK', 'WEAK');
    expect(result.gaugeIncreases).toBe(false);
  });
  test('PARRY + STRONG → gauge does not increase', () => {
    const result = resolveBlock(makeRing(0, 3), makeRing(1, 3), 'PARRY', 'STRONG');
    expect(result.gaugeIncreases).toBe(false);
  });
});

describe('resolveBlock scenarios', () => {
  test('NO_BLOCK → heart lost, ring untouched', () => {
    const atk = makeRing(0, 3);
    const result = resolveBlock(atk, null, 'NO_BLOCK', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(true);
    expect(result.attackerHeartLost).toBe(false);
    expect(result.rallyContinues).toBe(false);
  });

  test('MISTIME → heart lost, -1 use on defender ring', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 3);
    const result = resolveBlock(atk, def, 'MISTIME', 'STRONG');
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('MISTIME with 1 use → extinguished, heart lost', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 1);
    const result = resolveBlock(atk, def, 'MISTIME', 'STRONG');
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });

  test('BLOCK + NEUTRAL → no heart lost, -1 use', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(0, 3);
    const result = resolveBlock(atk, def, 'BLOCK', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('PARRY + NEUTRAL → no heart lost, -1 use, no rally', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(0, 3);
    const result = resolveBlock(atk, def, 'PARRY', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('PARRY + STRONG → rally, volleyedElement = defender element, no heart lost', () => {
    const atk = makeRing(0, 3); // FIRE
    const def = makeRing(1, 3); // WATER
    const result = resolveBlock(atk, def, 'PARRY', 'STRONG');
    expect(result.rallyContinues).toBe(true);
    expect(result.volleyedElement).toBe(1);
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('BLOCK + STRONG → no heart lost, -1 use, no rally', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 3);
    const result = resolveBlock(atk, def, 'BLOCK', 'STRONG');
    expect(result.rallyContinues).toBe(false);
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('BLOCK + WEAK → heart lost, -1 use (not -2)', () => {
    const atk = makeRing(0, 3); // FIRE
    const def = makeRing(4, 3); // WOOD (weak vs FIRE)
    const result = resolveBlock(atk, def, 'BLOCK', 'WEAK');
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(2); // only -1 use
    expect(def.isExtinguished).toBe(false);
  });

  test('BLOCK + WEAK with 1 use → heart lost, ring extinguished', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(4, 1); // WOOD at 1 use
    const result = resolveBlock(atk, def, 'BLOCK', 'WEAK');
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });

  test('PARRY + WEAK → heart lost, -1 use, no rally', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(4, 3); // WOOD
    const result = resolveBlock(atk, def, 'PARRY', 'WEAK');
    expect(result.defenderHeartLost).toBe(true);
    expect(result.rallyContinues).toBe(false);
    expect(def.currentUses).toBe(2);
  });

  test('attacker ring extinguishes when uses hit 0', () => {
    const atk = makeRing(0, 0);
    atk.isExtinguished = false; // pre-throw state, set by resolveBlock
    const def = makeRing(1, 3);
    resolveBlock(atk, def, 'BLOCK', 'STRONG');
    expect(atk.isExtinguished).toBe(true);
  });
});
