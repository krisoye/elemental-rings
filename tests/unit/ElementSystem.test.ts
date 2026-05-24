import { describe, test, expect } from 'vitest';
import {
  resolve,
  counterOf,
  isFusion,
  fusionParents,
  componentsOf,
  triangleComponentsOf,
} from '../../server/src/game/ElementSystem';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;
const {
  STEAM,
  WILDFIRE,
  INFERNO,
  MAGMA,
  TIDAL,
  STORM,
  MUD,
  THORNADO,
  BLOOM,
  DUST,
} = ElementEnum;

const BASE = [FIRE, WATER, EARTH, WIND, WOOD];
const NAME: Record<number, string> = {
  [FIRE]: 'FIRE',
  [WATER]: 'WATER',
  [EARTH]: 'EARTH',
  [WIND]: 'WIND',
  [WOOD]: 'WOOD',
};

// Triangle cycle: Fire→Wood→Water→Fire. beats[a] = the element a defeats.
const beats: Record<number, number> = { [FIRE]: WOOD, [WOOD]: WATER, [WATER]: FIRE };
const isTri = (e: number): boolean => e === FIRE || e === WATER || e === WOOD;

/** Reference defender-standing (the Block Resolution Table input). */
function expectedDefense(att: number, def: number): 'STRONG' | 'NEUTRAL' | 'WEAK' {
  if (def === WIND) return 'WEAK';
  if (def === EARTH) return 'NEUTRAL';
  if (isTri(def)) {
    if (att === WIND || att === EARTH) return 'NEUTRAL';
    if (isTri(att)) {
      if (beats[def] === att) return 'STRONG';
      if (beats[att] === def) return 'WEAK';
      return 'NEUTRAL';
    }
  }
  return 'NEUTRAL';
}

/** Reference attacker-standing (mirror). */
function expectedAttack(att: number, def: number): 'STRONG' | 'NEUTRAL' | 'WEAK' {
  if (att === WIND) return 'NEUTRAL';
  if (att === EARTH) return 'WEAK';
  if (isTri(att)) {
    if (def === WIND) return 'STRONG';
    if (def === EARTH) return 'NEUTRAL';
    if (isTri(def)) {
      if (beats[att] === def) return 'STRONG';
      if (beats[def] === att) return 'WEAK';
      return 'NEUTRAL';
    }
  }
  return 'NEUTRAL';
}

describe('resolve — full 5x5 base truth table, both roles', () => {
  for (const att of BASE) {
    for (const def of BASE) {
      test(`defense: ${NAME[att]} attack vs ${NAME[def]} defense`, () => {
        expect(resolve(att, def, 'defense')).toBe(expectedDefense(att, def));
      });
      test(`attack: ${NAME[att]} attack vs ${NAME[def]} defense`, () => {
        expect(resolve(att, def, 'attack')).toBe(expectedAttack(att, def));
      });
    }
  }
});

describe('resolve — triangle cycle (Fire→Wood→Water→Fire)', () => {
  // Defense role: defender beats attacker → STRONG.
  test('WATER defends FIRE → STRONG (Water beats Fire)', () =>
    expect(resolve(FIRE, WATER, 'defense')).toBe('STRONG'));
  test('FIRE defends WOOD → STRONG (Fire beats Wood)', () =>
    expect(resolve(WOOD, FIRE, 'defense')).toBe('STRONG'));
  test('WOOD defends WATER → STRONG (Wood beats Water)', () =>
    expect(resolve(WATER, WOOD, 'defense')).toBe('STRONG'));
  // Inverse → WEAK.
  test('FIRE defends WATER → WEAK', () => expect(resolve(WATER, FIRE, 'defense')).toBe('WEAK'));
  test('WOOD defends FIRE → WEAK', () => expect(resolve(FIRE, WOOD, 'defense')).toBe('WEAK'));
  test('WATER defends WOOD → WEAK', () => expect(resolve(WOOD, WATER, 'defense')).toBe('WEAK'));
  // Same element → NEUTRAL.
  test('FIRE vs FIRE → NEUTRAL', () => expect(resolve(FIRE, FIRE, 'defense')).toBe('NEUTRAL'));
});

