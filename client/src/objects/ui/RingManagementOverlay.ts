import { SLOT_KEYS } from '../../Constants';
import type { RingData } from '../InventoryGrid';

/**
 * Unified ring-management contract (EPIC #387 / #389 / #395).
 *
 * The field "Manage Battle Rings" overlay (`BattleHandOverlay`) and the Sanctum
 * "Reliquary" overlay (`CampScene.openRingwallOverlay`) were two divergent
 * implementations of overlapping ring-management UI. This module converges them:
 *
 * ```
 *  sanctum:  SPIRIT (n/max)  | BENCH (n/max) | HEALTH | COMBAT
 *  field:    LOOT (WON/DISC) | BENCH (n/max) | HEALTH | COMBAT
 *  fusion:   FUSE            | BENCH (n/max) | HEALTH | COMBAT
 * ```
 *
 * The three right-hand columns (BENCH, HEALTH, COMBAT) are rendered by the shared
 * `BenchHealthCombat` component in all modes. Only the left column is mode-specific.
 *
 * NAMING (#389): the carried-rings column is labelled **"Bench"** to the player
 * (replacing the old "Spares"); code/DB/API identifiers stay `spare_*`.
 *
 * ARCHITECTURE: this module is **pure TypeScript** — no Phaser import. Unit tests
 * rely on this invariant. The overlay class lives in `RingManagementOverlayClass.ts`.
 */

// #395 — 'fusion' added for Sub-B (rendering wired in Sub-B; mode type extended here).
// #431 — 'merge' added for same-element ring consolidation (GDD §4.7).
export type RingMgmtMode = 'sanctum' | 'field' | 'fusion' | 'merge';

/**
 * Player-facing column header labels (left → right). Mode-specific LEFT column:
 * SPIRIT (sanctum), LOOT (field), FUSE (fusion), MERGE (merge). Three shared
 * right columns are identical across all modes.
 */
export const COLUMN_LABELS: Record<RingMgmtMode, readonly string[]> = {
  sanctum: ['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT'],
  field:   ['BENCH',  'HEALTH', 'COMBAT'],
  fusion:  ['FUSE',   'BENCH', 'HEALTH', 'COMBAT'],
  merge:   ['MERGE',  'BENCH', 'HEALTH', 'COMBAT'],
} as const;

/**
 * The canonical Bench count — rings carried (`in_carry=1`), NOT occupying any
 * battle-hand slot, and NOT the pending WON ring. Mirrors the server's
 * `assertSpareWithinMax` predicate exactly. `spare_*` is retained in every
 * identifier — only the player-facing label reads "Bench".
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
 * Recursively scan a Phaser display object for any text child whose content reads
 * like a Tier row (`T0`/`T1`/…). Gives E2E real regression protection.
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
 * Publish the converged ring-management structure to `window.__ringMgmtState`.
 * Call once per render; pass the live counters and the overlay container.
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
    anyCardHasTierRow: scanForTierRow(overlayRoot),
  };
}

/** Clear the structure reporter when the overlay closes. */
export function clearRingMgmtState(): void {
  window.__ringMgmtState = undefined;
}

