// GDD §7 — triangle status effects, derived purely from the persistent element
// gauges (no extra @Schema state). A gauge at/above STATUS_THRESHOLD activates
// its status:
//   fireGauge  → Burning   (lose 1 heart at the start of the afflicted turn)
//   waterGauge → Drowning  (every attack throw costs +1 use)
//   woodGauge  → Entangled (highest-use battle ring loses 1 use at turn start)
//
// Statuses are cleansed by catching (BLOCK/PARRY) with the element that beats the
// gauge element: Water catch → −fireGauge, Wood catch → −waterGauge, Fire catch
// → −woodGauge (GDD §7.2 "How to Reduce Gauge").
//
// This module is pure and Colyseus-free so it is fully unit-testable with plain
// objects — it references only a minimal structural view of PlayerState/Ring
// (the same approach BlockResolver/ElementSystem take with their inputs).
import { ElementEnum } from '../../../shared/types';
import { STATUS_THRESHOLD } from './constants';

/** Minimal structural view of a Ring (only the fields the status code touches). */
interface RingLike {
  currentUses: number;
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

/** The four battle-hand combat slots Entangled can drain (thumb is excluded). */
const BATTLE_RING_KEYS = ['a1', 'a2', 'd1', 'd2'] as const;
type BattleRingKey = (typeof BATTLE_RING_KEYS)[number];

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
  /** The battle slot Entangled drained one use from, or null if it did not fire. */
  entangledRingKey: string | null;
}

/**
 * Find the highest-use, still-usable battle ring among a1/a2/d1/d2. Extinguished
 * rings (0 uses) are skipped — they have no use to drain. Ties resolve to the
 * earlier slot in BATTLE_RING_KEYS order (a1 > a2 > d1 > d2), deterministically.
 * Returns null when every battle ring is extinguished.
 */
function highestUseBattleRingKey(ps: PlayerLike): BattleRingKey | null {
  let bestKey: BattleRingKey | null = null;
  let bestUses = 0;
  for (const key of BATTLE_RING_KEYS) {
    const ring = ps[key];
    if (ring.isExtinguished || ring.currentUses <= 0) continue;
    if (ring.currentUses > bestUses) {
      bestUses = ring.currentUses;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * Apply start-of-turn status damage to the afflicted (current attacker) player.
 *
 * - Burning (fireGauge ≥ threshold): lose 1 heart. Floored at 0 — Burning can KO.
 * - Entangled (woodGauge ≥ threshold): the highest-use battle ring (a1/a2/d1/d2)
 *   loses 1 use, extinguishing it if it hits 0. No-op if every battle ring is
 *   already extinguished.
 *
 * Mutates `ps` in place. Drowning has no turn-start tick (its cost applies at
 * attack-throw time in BattleRoom).
 */
export function applyTurnStart(ps: PlayerLike): TurnStartResult {
  const result: TurnStartResult = { heartLost: false, entangledRingKey: null };

  if (isBurning(ps)) {
    ps.hearts = Math.max(0, ps.hearts - 1);
    result.heartLost = true;
  }

  if (isEntangled(ps)) {
    const key = highestUseBattleRingKey(ps);
    if (key) {
      const ring = ps[key];
      ring.currentUses = Math.max(0, ring.currentUses - 1);
      ring.isExtinguished = ring.currentUses === 0;
      result.entangledRingKey = key;
    }
  }

  return result;
}

/**
 * Cleanse one gauge counter when the defender catches (BLOCK/PARRY) with a
 * triangle element (GDD §7.2): the caught element reduces the gauge it counters.
 *   Water catch → fireGauge −1
 *   Wood catch  → waterGauge −1
 *   Fire catch  → woodGauge −1
 * All gauges floor at 0. Non-triangle (Wind/Earth/fusion) defenses cleanse
 * nothing. Mutates `ps` in place.
 */
export function applyGaugeCleanse(defenderPs: PlayerLike, defenderElement: number): void {
  switch (defenderElement) {
    case ElementEnum.WATER:
      defenderPs.fireGauge = Math.max(0, defenderPs.fireGauge - 1);
      break;
    case ElementEnum.WOOD:
      defenderPs.waterGauge = Math.max(0, defenderPs.waterGauge - 1);
      break;
    case ElementEnum.FIRE:
      defenderPs.woodGauge = Math.max(0, defenderPs.woodGauge - 1);
      break;
    default:
      // Wind, Earth, and fusion defenses cleanse no gauge.
      break;
  }
}
