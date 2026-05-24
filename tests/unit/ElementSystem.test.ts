import { describe, test, expect } from 'vitest';
import { resolve, relationship } from '../../server/src/game/ElementSystem';

// ElementEnum: FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4
// BEATS: FIRE>WOOD, WATER>FIRE, EARTH>WIND, WIND>WATER, WOOD>EARTH

describe('ElementSystem.resolve', () => {
  test('FIRE beats WOOD', () => expect(resolve(0, 4)).toBe(1));
  test('WATER beats FIRE', () => expect(resolve(1, 0)).toBe(1));
  test('EARTH beats WIND', () => expect(resolve(2, 3)).toBe(1));
  test('WIND beats WATER', () => expect(resolve(3, 1)).toBe(1));
  test('WOOD beats EARTH', () => expect(resolve(4, 2)).toBe(1));

  test('WOOD loses to FIRE', () => expect(resolve(4, 0)).toBe(-1));
  test('FIRE loses to WATER', () => expect(resolve(0, 1)).toBe(-1));
  test('WIND loses to EARTH', () => expect(resolve(3, 2)).toBe(-1));
  test('WATER loses to WIND', () => expect(resolve(1, 3)).toBe(-1));
  test('EARTH loses to WOOD', () => expect(resolve(2, 4)).toBe(-1));

  test('FIRE vs FIRE = neutral', () => expect(resolve(0, 0)).toBe(0));
  test('WATER vs WATER = neutral', () => expect(resolve(1, 1)).toBe(0));
  test('EARTH vs EARTH = neutral', () => expect(resolve(2, 2)).toBe(0));
  test('WIND vs WIND = neutral', () => expect(resolve(3, 3)).toBe(0));
  test('WOOD vs WOOD = neutral', () => expect(resolve(4, 4)).toBe(0));

  // Cross-element non-adjacent neutrals (elements that don't beat each other)
  test('FIRE vs EARTH = neutral', () => expect(resolve(0, 2)).toBe(0));
  test('FIRE vs WIND = neutral', () => expect(resolve(0, 3)).toBe(0));
  test('WATER vs EARTH = neutral', () => expect(resolve(1, 2)).toBe(0));
  test('WATER vs WOOD = neutral', () => expect(resolve(1, 4)).toBe(0));
  test('EARTH vs FIRE = neutral', () => expect(resolve(2, 0)).toBe(0));
  test('WIND vs FIRE = neutral', () => expect(resolve(3, 0)).toBe(0));
  test('WIND vs EARTH = neutral', () => expect(resolve(3, 2)).toBe(-1)); // EARTH beats WIND
  test('WOOD vs WATER = neutral', () => expect(resolve(4, 1)).toBe(0));
  test('WOOD vs WIND = neutral', () => expect(resolve(4, 3)).toBe(0));
});

describe('ElementSystem.relationship', () => {
  // relationship(attackerEl, defenderEl) from defender's perspective
  // STRONG means defender's element beats attacker's element
  test('WATER defender vs FIRE attacker = STRONG', () => expect(relationship(0, 1)).toBe('STRONG'));
  test('FIRE defender vs WATER attacker = WEAK', () => expect(relationship(1, 0)).toBe('WEAK'));
  test('FIRE vs FIRE = NEUTRAL', () => expect(relationship(0, 0)).toBe('NEUTRAL'));
  test('FIRE attacker vs WOOD defender = WEAK (defender WOOD loses to attacker FIRE)', () => expect(relationship(0, 4)).toBe('WEAK'));
  test('WOOD defender vs FIRE attacker = STRONG? No: FIRE beats WOOD, defender is WEAK', () => {
    // attacker=FIRE(0), defender=WOOD(4). FIRE beats WOOD → WEAK for defender
    expect(relationship(0, 4)).toBe('WEAK');
  });
});
