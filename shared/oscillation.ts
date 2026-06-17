// Oscillation formula for the charge attack mechanic (GDD §6.3 Option A / #485).
//
// The SAME formulas are used client-side (for display) and server-side (for
// authoritative hit/miss resolution) to ensure the client can never spoof the
// release Y position. Both sides import these pure functions and the constants
// they need — no duplication.
//
// Constants imported from constants.ts on each side; this module is parameter-
// based so it is fully portable (no Node/browser-specific imports).

// --- Oscillation period formula ---
// Period speeds up (shortens) as the hold duration grows. BASE_PERIOD_MS sets the
// slowest oscillation (at t=0); PERIOD_DECAY_MS controls how quickly it tightens.
export function oscillationPeriod(
  holdMs: number,
  basePeriodMs: number,
  periodDecayMs: number,
): number {
  return basePeriodMs / (1 + holdMs / periodDecayMs);
}

// --- Y-offset formula ---
// A sine wave whose period shrinks with hold duration — the orb oscillates faster
// the longer it is held. Clamped to [-amplitudePx, +amplitudePx] (the GDD cap of
// ±80 px) to keep the orb readable at all charge levels.
export function yOffset(
  holdMs: number,
  amplitudePx: number,
  basePeriodMs: number,
  periodDecayMs: number,
): number {
  const period = oscillationPeriod(holdMs, basePeriodMs, periodDecayMs);
  const raw = amplitudePx * Math.sin((2 * Math.PI * holdMs) / period);
  // Clamp: amplitude should never exceed the cap even if floating-point rounds over.
  return Math.max(-amplitudePx, Math.min(amplitudePx, raw));
}

// --- Hit check ---
// Returns true when the orb's Y position at the release moment is within the
// hit cone (±HIT_CONE_PX of the centre line).
export function isHit(holdMs: number, hitConePx: number, amplitudePx: number, basePeriodMs: number, periodDecayMs: number): boolean {
  return Math.abs(yOffset(holdMs, amplitudePx, basePeriodMs, periodDecayMs)) <= hitConePx;
}

// --- Sharpness ---
// 0 = no charge (tap), 1 = maximum charge (MAX_CHARGE_MS or beyond). Clamped.
export function sharpness(holdMs: number, maxChargeMs: number): number {
  return Math.max(0, Math.min(1, holdMs / maxChargeMs));
}

// --- Telegraph duration ---
// Varies from the standard TELEGRAPH_MS down to CHARGE_TELEGRAPH_MIN_MS as
// sharpness increases. A tap attack gets the full 900 ms; a maxed charge gets
// the compressed minimum.
export function telegraphDuration(
  sharpnessVal: number,
  baseTelegraphMs: number,
  chargeTelegraphMinMs: number,
): number {
  return Math.round(
    baseTelegraphMs + (chargeTelegraphMinMs - baseTelegraphMs) * sharpnessVal,
  );
}
