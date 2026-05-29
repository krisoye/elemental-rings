// GDD §7 — triangle status effects, derived purely from the persistent element
// gauges (no extra @Schema state). A gauge at/above STATUS_THRESHOLD activates
// its status. All three triangle statuses now resolve at TURN START (the v2
// four-case model retired the old per-throw Drowning surcharge and the
// catch-to-cleanse rule — the gauge reductions are handled by the strong-block /
// parry cases in BlockResolver):
//   fireGauge  → Burning   (lose 1 heart at turn start)
//   waterGauge → Drowning  (highest-capacity ATTACK ring loses 1 use at turn start)
//   woodGauge  → Entangled (highest-capacity DEFENSE ring loses 1 use at turn start)
//
// Capacity = a ring's max_uses (its tier potential), NOT its current uses.
//
// This module is pure and Colyseus-free so it is fully unit-testable with plain
// objects — it references only a minimal structural view of PlayerState/Ring
// (the same approach BlockResolver/ElementSystem take with their inputs).
import { STATUS_THRESHOLD } from './constants';

/** Minimal structural view of a Ring (only the fields the status code touches). */
interface RingLike {
  currentUses: number;
  maxUses: number;
  isExtinguished: boolean;
}

/**
 * Minimal structural view of PlayerState. Typed structurally (rather than
 * importing the Colyseus @Schema class) so these functions stay framework-free
 * and unit-testable with plain objects. The real PlayerState satisfies it.
 */
export interface PlayerLike {
  hearts: number;
  fireGauge: number;
  waterGauge: number;
  woodGauge: number;
  a1: RingLike;
  a2: RingLike;
  d1: RingLike;
  d2: RingLike;
}

/** The two attack slots Drowning can drain. */
const ATTACK_RING_KEYS = ['a1', 'a2'] as const;
/** The two defense slots Entangled can drain. */
const DEFENSE_RING_KEYS = ['d1', 'd2'] as const;
type BattleRingKey = 'a1' | 'a2' | 'd1' | 'd2';

/** True when the player's Fire gauge has reached the status threshold (Burning). */
export function isBurning(ps: PlayerLike, threshold: number = STATUS_THRESHOLD): boolean {
  return ps.fireGauge >= threshold;
}

/** True when the player's Water gauge has reached the status threshold (Drowning). */
export function isDrowning(ps: PlayerLike, threshold: number = STATUS_THRESHOLD): boolean {
  return ps.waterGauge >= threshold;
}

/** True when the player's Wood gauge has reached the status threshold (Entangled). */
export function isEntangled(ps: PlayerLike, threshold: number = STATUS_THRESHOLD): boolean {
  return ps.woodGauge >= threshold;
}

/** Result of applying start-of-turn status damage to the afflicted player. */
export interface TurnStartResult {
  /** Burning fired and removed a heart this turn. */
  heartLost: boolean;
  /** The attack slot Drowning drained one use from, or null if it did not fire. */
  drowningRingKey: string | null;
  /** The defense slot Entangled drained one use from, or null if it did not fire. */
  entangledRingKey: string | null;
}

/**
 * Find the highest-CAPACITY (max_uses), still-usable ring among `keys`.
 * Extinguished / 0-use rings are skipped — they have no use to drain. Ties
 * resolve to the earlier slot in `keys` order, deterministically. Returns null
 * when every candidate ring is extinguished.
 */
function highestCapacityRingKey(
  ps: PlayerLike,
  keys: readonly BattleRingKey[],
): BattleRingKey | null {
  let bestKey: BattleRingKey | null = null;
  let bestCapacity = -1;
  for (const key of keys) {
    const ring = ps[key];
    if (ring.isExtinguished || ring.currentUses <= 0) continue;
    if (ring.maxUses > bestCapacity) {
      bestCapacity = ring.maxUses;
      bestKey = key;
    }
  }
  return bestKey;
}

/** Drain one use from the chosen ring, extinguishing it at 0. */
function drainRing(ps: PlayerLike, key: BattleRingKey): void {
  const ring = ps[key];
  ring.currentUses = Math.max(0, ring.currentUses - 1);
  ring.isExtinguished = ring.currentUses === 0;
}

/**
 * Apply start-of-turn status effects to the afflicted (current attacker) player.
 * All three triangle statuses now tick here (GDD §7.1/§7.2 v2):
 *
 * - Burning (fireGauge ≥ threshold): lose 1 heart. Floored at 0 — Burning can KO.
 * - Drowning (waterGauge ≥ threshold): the highest-capacity ATTACK ring (a1/a2 by
 *   max_uses) loses 1 use. No per-throw surcharge any more.
 * - Entangled (woodGauge ≥ threshold): the highest-capacity DEFENSE ring (d1/d2 by
 *   max_uses) loses 1 use.
 *
 * Each ring drain is a no-op if its candidate slots are all extinguished. Mutates
 * `ps` in place.
 */
export function applyTurnStart(ps: PlayerLike): TurnStartResult {
  const result: TurnStartResult = {
    heartLost: false,
    drowningRingKey: null,
    entangledRingKey: null,
  };

  if (isBurning(ps)) {
    ps.hearts = Math.max(0, ps.hearts - 1);
    result.heartLost = true;
  }

  if (isDrowning(ps)) {
    const key = highestCapacityRingKey(ps, ATTACK_RING_KEYS);
    if (key) {
      drainRing(ps, key);
      result.drowningRingKey = key;
    }
  }

  if (isEntangled(ps)) {
    const key = highestCapacityRingKey(ps, DEFENSE_RING_KEYS);
    if (key) {
      drainRing(ps, key);
      result.entangledRingKey = key;
    }
  }

  return result;
}
