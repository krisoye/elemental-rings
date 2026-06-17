// Charge attack formula wrappers (#485, GDD §6.3 Option A).
//
// These thin wrappers bind the shared oscillation functions to the server's
// authoritative constants so callers only import this module (not the shared
// module + constants separately). They are also the target of the unit test
// suite (tests/unit/ChargeAttack.test.ts), which imports them directly.
//
// All functions are pure and stateless — calling them with the same holdDuration
// always produces the same result.

import {
  oscillationPeriod,
  yOffset,
  isHit,
  sharpness,
  telegraphDuration,
} from '../../../shared/oscillation';
import {
  HIT_CONE_PX,
  Y_AMPLITUDE_PX,
  BASE_PERIOD_MS,
  PERIOD_DECAY_MS,
  MAX_CHARGE_MS,
  CHARGE_TELEGRAPH_MIN_MS,
} from './constants';
import { TELEGRAPH_MS } from '../../../shared/timing';

/**
 * The current oscillation period at `holdMs` ms of charge. Shorter period =
 * faster oscillation = more demanding for the attacker to time the release.
 */
export function computeOscillationPeriod(holdMs: number): number {
  return oscillationPeriod(holdMs, BASE_PERIOD_MS, PERIOD_DECAY_MS);
}

/**
 * The orb's Y offset at `holdMs` ms of charge. Range: [-Y_AMPLITUDE_PX, +Y_AMPLITUDE_PX].
 * Both client (for display) and server (for hit resolution) use this function with
 * the same constants to guarantee identical results.
 */
export function computeYOffset(holdMs: number): number {
  return yOffset(holdMs, Y_AMPLITUDE_PX, BASE_PERIOD_MS, PERIOD_DECAY_MS);
}

/**
 * Returns true when the orb is within the hit cone (|yOffset| <= HIT_CONE_PX).
 * The server calls this on the hold duration it measured authoritatively — the
 * client value is only a fallback (or not used for hit classification at all).
 */
export function computeIsHit(holdMs: number): boolean {
  return isHit(holdMs, HIT_CONE_PX, Y_AMPLITUDE_PX, BASE_PERIOD_MS, PERIOD_DECAY_MS);
}

/**
 * Sharpness in [0, 1]. 0 = tap; 1 = maximum charge (MAX_CHARGE_MS or beyond).
 * Drives the telegraph duration and parry window compression.
 */
export function computeSharpness(holdMs: number): number {
  return sharpness(holdMs, MAX_CHARGE_MS);
}

/**
 * Variable telegraph duration in ms. Lerps from TELEGRAPH_MS (standard, at
 * sharpness 0) down to CHARGE_TELEGRAPH_MIN_MS (fastest, at sharpness 1).
 * Rounded to the nearest millisecond to keep values integers.
 */
export function computeTelegraphDuration(holdMs: number): number {
  return telegraphDuration(computeSharpness(holdMs), TELEGRAPH_MS, CHARGE_TELEGRAPH_MIN_MS);
}
