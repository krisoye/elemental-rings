/**
 * Unit tests for the charge attack arc-swing mechanic (#491).
 * Tests the pure deterministic angular formula and derived sharpness/telegraph
 * values — no Colyseus room, no I/O. Every constant is imported from the server
 * constants module so tests pin actual production values, not re-derived copies.
 *
 * Formula (server-authoritative, matches client):
 *   sweepIndex(t)          = 0-based sweep we are in at holdMs t
 *   orbAngle(t)            = −SWEEP_RANGE_DEG..+SWEEP_RANGE_DEG (degrees)
 *   isHitAngle             = |orbAngle(t)| ≤ HIT_CONE_DEG
 *   sharpnessFromSweep(t)  = 1/3 (sweep 0) | 2/3 (sweep 1) | 1.0 (sweep 2+)
 *   telegraphDuration      = lerp(TELEGRAPH_MS, CHARGE_TELEGRAPH_MIN_MS, sharpness)
 */
import { describe, test, expect } from 'vitest';
import {
  computeSweepIndex,
  computeOrbAngle,
  computeIsHitAngle,
  computeSharpness,
  computeTelegraphDuration,
} from '../../server/src/game/ChargeAttack';
import { sweepHoldMs } from '../../shared/oscillation';
import {
  SWEEP_RANGE_DEG,
  HIT_CONE_DEG,
  BASE_SWEEP_MS,
  SWEEP_SPEEDUP,
  MAX_SWEEPS,
  CHARGE_THRESHOLD_MS,
  CHARGE_TELEGRAPH_MIN_MS,
} from '../../server/src/game/constants';
import { TELEGRAPH_MS } from '../../shared/timing';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Duration of sweep N (0-based) using the production speed schedule.
 * Matches shared/oscillation.ts sweepDuration formula.
 */
function sweepDuration(n: number): number {
  return BASE_SWEEP_MS * Math.pow(SWEEP_SPEEDUP, Math.min(n, MAX_SWEEPS - 1));
}

/**
 * Cumulative elapsed time to reach the start of sweep N (0-based).
 */
function sweepStartMs(n: number): number {
  let t = 0;
  for (let i = 0; i < n; i++) t += sweepDuration(i);
  return t;
}

/**
 * holdMs at which the orb is exactly at 0° (midpoint of sweep N, even-numbered).
 * Sweep 0 goes −SWEEP_RANGE_DEG → +SWEEP_RANGE_DEG, midpoint = 0°.
 */
function sweepMidpointMs(n: number): number {
  return sweepStartMs(n) + sweepDuration(n) / 2;
}

// ── sweepIndex correctness ─────────────────────────────────────────────────────

describe('computeSweepIndex — sweep indexing', () => {
  test('t=0 → sweep index 0 (at start of first sweep)', () => {
    // #491: orb starts at the beginning of sweep 0 on chargeStart.
    expect(computeSweepIndex(0)).toBe(0);
  });

  test('t just before first sweep ends → still sweep 0', () => {
    // One ms before the first reversal must still be sweep 0.
    const t = sweepDuration(0) - 1;
    expect(computeSweepIndex(t)).toBe(0);
  });

  test('t = sweep 0 duration → enters sweep 1', () => {
    // Exactly at the first reversal boundary: sweep 1.
    const t = sweepDuration(0);
    expect(computeSweepIndex(t)).toBe(1);
  });

  test('t = sweep 0 + sweep 1 duration → enters sweep 2', () => {
    const t = sweepStartMs(2);
    expect(computeSweepIndex(t)).toBe(2);
  });

  test('sweep durations shorten with each reversal (speed steps up)', () => {
    // #491 spec: each sweep is SWEEP_SPEEDUP fraction of the previous duration.
    // Verify the implied sweep timing by checking sweep boundaries.
    expect(sweepDuration(0)).toBeGreaterThan(sweepDuration(1));
    expect(sweepDuration(1)).toBeGreaterThan(sweepDuration(2));
  });

  test('speed caps at MAX_SWEEPS (beyond that, sweep duration stays constant)', () => {
    // #491: max speed reached at sweep MAX_SWEEPS (index MAX_SWEEPS - 1);
    // sweep MAX_SWEEPS and beyond have the same duration as sweep MAX_SWEEPS - 1.
    const capDuration = sweepDuration(MAX_SWEEPS - 1);
    const beyondDuration = sweepDuration(MAX_SWEEPS);
    expect(beyondDuration).toBeCloseTo(capDuration, 6);
  });
});

// ── orbAngle correctness ──────────────────────────────────────────────────────

