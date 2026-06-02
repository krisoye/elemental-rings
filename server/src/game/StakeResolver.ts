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
 * All-in setup distributor (Fire / Water / Wood thumb) — applied once when the
 * battle room seats the player, before the first exchange.
 *
 * The thumb spends ALL of its current uses, distributing +1 currentUses at a
 * time to base-element rings in the battle hand (A1/A2/D1/D2) that match the
 * thumb's element. Recipients are visited round-robin from highest-XP to
 * lowest-XP, tiebreaking by slot order A1→A2→D1→D2, until the thumb reaches 0.
 *
 * Each granted use raises the ring's maxUses to match if it would overflow, and
 * clears isExtinguished. If no matching rings are in the hand, the passive does
 * NOT fire and the thumb keeps all of its uses. When it does fire, the thumb
 * ends at 0 uses (extinguished, passive for the rest of the duel).
 *
 * Returns the total number of uses distributed (0 if the passive did not apply)
 * so the caller can award thumb XP (XP_THUMB_BUFF per use distributed).
 */
export function applySetupPassive(ps: PlayerState): number {
  if (!thumbActive(ps)) return 0;
  const el = ps.thumb.element;
  if (el !== FIRE && el !== WATER && el !== WOOD) return 0;

  const SLOT_ORDER = ['a1', 'a2', 'd1', 'd2'] as const;
  const matching = SLOT_ORDER.map((slot, idx) => ({ idx, ring: ps.getSlot(slot) }))
    .filter(({ ring }) => ring.element === el)
    .sort((a, b) => b.ring.xp - a.ring.xp || a.idx - b.idx);

  // No matching base-element rings: passive does not fire; thumb keeps its uses.
  if (matching.length === 0) return 0;

  let distributed = 0;
  let i = 0;
  while (ps.thumb.currentUses > 0) {
    const ring = matching[i % matching.length].ring;
    ring.currentUses += 1;
    ring.maxUses = Math.max(ring.maxUses, ring.currentUses);
    ring.isExtinguished = false;
    chargeThumb(ps);
    distributed += 1;
    i += 1;
  }
  return distributed;
}

/**
 * Precision Parry (Earth thumb) — called whenever the DEFENDER hits the PARRY
 * timing window, regardless of element matchup (STRONG/NEUTRAL/WEAK).
 *
 * Refunds the 1 use that `resolveBlock` already spent on the defending ring
 * (capped at its maxUses), then charges the Earth thumb 1 use instead and
 * clears isExtinguished on the defending ring. Fires every time until the thumb
 * is exhausted.
 *
 * Returns true if the passive fired; false if the guard rejected it.
 */
export function applyEarthParry(ps: PlayerState, defenderRing: Ring): boolean {
  if (!thumbActive(ps)) return false;
  if (ps.thumb.element !== EARTH) return false;
  defenderRing.currentUses = Math.min(defenderRing.maxUses, defenderRing.currentUses + 1);
  defenderRing.isExtinguished = false;
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

// ── Boss unique passives (EPIC #256, #261) ──────────────────────────────────
/**
 * Curated, boss-only passive descriptor (GDD §10.5). Data-driven and keyed by
 * boss id in BOSS_PASSIVES so a new boss is a table row, not a code branch. Both
 * effects are applied (or initialised) at AI seat time:
 *
 *   heartwoodCharges    — Thornwood "Heartwood": the first N heart-losses are
 *                         redirected to the Thumb (absorbed) instead of costing a
 *                         heart. BattleRoom tracks the remaining charges and
 *                         consumes one per absorbed hit (applyHeartwoodAbsorb).
 *   bulwarkDefenseBonus — Bogwood "Bulwark": both defense rings (d1/d2) start at
 *                         +this uses, applied once at seat (applyBossSetupPassive).
 *
 * Guardians have no row → no passive (their identity is gauge pressure, #260).
 */
export interface BossPassive {
  heartwoodCharges: number;
  bulwarkDefenseBonus: number;
}

export const BOSS_PASSIVES: Record<string, BossPassive> = {
  forest_thornwood_warden: { heartwoodCharges: 2, bulwarkDefenseBonus: 0 },
  forest_bogwood_warden: { heartwoodCharges: 0, bulwarkDefenseBonus: 1 },
  // Guardians intentionally absent → applyBossSetupPassive is a no-op for them.
};

/**
 * Apply the SEAT-TIME half of a boss passive: Bulwark adds +bulwarkDefenseBonus
 * uses to both defense rings (raising maxUses to match). Returns the number of
 * Heartwood charges this boss starts with (0 when none) so BattleRoom can track
 * the redirect counter. A boss id with no passive row returns 0 and changes
 * nothing. Mutates `ps` in place.
 */
export function applyBossSetupPassive(ps: PlayerState, bossId: string): number {
  const passive = BOSS_PASSIVES[bossId];
  if (!passive) return 0;

  if (passive.bulwarkDefenseBonus > 0) {
    for (const ring of [ps.d1, ps.d2]) {
      ring.currentUses += passive.bulwarkDefenseBonus;
      ring.maxUses = Math.max(ring.maxUses, ring.currentUses);
      ring.isExtinguished = ring.currentUses === 0;
    }
  }
  return passive.heartwoodCharges;
}
