// Charge attack formula wrappers (#491, GDD §6.3).
//
// These thin wrappers bind the shared arc-swing functions to the server's
// authoritative constants so callers only import this module (not the shared
// module + constants separately). They are also the target of the unit test
// suite (tests/unit/ChargeAttack.test.ts), which imports them directly.
//
// All functions are pure and stateless — calling them with the same holdDuration
// always produces the same result.

import {
  sweepIndex,
  orbAngle,
  isHitAngle,
  sharpnessFromSweep,
  telegraphDuration,
} from '../../../shared/oscillation';
import {
  SWEEP_RANGE_DEG,
  HIT_CONE_DEG,
  BASE_SWEEP_MS,
  SWEEP_SPEEDUP,
  MAX_SWEEPS,
  CHARGE_ARM_MS,
  CHARGE_TELEGRAPH_MIN_MS,
} from './constants';
import { TELEGRAPH_MS } from '../../../shared/timing';

/**
 * The 0-based sweep index the orb is in at `holdMs` ms of charge. Sweep 0 is
 * the first full post-arm pass (+SWEEP_RANGE_DEG → −SWEEP_RANGE_DEG); higher
 * sweeps reverse and speed up on each reversal. Returns 0 during the arm leg.
 */
export function computeSweepIndex(holdMs: number): number {
  return sweepIndex(holdMs, BASE_SWEEP_MS, SWEEP_SPEEDUP, MAX_SWEEPS, CHARGE_ARM_MS);
}

/**
 * The orb's angle in degrees at `holdMs` ms of charge. Range: [−SWEEP_RANGE_DEG,
 * +SWEEP_RANGE_DEG] (i.e. [−45, +45]). 0° = sweet spot (aimed at opponent).
 * `holdMs=0` returns 0° (#499: orb starts aimed at the opponent).
 * Both client (for display) and server (for hit resolution) use this function with
 * the same constants to guarantee identical results.
 */
export function computeOrbAngle(holdMs: number): number {
  return orbAngle(holdMs, SWEEP_RANGE_DEG, BASE_SWEEP_MS, SWEEP_SPEEDUP, MAX_SWEEPS, CHARGE_ARM_MS);
}

/**
 * Returns true when the orb is within the hit cone (|angle| ≤ HIT_CONE_DEG, i.e. ±10°).
 * The server calls this on the hold duration it measured authoritatively — the
 * client value is only a fallback (or not used for hit classification at all).
 * ARM GATE: callers must check holdMs ≥ CHARGE_ARM_MS before calling; a release
 * during the arm leg must resolve as a tap, not a charged miss.
 */
export function computeIsHitAngle(holdMs: number): boolean {
  return isHitAngle(holdMs, SWEEP_RANGE_DEG, BASE_SWEEP_MS, HIT_CONE_DEG, SWEEP_SPEEDUP, MAX_SWEEPS, CHARGE_ARM_MS);
}

/**
 * Sharpness in {1/3, 2/3, 1.0} based on the current sweep:
 *   sweep 0 / arm leg: 1/3 (floor — a charged release always beats a tap)
 *   sweep 1: 2/3
 *   sweep 2+: 1.0
 * A tap (holdMs < CHARGE_THRESHOLD_MS) returns 0, handled upstream.
 */
export function computeSharpness(holdMs: number): number {
  return sharpnessFromSweep(holdMs, BASE_SWEEP_MS, SWEEP_SPEEDUP, MAX_SWEEPS, CHARGE_ARM_MS);
}

/**
 * Variable telegraph duration in ms. Lerps from TELEGRAPH_MS (standard, at
 * sharpness 0) down to CHARGE_TELEGRAPH_MIN_MS (fastest, at sharpness 1).
 * Rounded to the nearest millisecond to keep values integers.
 */
export function computeTelegraphDuration(holdMs: number): number {
  return telegraphDuration(computeSharpness(holdMs), TELEGRAPH_MS, CHARGE_TELEGRAPH_MIN_MS);
}
