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

describe('resolveBlock scenarios', () => {
  test('NO_BLOCK → defender loses heart', () => {
    const atk = makeRing(0, 3);
    const result = resolveBlock(atk, null, 'NO_BLOCK', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(true);
    expect(result.attackerHeartLost).toBe(false);
    expect(result.rallyContinues).toBe(false);
  });

  test('MISTIME → defender loses heart + use', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 3);
    const result = resolveBlock(atk, def, 'MISTIME', 'STRONG');
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('BLOCK + NEUTRAL → no heart lost, -1 use defender', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(0, 3); // same element = NEUTRAL
    const result = resolveBlock(atk, def, 'BLOCK', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('PARRY + NEUTRAL → no heart lost, -1 use defender, no rally', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(0, 3);
    const result = resolveBlock(atk, def, 'PARRY', 'NEUTRAL');
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(2);
    expect(result.rallyContinues).toBe(false);
  });

  test('PARRY + STRONG → rally, volleyedElement = defender element', () => {
    const atk = makeRing(0, 3); // FIRE
    const def = makeRing(1, 3); // WATER (strong vs FIRE)
    const result = resolveBlock(atk, def, 'PARRY', 'STRONG');
    expect(result.rallyContinues).toBe(true);
    expect(result.volleyedElement).toBe(1); // WATER
    expect(result.defenderHeartLost).toBe(false);
  });

  test('BLOCK + STRONG → no rally (only PARRY triggers rally)', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 3);
    const result = resolveBlock(atk, def, 'BLOCK', 'STRONG');
    expect(result.rallyContinues).toBe(false);
    expect(result.defenderHeartLost).toBe(false);
  });

  test('BLOCK + WEAK with surplus uses → -2 uses, no heart lost', () => {
    const atk = makeRing(0, 3); // FIRE
    const def = makeRing(4, 3); // WOOD (weak vs FIRE)
    const result = resolveBlock(atk, def, 'BLOCK', 'WEAK');
    // BLOCK+WEAK: currentUses -= 1 (3→2), then WEAK -= 1 more (2→1).
    // 3 - 1 - 1 = 1, which is not < 0, so no heart is lost.
    expect(result.defenderHeartLost).toBe(false);
    expect(def.currentUses).toBe(1);
  });

  test('BLOCK + WEAK with 1 use → heart lost, ring extinguished', () => {
    const atk = makeRing(0, 3); // FIRE
    const def = makeRing(4, 1); // WOOD at 1 use
    const result = resolveBlock(atk, def, 'BLOCK', 'WEAK');
    // 1 - 1 - 1 = -1 < 0 → heart lost, clamped to 0
    expect(result.defenderHeartLost).toBe(true);
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });

  test('PARRY + WEAK → heart lost (WEAK overrides PARRY rally)', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(4, 1); // WOOD at 1 use, WEAK vs FIRE
    const result = resolveBlock(atk, def, 'PARRY', 'WEAK');
    expect(result.defenderHeartLost).toBe(true);
    expect(result.rallyContinues).toBe(false);
  });

  test('attacker ring extinguishes when uses hit 0', () => {
    const atk = makeRing(0, 1); // FIRE at 1 use (already decremented by BattleRoom)
    atk.currentUses = 0; // simulating after throw
    const def = makeRing(1, 3);
    resolveBlock(atk, def, 'BLOCK', 'STRONG');
    expect(atk.isExtinguished).toBe(true);
  });

  test('MISTIME with 1 use → extinguished but no heart (uses clamped to 0)', () => {
    const atk = makeRing(0, 3);
    const def = makeRing(1, 1);
    const result = resolveBlock(atk, def, 'MISTIME', 'STRONG');
    expect(result.defenderHeartLost).toBe(true); // MISTIME always loses heart
    expect(def.currentUses).toBe(0);
    expect(def.isExtinguished).toBe(true);
  });
});
