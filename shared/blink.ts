// Short-range blink cost model (GDD §12 — spirit system, Part A of #87). Blink
// is the first NON-recharge spirit sink: double-clicking an in-range interaction
// zone snaps the player onto it for a spirit cost proportional to the travelled
// distance. This module is the single source of truth for that cost; the server
// (routes.ts) imports blinkCost to compute the authoritative charge, and the
// client imports the same function so its pre-check matches the server exactly.

/** Pixels of blink distance covered per 1 spirit spent. */
export const BLINK_PX_PER_SPIRIT = 100;

/** Minimum spirit charged for any blink, however short. */
export const BLINK_MIN_COST = 1;

/**
 * Spirit cost of a blink across `distance` pixels: `ceil(distance / 100)`,
 * floored at BLINK_MIN_COST so even a near-zero blink costs at least 1 spirit.
 * A negative or NaN distance clamps to the minimum cost.
 */
export function blinkCost(distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return BLINK_MIN_COST;
  return Math.max(BLINK_MIN_COST, Math.ceil(distance / BLINK_PX_PER_SPIRIT));
}
