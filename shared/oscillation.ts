// Arc-swing formula for the charge attack mechanic (GDD §6.3, #491).
//
// The orb swings on a constant-angular-velocity arc from −SWEEP_RANGE_DEG to
// +SWEEP_RANGE_DEG (e.g. −45° to +45°), pivoting at the spawn point. The sweet
// spot is 0° (aimed directly at the opponent). Speed steps up on each ±45°
// reversal; the player must time the release at 0° to land a hit.
//
// The SAME formulas are used client-side (for display) and server-side (for
// authoritative hit/miss resolution) to ensure the client can never spoof the
// release angle. Both sides import these pure functions and the constants they
// need — no duplication.
//
// Constants imported from constants.ts on each side; this module is parameter-
// based so it is fully portable (no Node/browser-specific imports).

// ── Sweep index ───────────────────────────────────────────────────────────────

/**
 * Returns the 0-based sweep index the orb is in at `holdMs` ms of charge.
 *
 * Sweep 0: −SWEEP_RANGE_DEG → +SWEEP_RANGE_DEG (base speed, duration = sweepDurationMs).
 * Sweep 1: +SWEEP_RANGE_DEG → −SWEEP_RANGE_DEG (faster; duration × SWEEP_SPEEDUP).
 * Sweep N: duration × SWEEP_SPEEDUP^min(N, MAX_SWEEPS-1).
 *
 * `sweepDurationMs` is the duration of sweep 0 (BASE_SWEEP_MS).
 * `speedup` is the per-reversal duration multiplier (SWEEP_SPEEDUP, < 1 = faster).
 * `maxSweeps` caps the speedup (beyond maxSweeps the duration stays constant).
 */
export function sweepIndex(
  holdMs: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number {
  let remaining = Math.max(0, holdMs);
  let sweep = 0;
  while (true) {
    const duration = sweepDurationMs * Math.pow(speedup, Math.min(sweep, maxSweeps - 1));
    if (remaining < duration) return sweep;
    remaining -= duration;
    sweep++;
  }
}

// ── Orb angle ─────────────────────────────────────────────────────────────────

/**
 * Returns the orb's current angle in degrees (−sweepRangeDeg..+sweepRangeDeg).
 *
 * Sweep 0 starts at −sweepRangeDeg and travels to +sweepRangeDeg.
 * Odd sweeps reverse direction. The speed steps up on each reversal up to maxSweeps.
 *
 * `sweepDurationMs` is BASE_SWEEP_MS (duration of sweep 0).
 * `speedup` is SWEEP_SPEEDUP (< 1 → faster each reversal).
 * `maxSweeps` is MAX_SWEEPS.
 */
export function orbAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number {
  let remaining = Math.max(0, holdMs);
  let sweep = 0;
  while (true) {
    const duration = sweepDurationMs * Math.pow(speedup, Math.min(sweep, maxSweeps - 1));
    if (remaining < duration) {
      // Position within this sweep (0..1 fraction)
      const frac = remaining / duration;
      // Even sweeps: −range → +range. Odd sweeps: +range → −range.
      if (sweep % 2 === 0) {
        return -sweepRangeDeg + frac * 2 * sweepRangeDeg;
      } else {
        return sweepRangeDeg - frac * 2 * sweepRangeDeg;
      }
    }
    remaining -= duration;
    sweep++;
  }
}

// ── Hit check ────────────────────────────────────────────────────────────────

/**
 * Returns true when the orb's angle at the release moment is within the hit cone
 * (|angle| ≤ hitConeDeg). The sweet spot is 0° (aimed at the opponent).
 */
export function isHitAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  hitConeDeg: number,
  speedup: number,
  maxSweeps: number,
): boolean {
  return Math.abs(orbAngle(holdMs, sweepRangeDeg, sweepDurationMs, speedup, maxSweeps)) <= hitConeDeg;
}

// ── Sharpness ────────────────────────────────────────────────────────────────

/**
 * Sharpness derived from sweep index (0-based):
 *   sweep 0: 1/3 (floor — a charged release always beats a tap)
 *   sweep 1: 2/3
 *   sweep 2+: 1.0
 *
 * A tap (holdMs < CHARGE_THRESHOLD_MS) returns 0, handled upstream by the caller
 * before the orb enters the arc-swing path. This function only applies on the
 * charged path (holdMs ≥ CHARGE_THRESHOLD_MS).
 */
export function sharpnessFromSweep(
  holdMs: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
): number {
  const sweep = sweepIndex(holdMs, sweepDurationMs, speedup, maxSweeps);
  if (sweep === 0) return 1 / 3;
  if (sweep === 1) return 2 / 3;
  return 1.0;
}

// ── Angle inverse ────────────────────────────────────────────────────────────

/**
 * Converts a desired release angle and target sweep to the holdDuration (ms)
 * at which `orbAngle` first equals `releaseDeg` within that sweep.
 *
 * `targetSweep` is 1-based: 1=sweep 0 (−range→+range), 2=sweep 1, 3=sweep 2.
 * `releaseDeg` is clamped to [−SWEEP_RANGE_DEG, +SWEEP_RANGE_DEG].
 * Even sweeps travel −range→+range; odd sweeps travel +range→−range.
 */
export function sweepHoldMs(
  targetSweep: number,
  releaseDeg: number,
  baseSweepMs: number,
  sweepSpeedup: number,
): number {
  const SWEEP_RANGE_DEG = 45;
  const MAX_SWEEPS = 3;
  const sweep = targetSweep - 1; // convert to 0-based
  const clamped = Math.min(Math.max(releaseDeg, -SWEEP_RANGE_DEG), SWEEP_RANGE_DEG);

  // Sum durations of all preceding sweeps.
  let accumulated = 0;
  for (let i = 0; i < sweep; i++) {
    accumulated += baseSweepMs * Math.pow(sweepSpeedup, Math.min(i, MAX_SWEEPS - 1));
  }

  // Position within the target sweep.
  const duration = baseSweepMs * Math.pow(sweepSpeedup, Math.min(sweep, MAX_SWEEPS - 1));
  let frac: number;
  if (sweep % 2 === 0) {
    // Even sweep: −range → +range
    frac = (clamped + SWEEP_RANGE_DEG) / (2 * SWEEP_RANGE_DEG);
  } else {
    // Odd sweep: +range → −range
    frac = (SWEEP_RANGE_DEG - clamped) / (2 * SWEEP_RANGE_DEG);
  }

  return accumulated + frac * duration;
}

// ── Telegraph duration ────────────────────────────────────────────────────────

/**
 * Varies from the standard TELEGRAPH_MS down to CHARGE_TELEGRAPH_MIN_MS as
 * sharpness increases. A tap attack gets the full 900 ms; a maxed charge gets
 * the compressed minimum.
 */
export function telegraphDuration(
  sharpnessVal: number,
  baseTelegraphMs: number,
  chargeTelegraphMinMs: number,
): number {
  return Math.round(
    baseTelegraphMs + (chargeTelegraphMinMs - baseTelegraphMs) * sharpnessVal,
  );
}
