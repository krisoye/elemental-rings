import { describe, test, expect } from 'vitest';
import {
  isBurning,
  isDrowning,
  isEntangled,
  applyTurnStart,
  applyGaugeCleanse,
  type PlayerLike,
} from '../../server/src/game/StatusEffects';
import { ElementEnum } from '../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

function makeRing(uses: number): { currentUses: number; isExtinguished: boolean } {
  return { currentUses: uses, isExtinguished: uses === 0 };
}

/** Build a PlayerLike with sensible defaults (3 hearts, all gauges 0, 3-use rings). */
function makePlayer(overrides: Partial<PlayerLike> = {}): PlayerLike {
  return {
    hearts: 3,
    fireGauge: 0,
    waterGauge: 0,
    woodGauge: 0,
    a1: makeRing(3),
    a2: makeRing(3),
    d1: makeRing(3),
    d2: makeRing(3),
    ...overrides,
  };
}

describe('status predicates', () => {
  test('isBurning true at threshold, false below', () => {
    expect(isBurning(makePlayer({ fireGauge: 4 }))).toBe(true);
    expect(isBurning(makePlayer({ fireGauge: 3 }))).toBe(false);
  });

  test('isDrowning true at threshold, false below', () => {
    expect(isDrowning(makePlayer({ waterGauge: 4 }))).toBe(true);
    expect(isDrowning(makePlayer({ waterGauge: 3 }))).toBe(false);
  });

  test('isEntangled true at threshold, false below', () => {
    expect(isEntangled(makePlayer({ woodGauge: 4 }))).toBe(true);
    expect(isEntangled(makePlayer({ woodGauge: 3 }))).toBe(false);
  });

  test('custom threshold is honored', () => {
    expect(isBurning(makePlayer({ fireGauge: 6 }), 7)).toBe(false);
    expect(isBurning(makePlayer({ fireGauge: 7 }), 7)).toBe(true);
  });
});

describe('applyTurnStart — Burning', () => {
  test('fireGauge=4 → heartLost, hearts 3→2', () => {
    const ps = makePlayer({ fireGauge: 4, hearts: 3 });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(true);
    expect(ps.hearts).toBe(2);
  });

  test('fireGauge=3 → no effect', () => {
    const ps = makePlayer({ fireGauge: 3, hearts: 3 });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(false);
    expect(ps.hearts).toBe(3);
  });

  test('Burning can KO (hearts 1→0)', () => {
    const ps = makePlayer({ fireGauge: 5, hearts: 1 });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(true);
    expect(ps.hearts).toBe(0);
  });
});

