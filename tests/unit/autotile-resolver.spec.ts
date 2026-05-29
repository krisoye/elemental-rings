import { describe, it, expect } from 'vitest';
// Pure ESM .mjs resolver module under client/scripts/lib; vitest resolves it
// directly (no transpile needed), mirroring autotile-decoder.spec.ts.
import {
  resolveAutotileVariant,
  representativeMasks,
  VARIANT_COUNT,
  cornerStates,
} from '../../client/scripts/lib/autotile-resolver.mjs';

// Neighbour bit positions (bit0=N … bit7=NW), matching the resolver header.
const N = 1 << 0;
const NE = 1 << 1;
const E = 1 << 2;
const SE = 1 << 3;
const S = 1 << 4;
const SW = 1 << 5;
const W = 1 << 6;
const NW = 1 << 7;

describe('autotile resolver — blob-47 + isolated (48 slots)', () => {
  it('exposes exactly 48 variant slots', () => {
    expect(VARIANT_COUNT).toBe(48);
  });

  it('fully surrounded (all 8 neighbours) → variant 0 (interior)', () => {
    expect(resolveAutotileVariant(0xff)).toBe(0);
  });

  it('all 4 cardinal edges + all 4 corners → variant 0', () => {
    expect(resolveAutotileVariant(N | E | S | W | NE | SE | SW | NW)).toBe(0);
  });

  it('isolated tile (no neighbours) → variant 47', () => {
    expect(resolveAutotileVariant(0x00)).toBe(47);
  });

  it('diagonal-only neighbours (no cardinal edges) → isolated render slot 46', () => {
    expect(resolveAutotileVariant(NE)).toBe(46);
    expect(resolveAutotileVariant(NW | SE)).toBe(46);
    // Adding a cardinal edge connects it → no longer isolated.
    expect(resolveAutotileVariant(NE | E)).not.toBe(46);
  });

  it('returns an integer in [0,47] for every one of the 256 masks', () => {
    for (let mask = 0; mask < 256; mask++) {
      const v = resolveAutotileVariant(mask);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(47);
    }
  });

  it('all 48 variant slots are reachable across the 256 masks', () => {
    const seen = new Set<number>();
    for (let mask = 0; mask < 256; mask++) seen.add(resolveAutotileVariant(mask));
    expect(seen.size).toBe(48);
    for (let v = 0; v < 48; v++) expect(seen.has(v)).toBe(true);
  });

  // The 48-CASE TRUTH TABLE: for each variant index v there is a canonical
  // representative mask; resolving it must round-trip back to v. This pins the
  // full variant ordering and is the decoder's truth source companion.
  it('round-trips: resolve(representativeMasks()[v]) === v for all 48 variants', () => {
    const reps = representativeMasks();
    expect(reps).toHaveLength(48);
    for (let v = 0; v < 48; v++) {
      expect(reps[v]).toBeGreaterThanOrEqual(0);
      expect(reps[v]).toBeLessThanOrEqual(255);
      expect(resolveAutotileVariant(reps[v])).toBe(v);
    }
  });

  it('representative masks are unique per variant', () => {
    const reps = representativeMasks();
    expect(new Set(reps).size).toBe(48);
  });

  it('is deterministic — same mask always resolves to the same variant', () => {
    for (let mask = 0; mask < 256; mask++) {
      const a = resolveAutotileVariant(mask);
      const b = resolveAutotileVariant(mask);
      expect(a).toBe(b);
    }
  });

  describe('corner rule — a diagonal only matters when both adjacent edges are set', () => {
    it('NE corner is ignored unless both N and E are present', () => {
      // With N and E both present, toggling NE changes the render.
      expect(resolveAutotileVariant(N | E)).not.toBe(resolveAutotileVariant(N | E | NE));
      // With only N present (E absent), toggling NE must NOT change the render.
      expect(resolveAutotileVariant(N)).toBe(resolveAutotileVariant(N | NE));
      // With only E present (N absent), toggling NE must NOT change the render.
      expect(resolveAutotileVariant(E)).toBe(resolveAutotileVariant(E | NE));
    });

    it('SW corner is ignored unless both S and W are present', () => {
      expect(resolveAutotileVariant(S | W)).not.toBe(resolveAutotileVariant(S | W | SW));
      expect(resolveAutotileVariant(S)).toBe(resolveAutotileVariant(S | SW));
      expect(resolveAutotileVariant(W)).toBe(resolveAutotileVariant(W | SW));
    });

    it('irrelevant diagonal bits never change the variant', () => {
      // For every mask, clearing each diagonal whose two adjacent edges are NOT
      // both set must leave the variant unchanged.
      for (let mask = 0; mask < 256; mask++) {
        const base = resolveAutotileVariant(mask);
        const pairs: Array<[number, number, number]> = [
          [NE, N, E],
          [SE, S, E],
          [SW, S, W],
          [NW, N, W],
        ];
        for (const [diag, a, b] of pairs) {
          const bothEdges = (mask & a) !== 0 && (mask & b) !== 0;
          if (!bothEdges) {
            const toggled = mask ^ diag;
            // Skip the diagonal-only family (slot 46/47 split is by design).
            if ((mask & (N | E | S | W)) === 0) continue;
            expect(resolveAutotileVariant(toggled)).toBe(base);
          }
        }
      }
    });
  });

  describe('corner-state decomposition (decoder helper)', () => {
    it('surrounded → all four corners are flat fill', () => {
      const c = cornerStates(0xff);
      expect(c).toEqual({ NW: 'fill', NE: 'fill', SW: 'fill', SE: 'fill' });
    });

    it('isolated → all four corners are outer', () => {
      const c = cornerStates(0x00);
      expect(c).toEqual({ NW: 'outer', NE: 'outer', SW: 'outer', SE: 'outer' });
    });

    it('N and E set but NE clear → NE corner is concave (inner corner)', () => {
      expect(cornerStates(N | E).NE).toBe('concave');
    });

    it('N and E and NE set → NE corner is flat fill', () => {
      expect(cornerStates(N | E | NE).NE).toBe('fill');
    });

    it('only N set → NE and NW corners are edge pieces, S corners outer', () => {
      const c = cornerStates(N);
      expect(c.NE).toBe('edgeA'); // N is the "A" edge for NE
      expect(c.NW).toBe('edgeA'); // N is the "A" edge for NW
      expect(c.SE).toBe('outer');
      expect(c.SW).toBe('outer');
    });
  });

  it('rejects out-of-range and non-integer masks', () => {
    expect(() => resolveAutotileVariant(-1)).toThrow();
    expect(() => resolveAutotileVariant(256)).toThrow();
    expect(() => resolveAutotileVariant(1.5)).toThrow();
    // @ts-expect-error — exercise the runtime guard against non-numbers.
    expect(() => resolveAutotileVariant('7')).toThrow();
  });
});
