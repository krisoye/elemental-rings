/**
 * StakeResolver — pure functions that implement thumb-ring stake passives.
 *
 * Each function guards on three conditions before acting:
 *   1. The thumb ring must not be a fusion (fusions have no passive).
 *   2. The thumb ring must have at least 1 use remaining.
 *   3. The thumb element must match the specific passive's element.
 *
 * These functions mutate the Colyseus schema objects in-place (they are called
 * only from BattleRoom on the server where mutations are authoritative).
 */
import { PlayerState } from '../schemas/PlayerState';
import { Ring } from '../schemas/Ring';
import { ElementEnum } from '../../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

/** True when the thumb qualifies to trigger any passive (not fusion, has uses). */
function thumbActive(ps: PlayerState): boolean {
  return !ps.thumb.isFusion && ps.thumb.currentUses > 0;
}

/** Charge the thumb 1 use; update extinguished flag. */
function chargeThumb(ps: PlayerState): void {
  ps.thumb.currentUses -= 1;
  ps.thumb.isExtinguished = ps.thumb.currentUses === 0;
}

/**
 * Kindling (Fire thumb) / Bulwark (Earth thumb) — applied once when the
 * battle room seats the player, before the first exchange.
 *
 * Kindling: buffs a1/a2/d1/d2 rings that share the FIRE element, in the
 *   order a1→a2→d1→d2, consuming 1 thumb use per ring buffed.
 * Bulwark: same but targets EARTH rings in the order d1→d2→a1→a2.
 *
 * Each buffed ring gets +1 currentUses (maxUses raised to match if needed),
 * and isExtinguished is cleared. Stops when thumb uses run out or all slots
 * have been visited.
 */
export function applySetupPassive(ps: PlayerState): void {
  if (!thumbActive(ps)) return;

  let targetEl: number;
  let order: ReadonlyArray<'a1' | 'a2' | 'd1' | 'd2'>;

  if (ps.thumb.element === FIRE) {
    targetEl = FIRE;
    order = ['a1', 'a2', 'd1', 'd2'];
  } else if (ps.thumb.element === EARTH) {
    targetEl = EARTH;
    order = ['d1', 'd2', 'a1', 'a2'];
  } else {
    return;
  }

  for (const slot of order) {
    if (ps.thumb.currentUses <= 0) break;
    const ring = ps.getSlot(slot);
    if (ring.element !== targetEl) continue;
    ring.currentUses += 1;
    ring.maxUses = Math.max(ring.maxUses, ring.currentUses);
    ring.isExtinguished = false;
    chargeThumb(ps);
  }
}

/**
 * Wellspring (Water thumb) — called after a successful PARRY+STRONG rally.
 *
 * Refunds the 1 use that `resolveBlock` already spent on the defender ring,
 * then charges the thumb 1 use instead.
 *
 * Returns true if the passive fired; false if the guard rejected it.
 */
export function applyWellspring(ps: PlayerState, defenderRing: Ring): boolean {
  if (!thumbActive(ps)) return false;
  if (ps.thumb.element !== WATER) return false;
  defenderRing.currentUses = Math.min(defenderRing.maxUses, defenderRing.currentUses + 1);
  defenderRing.isExtinguished = false;
  chargeThumb(ps);
  return true;
}

/**
 * Deep Roots (Wood thumb) — called instead of applying a heart loss to the
 * player. The thumb absorbs the blow by spending 1 use.
 *
 * Returns true if the passive fired (heart NOT lost); false otherwise.
 */
export function applyDeepRoots(ps: PlayerState): boolean {
  if (!thumbActive(ps)) return false;
  if (ps.thumb.element !== WOOD) return false;
  chargeThumb(ps);
  return true;
}

/**
 * Tailwind (Wind thumb) — called in handleSelectAttack before the attack ring
 * pays its use cost. The thumb pays instead, so the attack ring is NOT charged.
 *
 * Returns true if the passive fired (attack ring use NOT deducted); false
 * otherwise. The caller skips the normal ring deduction when this returns true.
 */
export function applyTailwind(ps: PlayerState, _attackRing: Ring): boolean {
  if (!thumbActive(ps)) return false;
  if (ps.thumb.element !== WIND) return false;
  chargeThumb(ps);
  return true;
}
