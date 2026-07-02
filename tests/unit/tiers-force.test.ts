import { describe, test, expect } from 'vitest';
import { force, forceFromTier1, tierStartXp } from '../../shared/tiers';

// ---------------------------------------------------------------------------
// Force scalar (Contract A, EPIC #511 / #512). force(xp) = forceFromTier1(tierForXp(xp) + 1).
// Thresholds: T0=0, T1=500, T2=1500, T3=3000, T4=5000, T5=7500, T6=10500,
// T7=14000, T8=18000, T9=22500.
// ---------------------------------------------------------------------------

describe('force — Contract A table (XP → force)', () => {
  test('matches the Contract A table exactly', () => {
    expect(force(0)).toBe(1); // T1
    expect(force(tierStartXp(1))).toBe(2); // T2, tierStartXp(1) = 500
    expect(force(1500)).toBe(2); // T3
    expect(force(3000)).toBe(3); // T4
    expect(force(5000)).toBe(3); // T5
    expect(force(7500)).toBe(4); // T6
    expect(force(tierStartXp(6))).toBe(4); // T7
    expect(force(tierStartXp(7))).toBe(5); // T8
    expect(force(tierStartXp(8))).toBe(5); // T9
    expect(force(tierStartXp(9))).toBe(6); // T10
  });
});

describe('forceFromTier1 — 1-indexed tier → force', () => {
  test('matches the Contract A primitive exactly', () => {
    expect(forceFromTier1(1)).toBe(1);
    expect(forceFromTier1(2)).toBe(2);
    expect(forceFromTier1(3)).toBe(2);
    expect(forceFromTier1(4)).toBe(3);
    expect(forceFromTier1(6)).toBe(4);
    expect(forceFromTier1(10)).toBe(6);
  });
});