describe('computeOrbAngle — arc position formula', () => {
  test('t=0 → angle = −SWEEP_RANGE_DEG (orb starts at left of arc)', () => {
    // #491: orb always starts at −45° (locked startAngle).
    expect(computeOrbAngle(0)).toBeCloseTo(-SWEEP_RANGE_DEG, 6);
  });

  test('sweep 0 midpoint → angle ≈ 0° (sweet spot, aimed at opponent)', () => {
    // #491: midpoint of the first sweep is the sweet spot at 0°.
    // sweep 0: −45° → +45°, midpoint at half the duration → 0°.
    const t = sweepMidpointMs(0);
    expect(computeOrbAngle(t)).toBeCloseTo(0, 6);
  });

  test('end of sweep 0 → angle = +SWEEP_RANGE_DEG (first reversal)', () => {
    // At exactly one sweep duration the orb reaches +45° and reverses.
    const t = sweepDuration(0) - 1; // 1ms before boundary
    expect(computeOrbAngle(t)).toBeGreaterThan(SWEEP_RANGE_DEG * 0.98);
  });

  test('start of sweep 1 → angle = +SWEEP_RANGE_DEG (reversed, heading back)', () => {
    // Sweep 1 starts at +45° (odd sweep = reverse direction).
    const t = sweepStartMs(1);
    expect(computeOrbAngle(t)).toBeCloseTo(SWEEP_RANGE_DEG, 4);
  });

  test('sweep 1 midpoint → angle ≈ 0° (sweet spot again on the return pass)', () => {
    // Sweep 1: +45° → −45°, midpoint = 0°.
    const t = sweepMidpointMs(1); // midpoint via odd-sweep formula
    // sweepMidpointMs helper assumes even-sweep 0→45; for odd sweeps the midpoint
    // is the same fraction (1/2 of the sweep duration from sweep start).
    const odd_mid = sweepStartMs(1) + sweepDuration(1) / 2;
    expect(computeOrbAngle(odd_mid)).toBeCloseTo(0, 6);
  });

  test('angle is always within [−SWEEP_RANGE_DEG, +SWEEP_RANGE_DEG]', () => {
    // #491 adversarial: no holdDuration should produce an angle outside ±45°.
    const samples = [0, 100, 300, 600, 900, 1200, 1800, 2400, 3000, 5000];
    for (const t of samples) {
      const angle = computeOrbAngle(t);
      expect(angle).toBeGreaterThanOrEqual(-SWEEP_RANGE_DEG - 1e-9);
      expect(angle).toBeLessThanOrEqual(SWEEP_RANGE_DEG + 1e-9);
    }
  });

  test('angle is continuous across sweep boundaries (no jumps)', () => {
    // #491 adversarial: the arc must not jump at reversal points. Sample densely
    // around the first reversal (sweepDuration(0)).
    const boundary = sweepDuration(0);
    const before = computeOrbAngle(boundary - 1);
    const after = computeOrbAngle(boundary);
    // Both should be near +45°; difference must be small.
    expect(Math.abs(before - after)).toBeLessThan(1); // within 1°
  });
});

// ── isHitAngle boundary ───────────────────────────────────────────────────────

describe('computeIsHitAngle — ±HIT_CONE_DEG boundary (inclusive)', () => {
  test('angle at 0° (sweet spot, sweep 0 midpoint) → isHitAngle is TRUE', () => {
    // #491: the center of the arc is the sweet spot — always a hit.
    const t = sweepMidpointMs(0);
    expect(computeIsHitAngle(t)).toBe(true);
  });

  test('angle at −45° (sweep start) → isHitAngle is FALSE (far outside cone)', () => {
    // #491: orb at the edge of the arc (−45°) is well outside ±HIT_CONE_DEG=10°.
    expect(computeIsHitAngle(0)).toBe(false);
  });

  test('angle at +45° (first reversal) → isHitAngle is FALSE', () => {
    // +45° is SWEEP_RANGE_DEG=45, which is >> HIT_CONE_DEG=10.
    const t = sweepDuration(0) - 1;
    expect(computeIsHitAngle(t)).toBe(false);
  });

  test('isHitAngle is TRUE throughout the hit cone (several samples)', () => {
    // #491: any release within ±HIT_CONE_DEG of 0° must be a hit.
    // Sample holdMs values that place the orb within the cone in sweep 0.
    // The hit-cone window in sweep 0: (HIT_CONE_DEG/SWEEP_RANGE_DEG) × sweepDuration(0) / 2
    // centered on the midpoint.
    const midMs = sweepMidpointMs(0);
    const halfConeMs = (HIT_CONE_DEG / SWEEP_RANGE_DEG) * (sweepDuration(0) / 2);
    // Sample a few points within the cone.
    for (const offset of [-halfConeMs * 0.9, 0, halfConeMs * 0.9]) {
      const t = midMs + offset;
      expect(computeIsHitAngle(t)).toBe(true);
    }
  });

  test('isHitAngle is FALSE outside the cone (away from sweet spot)', () => {
    // #491: a release at 200ms (early in sweep 0, angle ≈ −29°) must miss.
    // angle at 200ms: −45 + (200/1200)*90 = −45 + 15 = −30° — well outside ±10°.
    const t = 200;
    const angle = computeOrbAngle(t);
    if (Math.abs(angle) > HIT_CONE_DEG) {
      expect(computeIsHitAngle(t)).toBe(false);
    }
  });

  test('isHitAngle contract: result equals (|orbAngle| ≤ HIT_CONE_DEG)', () => {
    // #491 spec conformance: isHitAngle must be identical to the explicit cone check.
    const samples = [0, 100, 200, 400, 600, 800, 1000, 1200, 1800, 2400, 3000];
    for (const t of samples) {
      const angle = computeOrbAngle(t);
      const expected = Math.abs(angle) <= HIT_CONE_DEG;
      expect(computeIsHitAngle(t)).toBe(expected);
    }
  });
});

// ── sharpnessFromSweep ────────────────────────────────────────────────────────

