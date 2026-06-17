// Charge attack constants shared by client and server (#485, GDD §6.3 Option A).
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

/** Hold below this threshold → instant tap (no oscillation, always horizontal). */
export const CHARGE_THRESHOLD_MS = 150;
/** Half-width of the centre-line hit zone in pixels. */
export const HIT_CONE_PX = 20;
/** Maximum Y amplitude of the oscillating orb (±80 px). */
export const Y_AMPLITUDE_PX = 80;
/** Oscillation period at t=0 (slowest oscillation). */
export const BASE_PERIOD_MS = 1200;
/** Controls how quickly the period tightens with hold time. */
export const PERIOD_DECAY_MS = 600;
/** Hold duration at which sharpness clamps to 1.0 (3 s full charge). */
export const MAX_CHARGE_MS = 3000;
/** Production telegraph minimum (500 ms at max charge). */
export const CHARGE_TELEGRAPH_MIN_MS_PROD = 500;
