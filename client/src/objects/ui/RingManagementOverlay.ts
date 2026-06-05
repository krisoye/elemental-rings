import { SLOT_KEYS } from '../../Constants';
import type { RingData } from '../InventoryGrid';
import type { SwapSlot } from './SlotSwapManager';

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
export type RingMgmtMode = 'sanctum' | 'field' | 'fusion';

/**
 * Player-facing column header labels (left → right). Mode-specific LEFT column:
 * SPIRIT (sanctum), LOOT (field), FUSE (fusion). Three shared right columns are
 * identical across all modes.
 */
export const COLUMN_LABELS: Record<RingMgmtMode, readonly string[]> = {
  sanctum: ['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT'],
  field:   ['LOOT',   'BENCH', 'HEALTH', 'COMBAT'],
  fusion:  ['FUSE',   'BENCH', 'HEALTH', 'COMBAT'],
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

// ── Symmetric-swap helper (#395) ─────────────────────────────────────────────

/**
 * Bench sections (pools that count toward the bench cap).
 * Used by the symmetric-swap pick-up guard: only a net one-way INTO the bench is
 * blocked at full-bench; a net-zero swap (one ring leaves and one enters) is always
 * allowed regardless of pick-up order.
 */
const BENCH_SECTIONS = new Set<SwapSlot>(['spare']);
/** Returns true when `s` is a section that counts toward the bench. */
function isBenchSection(s: SwapSlot): boolean {
  return BENCH_SECTIONS.has(s);
}

/**
 * Returns true when picking up `pickupSource` should be BLOCKED because the bench
 * is full and the move would be a net one-way increase into the bench.
 *
 * A net-zero swap (one bench ring already selected → drop target will displace it)
 * is always allowed regardless of pick-up order.
 *
 * The old guard (`if source === 'reliquary' && __reliquaryLocked`) rejected every
 * reliquary pick-up when bench was full, regardless of whether the player intended
 * to swap with a bench ring (net-zero). This replaces it.
 *
 * @param pickupSource   section the ring is being picked up FROM
 * @param currentSel     currently-selected ring's source (null = nothing selected)
 * @param benchFull      whether the bench is currently at or above spare_ring_max
 */
export function isPickupBlockedByFullBench(
  pickupSource: SwapSlot,
  currentSel: SwapSlot | null,
  benchFull: boolean,
): boolean {
  if (!benchFull) return false;
  // If picking up FROM the bench itself, bench count won't increase — never blocked.
  if (isBenchSection(pickupSource)) return false;
  // If a bench ring is already held (will be displaced FROM bench on drop), this new
  // pick-up is the "receive" side of a net-zero swap — allowed.
  if (currentSel !== null && isBenchSection(currentSel)) return false;
  // Picking up a non-bench ring when bench is full and nothing (or a non-bench ring)
  // is selected: any drop into spare would overflow. Block it.
  return true;
}
