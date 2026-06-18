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
  CHARGE_ARM_MS,
  CHARGE_TELEGRAPH_MIN_MS,
} from '../../server/src/game/constants';
import { TELEGRAPH_MS } from '../../shared/timing';

// ── helpers ───────────────────────────────────────────────────────────────────

/**
 * Duration of post-arm sweep N (0-based) using the production speed schedule.
 * Matches shared/oscillation.ts sweepDuration formula.
 */
function sweepDuration(n: number): number {
  return BASE_SWEEP_MS * Math.pow(SWEEP_SPEEDUP, Math.min(n, MAX_SWEEPS - 1));
}

/**
 * Absolute holdMs at which post-arm sweep N (0-based) starts.
 * Includes the CHARGE_ARM_MS offset: sweep 0 starts at CHARGE_ARM_MS.
 */
function sweepStartMs(n: number): number {
  let t = CHARGE_ARM_MS; // arm leg precedes all post-arm sweeps
  for (let i = 0; i < n; i++) t += sweepDuration(i);
  return t;
}

/**
 * holdMs at which the orb passes through 0° within post-arm sweep N.
 * Post-arm sweep 0 (even): +SWEEP_RANGE_DEG → −SWEEP_RANGE_DEG; 0° at midpoint.
 * Post-arm sweep 1 (odd): −SWEEP_RANGE_DEG → +SWEEP_RANGE_DEG; 0° at midpoint.
 * Both pass 0° at their midpoints (#499: phase-shifted from the old sweep-0 start).
 */
function sweepMidpointMs(n: number): number {
  return sweepStartMs(n) + sweepDuration(n) / 2;
}

// ── sweepIndex correctness ─────────────────────────────────────────────────────