describe('resolve — Wind/Earth asymmetry', () => {
  test('Wind attack is always NEUTRAL (vs every defender)', () => {
    for (const def of BASE) expect(resolve(WIND, def, 'attack')).toBe('NEUTRAL');
  });
  test('Wind defense is always WEAK (vs every attacker)', () => {
    for (const att of BASE) expect(resolve(att, WIND, 'defense')).toBe('WEAK');
  });
  test('Earth attack is always WEAK (vs every defender)', () => {
    for (const def of BASE) expect(resolve(EARTH, def, 'attack')).toBe('WEAK');
  });
  test('Earth defense is always NEUTRAL (vs every attacker)', () => {
    for (const att of BASE) expect(resolve(att, EARTH, 'defense')).toBe('NEUTRAL');
  });
  test('Wind/Earth attacker carries no triangle threat for a triangle defender', () => {
    expect(resolve(WIND, FIRE, 'defense')).toBe('NEUTRAL');
    expect(resolve(EARTH, WATER, 'defense')).toBe('NEUTRAL');
    expect(resolve(WIND, WOOD, 'defense')).toBe('NEUTRAL');
  });
});

describe('counterOf — triangle counters only', () => {
  test('WATER counters FIRE', () => expect(counterOf(FIRE)).toBe(WATER));
  test('FIRE counters WOOD', () => expect(counterOf(WOOD)).toBe(FIRE));
  test('WOOD counters WATER', () => expect(counterOf(WATER)).toBe(WOOD));
  test('WIND has no single counter → -1', () => expect(counterOf(WIND)).toBe(-1));
  test('EARTH has no single counter → -1', () => expect(counterOf(EARTH)).toBe(-1));
  test('fusions have no single counter → -1', () => {
    expect(counterOf(STEAM)).toBe(-1);
    expect(counterOf(DUST)).toBe(-1);
  });
});

describe('fusion helpers', () => {
  test('isFusion: base elements are not fusions', () => {
    for (const e of BASE) expect(isFusion(e)).toBe(false);
  });
  test('isFusion: all 10 fusions are fusions', () => {
    for (const e of [STEAM, WILDFIRE, INFERNO, MAGMA, TIDAL, STORM, MUD, THORNADO, BLOOM, DUST]) {
      expect(isFusion(e)).toBe(true);
    }
  });

  test('fusionParents: base → null', () => expect(fusionParents(FIRE)).toBeNull());
  test('fusionParents: STEAM → [FIRE, WATER] (first is tiebreak winner)', () =>
    expect(fusionParents(STEAM)).toEqual([FIRE, WATER]));
  test('fusionParents: DUST → [WIND, EARTH]', () =>
    expect(fusionParents(DUST)).toEqual([WIND, EARTH]));
  test('fusionParents: BLOOM (Nature) → [WOOD, EARTH]', () =>
    expect(fusionParents(BLOOM)).toEqual([WOOD, EARTH]));

  test('componentsOf: base → [self]', () => expect(componentsOf(FIRE)).toEqual([FIRE]));
  test('componentsOf: fusion → its 2 parents', () =>
    expect(componentsOf(TIDAL)).toEqual([WATER, WOOD]));

  test('triangleComponentsOf: dual-triangle fusion → both parents', () =>
    expect(triangleComponentsOf(TIDAL)).toEqual([WATER, WOOD]));
  test('triangleComponentsOf: mixed fusion → only the triangle component', () =>
    expect(triangleComponentsOf(STORM)).toEqual([WATER]));
  test('triangleComponentsOf: pure-neutral fusion → []', () =>
    expect(triangleComponentsOf(DUST)).toEqual([]));
  test('triangleComponentsOf: base triangle → [self]', () =>
    expect(triangleComponentsOf(WOOD)).toEqual([WOOD]));
  test('triangleComponentsOf: base neutral → []', () =>
    expect(triangleComponentsOf(WIND)).toEqual([]));
});