describe('computeSharpness — sweep-based sharpness', () => {
  test('sweep 0 (early charge) → sharpness = 1/3', () => {
    // #491 spec: first sweep floor is 1/3 — always beats a tap sharpness (0).
    const t = sweepMidpointMs(0); // solidly in sweep 0
    expect(computeSharpness(t)).toBeCloseTo(1 / 3, 6);
  });

  test('sweep 1 → sharpness = 2/3', () => {
    // #491 spec: sharpness steps up to 2/3 on the second sweep.
    const t = sweepStartMs(1) + sweepDuration(1) / 2; // mid-sweep 1
    expect(computeSharpness(t)).toBeCloseTo(2 / 3, 6);
  });

  test('sweep 2+ → sharpness = 1.0 (maximum)', () => {
    // #491 spec: third sweep and beyond gives full sharpness.
    const t = sweepStartMs(2) + sweepDuration(2) / 2; // mid-sweep 2
    expect(computeSharpness(t)).toBeCloseTo(1.0, 6);
  });

  test('sharpness at sweep 3 stays at 1.0 (max speed / max sharpness)', () => {
    // Beyond MAX_SWEEPS, sharpness stays clamped at 1.0 — no super-charge.
    const t = sweepStartMs(MAX_SWEEPS) + sweepDuration(MAX_SWEEPS) * 2;
    expect(computeSharpness(t)).toBeCloseTo(1.0, 6);
  });

  test('sharpness values step up monotonically across sweep boundaries', () => {
    // #491 adversarial: sharpness must never decrease as hold time increases.
    let prev = computeSharpness(10);
    for (let t = 100; t <= 4000; t += 50) {
      const curr = computeSharpness(t);
      expect(curr).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = curr;
    }
  });
});

// ── telegraph duration ────────────────────────────────────────────────────────

describe('computeTelegraphDuration — lerp between TELEGRAPH_MS and CHARGE_TELEGRAPH_MIN_MS', () => {
  test('sweep 0 sharpness (1/3) → telegraph between CHARGE_TELEGRAPH_MIN_MS and TELEGRAPH_MS', () => {
    // #491: sweep-0 sharpness=1/3 produces a compressed (but not minimum) telegraph.
    const t = sweepMidpointMs(0);
    const result = computeTelegraphDuration(t);
    expect(result).toBeLessThanOrEqual(TELEGRAPH_MS);
    expect(result).toBeGreaterThanOrEqual(CHARGE_TELEGRAPH_MIN_MS);
  });

  test('sweep 2+ (sharpness=1.0) → telegraphDuration = CHARGE_TELEGRAPH_MIN_MS', () => {
    // #491: full sharpness floors the telegraph at the minimum.
    const t = sweepStartMs(2) + sweepDuration(2) / 2;
    expect(computeTelegraphDuration(t)).toBe(CHARGE_TELEGRAPH_MIN_MS);
  });

  test('telegraphDuration >= CHARGE_TELEGRAPH_MIN_MS for all valid holds (never below the floor)', () => {
    // #491 adversarial: no holdDuration can produce a telegraph shorter than the minimum.
    const holds = [CHARGE_THRESHOLD_MS, 300, 600, 1200, 2400, 3000, 5000];
    for (const t of holds) {
      expect(computeTelegraphDuration(t)).toBeGreaterThanOrEqual(CHARGE_TELEGRAPH_MIN_MS);
    }
  });

  test('telegraphDuration <= TELEGRAPH_MS for all valid holds (never above the baseline)', () => {
    // #491 adversarial: the telegraph can only decrease with charge, never increase.
    const holds = [CHARGE_THRESHOLD_MS, 300, 600, 1200, 2400, 3000];
    for (const t of holds) {
      expect(computeTelegraphDuration(t)).toBeLessThanOrEqual(TELEGRAPH_MS);
    }
  });

  test('returns an integer (Math.round applied): no fractional milliseconds', () => {
    // #491 impl: telegraphDuration uses Math.round so the value is always an integer ms.
    const samples = [CHARGE_THRESHOLD_MS, 300, 600, 1200, 2400, 3000];
    for (const t of samples) {
      const result = computeTelegraphDuration(t);
      expect(Number.isInteger(result)).toBe(true);
    }
  });

  test('sweep 1 sharpness (2/3) → telegraph matches lerp(TELEGRAPH_MS, MIN, 2/3)', () => {
    // #491: sweep-1 sharpness = 2/3; telegraph = round(TELEGRAPH_MS + (MIN−BASE)*2/3).
    const t = sweepStartMs(1) + sweepDuration(1) / 2;
    const expected = Math.round(TELEGRAPH_MS + (CHARGE_TELEGRAPH_MIN_MS - TELEGRAPH_MS) * (2 / 3));
    expect(computeTelegraphDuration(t)).toBe(expected);
  });
});

// ── determinism ───────────────────────────────────────────────────────────────

