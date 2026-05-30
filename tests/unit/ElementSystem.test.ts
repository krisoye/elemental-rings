import { describe, test, expect } from 'vitest';
import {
  resolve,
  counterOf,
  isFusion,
  fusionBeats,
  fusionParents,
  componentsOf,
  triangleComponentsOf,
} from '../../server/src/game/ElementSystem';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD, SHADOW } = ElementEnum;

// #133 — Shadow element core (GDD §3.5). Shadow sits outside the triangle: it
// beats Wood, loses to Fire, and is neutral vs everything else (incl. mirror).
describe('Shadow matchups (§3.5)', () => {
  test('SHADOW enum is 15; no existing index shifted', () => {
    expect(SHADOW).toBe(15);
    expect(FIRE).toBe(0);
    expect(WOOD).toBe(4);
    expect(ElementEnum.DUST).toBe(14);
  });

  test('isFusion(SHADOW) is false (Shadow is a base element)', () => {
    expect(isFusion(SHADOW)).toBe(false);
  });

  test('componentsOf(SHADOW) → [SHADOW] (base, no fusion parents)', () => {
    expect(componentsOf(SHADOW)).toEqual([SHADOW]);
  });

  // defense-role: resolve(attackEl, defenderEl, 'defense') = the DEFENDER's standing.
  test('Shadow attack vs Wood defense → defender WEAK (Shadow beats Wood)', () => {
    expect(resolve(SHADOW, WOOD, 'defense')).toBe('WEAK');
  });
  test('Shadow attack vs Fire defense → defender STRONG (Fire dispels Shadow)', () => {
    expect(resolve(SHADOW, FIRE, 'defense')).toBe('STRONG');
  });
  test('Fire attack vs Shadow defense → Shadow defense WEAK', () => {
    expect(resolve(FIRE, SHADOW, 'defense')).toBe('WEAK');
  });
  test('Wood attack vs Shadow defense → Shadow defense STRONG (rally-capable)', () => {
    expect(resolve(WOOD, SHADOW, 'defense')).toBe('STRONG');
  });

  test('Shadow vs Water / Wind / Earth → NEUTRAL both directions', () => {
    for (const other of [WATER, WIND, EARTH]) {
      expect(resolve(SHADOW, other, 'defense')).toBe('NEUTRAL');
      expect(resolve(other, SHADOW, 'defense')).toBe('NEUTRAL');
      expect(resolve(SHADOW, other, 'attack')).toBe('NEUTRAL');
      expect(resolve(other, SHADOW, 'attack')).toBe('NEUTRAL');
    }
  });

  test('Shadow vs Shadow → NEUTRAL (mirror)', () => {
    expect(resolve(SHADOW, SHADOW, 'defense')).toBe('NEUTRAL');
    expect(resolve(SHADOW, SHADOW, 'attack')).toBe('NEUTRAL');
  });

  // attack-role mirrors: the attacker's standing.
  test('attack-role: Shadow vs Wood → attacker STRONG; Shadow vs Fire → attacker WEAK', () => {
    expect(resolve(SHADOW, WOOD, 'attack')).toBe('STRONG');
    expect(resolve(SHADOW, FIRE, 'attack')).toBe('WEAK');
  });
});
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

// #176 (EPIC #173 C3) — Compound element matchup (GDD §3.4). A fusion ring
// resolves as a single compound element: offensive profile = union of its
// triangle parents' strengths; no weakness; fused-vs-fused always Neutral.
const ALL_FUSIONS = [STEAM, WILDFIRE, INFERNO, MAGMA, TIDAL, STORM, MUD, THORNADO, BLOOM, DUST];

