import { describe, test, expect } from 'vitest';
import {
  isBurning,
  isDrowning,
  isEntangled,
  isBlinded,
  applyTurnStart,
  SHADOW_GAUGE_CAP,
  type PlayerLike,
} from '../../server/src/game/StatusEffects';

/**
 * Build a RingLike. `maxUses` defaults to `uses` (a full ring); pass it
 * explicitly to model a higher-capacity ring with fewer current uses — the v2
 * Drowning/Entangled drains pick by CAPACITY (max_uses), not current uses.
 */
function makeRing(
  uses: number,
  maxUses: number = uses,
): { currentUses: number; maxUses: number; isExtinguished: boolean } {
  return { currentUses: uses, maxUses, isExtinguished: uses === 0 };
}

/** Build a PlayerLike with sensible defaults (3 hearts, all gauges 0, 3-use rings). */
function makePlayer(overrides: Partial<PlayerLike> = {}): PlayerLike {
  return {
    hearts: 3,
    fireGauge: 0,
    waterGauge: 0,
    woodGauge: 0,
    shadowGauge: 0,
    a1: makeRing(3),
    a2: makeRing(3),
    d1: makeRing(3),
    d2: makeRing(3),
    ...overrides,
  };
}

describe('isBlinded (#134, §7.2)', () => {
  test('Blinded triggers at any stack (shadowGauge ≥ 1), not the triangle threshold', () => {
    expect(isBlinded(makePlayer({ shadowGauge: 0 }))).toBe(false);
    expect(isBlinded(makePlayer({ shadowGauge: 1 }))).toBe(true);
    expect(isBlinded(makePlayer({ shadowGauge: 5 }))).toBe(true);
  });

  test('Blinded has no turn-start tick (applyTurnStart leaves shadow/hearts/rings alone)', () => {
    const ps = makePlayer({ shadowGauge: 5, hearts: 3 });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(false);
    expect(r.drowningRingKey).toBeNull();
    expect(r.entangledRingKey).toBeNull();
    expect(ps.shadowGauge).toBe(5); // untouched
    expect(ps.hearts).toBe(3);
  });

  test('SHADOW_GAUGE_CAP is 5', () => {
    expect(SHADOW_GAUGE_CAP).toBe(5);
  });
});

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

describe('applyTurnStart — Drowning (v2: turn-start attack-ring drain)', () => {
  test('waterGauge=4 → highest-CAPACITY attack ring (a1/a2 by max_uses) −1 use', () => {
    // a1 max 3, a2 max 5 → a2 is highest-capacity; drains 5→4.
    const ps = makePlayer({
      waterGauge: 4,
      a1: makeRing(3, 3),
      a2: makeRing(5, 5),
      d1: makeRing(3, 3),
      d2: makeRing(3, 3),
    });
    const r = applyTurnStart(ps);
    expect(r.drowningRingKey).toBe('a2');
    expect(ps.a2.currentUses).toBe(4);
    expect(ps.a1.currentUses).toBe(3); // untouched
    // Defense rings are never touched by Drowning.
    expect(ps.d1.currentUses).toBe(3);
    expect(ps.d2.currentUses).toBe(3);
  });

  test('Drowning never drains a defense ring even if d-rings have higher capacity', () => {
    const ps = makePlayer({
      waterGauge: 4,
      a1: makeRing(2, 2),
      a2: makeRing(2, 2),
      d1: makeRing(5, 5),
      d2: makeRing(5, 5),
    });
    const r = applyTurnStart(ps);
    expect(['a1', 'a2']).toContain(r.drowningRingKey);
    expect(ps.d1.currentUses).toBe(5);
    expect(ps.d2.currentUses).toBe(5);
  });

  test('Drowning below threshold does nothing', () => {
    const ps = makePlayer({ waterGauge: 3, a1: makeRing(3) });
    const r = applyTurnStart(ps);
    expect(r.drowningRingKey).toBeNull();
    expect(ps.a1.currentUses).toBe(3);
  });

  test('Drowning with both attack rings extinguished is a no-op', () => {
    const ps = makePlayer({ waterGauge: 4, a1: makeRing(0), a2: makeRing(0) });
    const r = applyTurnStart(ps);
    expect(r.drowningRingKey).toBeNull();
  });

  test('Drowning capacity tie resolves to a1', () => {
    const ps = makePlayer({ waterGauge: 4, a1: makeRing(3, 3), a2: makeRing(3, 3) });
    const r = applyTurnStart(ps);
    expect(r.drowningRingKey).toBe('a1');
    expect(ps.a1.currentUses).toBe(2);
    expect(ps.a2.currentUses).toBe(3);
  });
});