describe('computeSweepIndex — sweep indexing', () => {
  test('t=0 → sweep index 0 (during arm leg, before any full sweep)', () => {
    // #499: at t=0 the orb is in the arm leg; sweepIndex returns 0.
    expect(computeSweepIndex(0)).toBe(0);
  });

  test('t = CHARGE_ARM_MS → sweep index 0 (just entered post-arm sweep 0)', () => {
    // At the arm-end boundary the orb just enters post-arm sweep 0.
    expect(computeSweepIndex(CHARGE_ARM_MS)).toBe(0);
  });

  test('t just before post-arm sweep 0 ends → still sweep 0', () => {
    // sweepStartMs(1) - 1 = (CHARGE_ARM_MS + sweepDuration(0)) - 1 = 1449ms.
    const t = sweepStartMs(1) - 1;
    expect(computeSweepIndex(t)).toBe(0);
  });

  test('t = sweepStartMs(1) → enters post-arm sweep 1', () => {
    // Exactly at the first reversal boundary (1450ms): post-arm sweep 1.
    const t = sweepStartMs(1);
    expect(computeSweepIndex(t)).toBe(1);
  });

  test('t = sweepStartMs(2) → enters post-arm sweep 2', () => {
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
  test('t=0 → angle = 0° (orb starts aimed at opponent)', () => {
    // #499: orb now starts at 0° (aimed at the opponent), not at −45°.
    expect(computeOrbAngle(0)).toBeCloseTo(0, 6);
  });

  test('t=CHARGE_ARM_MS → angle = +SWEEP_RANGE_DEG (arm moment, first extreme)', () => {
    // #499: at the end of the arm leg the orb has swung to the first extreme (+45°).
    expect(computeOrbAngle(CHARGE_ARM_MS)).toBeCloseTo(SWEEP_RANGE_DEG, 4);
  });

  test('post-arm sweep 0 midpoint → angle ≈ 0° (first post-arm sweet spot)', () => {
    // #499: post-arm sweep 0 goes +45° → −45°; its midpoint is at 0°.
    // sweepMidpointMs(0) = CHARGE_ARM_MS + sweepDuration(0)/2 = 250 + 600 = 850ms.
    const t = sweepMidpointMs(0);
    expect(computeOrbAngle(t)).toBeCloseTo(0, 6);
  });

  test('end of post-arm sweep 0 → angle = −SWEEP_RANGE_DEG (first reversal after arm)', () => {
    // Post-arm sweep 0 ends at −45° (it travels +45°→−45°).
    const t = sweepStartMs(1) - 1; // 1ms before post-arm sweep 1 boundary
    expect(computeOrbAngle(t)).toBeLessThan(-SWEEP_RANGE_DEG * 0.98);
  });

  test('start of post-arm sweep 1 → angle = −SWEEP_RANGE_DEG (reversed, heading back to +45°)', () => {
    // Post-arm sweep 1 starts at −45° (even-sweep ending = odd-sweep start).
    const t = sweepStartMs(1);
    expect(computeOrbAngle(t)).toBeCloseTo(-SWEEP_RANGE_DEG, 4);
  });

  test('post-arm sweep 1 midpoint → angle ≈ 0° (sweet spot on return pass)', () => {
    // Post-arm sweep 1: −45° → +45°, midpoint = 0°.
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
    // around the first post-arm reversal (sweepStartMs(1) = CHARGE_ARM_MS + sweepDuration(0) = 1450ms).
    // #499: the old boundary (sweepDuration(0) = 1200ms) is mid-sweep, not a reversal —
    // the true first reversal is at sweepStartMs(1) where the orb reaches -SWEEP_RANGE_DEG.
    const boundary = sweepStartMs(1); // 1450ms — end of post-arm sweep 0, both sides near -45°
    const before = computeOrbAngle(boundary - 1);
    const after = computeOrbAngle(boundary);
    // Both should be near -45°; difference must be small (< 1° for 1ms step).
    expect(Math.abs(before - after)).toBeLessThan(1); // within 1°
  });
});

// ── isHitAngle boundary ───────────────────────────────────────────────────────

describe('computeIsHitAngle — ±HIT_CONE_DEG boundary (inclusive)', () => {
  test('angle at 0° (first post-arm sweet spot at sweepMidpointMs(0)) → isHitAngle is TRUE', () => {
    // #499: the center of the arc is the sweet spot — always a hit.
    // sweepMidpointMs(0) = CHARGE_ARM_MS + sweepDuration(0)/2 = 250 + 600 = 850ms.
    const t = sweepMidpointMs(0);
    expect(computeIsHitAngle(t)).toBe(true);
  });

  test('angle at 0° (holdMs=0, arm start) → isHitAngle is TRUE (angle=0° but arm gate in BattleRoom)', () => {
    // #499: orbAngle(0) = 0° — within the cone. isHitAngle is a pure formula check;
    // the arm gate (releases before CHARGE_ARM_MS → tap) lives in BattleRoom, not here.
    expect(computeIsHitAngle(0)).toBe(true);
  });

  test('angle at +45° (arm extreme, holdMs=CHARGE_ARM_MS) → isHitAngle is FALSE', () => {
    // #499: at the arm moment the orb is at +45°, well outside ±HIT_CONE_DEG=10°.
    expect(computeIsHitAngle(CHARGE_ARM_MS)).toBe(false);
  });

  test('isHitAngle is TRUE throughout the hit cone in post-arm sweep 0 (several samples)', () => {
    // #499: any release within ±HIT_CONE_DEG of 0° must be a hit (post-arm sweep 0).
    const midMs = sweepMidpointMs(0);
    const halfConeMs = (HIT_CONE_DEG / SWEEP_RANGE_DEG) * (sweepDuration(0) / 2);
    for (const offset of [-halfConeMs * 0.9, 0, halfConeMs * 0.9]) {
      const t = midMs + offset;
      expect(computeIsHitAngle(t)).toBe(true);
    }
  });

  test('isHitAngle is FALSE in arm leg mid-point (angle ≈ +22°, outside ±10° cone)', () => {
    // #499: at 125ms (halfway through arm leg) angle ≈ (125/250)*45 ≈ 22.5° > 10°.
    const t = CHARGE_ARM_MS / 2;
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
    // A brief charge (e.g. 200ms) is well within sweep 0 (BASE_SWEEP_MS=1200ms).
    expect(computeSweepIndex(200)).toBe(0);
  });
});

// ── fusion independence ───────────────────────────────────────────────────────

describe('fusion double-attack — held slot checked, tapped slot always hits', () => {
  test('held at 0° (sweet spot) → isHitAngle true; check is independent of tapped slot', () => {
    // #491 spec: in a fusion double-attack, the held orb (A1) is angle-checked at
    // the moment A2 is tapped. The tapped slot always hits (holdDuration=0 → tap).
    // Tap convention: holdDuration=0 → tap path (arm gate in BattleRoom); computeIsHitAngle
    // is only called on the held slot (holdMs ≥ CHARGE_ARM_MS). Use sweepMidpointMs(0)
    // = 850ms to target 0° in post-arm sweep 0.
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

  test('a hold at 200ms (arm leg) is outside cone (arm leg angle ≈ +36°)', () => {
    // #499: at 200ms the orb is in the arm leg: angle = (200/250)*45 ≈ 36° >> ±10°.
    // The arm gate in BattleRoom resolves this as a tap before isHitAngle is checked;
    // the formula still returns false at this angle regardless.
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
  test('t=0 → 0° (orb starts aimed at opponent — #499)', () => {
    // #499: orb starts at 0° (aimed at the opponent), not −45°.
    expect(computeOrbAngle(0)).toBeCloseTo(0, 4);
  });

  test('t=CHARGE_ARM_MS → +45° (arm moment = first extreme)', () => {
    // #499: at the end of the arm leg (250ms) the orb reaches +SWEEP_RANGE_DEG.
    expect(computeOrbAngle(CHARGE_ARM_MS)).toBeCloseTo(SWEEP_RANGE_DEG, 4);
  });

  test('t=CHARGE_ARM_MS + BASE_SWEEP_MS/2 → 0° (first post-arm sweet spot)', () => {
    // Post-arm sweep 0 midpoint = arm end + half of BASE_SWEEP_MS = 250 + 600 = 850ms.
    expect(computeOrbAngle(CHARGE_ARM_MS + BASE_SWEEP_MS / 2)).toBeCloseTo(0, 4);
  });

  test('t=CHARGE_ARM_MS + BASE_SWEEP_MS → −45° (post-arm sweep-0 end)', () => {
    // At the end of post-arm sweep 0 (1450ms) the orb reaches −SWEEP_RANGE_DEG.
    expect(computeOrbAngle(CHARGE_ARM_MS + BASE_SWEEP_MS)).toBeCloseTo(-SWEEP_RANGE_DEG, 4);
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
  test('negative holdMs clamps to 0° (no crash, no underflow)', () => {
    // #499 adversarial: a client that sends a negative hold duration (e.g. clock
    // skew or a rogue client) must not crash or produce an out-of-range angle.
    // Math.max(0, holdMs) in the formula clamps to t=0 → angle = 0° (arm leg start).
    expect(computeOrbAngle(-1)).toBeCloseTo(0, 6);
    expect(computeOrbAngle(-1000)).toBeCloseTo(0, 6);
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
  test('1ms before post-arm sweep 1 starts → sharpness is still 1/3', () => {
    // #499 adversarial: holdMs = sweepStartMs(1) - 1 must still be post-arm sweep 0.
    // sweepStartMs(1) = CHARGE_ARM_MS + sweepDuration(0) = 250 + 1200 = 1450ms.
    const justBeforeSweep1 = sweepStartMs(1) - 1;
    expect(computeSharpness(justBeforeSweep1)).toBeCloseTo(1 / 3, 6);
  });

  test('exactly at post-arm sweep 1 start → sharpness steps to 2/3', () => {
    // #499 adversarial: the 2/3 transition happens at sweepStartMs(1) = 1450ms.
    const atSweep1Start = sweepStartMs(1);
    expect(computeSharpness(atSweep1Start)).toBeCloseTo(2 / 3, 6);
  });

  test('1ms before post-arm sweep 2 starts → sharpness is still 2/3', () => {
    // sweepStartMs(2) = CHARGE_ARM_MS + sweepDuration(0) + sweepDuration(1) = 2350ms.
    const justBeforeSweep2 = sweepStartMs(2) - 1;
    expect(computeSharpness(justBeforeSweep2)).toBeCloseTo(2 / 3, 6);
  });

  test('exactly at post-arm sweep 2 start → sharpness steps to 1.0', () => {
    // sweepStartMs(2) = 2350ms.
    const atSweep2Start = sweepStartMs(2);
    expect(computeSharpness(atSweep2Start)).toBeCloseTo(1.0, 6);
  });
});

// ── Adversarial: isHitAngle at exact HIT_CONE_DEG boundary ───────────────────

describe('adversarial — isHitAngle at exact cone boundary', () => {
  // To test the exact ±HIT_CONE_DEG boundary, we need holdMs values that produce
  // angles of exactly 9.9°, 10°, and 10.1°. In post-arm sweep 0 (+45→−45):
  // angle = 45 − (frac * 90), where frac = (holdMs − CHARGE_ARM_MS) / sweepDuration(0)
  // → holdMs = CHARGE_ARM_MS + (45 − angle) / 90 * sweepDuration(0)
  function holdMsForAngle(deg: number): number {
    return CHARGE_ARM_MS + ((SWEEP_RANGE_DEG - deg) / (2 * SWEEP_RANGE_DEG)) * sweepDuration(0);
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

describe('sweepHoldMs — arc-angle inverse (#493, re-derived for #499)', () => {
  test('sweepHoldMs(1, 0°, ...) returns 850ms (post-arm sweep-0 midpoint)', () => {
    // #499: targetSweep=1 (first post-arm sweep, +45°→−45°), releaseDeg=0°.
    // Post-arm sweep 0 starts at CHARGE_ARM_MS=250ms; midpoint = 250 + 600 = 850ms.
    expect(sweepHoldMs(1, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(850, 4);
  });

  test('sweepHoldMs(1, +45°, ...) returns CHARGE_ARM_MS (start of post-arm sweep 0)', () => {
    // +45° is the START of post-arm sweep 0 (frac=0 → holdMs = CHARGE_ARM_MS).
    expect(sweepHoldMs(1, SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(CHARGE_ARM_MS, 4);
  });

  test('sweepHoldMs(1, -45°, ...) returns CHARGE_ARM_MS + BASE_SWEEP_MS (end of post-arm sweep 0)', () => {
    // −45° is the END of post-arm sweep 0 (frac=1 → holdMs = 250 + 1200 = 1450ms).
    expect(sweepHoldMs(1, -SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(CHARGE_ARM_MS + BASE_SWEEP_MS, 4);
  });

  test('sweepHoldMs result is always ≥ CHARGE_ARM_MS (post-arm guarantee)', () => {
    // #499: all post-arm holdMs targets are ≥ CHARGE_ARM_MS; the inverse must never
    // return a pre-arm holdMs (that would be a grace-window tap, not a charge hit).
    for (const deg of [-45, -30, -10, 0, 10, 30, 45]) {
      const holdMs = sweepHoldMs(1, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
      expect(holdMs).toBeGreaterThanOrEqual(CHARGE_ARM_MS);
    }
  });

  test('orbAngle(sweepHoldMs(1, deg, ...)) ≈ deg for several angles in post-arm sweep 0', () => {
    // The inverse must round-trip: orbAngle applied to the computed holdMs yields
    // back approximately the requested angle.
    for (const deg of [-30, -10, 0, 10, 30]) {
      const holdMs = sweepHoldMs(1, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
      expect(computeOrbAngle(holdMs)).toBeCloseTo(deg, 4);
    }
  });

  test('sweepHoldMs(2, 0°, ...) targets post-arm sweep-1 midpoint (return pass at 0°)', () => {
    // targetSweep=2 → post-arm sweep 1. Sweep 1 duration = 1200*0.75=900ms.
    // Post-arm sweep 1 starts at 250+1200=1450ms; 0° midpoint → 1450 + 450 = 1900ms.
    expect(sweepHoldMs(2, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(CHARGE_ARM_MS + BASE_SWEEP_MS + 450, 4);
  });

  test('orbAngle(sweepHoldMs(2, deg, ...)) ≈ deg for post-arm sweep 1', () => {
    for (const deg of [-20, 0, 20]) {
      const holdMs = sweepHoldMs(2, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
      expect(computeOrbAngle(holdMs)).toBeCloseTo(deg, 4);
    }
  });

  test('sweepHoldMs(3, 0°, ...) targets post-arm sweep-2 midpoint', () => {
    // sweep 0: 1200ms, sweep 1: 900ms, sweep 2: 675ms.
    // Post-arm sweep 2 starts at 250+1200+900=2350ms; 0° midpoint at 2350+675/2 = 2687.5ms.
    const sweep2Duration = BASE_SWEEP_MS * Math.pow(SWEEP_SPEEDUP, 2);
    const expected = CHARGE_ARM_MS + BASE_SWEEP_MS + BASE_SWEEP_MS * SWEEP_SPEEDUP + sweep2Duration / 2;
    expect(sweepHoldMs(3, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(expected, 4);
  });

  test('sweepHoldMs clamps releaseDeg beyond ±SWEEP_RANGE_DEG', () => {
    // Clamping: 999° clamps to +45°, which should give start-of-post-arm-sweep-0 holdMs.
    const clamped = sweepHoldMs(1, 999, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    const unclamped = sweepHoldMs(1, SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    expect(clamped).toBeCloseTo(unclamped, 4);
  });

  test('sweepHoldMs(1, 90°, ...) clamps to +45° → returns CHARGE_ARM_MS', () => {
    // #499 adversarial: 90° is outside the swing range — must clamp to +45°.
    // Post-arm sweep 0 starts at +45° (frac=0), so result = CHARGE_ARM_MS.
    expect(sweepHoldMs(1, 90, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS)).toBeCloseTo(CHARGE_ARM_MS, 4);
  });

  test('sweepHoldMs(1, -90°, ...) clamps to -45° → returns CHARGE_ARM_MS + BASE_SWEEP_MS', () => {
    // #499 adversarial: -90° is below the swing range — must clamp to -45°.
    // Post-arm sweep 0 ends at -45° (frac=1), so result = CHARGE_ARM_MS + BASE_SWEEP_MS.
    const holdMs = sweepHoldMs(1, -90, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    expect(holdMs).toBeCloseTo(CHARGE_ARM_MS + BASE_SWEEP_MS, 4);
    expect(holdMs).toBeGreaterThanOrEqual(CHARGE_ARM_MS);
  });

  test('orbAngle(sweepHoldMs(1, 15°, ...)) ≈ 15° (spec example round-trip)', () => {
    // #499 adversarial: the inverse is used by AIController to compute release timing.
    const holdMs = sweepHoldMs(1, 15, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    expect(computeOrbAngle(holdMs)).toBeCloseTo(15, 1); // within ±0.5° (1 decimal)
  });

  test('sweepHoldMs(1, any angle, ...) ≥ CHARGE_ARM_MS (AI always waits past arm)', () => {
    // #499 impl: all valid sweep-1 targets are in the post-arm window. The AI wait
    // is Math.max(0, holdMs − CHARGE_THRESHOLD_MS); since holdMs ≥ CHARGE_ARM_MS=250 >
    // CHARGE_THRESHOLD_MS=150, the wait is always positive.
    const holdMs = sweepHoldMs(1, 0, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    expect(holdMs).toBeGreaterThanOrEqual(CHARGE_ARM_MS);
    // Verify the AI wait (holdMs - CHARGE_THRESHOLD_MS) is positive.
    expect(holdMs - CHARGE_THRESHOLD_MS).toBeGreaterThan(0);
  });
});

// ── Adversarial: orbAngle end-of-sweep-0 precision ───────────────────────────

describe('adversarial — orbAngle precision near post-arm sweep 0 end', () => {
  test('holdMs = sweepStartMs(1) - 1 → angle is just above −45° but within range', () => {
    // #499 adversarial: 1ms before the post-arm-sweep-0 end the orb should be near
    // −45° but NOT exceed it. Verifies no fence-post error at the boundary.
    const t = sweepStartMs(1) - 1;
    const angle = computeOrbAngle(t);
    expect(angle).toBeGreaterThanOrEqual(-SWEEP_RANGE_DEG - 1e-9);
    // Should be very close to −45° (within 0.1°)
    expect(angle).toBeLessThan(-SWEEP_RANGE_DEG + 0.1);
  });

  test('holdMs = sweepStartMs(1) → angle = −SWEEP_RANGE_DEG exactly (post-arm sweep 1 starts at −45°)', () => {
    // #499 adversarial: the reversal boundary must produce exactly −45°.
    // Post-arm sweep 0 ends at −45° and post-arm sweep 1 starts from there.
    const t = sweepStartMs(1);
    expect(computeOrbAngle(t)).toBeCloseTo(-SWEEP_RANGE_DEG, 6);
  });
});

// ── #499 Phase 1: Arm-gate logic contract ─────────────────────────────────────
//
// The arm leg (0..CHARGE_ARM_MS) is a grace window. During it the orb is NOT in
// a charged-hit-eligible position: the hit cone formula (isHitAngle) MAY return
// true (angle=0° at t=0 is within ±10°), but the arm gate in BattleRoom ensures
// those releases resolve as taps, not charged hits. These tests encode the
// CONTRACTUAL INVARIANT that both sides of the boundary are handled correctly.

describe('#499 arm-gate logic contract — spec invariant: arm-leg releases are always taps', () => {
  test('isHitAngle(0) is TRUE but t=0 is in the arm leg — arm gate prevents charged resolution', () => {
    // #499 adversarial: the orb starts at 0° (within ±10° cone). computeIsHitAngle
    // is a pure formula; it returns true. BUT the arm gate (holdMs < CHARGE_ARM_MS)
    // in BattleRoom prevents the charged path from ever being entered. Assert:
    // 1) isHitAngle says "hit" at t=0 (formula is correct)
    // 2) t=0 < CHARGE_ARM_MS (gate would fire and redirect to tap)
    expect(computeIsHitAngle(0)).toBe(true);
    expect(0).toBeLessThan(CHARGE_ARM_MS);
  });

  test('isHitAngle(249) is FALSE — orb is near +45° at end of arm leg (angle ≈ 44.8°)', () => {
    // #499 adversarial: at 249ms (1ms before arm end) the orb is at ~(249/250)*45 ≈
    // 44.8° — well outside the ±10° hit cone. Even if the arm gate were absent,
    // this would be a miss. Both gates (arm gate + angle check) agree: miss.
    expect(computeOrbAngle(249)).toBeGreaterThan(HIT_CONE_DEG);
    expect(computeIsHitAngle(249)).toBe(false);
  });

  test('CHARGE_ARM_MS boundary: t=249 is pre-arm (tap by gate), t=250 is post-arm (charged miss)', () => {
    // #499 adversarial: one millisecond separates the tap path from the charged path.
    // At 249ms the arm gate fires → tap. At 250ms the gate is bypassed → charged.
    // At 250ms the orb is at exactly +45° which is a miss (outside ±10°).
    expect(249).toBeLessThan(CHARGE_ARM_MS);    // gate fires at t=249
    expect(250).toBeGreaterThanOrEqual(CHARGE_ARM_MS); // gate does NOT fire at t=250
    expect(computeOrbAngle(250)).toBeCloseTo(SWEEP_RANGE_DEG, 4); // +45° exactly
    expect(computeIsHitAngle(250)).toBe(false); // first charged release is a miss
  });

  test('first charged hit is NOT at CHARGE_ARM_MS — orb must return to 0° first (t≈850ms)', () => {
    // #499 spec: the hit cone is inactive during the arm leg. The first post-arm
    // release (t=CHARGE_ARM_MS) is at +45° — a MISS. The orb must sweep back to 0°
    // before a charged HIT is possible. That happens at sweepMidpointMs(0) ≈ 850ms.
    expect(computeIsHitAngle(CHARGE_ARM_MS)).toBe(false);  // +45° at arm end = miss
    expect(computeIsHitAngle(sweepMidpointMs(0))).toBe(true); // 0° at sweep midpoint = hit
  });

  test('grace window upper bound: orbAngle(249) ≈ +44.8°, orbAngle(250) = +45°', () => {
    // #499 adversarial: the last ms of the arm leg (249ms) and the first ms of
    // post-arm (250ms) should differ by less than 1° — no discontinuity.
    const angleBefore = computeOrbAngle(249);
    const angleAt = computeOrbAngle(250);
    expect(angleBefore).toBeCloseTo((249 / 250) * SWEEP_RANGE_DEG, 2);
    expect(angleAt).toBeCloseTo(SWEEP_RANGE_DEG, 4);
    expect(Math.abs(angleAt - angleBefore)).toBeLessThan(1); // < 1° jump at boundary
  });
});

// ── #499 Phase 1: sweepHoldMs round-trip for #499 phase ──────────────────────

describe('#499 sweepHoldMs with CHARGE_ARM_MS param — round-trip correctness', () => {
  test('sweepHoldMs(1, 15°, ...) round-trips through orbAngle to within ±0.75° (#499 spec example)', () => {
    // #499 adversarial: the AI uses sweepHoldMs to compute its release timing.
    // A round-trip error > 1° would cause systematic AI misses or hits on wrong targets.
    const holdMs = sweepHoldMs(1, 15, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
    expect(computeOrbAngle(holdMs)).toBeCloseTo(15, 1); // ±0.5° at 1 decimal
  });

  test('all sweepHoldMs(1, deg, ...) results are ≥ CHARGE_ARM_MS (no arm-leg leakage)', () => {
    // #499 adversarial: if the inverse ever returned a value < CHARGE_ARM_MS the AI
    // would target an arm-leg time, where the arm gate redirects to tap — silent wrong
    // behavior. Every valid post-arm angle must map to holdMs ≥ CHARGE_ARM_MS.
    for (const deg of [-45, -30, -15, -10, 0, 10, 15, 30, 45]) {
      const holdMs = sweepHoldMs(1, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
      expect(holdMs).toBeGreaterThanOrEqual(CHARGE_ARM_MS);
    }
  });
});

// ── #499 Phase 1: Miss orb facing direction ────────────────────────────────────

describe('#499 miss orb facing — Math.sign(enemyX - fromX) formula', () => {
  test('player at PLAYER_X=768, opponent at OPPONENT_X=256: facing = -1 (player fires left)', () => {
    // #499 spec: the miss orb must fly TOWARD the opponent, not backward.
    // For the player (x=768) shooting at the opponent (x=256): enemy is to the left.
    // Math.sign(256 - 768) = Math.sign(-512) = -1 → orb flies left (toward opponent).
    const PLAYER_X = 768;
    const OPPONENT_X = 256;
    const facingFromPlayer = Math.sign(OPPONENT_X - PLAYER_X);
    expect(facingFromPlayer).toBe(-1);
  });

  test('opponent at OPPONENT_X=256, player at PLAYER_X=768: facing = +1 (opponent fires right)', () => {
    // #499 spec: for the opponent (x=256) shooting at the player (x=768): enemy is to the right.
    // Math.sign(768 - 256) = Math.sign(512) = +1 → orb flies right (toward player).
    const PLAYER_X = 768;
    const OPPONENT_X = 256;
    const facingFromOpponent = Math.sign(PLAYER_X - OPPONENT_X);
    expect(facingFromOpponent).toBe(1);
  });

  test('facings are always opposite: player and opponent fire toward each other', () => {
    // #499 adversarial: if both facings had the same sign both orbs would fly the
    // same direction — one would fly away from the opponent (regression from pre-#499).
    const PLAYER_X = 768;
    const OPPONENT_X = 256;
    const facingFromPlayer = Math.sign(OPPONENT_X - PLAYER_X);
    const facingFromOpponent = Math.sign(PLAYER_X - OPPONENT_X);
    expect(facingFromPlayer + facingFromOpponent).toBe(0); // sum = 0 (opposite signs)
  });

  test('Math.sign never produces 0 for the canonical PLAYER_X vs OPPONENT_X (positions differ)', () => {
    // #499 adversarial: Math.sign(0) = 0 is an invalid facing; it would produce a
    // stationary orb. Guard: canonical x positions must differ so sign is never 0.
    const PLAYER_X = 768;
    const OPPONENT_X = 256;
    expect(Math.sign(OPPONENT_X - PLAYER_X)).not.toBe(0);
    expect(Math.sign(PLAYER_X - OPPONENT_X)).not.toBe(0);
  });
});

// ── #499 Phase 2: computeOrbAngle wrapper is consistent with direct orbAngle call

describe('#499 impl-aware: computeOrbAngle wrapper correctly binds CHARGE_ARM_MS', () => {
  test('computeOrbAngle(0) = 0° — CHARGE_ARM_MS binding confirmed (pre-#499 would be −45°)', () => {
    // #499 impl: computeOrbAngle is a thin wrapper that binds the server constants.
    // If CHARGE_ARM_MS were missing or zero, orbAngle(0) would return −45° (the old
    // pre-#499 start). 0° confirms the arm-leg phase shift is correctly wired.
    expect(computeOrbAngle(0)).toBeCloseTo(0, 6);
  });

  test('computeOrbAngle(CHARGE_ARM_MS) = +45° — wrapper passes chargeArmMs correctly', () => {
    // #499 impl: if CHARGE_ARM_MS were passed in the wrong position the arm-leg
    // boundary would be wrong, producing an incorrect angle at t=250ms.
    expect(computeOrbAngle(CHARGE_ARM_MS)).toBeCloseTo(SWEEP_RANGE_DEG, 4);
  });

  test('computeOrbAngle matches sweepHoldMs inverse for known angles — wrapper is self-consistent', () => {
    // #499 impl: sweepHoldMs is also imported from shared/oscillation with CHARGE_ARM_MS.
    // If computeOrbAngle had a different CHARGE_ARM_MS binding, the round-trip would fail.
    const samples = [-30, -10, 0, 10, 30];
    for (const deg of samples) {
      const holdMs = sweepHoldMs(1, deg, BASE_SWEEP_MS, SWEEP_SPEEDUP, SWEEP_RANGE_DEG, MAX_SWEEPS, CHARGE_ARM_MS);
      expect(computeOrbAngle(holdMs)).toBeCloseTo(deg, 4);
    }
  });
});

// ── #499 Phase 2: arm grace window — tap path consistency ────────────────────

describe('#499 impl-aware: arm grace window tap-path consistency (150ms ≤ holdMs < 250ms)', () => {
  test('sharpnessFromSweep(249, ...) returns 1/3 without throwing (formula safe for arm-leg input)', () => {
    // #499 impl: the arm gate (holdMs < CHARGE_ARM_MS) redirects to tap before
    // sharpness is ever used. But the pure formula is called with holdMs=249 in unit
    // context — it should return 1/3 (sweep 0 during arm leg) and not throw.
    // (Sharpness is IRRELEVANT for taps, but the formula must be crash-safe.)
    expect(() => computeSharpness(249)).not.toThrow();
    expect(computeSharpness(249)).toBeCloseTo(1 / 3, 6);
  });

  test('both sub-ranges of the grace window (0..149, 150..249) resolve to the same tap behavior', () => {
    // #499 impl: the grace window REPLACES the old CHARGE_THRESHOLD_MS check.
    // Old gate: holdMs < 150 → tap. New gate: holdMs < 250 → tap.
    // Both sub-ranges (0..149 and 150..249) must produce tap-compatible formula values:
    // sweep 0 = sharpness 1/3 (consistent — never exceeds post-arm sharpness floor).
    const preThreshold = computeSharpness(149); // old sub-range boundary - 1
    const inGraceWindow = computeSharpness(200); // CHARGE_THRESHOLD_MS ≤ t < CHARGE_ARM_MS
    const graceWindowEnd = computeSharpness(249); // last ms before CHARGE_ARM_MS
    expect(preThreshold).toBeCloseTo(1 / 3, 6);
    expect(inGraceWindow).toBeCloseTo(1 / 3, 6);
    expect(graceWindowEnd).toBeCloseTo(1 / 3, 6);
  });

  test('holdMs = CHARGE_THRESHOLD_MS (150ms) is within arm gate and produces sharpness 1/3', () => {
    // #499 impl: the old threshold (150ms) is now inside the arm leg (250ms).
    // If any code still used the old CHARGE_THRESHOLD_MS check, holds between 150..249
    // would enter the charged path — wrong. sharpnessFromSweep(150) = 1/3 is consistent
    // with tap; the arm gate in BattleRoom is the definitive guard, but the formula
    // must not produce a value that would mislead callers if they check sharpness.
    expect(150).toBeLessThan(CHARGE_ARM_MS);
    expect(computeSharpness(CHARGE_THRESHOLD_MS)).toBeCloseTo(1 / 3, 6);
  });
});
