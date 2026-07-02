import { describe, test, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { force, forceFromTier1, tierStartXp, tierForXp } from '../../shared/tiers';

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

// ---------------------------------------------------------------------------
// QA adversarial pass (#512). The spec explicitly flags three risk areas to
// probe: xp=0 (the game's actual floor, divide-by-zero risk at the
// `1/force(xp)` call sites in BlockResolver), negative xp (shouldn't happen
// server-side, but must degrade safely), and very large xp (does force keep
// climbing correctly, no overflow/rounding surprises). This section also locks
// in the force/forceFromTier1/tierForXp composition invariant and the
// shared/tiers.ts → no server/ import architectural boundary the EPIC's whole
// rationale for this module's placement depends on.
// ---------------------------------------------------------------------------

describe('force — divide-by-zero safety at every documented tier (#512 adversarial)', () => {
  test.each([0, 1, 250, 499, 500, 1500, 3000, 5000, 7500, 100000, Number.MAX_SAFE_INTEGER])(
    'force(%i) is always a finite positive integer >= 1, never 0/NaN/Infinity — guards the two "1 / force(xp)" call sites in BlockResolver.ts',
    (xp) => {
      const f = force(xp);
      expect(Number.isFinite(f)).toBe(true);
      expect(Number.isInteger(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(1);
    },
  );

  test('force(0) — the actual floor for a brand-new ring — is exactly 1, so 1/force(0) is 1.0, never Infinity', () => {
    // adversarial #512: xp=0 is not a theoretical edge case — every ring is
    // born at xp=0 and can be blocked in battle before it ever earns XP.
    expect(force(0)).toBe(1);
    expect(1 / force(0)).toBe(1.0);
  });
});

describe('force — negative XP degrades safely instead of propagating NaN (#512 adversarial)', () => {
  // The server should never award negative XP, but tierForXp already clamps
  // negative XP to tier 0 (see Tiers.test.ts "negative XP returns 0 (guard
  // against NaN propagation)"). force must inherit that clamp, not bypass it.
  test.each([-1, -100, -Number.MAX_SAFE_INTEGER])(
    'force(%i) clamps to the tier-0 force (1), matching force(0) rather than throwing or returning NaN',
    (xp) => {
      expect(force(xp)).toBe(1);
      expect(force(xp)).toBe(force(0));
    },
  );
});

describe('force — very large XP: no overflow, no rounding surprises, force keeps climbing (#512 adversarial)', () => {
  test('force strictly increases across widely-spaced tiers far beyond the documented T10 threshold', () => {
    const xpSamples = [tierStartXp(9), tierStartXp(20), tierStartXp(50), tierStartXp(100)];
    let prev = force(xpSamples[0]);
    for (let i = 1; i < xpSamples.length; i++) {
      const cur = force(xpSamples[i]);
      expect(Number.isFinite(cur)).toBe(true);
      expect(cur).toBeGreaterThan(prev); // must keep climbing, never plateau or wrap
      prev = cur;
    }
  });

  test('force(Number.MAX_SAFE_INTEGER) stays a finite integer — no overflow to Infinity/NaN at the sqrt/floor arithmetic in tierForXp', () => {
    const f = force(Number.MAX_SAFE_INTEGER);
    expect(Number.isFinite(f)).toBe(true);
    expect(Number.isInteger(f)).toBe(true);
    expect(f).toBeGreaterThan(1);
  });
});

describe('force — monotonic non-decreasing across a dense XP sweep (#512 adversarial)', () => {
  test('force never regresses at any 250-XP step through tiers T0..T10', () => {
    // adversarial #512: force is a floor()-division composition; a subtle
    // off-by-one in the +1 normalization or forceFromTier1's rounding could
    // make force dip at a specific tier boundary that the sparse Contract A
    // table (only ~10 points) would never catch. Sweep densely instead.
    let prev = force(0);
    for (let xp = 0; xp <= tierStartXp(10); xp += 250) {
      const cur = force(xp);
      expect(cur).toBeGreaterThanOrEqual(prev);
      prev = cur;
    }
  });
});

describe('force — composition invariant: force(xp) === forceFromTier1(tierForXp(xp)+1) (#512 adversarial)', () => {
  // Code Reuse Directive: "force is defined strictly in terms of tierForXp; do
  // not inline a second copy of the tier thresholds." This property-based
  // check would catch a future refactor that hand-rolls tier math inside
  // force() instead of composing the two named primitives.
  test.each([0, 1, 250, 499, 500, 501, 1000, 1499, 1500, 2999, 3000, 5000, 7500, 10000, 50000])(
    'force(%i) === forceFromTier1(tierForXp(%i) + 1)',
    (xp) => {
      expect(force(xp)).toBe(forceFromTier1(tierForXp(xp) + 1));
    },
  );
});

describe('forceFromTier1 — full rounding table beyond the acceptance-criteria sample (#512 adversarial)', () => {
  // Acceptance criteria only samples forceFromTier1 at tier1 = 1,2,3,4,6,10.
  // This table fills in every 1-indexed tier from the degenerate tier1=0
  // (out-of-domain but must not throw or divide-by-zero) through 12, locking
  // in the floor((tier1+2)/2) rounding at every odd boundary the acceptance
  // criteria skipped (5, 7, 8, 9, 11, 12).
  test.each([
    [0, 1],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
    [8, 5],
    [9, 5],
    [10, 6],
    [11, 6],
    [12, 7],
  ])('forceFromTier1(%i) === %i', (tier1, expected) => {
    expect(forceFromTier1(tier1)).toBe(expected);
  });
});

describe('shared/tiers.ts architectural boundary — imports nothing under server/ (#512 adversarial)', () => {
  test('no import (static or dynamic require) reaches into server/', () => {
    // adversarial #512: the EPIC's entire rationale for placing force() in
    // shared/ instead of server/src/game/Tiers.ts is that the Phaser client
    // (RingCard force display) cannot import server-only code. A stray
    // `from '../server/...'` added later — e.g. importing a server constant
    // for convenience — would silently break the client build without any
    // server-side unit test catching it, since server tests would still pass.
    const src = fs.readFileSync(path.join(__dirname, '../../shared/tiers.ts'), 'utf8');
    const importLines = src.match(/^import .*from\s+['"][^'"]+['"];?/gm) ?? [];
    for (const line of importLines) {
      expect(line).not.toMatch(/server\//);
    }
    expect(src).not.toMatch(/require\(\s*['"][^'"]*server\//);
  });
});