describe('applyTurnStart — Entangled (v2: turn-start defense-ring drain)', () => {
  test('woodGauge=4 → highest-CAPACITY defense ring (d1/d2 by max_uses) −1 use', () => {
    // d1 max 3, d2 max 5 → d2 highest-capacity; drains 5→4.
    const ps = makePlayer({
      woodGauge: 4,
      a1: makeRing(3, 3),
      a2: makeRing(3, 3),
      d1: makeRing(3, 3),
      d2: makeRing(5, 5),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('d2');
    expect(ps.d2.currentUses).toBe(4);
    // Attack rings are never touched by Entangled.
    expect(ps.a1.currentUses).toBe(3);
    expect(ps.a2.currentUses).toBe(3);
    expect(ps.d1.currentUses).toBe(3);
  });

  test('Entangled below threshold does nothing', () => {
    const ps = makePlayer({ woodGauge: 3, d1: makeRing(3) });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBeNull();
    expect(ps.d1.currentUses).toBe(3);
  });

  test('Entangled drains to 0 → extinguished', () => {
    const ps = makePlayer({
      woodGauge: 4,
      d1: makeRing(1, 3),
      d2: makeRing(0, 3),
    });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('d1');
    expect(ps.d1.currentUses).toBe(0);
    expect(ps.d1.isExtinguished).toBe(true);
  });

  test('Entangled with both defense rings extinguished is a no-op', () => {
    const ps = makePlayer({ woodGauge: 4, d1: makeRing(0), d2: makeRing(0) });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBeNull();
  });

  test('Entangled capacity tie resolves to d1', () => {
    const ps = makePlayer({ woodGauge: 4, d1: makeRing(3, 3), d2: makeRing(2, 3) });
    const r = applyTurnStart(ps);
    expect(r.entangledRingKey).toBe('d1');
    expect(ps.d1.currentUses).toBe(2);
    expect(ps.d2.currentUses).toBe(2);
  });
});

describe('multiple statuses stack', () => {
  test('Burning + Drowning + Entangled all fire at turn start', () => {
    const ps = makePlayer({
      fireGauge: 4,
      waterGauge: 4,
      woodGauge: 4,
      hearts: 3,
      a1: makeRing(3, 3),
      a2: makeRing(2, 2),
      d1: makeRing(3, 3),
      d2: makeRing(2, 2),
    });
    const r = applyTurnStart(ps);
    expect(r.heartLost).toBe(true);
    expect(ps.hearts).toBe(2);
    expect(r.drowningRingKey).toBe('a1'); // capacity 3 > a2's 2
    expect(ps.a1.currentUses).toBe(2);
    expect(r.entangledRingKey).toBe('d1'); // capacity 3 > d2's 2
    expect(ps.d1.currentUses).toBe(2);
  });

  test('all three statuses active: predicates all true', () => {
    const ps = makePlayer({ fireGauge: 4, waterGauge: 4, woodGauge: 4 });
    expect(isBurning(ps)).toBe(true);
    expect(isDrowning(ps)).toBe(true);
    expect(isEntangled(ps)).toBe(true);
  });
});