describe('applyTurnStart — Entangled', () => {
  test('woodGauge=4 → highest-use battle ring −1 use', () => {
    // a1=2, a2=3 (highest), d1=2, d2=1 → a2 should be drained to 2.
    const ps = makePlayer({
      woodGauge: 4,
      a1: makeRing(2),
      a2: makeRing(3),
      d1: makeRing(2),
      d2: makeRing(1),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('a2');
    expect(ps.a2.currentUses).toBe(2);
    // Others untouched.
    expect(ps.a1.currentUses).toBe(2);
    expect(ps.d1.currentUses).toBe(2);
    expect(ps.d2.currentUses).toBe(1);
  });

  test('Entangled below threshold does nothing', () => {
    const ps = makePlayer({ woodGauge: 3, a1: makeRing(3) });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBeNull();
    expect(ps.a1.currentUses).toBe(3);
  });

  test('Entangled drains to 0 → extinguished', () => {
    const ps = makePlayer({
      woodGauge: 4,
      a1: makeRing(1),
      a2: makeRing(0),
      d1: makeRing(0),
      d2: makeRing(0),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('a1');
    expect(ps.a1.currentUses).toBe(0);
    expect(ps.a1.isExtinguished).toBe(true);
  });

  test('Entangled with every battle ring extinguished is a no-op', () => {
    const ps = makePlayer({
      woodGauge: 4,
      a1: makeRing(0),
      a2: makeRing(0),
      d1: makeRing(0),
      d2: makeRing(0),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBeNull();
  });

  test('Entangled tie resolves to earlier slot (a1 over d1)', () => {
    const ps = makePlayer({
      woodGauge: 4,
      a1: makeRing(3),
      a2: makeRing(2),
      d1: makeRing(3),
      d2: makeRing(2),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('a1');
    expect(ps.a1.currentUses).toBe(2);
    expect(ps.d1.currentUses).toBe(3);
  });
});

describe('applyTurnStart — Drowning has no turn-start tick', () => {
  test('Drowning alone leaves hearts and rings unchanged', () => {
    const ps = makePlayer({ waterGauge: 5, hearts: 3, a1: makeRing(3) });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(false);
    expect(r.entangledRingKey).toBeNull();
    expect(ps.hearts).toBe(3);
    expect(ps.a1.currentUses).toBe(3);
  });
});

describe('applyGaugeCleanse', () => {
  test('Water catch → fireGauge decrements', () => {
    const ps = makePlayer({ fireGauge: 5 });
    applyGaugeCleanse(ps, WATER);
    expect(ps.fireGauge).toBe(4);
  });

  test('Water catch floors fireGauge at 0', () => {
    const ps = makePlayer({ fireGauge: 0 });
    applyGaugeCleanse(ps, WATER);
    expect(ps.fireGauge).toBe(0);
  });

  test('Wood catch → waterGauge decrements', () => {
    const ps = makePlayer({ waterGauge: 4 });
    applyGaugeCleanse(ps, WOOD);
    expect(ps.waterGauge).toBe(3);
  });

  test('Fire catch → woodGauge decrements', () => {
    const ps = makePlayer({ woodGauge: 4 });
    applyGaugeCleanse(ps, FIRE);
    expect(ps.woodGauge).toBe(3);
  });

  test('non-triangle defender (Earth) → no gauge change', () => {
    const ps = makePlayer({ fireGauge: 5, waterGauge: 5, woodGauge: 5 });
    applyGaugeCleanse(ps, EARTH);
    expect(ps.fireGauge).toBe(5);
    expect(ps.waterGauge).toBe(5);
    expect(ps.woodGauge).toBe(5);
  });

  test('non-triangle defender (Wind) → no gauge change', () => {
    const ps = makePlayer({ fireGauge: 5, waterGauge: 5, woodGauge: 5 });
    applyGaugeCleanse(ps, WIND);
    expect(ps.fireGauge).toBe(5);
    expect(ps.waterGauge).toBe(5);
    expect(ps.woodGauge).toBe(5);
  });

  test('cleanse only touches the countered gauge, not the others', () => {
    const ps = makePlayer({ fireGauge: 5, waterGauge: 5, woodGauge: 5 });
    applyGaugeCleanse(ps, WATER); // only fire
    expect(ps.fireGauge).toBe(4);
    expect(ps.waterGauge).toBe(5);
    expect(ps.woodGauge).toBe(5);
  });
});

describe('multiple statuses stack', () => {
  test('Burning + Entangled both fire at turn start', () => {
    const ps = makePlayer({
      fireGauge: 4,
      woodGauge: 4,
      hearts: 3,
      a1: makeRing(3),
      a2: makeRing(2),
      d1: makeRing(1),
      d2: makeRing(1),
    });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(true);
    expect(ps.hearts).toBe(2);
    expect(r.entangledRingKey).toBe('a1');
    expect(ps.a1.currentUses).toBe(2);
  });

  test('all three statuses active: predicates all true', () => {
    const ps = makePlayer({ fireGauge: 4, waterGauge: 4, woodGauge: 4 });
    expect(isBurning(ps)).toBe(true);
    expect(isDrowning(ps)).toBe(true);
    expect(isEntangled(ps)).toBe(true);
  });
});