// §3.4 reference table: fusion → the base elements it beats.
const FUSION_BEATS_TABLE: Record<number, number[]> = {
  [STEAM]: [WOOD, FIRE], // Fire→Wood, Water→Fire
  [WILDFIRE]: [WOOD, WATER], // Fire→Wood, Wood→Water
  [TIDAL]: [FIRE, WATER], // Water→Fire, Wood→Water
  [INFERNO]: [WOOD], // Fire→Wood (Wind contributes nothing)
  [MAGMA]: [WOOD], // Fire→Wood (Earth contributes nothing)
  [STORM]: [FIRE], // Water→Fire (Wind contributes nothing)
  [MUD]: [FIRE], // Water→Fire (Earth contributes nothing)
  [THORNADO]: [WATER], // Wood→Water (Wind contributes nothing)
  [BLOOM]: [WATER], // Wood→Water (Earth contributes nothing)
  [DUST]: [], // Wind+Earth — beats nothing
};

const FUSION_NAME: Record<number, string> = {
  [STEAM]: 'STEAM',
  [WILDFIRE]: 'WILDFIRE',
  [INFERNO]: 'INFERNO',
  [MAGMA]: 'MAGMA',
  [TIDAL]: 'TIDAL',
  [STORM]: 'STORM',
  [MUD]: 'MUD',
  [THORNADO]: 'THORNADO',
  [BLOOM]: 'BLOOM',
  [DUST]: 'DUST',
};

describe('fusionBeats — §3.4 compound matchup table', () => {
  for (const fusion of ALL_FUSIONS) {
    const beaten = new Set(FUSION_BEATS_TABLE[fusion]);
    test(`${FUSION_NAME[fusion]} beats exactly [${FUSION_BEATS_TABLE[fusion]
      .map((e) => NAME[e])
      .join(', ')}]`, () => {
      for (const base of [FIRE, WATER, EARTH, WIND, WOOD, SHADOW]) {
        expect(fusionBeats(fusion, base)).toBe(beaten.has(base));
      }
    });
  }

  test('a fusion never beats another fusion (no weakness on either side)', () => {
    for (const a of ALL_FUSIONS) {
      for (const b of ALL_FUSIONS) {
        expect(fusionBeats(a, b)).toBe(false);
      }
    }
  });
});

describe('resolve — compound fusion vs base (§3.4)', () => {
  for (const fusion of ALL_FUSIONS) {
    const beaten = new Set(FUSION_BEATS_TABLE[fusion]);
    for (const base of [FIRE, WATER, EARTH, WIND, WOOD]) {
      const hit = beaten.has(base);

      // Fusion attacks a base defender.
      test(`${FUSION_NAME[fusion]} attack vs ${NAME[base]} → ${hit ? 'STRONG/WEAK' : 'NEUTRAL'}`, () => {
        expect(resolve(fusion, base, 'attack')).toBe(hit ? 'STRONG' : 'NEUTRAL');
        expect(resolve(fusion, base, 'defense')).toBe(hit ? 'WEAK' : 'NEUTRAL');
      });

      // Base attacks a fusion defender — fusion has NO weakness.
      test(`${NAME[base]} attack vs ${FUSION_NAME[fusion]} defense → ${
        hit ? 'STRONG' : 'NEUTRAL'
      } (never WEAK)`, () => {
        const def = resolve(base, fusion, 'defense');
        expect(def).toBe(hit ? 'STRONG' : 'NEUTRAL');
        expect(def).not.toBe('WEAK'); // fusion defender is never punished
        expect(resolve(base, fusion, 'attack')).toBe(hit ? 'WEAK' : 'NEUTRAL');
      });
    }

    // A fusion defender is never WEAK against ANY base attacker (incl. Shadow).
    test(`${FUSION_NAME[fusion]} defender is never WEAK vs any base attacker`, () => {
      for (const att of [FIRE, WATER, EARTH, WIND, WOOD, SHADOW]) {
        expect(resolve(att, fusion, 'defense')).not.toBe('WEAK');
      }
    });
  }
});

describe('resolve — fused-vs-fused is always NEUTRAL (§3.4)', () => {
  for (const a of ALL_FUSIONS) {
    for (const b of ALL_FUSIONS) {
      test(`${FUSION_NAME[a]} vs ${FUSION_NAME[b]} → NEUTRAL (both roles)`, () => {
        expect(resolve(a, b, 'attack')).toBe('NEUTRAL');
        expect(resolve(a, b, 'defense')).toBe('NEUTRAL');
      });
    }
  }
});
