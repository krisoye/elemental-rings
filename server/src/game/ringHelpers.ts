/**
 * ringHelpers — the single home for the two server-side ring INVARIANTS and the
 * typed broadcast-payload builders that were previously hand-maintained inline at
 * a dozen-plus sites across BattleRoom/BlockResolver/StatusEffects/StakeResolver.
 *
 * The invariant: a ring is extinguished exactly when it has 0 uses left. Every
 * mutation of `currentUses` MUST re-sync `isExtinguished`, or the broadcast state
 * desyncs from the actual depth. Routing every use change through `consumeUse` /
 * `setUses` makes that sync unforgettable.
 *
 * Typed structurally (RingUses) rather than against the Colyseus `Ring` @Schema so
 * the same helpers serve both the schema-mutating BattleRoom/StakeResolver paths
 * AND the framework-free, unit-testable StatusEffects module (which models a Ring
 * with a plain object). The real `Ring` schema satisfies RingUses.
 */
import { WonRingPayload, BattleSummaryPayload, RechargeResultPayload } from '../../../shared/types';

/** The minimal mutable view of a Ring the use-invariant helpers touch. */
export interface RingUses {
  currentUses: number;
  isExtinguished: boolean;
}

/**
 * Spend one use on `ring` (the universal ring-charge invariant). Decrements
 * currentUses by 1 when it is > 0 (a no-op at 0, never going negative), then
 * re-syncs isExtinguished. Behaviour-identical to the former inline
 * `currentUses = Math.max(0, currentUses - 1); isExtinguished = currentUses === 0`.
 */
export function consumeUse(ring: RingUses): void {
  if (ring.currentUses > 0) ring.currentUses -= 1;
  ring.isExtinguished = ring.currentUses === 0;
}

/**
 * Set `ring.currentUses` to `n` (floored at 0) and re-sync isExtinguished. Used by
 * every path that assigns currentUses to a computed value (seat, recharge, grants,
 * test seeding) rather than spending a single use.
 */
export function setUses(ring: RingUses, n: number): void {
  ring.currentUses = Math.max(0, n);
  ring.isExtinguished = ring.currentUses === 0;
}

// ── Typed broadcast-payload builders ────────────────────────────────────────
// One factory per outbound message so the literal field set lives in exactly one
// place and is checked against the shared payload interface at the call site.

/** Build the `wonRing` payload (winner gained a ring). element/xp default to 0. */
export function wonRingPayload(
  ringId: string,
  element: number | undefined,
  xp: number | undefined,
): WonRingPayload {
  return { ringId, element: element ?? 0, xp: xp ?? 0 };
}

/** Build the post-duel `battleSummary` payload for one human client. */
export function battleSummaryPayload(
  won: boolean,
  goldGained: number,
  xpGained: number,
  aggregateXp: number,
): BattleSummaryPayload {
  return { won, goldGained, xpGained, aggregateXp };
}

/** Build the per-client `rechargeResult` payload after an in-duel recharge. */
export function rechargeResultPayload(
  slot: RechargeResultPayload['slot'],
  restored: number,
  requested: number,
  spiritCurrent: number,
): RechargeResultPayload {
  return { slot, restored, requested, spiritCurrent };
}