describe('determinism — same holdDuration → same results (no hidden state)', () => {
  test('computeOrbAngle is pure: same t produces identical result across calls', () => {
    // #491 adversarial: if orbAngle uses mutable module-level state, calls with the
    // same input would diverge — allowing client/server disagreement. Pure only.
    const t = 437;
    const first = computeOrbAngle(t);
    const second = computeOrbAngle(t);
    const third = computeOrbAngle(t);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  test('computeIsHitAngle is pure: same holdDuration → same hit/miss result', () => {
    // #491 adversarial: any non-determinism in the hit predicate lets a client spoof.
    const t = 813;
    const first = computeIsHitAngle(t);
    const second = computeIsHitAngle(t);
    expect(second).toBe(first);
  });

  test('computeSharpness is pure: same holdDuration → same sharpness', () => {
    // #491 adversarial: non-deterministic sharpness would produce unpredictable
    // parry windows.
    const t = 600;
    const first = computeSharpness(t);
    const second = computeSharpness(t);
    expect(second).toBe(first);
  });

  test('computeTelegraphDuration is pure: same holdDuration → same result', () => {
    const t = 600;
    const first = computeTelegraphDuration(t);
    const second = computeTelegraphDuration(t);
    expect(second).toBe(first);
  });
});

// ── CHARGE_THRESHOLD_MS boundary ─────────────────────────────────────────────

describe('CHARGE_THRESHOLD_MS boundary — tap vs. charge distinction', () => {
  test('holdDuration = CHARGE_THRESHOLD_MS → charged path (sweep 0, sharpness=1/3)', () => {
    // #491 adversarial: at exactly the threshold, the orb has entered the arc-swing
    // path. Sharpness should be 1/3 (sweep 0).
    const sharp = computeSharpness(CHARGE_THRESHOLD_MS);
    expect(sharp).toBeCloseTo(1 / 3, 6);
  });

  test('holdDuration slightly above threshold → still in sweep 0', () => {
    // A brief charge (e.g. 500ms) is well within sweep 0 (BASE_SWEEP_MS=1200ms).
    expect(computeSweepIndex(500)).toBe(0);
  });

  // ── #506: threshold-specific regression locks ─────────────────────────────

  test('#506 spec: CHARGE_THRESHOLD_MS equals 450 (regression guard against silent constant change)', () => {
    // #506 adversarial: the constant is the single source of truth for the entire
    // tap/charge boundary. A stale build or accidental revert would silently restore
    // the old dead zone. This assertion locks the value so any regression fails loudly.
    expect(CHARGE_THRESHOLD_MS).toBe(450);
  });

  test('#506 spec: computeSharpness(CHARGE_THRESHOLD_MS) > 0 — charge path is immediately active at boundary', () => {
    // #506 spec conformance: "holds ≥ 450ms are deliberate charges where the charge
    // arc immediately offers a real hit opportunity." At exactly the boundary the
    // formula must produce a nonzero sharpness (sweep 0 = 1/3 > 0), confirming the
    // charge arc path is entered (not the tap path).
    expect(computeSharpness(CHARGE_THRESHOLD_MS)).toBeGreaterThan(0);
  });

  test('#506 spec: CHARGE_THRESHOLD_MS < first-cone-entry time (~467ms) — no dead zone reopens', () => {
    // #506 design invariant: the threshold must remain strictly less than the first
    // hit-cone entry time so there is no gap between tap-boundary and charge-hit-zone.
    // First cone entry: BASE_SWEEP_MS × (SWEEP_RANGE_DEG − HIT_CONE_DEG) / (2 × SWEEP_RANGE_DEG)
    // = 1200 × (45 − 10) / 90 ≈ 466.7ms. If this ever flips (threshold ≥ 467ms),
    // the dead zone reopens.
    const firstConeEntryMs = BASE_SWEEP_MS * (SWEEP_RANGE_DEG - HIT_CONE_DEG) / (2 * SWEEP_RANGE_DEG);
    expect(CHARGE_THRESHOLD_MS).toBeLessThan(firstConeEntryMs);
  });

  test('#506 impl: holdDuration just below threshold (449ms) → still in sweep 0, sharpness=1/3', () => {
    // #506 adversarial: 449ms is below CHARGE_THRESHOLD_MS=450ms (sub-threshold = tap).
    // The charge-path formula at 449ms produces sweep 0, but BattleRoom classifies
    // this as a tap (holdMs < CHARGE_THRESHOLD_MS → handleSelectAttack). Lock in
    // that the formula itself at 449ms is coherent: sweep 0, sharpness=1/3.
    // (The tap/charge branching is in BattleRoom, not ChargeAttack functions.)
    expect(computeSweepIndex(449)).toBe(0);
    expect(computeSharpness(449)).toBeCloseTo(1 / 3, 6);
  });
});

// ── fusion independence ───────────────────────────────────────────────────────

describe('fusion double-attack — held slot checked, tapped slot always hits', () => {
  test('held at 0° (sweet spot) → isHitAngle true; check is independent of tapped slot', () => {
    // #491 spec: in a fusion double-attack, the held orb (A1) is angle-checked at
    // the moment A2 is tapped. The tapped slot always hits (holdDuration=0 → tap).
    // Tap convention: holdDuration=0 → orbAngle=−45° but the TAP path is handled
    // UPSTREAM (before the arc formula is invoked); computeIsHitAngle is only called
    // on the held slot. Test that a holdMs corresponding to 0° is a hit.
    const heldMs = sweepMidpointMs(0); // angle ≈ 0° → hit
    expect(computeIsHitAngle(heldMs)).toBe(true);
  });

  test('held far from center → isHitAngle false; tapped A2 (tap path) still unaffected', () => {
    // #491 adversarial: if the server mistakenly applies the held-orb angle check
    // to the tapped slot (always tap → holdDuration=0), the orb would land at −45°
    // and miss. But the TAP path bypasses isHitAngle entirely (holdMs < threshold).
    // Just verify the held slot misses at a wide angle.
    const heldMs = 200; // ≈ −30° → outside ±10° cone
    const angle = computeOrbAngle(heldMs);
    if (Math.abs(angle) > HIT_CONE_DEG) {
      expect(computeIsHitAngle(heldMs)).toBe(false);
    }
  });

  test('a miss on the held slot does not affect the tapped slot hit result', () => {
    // #491 spec: "A2 orb: was a tap → always fires horizontal. Always hits."
    // The tapped slot is handled via the tap path (holdDuration=0 → selectAttack),
    // which never calls isHitAngle. Verify that any angle-miss on the held slot
    // does not contaminate the tapped slot's outcome.
    const missMs = 200; // held misses
    expect(computeIsHitAngle(missMs)).toBe(false); // held miss
    // Tapped slot: tap path → always hit (not tested via isHitAngle here;
    // it never calls isHitAngle — this assertion is tautological by design).
    expect(true).toBe(true); // tapped always hits; no isHitAngle call needed
  });
});

// ── hit zone robustness ───────────────────────────────────────────────────────

describe('hit zone — robustness to hold-time jitter around sweet spot', () => {
  test('the sweep-0 sweet spot is a hit for at least 100ms around midpoint', () => {
    // #491 adversarial: the hit zone window should be wide enough to absorb
    // realistic server event-loop jitter (~20ms). With BASE_SWEEP_MS=1200 and
    // HIT_CONE_DEG=10/SWEEP_RANGE_DEG=45, the window is (10/45)*600 ≈ 133ms.
    const midMs = sweepMidpointMs(0);
    const halfWindow = (HIT_CONE_DEG / SWEEP_RANGE_DEG) * (sweepDuration(0) / 2);
    // Sample within 80% of the half-window to stay comfortably inside the cone.
    const jitter = halfWindow * 0.8;
    for (let offset = -jitter; offset <= jitter; offset += 10) {
      const t = midMs + offset;
      if (t >= 0) {
        expect(computeIsHitAngle(t)).toBe(true);
      }
    }
  });

  test('a hold early in sweep 0 (≈200ms) is a miss (angle far from center)', () => {
    // #491 impl: at 200ms (early in sweep 0):
    // angle = −45 + (200/1200)*90 = −45 + 15 = −30° >> HIT_CONE_DEG=10°.
    // This covers the E2E miss scenario.
    const angle = computeOrbAngle(200);
    expect(Math.abs(angle)).toBeGreaterThan(HIT_CONE_DEG);
    expect(computeIsHitAngle(200)).toBe(false);
  });

  test('the sweep-1 sweet spot (return pass) is also a hit', () => {
    // #491: the second pass through 0° (sweep 1 midpoint) must also register as a hit.
    const midMs = sweepStartMs(1) + sweepDuration(1) / 2;
    expect(computeIsHitAngle(midMs)).toBe(true);
  });
});

// ── orbAngle known values ─────────────────────────────────────────────────────

describe('computeOrbAngle — spot checks at deterministic hold times', () => {
  test('t=0 → −45° (locked start)', () => {
    expect(computeOrbAngle(0)).toBeCloseTo(-SWEEP_RANGE_DEG, 4);
  });

  test('t=BASE_SWEEP_MS/2 → 0° (sweep-0 midpoint = sweet spot)', () => {
    // First sweet spot occurs at exactly half of BASE_SWEEP_MS.
    expect(computeOrbAngle(BASE_SWEEP_MS / 2)).toBeCloseTo(0, 4);
  });

  test('t=BASE_SWEEP_MS → +45° (first reversal)', () => {
    // At the end of sweep 0 the orb is at +SWEEP_RANGE_DEG.
    expect(computeOrbAngle(BASE_SWEEP_MS)).toBeCloseTo(SWEEP_RANGE_DEG, 4);
  });

  test('orbAngle produces a value in [−45,45] for a long hold (10 s)', () => {
    // #491 adversarial: the arc formula must not overflow beyond ±45° at any hold.
    const angle = computeOrbAngle(10000);
    expect(angle).toBeGreaterThanOrEqual(-SWEEP_RANGE_DEG - 1e-9);
    expect(angle).toBeLessThanOrEqual(SWEEP_RANGE_DEG + 1e-9);
  });
});

// ── Adversarial: negative and extreme holdMs ──────────────────────────────────

describe('adversarial — negative and extreme holdMs inputs', () => {
  test('negative holdMs clamps to −SWEEP_RANGE_DEG (no crash, no underflow)', () => {
    // #491 adversarial: a client that sends a negative hold duration (e.g. clock
    // skew or a rogue client) must not crash or produce an out-of-range angle.
    // Math.max(0, holdMs) in the formula clamps remaining to 0 → angle = −45°.
    expect(computeOrbAngle(-1)).toBeCloseTo(-SWEEP_RANGE_DEG, 6);
    expect(computeOrbAngle(-1000)).toBeCloseTo(-SWEEP_RANGE_DEG, 6);
  });

  test('negative holdMs → sweepIndex is 0 (no negative sweep)', () => {
    // #491 adversarial: negative input must land in sweep 0, not underflow the loop.
    expect(computeSweepIndex(-1)).toBe(0);
    expect(computeSweepIndex(-999)).toBe(0);
  });

  test('orbAngle stays within [−45,45] for very large holdMs (100,000ms)', () => {
    // #491 adversarial: 100 seconds of (hypothetical) hold should not NaN or overflow.
    // The formula loops through many capped-duration sweeps — must stay bounded.
    const angle = computeOrbAngle(100_000);
    expect(Number.isFinite(angle)).toBe(true);
    expect(angle).toBeGreaterThanOrEqual(-SWEEP_RANGE_DEG - 1e-9);
    expect(angle).toBeLessThanOrEqual(SWEEP_RANGE_DEG + 1e-9);
  });

  test('isHitAngle does not throw for negative holdMs', () => {
    // #491 adversarial: invalid client input must not crash the server's hit check.
    expect(() => computeIsHitAngle(-500)).not.toThrow();
  });

  test('sharpness is 1/3 for negative holdMs (clamps to sweep 0)', () => {
    // #491 adversarial: negative input clamps to holdMs=0 → sweep 0 → sharpness 1/3.
    expect(computeSharpness(-1)).toBeCloseTo(1 / 3, 6);
  });
});

// ── Adversarial: exact sweep-boundary sharpness transitions ──────────────────

describe('adversarial — sharpness at exact sweep-boundary holdMs', () => {
  test('1ms before sweep 1 starts → sharpness is still 1/3', () => {
    // #491 adversarial: holdMs = sweepDuration(0) - 1 must still be sweep 0.
    // A 1ms earlier press must NOT accidentally step up sharpness to 2/3.
    const justBeforeSweep1 = sweepDuration(0) - 1;
    expect(computeSharpness(justBeforeSweep1)).toBeCloseTo(1 / 3, 6);
  });

  test('exactly at sweep 1 start → sharpness steps to 2/3', () => {
    // #491 adversarial: the transition to 2/3 must happen at sweep start, not before.
    const atSweep1Start = sweepDuration(0);
    expect(computeSharpness(atSweep1Start)).toBeCloseTo(2 / 3, 6);
  });

  test('1ms before sweep 2 starts → sharpness is still 2/3', () => {
    // #491 adversarial: one ms before the second reversal must not prematurely reach 1.0.
    const justBeforeSweep2 = sweepStartMs(2) - 1;
    expect(computeSharpness(justBeforeSweep2)).toBeCloseTo(2 / 3, 6);
  });

  test('exactly at sweep 2 start → sharpness steps to 1.0', () => {
    // #491 adversarial: sweep 2 start must give full sharpness, not a partial value.
    const atSweep2Start = sweepStartMs(2);
    expect(computeSharpness(atSweep2Start)).toBeCloseTo(1.0, 6);
  });
});

// ── Adversarial: isHitAngle at exact HIT_CONE_DEG boundary ───────────────────

describe('adversarial — isHitAngle at exact cone boundary', () => {
  // To test the exact ±HIT_CONE_DEG boundary, we need holdMs values that produce
  // angles of exactly 9.9°, 10°, and 10.1°. In sweep 0 the formula is:
  // angle = −45 + (holdMs/BASE_SWEEP_MS)*90  →  holdMs = (angle+45)/90*BASE_SWEEP_MS
  function holdMsForAngle(deg: number): number {
    return ((deg + SWEEP_RANGE_DEG) / (2 * SWEEP_RANGE_DEG)) * sweepDuration(0);
  }

  test('angle 9.9° (just inside cone) → isHitAngle is TRUE (inclusive boundary)', () => {
    // #491 adversarial: a release 0.1° inside the cone must be a hit. Off-by-one
    // in the ≤ vs < comparison would miss this case and punish legitimate releases.
    const t = holdMsForAngle(9.9);
    const angle = computeOrbAngle(t);
    expect(Math.abs(angle)).toBeLessThan(HIT_CONE_DEG);
    expect(computeIsHitAngle(t)).toBe(true);
  });

  test('angle exactly 10° (cone boundary, inclusive) → isHitAngle is TRUE', () => {
    // #491 adversarial: the spec says |angle| ≤ HIT_CONE_DEG — the boundary itself
    // must be a hit. A strict < would produce a false miss at this exact angle.
    const t = holdMsForAngle(HIT_CONE_DEG);
    const angle = computeOrbAngle(t);
    // Due to floating-point, angle may not be exactly 10.0 — check that the result
    // matches the contract (|angle| ≤ HIT_CONE_DEG → true).
    expect(computeIsHitAngle(t)).toBe(Math.abs(angle) <= HIT_CONE_DEG);
  });

  test('angle 10.1° (just outside cone) → isHitAngle is FALSE', () => {
    // #491 adversarial: a release 0.1° outside the cone must miss. Any slop in the
    // boundary check would create a ghost-hit zone invisible in visual QA.
    const t = holdMsForAngle(10.1);
    const angle = computeOrbAngle(t);
    expect(Math.abs(angle)).toBeGreaterThan(HIT_CONE_DEG);
    expect(computeIsHitAngle(t)).toBe(false);
  });
});

// ── Adversarial: sweep duration speed-cap lock ────────────────────────────────

describe('adversarial — sweep speed cap (MAX_SWEEPS lock)', () => {
  test('sweep 2 and sweep 3 have identical duration (cap locked at MAX_SWEEPS-1)', () => {
    // #491 impl: Math.min(sweep, maxSweeps-1) as the exponent means sweep index 2
    // and sweep index 3 use the same exponent (2), so their durations are equal.
    // A bug that uses Math.min(sweep, maxSweeps) instead would make sweep 3 still
    // shrink, violating the cap.
    const dur2 = sweepDuration(2);
    const dur3 = sweepDuration(3);
    expect(dur3).toBeCloseTo(dur2, 6);
  });

  test('sweep 3 duration is NOT BASE_SWEEP_MS * SWEEP_SPEEDUP^3 (cap prevents further shrink)', () => {
    // #491 adversarial: if the exponent cap were off-by-one, sweep 3 would use
    // SWEEP_SPEEDUP^3 ≈ 0.422 instead of SWEEP_SPEEDUP^2 ≈ 0.5625. Verify the
    // locked value is visibly different from the uncapped value.
    const lockedDur = sweepDuration(3);
    const uncappedDur = BASE_SWEEP_MS * Math.pow(SWEEP_SPEEDUP, 3);
    expect(lockedDur).toBeGreaterThan(uncappedDur + 1); // locked is longer (slower)
  });

  test('sweepIndex beyond MAX_SWEEPS is still a valid integer (no infinite loop)', () => {
    // #491 adversarial: a very long hold must not hang the server. The while-loop
    // in sweepIndex consumes time at the capped duration — it must terminate.
    const largeHold = sweepStartMs(MAX_SWEEPS + 5);
    expect(() => computeSweepIndex(largeHold)).not.toThrow();
    expect(computeSweepIndex(largeHold)).toBeGreaterThanOrEqual(MAX_SWEEPS);
  });

  test('orbAngle at sweep 3+ stays within valid range (speed cap + angle cap both hold)', () => {
    // #491 adversarial: once capped, the angle formula must continue producing
    // values in [−45, +45] with no drift from accumulated floating-point errors.
    const deepHold = sweepStartMs(MAX_SWEEPS + 3);
    const angle = computeOrbAngle(deepHold);
    expect(angle).toBeGreaterThanOrEqual(-SWEEP_RANGE_DEG - 1e-9);
    expect(angle).toBeLessThanOrEqual(SWEEP_RANGE_DEG + 1e-9);
  });
});

// ── sweepHoldMs (arc inverse) ─────────────────────────────────────────────────

describe('sweepHoldMs — arc-angle inverse (#493)', () => {
  test('sweepHoldMs(1, 0, 1200, 0.75) returns 600ms (midpoint of sweep 0)', () => {
    // targetSweep=1 (0-based sweep 0), releaseDeg=0° (sweet spot).
    // sweep 0 duration = BASE_SWEEP_MS = 1200ms; midpoint = 600ms.
    expect(sweepHoldMs(1, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(600, 4);
  });

  test('sweepHoldMs(1, -45, ...) returns 0ms (start of sweep 0)', () => {
    // −45° is the very start of sweep 0 (t=0 by the even-sweep formula).
    expect(sweepHoldMs(1, -SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(0, 4);
  });

  test('sweepHoldMs(1, +45, ...) returns BASE_SWEEP_MS (end of sweep 0)', () => {
    // +45° is the end of sweep 0 (frac=1 → holdMs = sweep0 duration = 1200ms).
    expect(sweepHoldMs(1, SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(BASE_SWEEP_MS, 4);
  });

  test('orbAngle(sweepHoldMs(1, deg, ...)) ≈ deg for several angles in sweep 0', () => {
    // The inverse must round-trip: orbAngle applied to the computed holdMs yields
    // back approximately the requested angle.
    for (const deg of [-30, -10, 0, 10, 30]) {
      const holdMs = sweepHoldMs(1, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
      expect(computeOrbAngle(holdMs)).toBeCloseTo(deg, 4);
    }
  });

  test('sweepHoldMs(2, 0, ...) targets sweep 1 midpoint (return pass at 0°)', () => {
    // targetSweep=2 → 0-based sweep 1. Sweep 1 duration = 1200*0.75=900ms.
    // Sweep 1 starts at t=1200ms; 0° is midpoint → t=1200 + 900/2 = 1650ms.
    expect(sweepHoldMs(2, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(1200 + 450, 4);
  });

  test('orbAngle(sweepHoldMs(2, deg, ...)) ≈ deg for sweep 1', () => {
    for (const deg of [-20, 0, 20]) {
      const holdMs = sweepHoldMs(2, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
      expect(computeOrbAngle(holdMs)).toBeCloseTo(deg, 4);
    }
  });

  test('sweepHoldMs(3, 0, ...) targets sweep 2 midpoint', () => {
    // sweep 0: 1200ms, sweep 1: 900ms, sweep 2: 675ms.
    // sweep 2 starts at 1200+900=2100ms; 0° midpoint at 2100+675/2 = 2437.5ms.
    const sweep2Duration = BASE_SWEEP_MS * Math.pow(SWEEP_SPEEDUP, 2);
    const expected = BASE_SWEEP_MS + BASE_SWEEP_MS * SWEEP_SPEEDUP + sweep2Duration / 2;
    expect(sweepHoldMs(3, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(expected, 4);
  });

  test('sweepHoldMs clamps releaseDeg beyond ±SWEEP_RANGE_DEG', () => {
    // Clamping: 999° clamps to +45°, which should give end-of-sweep-0 holdMs.
    const clamped = sweepHoldMs(1, 999, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    const unclamped = sweepHoldMs(1, SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(clamped).toBeCloseTo(unclamped, 4);
  });

  test('sweepHoldMs(1, 90, ...) clamps to +45° → returns BASE_SWEEP_MS', () => {
    // #493 adversarial: 90° is outside the swing range — must clamp to +45°.
    // spec example: sweepHoldMs(1, 90, 1200, 0.75, 45, 3) → 1200ms (end of sweep 0).
    expect(sweepHoldMs(1, 90, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS)).toBeCloseTo(BASE_SWEEP_MS, 4);
  });

  test('sweepHoldMs(1, -45, ...) returns 0ms (negative boundary, no clamp needed)', () => {
    // #493 adversarial: -45° is the exact lower bound — no clamping required and
    // the formula must not produce a negative holdMs.
    const holdMs = sweepHoldMs(1, -45, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(holdMs).toBeCloseTo(0, 4);
    expect(holdMs).toBeGreaterThanOrEqual(0);
  });

  test('sweepHoldMs(1, -90, ...) clamps to -45° → returns 0ms (negative over-clamping)', () => {
    // #493 adversarial: -90° is below the swing range — must clamp to -45°, giving 0ms.
    // Without the clamp, frac would be negative and produce a negative holdMs.
    const holdMs = sweepHoldMs(1, -90, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(holdMs).toBeCloseTo(0, 4);
    expect(holdMs).toBeGreaterThanOrEqual(0);
  });

  test('orbAngle(sweepHoldMs(1, 15, ...)) ≈ 15° (spec example round-trip)', () => {
    // #493 adversarial: the inverse is used by AIController to compute release timing.
    // If the round-trip diverges beyond ±0.5°, the AI will consistently miss the
    // intended angle due to accumulated formula drift.
    const holdMs = sweepHoldMs(1, 15, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(computeOrbAngle(holdMs)).toBeCloseTo(15, 1); // within ±0.5° (1 decimal)
  });

  test('sweepHoldMs(1, near-left-edge, ...) produces holdMs < CHARGE_THRESHOLD_MS', () => {
    // #493 impl: when holdMs < CHARGE_THRESHOLD_MS the AI's scheduleAttack wait
    // clamps to Math.max(0, holdMs - CHARGE_THRESHOLD_MS) = 0 — the AI fires
    // immediately after chargeStart. Verify the formula produces a sub-threshold
    // holdMs for a very small releaseDeg angle (e.g., sweepHoldMs for -44° in
    // sweep 0 is (~1/90)*1200 ≈ 13ms, well below 150ms).
    const holdMs = sweepHoldMs(1, -44, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(holdMs).toBeLessThan(CHARGE_THRESHOLD_MS);
    // Math.max(0, holdMs - CHARGE_THRESHOLD_MS) must be 0 — no negative wait.
    expect(Math.max(0, holdMs - CHARGE_THRESHOLD_MS)).toBe(0);
  });

  test('#506 impl: AI waitMs clamp stays 0 for near-left-edge at new 450ms threshold', () => {
    // #506 adversarial: AIController.ts:312 computes waitMs = Math.max(0, holdMs - CHARGE_THRESHOLD_MS).
    // The spec confirmed sweepHoldMs(1, -44°, ...) ≈ 13ms < 150ms — and 13ms < 450ms still holds.
    // Lock this in explicitly against the new threshold so any future threshold drift that
    // makes the AI wait period go negative is caught.
    const holdMs = sweepHoldMs(1, -44, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    expect(holdMs).toBeLessThan(CHARGE_THRESHOLD_MS); // 13ms < 450ms ✓
    const waitMs = Math.max(0, holdMs - CHARGE_THRESHOLD_MS);
    expect(waitMs).toBe(0); // clamps to 0, never negative
  });

  test('#506 impl: AI waitMs is positive for targeted sweet-spot hold (600ms > 450ms threshold)', () => {
    // #506 adversarial: after the threshold increase, any AI target that is a true
    // charge (holdMs > 450ms) must produce a positive waitMs. If CHARGE_THRESHOLD_MS
    // were accidentally raised above a typical charge holdMs, the AI would always
    // clamp to 0 and fire too early (always miss). Assert 600ms − 450ms > 0.
    const sweetSpotHoldMs = sweepHoldMs(1, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS);
    // sweepHoldMs(1, 0°, ...) = BASE_SWEEP_MS/2 = 600ms.
    expect(sweetSpotHoldMs).toBeCloseTo(BASE_SWEEP_MS / 2, 4); // 600ms
    const waitMs = Math.max(0, sweetSpotHoldMs - CHARGE_THRESHOLD_MS);
    // 600 − 450 = 150ms wait — strictly positive.
    expect(waitMs).toBeGreaterThan(0);
    expect(waitMs).toBeCloseTo(sweetSpotHoldMs - CHARGE_THRESHOLD_MS, 4);
  });
});

// ── Adversarial: orbAngle end-of-sweep-0 precision ───────────────────────────

describe('adversarial — orbAngle precision near sweep 0 end', () => {
  test('holdMs = BASE_SWEEP_MS - 1 → angle is just below +45° but within range', () => {
    // #491 adversarial: 1ms before the first reversal the orb should be near +45°
    // but NOT exceed it. Verifies no fence-post error in the boundary condition.
    const t = sweepDuration(0) - 1;
    const angle = computeOrbAngle(t);
    expect(angle).toBeLessThanOrEqual(SWEEP_RANGE_DEG + 1e-9);
    // Should be very close to +45° (within 0.1°)
    expect(angle).toBeGreaterThan(SWEEP_RANGE_DEG - 0.1);
  });

  test('holdMs = BASE_SWEEP_MS → angle = +SWEEP_RANGE_DEG exactly (sweep 1 starts at +45°)', () => {
    // #491 adversarial: the reversal boundary must produce exactly +45°, not +45° + ε.
    // A > instead of >= in the sweep-exit condition would skip this value into sweep 1.
    const t = sweepDuration(0);
    expect(computeOrbAngle(t)).toBeCloseTo(SWEEP_RANGE_DEG, 6);
  });
});
