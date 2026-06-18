// Arc-swing formula for the charge attack mechanic (GDD §6.3, #491, #499).
//
// The orb starts at 0° (aimed directly at the opponent). It swings outward to the
// first extreme (+SWEEP_RANGE_DEG) over an initial arm leg of CHARGE_ARM_MS ms.
// After reaching the extreme it oscillates back and forth with full sweeps at
// BASE_SWEEP_MS each, speeding up on each reversal. The sweet spot is 0°
// (aimed at the opponent); the hit cone is INACTIVE during the initial arm leg
// (releasing before CHARGE_ARM_MS resolves as a tap, not a charged miss).
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
 * The initial arm leg (0 → CHARGE_ARM_MS) is NOT a sweep — sweepIndex treats
 * it as part of sweep 0 (returns 0 during the arm leg). Callers that need to
 * distinguish the arm leg from the first full sweep must check
 * `holdMs < chargeArmMs` upstream.
 *
 * Sweep 0: +SWEEP_RANGE_DEG → −SWEEP_RANGE_DEG (base speed, duration = sweepDurationMs).
 * Sweep 1: −SWEEP_RANGE_DEG → +SWEEP_RANGE_DEG (faster; duration × SWEEP_SPEEDUP).
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
  chargeArmMs: number,
): number {
  // During the arm leg, report sweep 0 (the first full sweep follows immediately).
  const postArm = Math.max(0, holdMs - chargeArmMs);
  let remaining = postArm;
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
 * Phase-shifted for #499: `holdMs=0` returns 0° (aimed at the opponent). The
 * orb swings outward to +sweepRangeDeg over `chargeArmMs` ms (the arm leg).
 * After the arm leg the orb oscillates with full sweeps at `sweepDurationMs` each,
 * starting from +sweepRangeDeg. The hit cone is inactive during the arm leg —
 * callers must check holdMs ≥ chargeArmMs upstream before treating isHitAngle as
 * meaningful (arm guard lives in BattleRoom.handleReleaseAttack).
 *
 * Arm leg (0..chargeArmMs): 0° → +sweepRangeDeg (linear).
 * Post-arm sweep 0: +sweepRangeDeg → −sweepRangeDeg (BASE_SWEEP_MS duration).
 * Post-arm sweep 1: −sweepRangeDeg → +sweepRangeDeg (BASE_SWEEP_MS × SWEEP_SPEEDUP).
 * Post-arm sweep N (0-based): direction alternates; duration × SWEEP_SPEEDUP^min(N, maxSweeps-1).
 *
 * `sweepDurationMs` is BASE_SWEEP_MS (duration of the first full post-arm sweep).
 * `speedup` is SWEEP_SPEEDUP (< 1 → faster each reversal).
 * `maxSweeps` is MAX_SWEEPS.
 * `chargeArmMs` is CHARGE_ARM_MS (arm-leg duration; 250 ms).
 */
export function orbAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
  chargeArmMs: number,
): number {
  const t = Math.max(0, holdMs);

  // Arm leg: 0° → +sweepRangeDeg linearly over chargeArmMs.
  if (t < chargeArmMs) {
    return (t / chargeArmMs) * sweepRangeDeg;
  }

  // Post-arm oscillation starting from +sweepRangeDeg.
  let remaining = t - chargeArmMs;
  let sweep = 0;
  while (true) {
    const duration = sweepDurationMs * Math.pow(speedup, Math.min(sweep, maxSweeps - 1));
    if (remaining < duration) {
      // Position within this post-arm sweep (0..1 fraction).
      const frac = remaining / duration;
      // Post-arm sweep 0 (even): +range → −range. Odd sweeps: −range → +range.
      if (sweep % 2 === 0) {
        return sweepRangeDeg - frac * 2 * sweepRangeDeg;
      } else {
        return -sweepRangeDeg + frac * 2 * sweepRangeDeg;
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
 *
 * ARM GATE: this function evaluates the angle formula only — it does NOT enforce
 * the arm guard. Callers (BattleRoom.handleReleaseAttack) must check
 * `holdMs >= chargeArmMs` before calling; a release during the arm leg must
 * resolve as a tap, not as a charged hit, even if orbAngle happens to be near 0°.
 */
export function isHitAngle(
  holdMs: number,
  sweepRangeDeg: number,
  sweepDurationMs: number,
  hitConeDeg: number,
  speedup: number,
  maxSweeps: number,
  chargeArmMs: number,
): boolean {
  return Math.abs(orbAngle(holdMs, sweepRangeDeg, sweepDurationMs, speedup, maxSweeps, chargeArmMs)) <= hitConeDeg;
}

// ── Sharpness ────────────────────────────────────────────────────────────────

/**
 * Sharpness derived from sweep index (0-based):
 *   sweep 0 (or arm leg): 1/3 (floor — a charged release always beats a tap)
 *   sweep 1: 2/3
 *   sweep 2+: 1.0
 *
 * A tap (holdMs < CHARGE_THRESHOLD_MS) returns 0, handled upstream by the caller
 * before the orb enters the arc-swing path. This function only applies on the
 * charged path (holdMs ≥ CHARGE_ARM_MS).
 */
export function sharpnessFromSweep(
  holdMs: number,
  sweepDurationMs: number,
  speedup: number,
  maxSweeps: number,
  chargeArmMs: number,
): number {
  const sweep = sweepIndex(holdMs, sweepDurationMs, speedup, maxSweeps, chargeArmMs);
  if (sweep === 0) return 1 / 3;
  if (sweep === 1) return 2 / 3;
  return 1.0;
}

// ── Angle inverse ────────────────────────────────────────────────────────────

/**
 * Converts a desired release angle and target sweep to the holdDuration (ms)
 * at which `orbAngle` first equals `releaseDeg` within that sweep.
 *
 * Re-derived for #499 (new phase: orb starts at 0°, arm leg to +sweepRangeDeg
 * over chargeArmMs, then full sweeps). The arm leg is NOT a sweep; targetSweep
 * addresses only the post-arm sweeps.
 *
 * `targetSweep` is 1-based: 1=first post-arm sweep (+range→−range),
 *   2=second post-arm sweep (−range→+range), 3=third, etc.
 * `releaseDeg` is clamped to [−sweepRangeDeg, +sweepRangeDeg].
 * `sweepRangeDeg` is SWEEP_RANGE_DEG; `maxSweeps` is MAX_SWEEPS.
 * Post-arm sweep 0 (targetSweep=1) travels +range→−range (even 0-based = odd-old).
 * Post-arm sweep 1 (targetSweep=2) travels −range→+range.
 *
 * Result is always ≥ chargeArmMs — targeting a post-arm 0°-crossing, not the
 * initial t=0 start.
 */
export function sweepHoldMs(
  targetSweep: number,
  releaseDeg: number,
  baseSweepMs: number,
  sweepSpeedup: number,
  sweepRangeDeg: number,
  maxSweeps: number,
  chargeArmMs: number,
): number {
  const sweep = targetSweep - 1; // convert to 0-based post-arm sweep index
  const clamped = Math.min(Math.max(releaseDeg, -sweepRangeDeg), sweepRangeDeg);

  // Arm leg offset: the post-arm phase begins at chargeArmMs.
  let accumulated = chargeArmMs;

  // Sum durations of all preceding post-arm sweeps.
  for (let i = 0; i < sweep; i++) {
    accumulated += baseSweepMs * Math.pow(sweepSpeedup, Math.min(i, maxSweeps - 1));
  }

  // Position within the target post-arm sweep.
  const duration = baseSweepMs * Math.pow(sweepSpeedup, Math.min(sweep, maxSweeps - 1));
  let frac: number;
  if (sweep % 2 === 0) {
    // Post-arm sweep 0, 2, 4 ... travel +range → −range.
    frac = (sweepRangeDeg - clamped) / (2 * sweepRangeDeg);
  } else {
    // Post-arm sweep 1, 3, 5 ... travel −range → +range.
    frac = (clamped + sweepRangeDeg) / (2 * sweepRangeDeg);
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
