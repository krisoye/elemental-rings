/**
 * Shared text/format helpers for the battle HUD widgets (EPIC #291 / WS D — DRY
 * remediation). PlayerDuelist and OpponentDuelist independently re-implemented the
 * hearts string, the gauge → CSS color conversion, and the §7.2 status-badge table
 * (with two different shapes). Those copies now live here, in one canonical place.
 *
 * Display-only: the server is the sole authority on hearts, gauges, and statuses.
 */

/** Default heart capacity (GDD §6.1 — all duelists start with 3 hearts). */
const DEFAULT_MAX_HEARTS = 3;

/**
 * Render a hearts bar: `max` symbols, the first `h` filled (♥) and the rest empty
 * (♡). Clamps so a value above `max` (or below 0) never produces a negative repeat.
 *
 * @param h current heart count.
 * @param max heart capacity (default 3).
 */
export function heartsString(h: number, max: number = DEFAULT_MAX_HEARTS): string {
  const filled = Math.max(0, Math.min(h, max));
  return '♥'.repeat(filled) + '♡'.repeat(Math.max(0, max - filled));
}

/**
 * Convert a 24-bit integer color (e.g. an `ELEMENT_COLORS[el]` entry) to a CSS
 * hex string `#rrggbb` for a Phaser text-style `color`. Zero-pads to six digits so
 * a dark color like 0x000044 keeps its leading zeros.
 */
export function cssColor(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/**
 * GDD §7.2 status badges — one per triangle gauge, index-aligned with
 * GAUGE_KEYS / GAUGE_ELEMENTS (Fire → Burn, Water → Drown, Wood → Tangle). The
 * canonical shape is `{ label, color }[]` (PlayerDuelist's original shape);
 * OpponentDuelist, which previously kept a bare `string[]`, now reads `.label`.
 * Order must not change — it is index-aligned with the gauge arrays.
 */
export const STATUS_BADGES: { label: string; color: string }[] = [
  { label: '🔥 BURN', color: '#ff6644' }, // fireGauge → Burning
  { label: '💧 DROWN', color: '#44aaff' }, // waterGauge → Drowning
  { label: '🌿 TANGLE', color: '#55cc44' }, // woodGauge → Entangled
];
