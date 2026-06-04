import { SLOT_KEYS } from '../../Constants';
import type { RingData } from '../InventoryGrid';

/**
 * Unified ring-management contract (EPIC #387 / #389).
 *
 * The field "Manage Battle Rings" overlay (`BattleHandOverlay`) and the Sanctum
 * "Reliquary" overlay (`CampScene.openRingwallOverlay`) were two divergent
 * implementations of overlapping ring-management UI. #389 converges them onto a
 * single shared structure:
 *
 * ```
 *  sanctum:  SPIRIT (n/max)  | BENCH (n/max) | HEALTH | COMBAT
 *  field:    LOOT (WON/DISC) | BENCH (n/max) | HEALTH | COMBAT
 * ```
 *
 * The three right-hand columns — BENCH (an `InventoryGrid` of carried, non-
 * battle-slotted rings), HEALTH (the equipped heart `RingCard`), and COMBAT (the
 * STATUS thumb card left-aligned above the 2×2 A1/A2 · D1/D2 cluster) — are the
 * SAME component structure and card geometry in both modes (the anti-drift
 * payload). Only the left column is mode-specific.
 *
 * This module owns the convergence contract that both controllers share:
 *   - the canonical Bench / Spirit counter computations (mirroring the server),
 *   - the shared column-header labels and player-facing "Bench" naming, and
 *   - the `window.__ringMgmtState` structure reporter used by the cross-mode E2E
 *     assertions.
 *
 * No server behaviour changes here — every move still maps to the existing
 * routes; the field mode simply disables the spirit/reliquary target (a ring
 * cannot be banked to the resting pool away from the Sanctum).
 */

export type RingMgmtMode = 'sanctum' | 'field';

/**
 * Player-facing column header labels (left → right). The mode-specific LEFT
 * column is SPIRIT (sanctum, the resting pool) or LOOT (field, the WON +
 * DISCARD pair); the three shared columns are identical in both modes.
 *
 * NAMING (#389): the carried-rings column is labelled **"Bench"** to the player
 * (replacing the old "Spares"); the code/DB/API identifiers stay `spare_*`.
 */
export const COLUMN_LABELS: Record<RingMgmtMode, readonly string[]> = {
  sanctum: ['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT'],
  field: ['LOOT', 'BENCH', 'HEALTH', 'COMBAT'],
} as const;

/**
 * The canonical Bench count — rings carried (`in_carry=1`), NOT occupying any
 * battle-hand slot, and NOT the pending WON ring (its one-allowed overflow slot
 * is excluded). Mirrors the server `assertSpareWithinMax` predicate exactly, so
 * the Bench counter never disagrees with the lock state. `spare_*` is retained
 * in every identifier — only the player-facing label reads "Bench".
 *
 * @param rings        every owned ring (`/api/me` rings list)
 * @param loadout      slot → ringId map (battle-hand assignments)
 * @param pendingRingId the pending WON ring id, or null
 */
export function benchSpareCount(
  rings: RingData[],
  loadout: Record<string, string | null>,
  pendingRingId: string | null,
): number {
  const battleSlotIds = new Set(
    (SLOT_KEYS as readonly string[]).map((k) => loadout[k]).filter(Boolean) as string[],
  );
  return rings.filter(
    (r) =>
      r.in_carry === 1 &&
      !battleSlotIds.has(r.id) &&
      r.id !== pendingRingId &&
      !(r as { pending?: number }).pending,
  ).length;
}

/** Counter values rendered as crisp `BENCH n/max` / `SPIRIT n/max` headers. */
export interface RingMgmtCounters {
  /** Sanctum only — `reliquaryCount / reliquaryCap` (the resting pool). */
  spirit?: { n: number; max: number };
  /** Both modes — `benchSpareCount / spare_ring_max` (pending excluded). */
  bench: { n: number; max: number };
}

/** A Tier-row glyph: an upper-case `T` immediately followed by a digit (T0, T1…). */
const TIER_ROW_RE = /^T\d/;

/**
 * Recursively scan a Phaser display object (typically the open overlay container)
 * for any text child whose content reads like a Tier row (`T0`/`T1`/…). #389
 * permanently dropped the Tier row from every `RingCard` surface, so a genuine
 * runtime scan — rather than a hardcoded `false` — gives the E2E layer real
 * regression protection: if a future edit reintroduces a Tier label anywhere in
 * the overlay, the reporter flips to `true` and the structural assertions fail.
 */
export function scanForTierRow(root: { getAll?: () => unknown[] } | null | undefined): boolean {
  if (!root || typeof root.getAll !== 'function') return false;
  for (const child of root.getAll()) {
    const o = child as { text?: unknown; getAll?: () => unknown[] };
    if (typeof o.text === 'string' && TIER_ROW_RE.test(o.text)) return true;
    if (typeof o.getAll === 'function' && scanForTierRow(o)) return true;
  }
  return false;
}

/**
 * Publish the converged ring-management structure to `window.__ringMgmtState` so
 * the cross-mode E2E assertions can verify, per mode: the rendered column set,
 * the Spirit/Bench counter values (`n/max`), and — via a genuine runtime scan of
 * the open overlay container — that no card carries a Tier row. Call once per
 * render; pass the live counters and the overlay container for the open mode.
 */
export function publishRingMgmtState(
  mode: RingMgmtMode,
  counters: RingMgmtCounters,
  overlayRoot?: { getAll?: () => unknown[] } | null,
): void {
  window.__ringMgmtState = {
    mode,
    columns: [...COLUMN_LABELS[mode]],
    counters,
    // #389 — real scan (not a hardcoded constant): the Tier row was dropped from
    // every RingCard surface, so this stays false unless a regression reintroduces
    // a `T{n}` label somewhere in the overlay.
    anyCardHasTierRow: scanForTierRow(overlayRoot),
  };
}

/** Clear the structure reporter when both overlays are closed. */
export function clearRingMgmtState(): void {
  window.__ringMgmtState = undefined;
}
