// Charge attack constants shared by client and server (#491, GDD §6.3).
// The server re-exports these from server/src/game/constants.ts (so the single
// authoritative source remains there for the server); the CLIENT imports from here
// so it never has to reach into the server source tree. Values must be kept in
// sync with server/src/game/constants.ts manually — any change to those values
// must be reflected here as well.
//
// NOTE: CHARGE_TELEGRAPH_MIN_MS is NOT here because the server's value is
// environment-dependent (shortened under E2E_FAST). The client always uses the
// PRODUCTION value (500 ms) — the server's compressed window is authoritative for
// timing; the client just renders the orb fly animation at the standard telegraph.
// The server broadcasts impact timing via its own window, so the client animation
// only needs the production value for a realistic display.

/** Hold below this threshold → instant tap (no arc swing, always horizontal). */
export const CHARGE_THRESHOLD_MS = 150;
/** Hold duration at which sharpness clamps to 1.0 (3 s full charge). */
export const MAX_CHARGE_MS = 3000;
/** Production telegraph minimum (500 ms at max charge). */
export const CHARGE_TELEGRAPH_MIN_MS_PROD = 500;

// ── Arc-swing constants (#491) ───────────────────────────────────────────────
/** Half-sweep angle: orb swings from −SWEEP_RANGE_DEG to +SWEEP_RANGE_DEG (degrees). */
export const SWEEP_RANGE_DEG = 45;
/** Half-width of the sweet-spot hit cone in degrees (orb must be within ±HIT_CONE_DEG of 0°). */
export const HIT_CONE_DEG = 10;
/** Duration of the first full sweep (−45° → +45°) in ms. */
export const BASE_SWEEP_MS = 1200;
/** Speed multiplier per reversal: each sweep is this fraction of the previous duration. */
export const SWEEP_SPEEDUP = 0.75;
/** Number of sweeps until max speed (speed stays at max beyond this). */
export const MAX_SWEEPS = 3;
/** Hold duration at which the orb has swung out to the first extreme and the
 *  hit cone arms (#499). Releases before this threshold resolve as a tap (grace
 *  window): CHARGE_THRESHOLD_MS ≤ holdMs < CHARGE_ARM_MS → tap path. */
export const CHARGE_ARM_MS = 250;
