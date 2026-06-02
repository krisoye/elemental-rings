/**
 * DoubleAttack — the fusion-thumb double-attack eligibility predicate
 * (EPIC #264, GDD §3.4 compound element / §4.5 ring abilities).
 *
 * A staked FUSION thumb grants a signature passive: when BOTH attack slots hold
 * the thumb fusion's two component elements, the attacker may fire a two-orb
 * combo in a single turn (cost: A1 −1, A2 −1, thumb −1). This module owns the
 * server-authoritative eligibility check; BattleRoom re-validates every
 * `selectDoubleAttack` against it and silently drops an ineligible request.
 *
 * Pure: reads ring elements/uses; mutates nothing.
 */
import { PlayerState } from '../schemas/PlayerState';
import { componentsOf } from './Fusions';

/** True when `a` and `b` are the same unordered 2-element set. */
function sameSet(a: number[], b: number[]): boolean {
  if (a.length !== 2 || b.length !== 2) return false;
  const [a0, a1] = a;
  const [b0, b1] = b;
  return (a0 === b0 && a1 === b1) || (a0 === b1 && a1 === b0);
}

/**
 * Eligibility for a fusion-thumb double attack (EPIC #264 Contracts).
 *
 *   thumb.isFusion
 *   && sameSet([a1.element, a2.element], componentsOf(thumb.element))
 *   && a1.currentUses > 0 && a2.currentUses > 0 && thumb.currentUses > 0
 *
 * Order-independent on the A1/A2 element pair. A base (non-fusion) thumb, a
 * mismatched A1/A2 pair, or any of the three rings out of uses → false (the
 * attacker falls back to the normal single-attack flow).
 */
export function canDoubleAttack(attacker: PlayerState): boolean {
  const { thumb, a1, a2 } = attacker;
  if (!thumb.isFusion) return false;
  if (thumb.currentUses <= 0 || a1.currentUses <= 0 || a2.currentUses <= 0) return false;
  return sameSet([a1.element, a2.element], componentsOf(thumb.element));
}
