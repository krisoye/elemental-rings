// EPIC #291 WS I (#307) — shared click-then-click slot-swap state machine.
//
// CampScene's Reliquary modal and BattleHandOverlay's manage-battle-rings modal
// both implement the identical "pick up a ring, then click a target slot to
// resolve the swap" interaction. After EPIC #302 added the unrestricted 'heart'
// slot to both, the two state machines became structurally identical — this
// class is the extraction point.
//
// The manager owns ONLY the selection state and the moveTo orchestration
// (deselect-on-same-slot / resolveMove / onAfter / clear). Each host supplies a
// `resolveMove` that performs the host-specific server round-trips (PUT
// /api/carry, /api/loadout, /api/heart-slot) and an `onAfter` that reloads and
// re-renders. The server stays authoritative for every effect — this class adds
// no game logic.

/**
 * Every section/slot a ring can be picked up from or dropped onto. `'reliquary'`
 * and `'spare'` are the inventory pools; `'thumb' | 'a1' | 'a2' | 'd1' | 'd2'`
 * are the battle-hand slots; `'heart'` is the dedicated Heart slot (EPIC #302).
 */
export type SwapSlot = 'reliquary' | 'spare' | 'thumb' | 'a1' | 'a2' | 'd1' | 'd2' | 'heart';

/**
 * Host-supplied configuration for a {@link SlotSwapManager}.
 */
export interface SwapConfig {
  /**
   * The slots this host actually exposes. A {@link SlotSwapManager.moveTo} into a
   * slot not in this list is ignored. CampScene includes `'reliquary'`; the field
   * modal (BattleHandOverlay) excludes it (no Reliquary access in the field).
   */
  validSlots: readonly SwapSlot[];
  /**
   * Resolve a single completed move: the ring `ringId` travels from `from` to
   * `to`. The host performs every server mutation here and resolves when the
   * round-trip is done (or has surfaced its own error). Never called when
   * `to === from` (that path deselects) or when `to` is not in {@link validSlots}.
   */
  resolveMove(ringId: string, from: SwapSlot, to: SwapSlot): Promise<void>;
  /**
   * Run after a successful {@link resolveMove} (and after the selection is
   * cleared) — typically reload `/api/me` and re-render. May be async; the
   * manager awaits it.
   */
  onAfter(): Promise<void> | void;
}

/**
 * Click-then-click slot-swap state machine shared by CampScene and
 * BattleHandOverlay. Holds the current "picked up" selection and orchestrates a
 * move when a target slot is clicked. All host-specific behaviour (which server
 * calls a move maps to, how to re-render) is injected via {@link SwapConfig}.
 */
export class SlotSwapManager {
  private readonly config: SwapConfig;
  private current: { ringId: string; source: SwapSlot } | null = null;

  constructor(config: SwapConfig) {
    this.config = config;
  }

  /**
   * Pick up `ringId` from `source` (or re-select to change the active source).
   * Replaces any existing selection.
   */
  select(ringId: string, source: SwapSlot): void {
    this.current = { ringId, source };
  }

  /**
   * Resolve the pending selection onto `target`. No-op when nothing is selected.
   * When `target === selection.source` the click is a re-click on the origin slot
   * and simply deselects. Otherwise, when `target` is a valid slot, the host's
   * `resolveMove(ringId, source, target)` runs, the selection is cleared, and
   * `onAfter()` runs.
   */
  async moveTo(target: SwapSlot): Promise<void> {
    const sel = this.current;
    if (!sel) return;
    if (target === sel.source) {
      // Re-click on the origin slot — deselect.
      this.clear();
      return;
    }
    if (!this.config.validSlots.includes(target)) return;
    await this.config.resolveMove(sel.ringId, sel.source, target);
    this.clear();
    await this.config.onAfter();
  }

  /** Clear the current selection. */
  clear(): void {
    this.current = null;
  }

  /** The current `{ ringId, source }` selection, or `null` when nothing is held. */
  get selection(): { ringId: string; source: SwapSlot } | null {
    return this.current;
  }
}
