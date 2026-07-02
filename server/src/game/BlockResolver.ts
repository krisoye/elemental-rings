import { BlockResult } from '../../../shared/types';
import { ElementEnum } from '../../../shared/types';
import { Ring } from '../schemas/Ring';
import { resolve, Relationship } from './ElementSystem';
import { componentsOf, triangleComponentsOf } from './Fusions';
import { force } from './Tiers';
import { consumeUse, setUses } from './ringHelpers';

const { FIRE, WATER, WOOD, SHADOW } = ElementEnum;

/** Gauge-bearing elements: the triangle (FIRE/WATER/WOOD) plus SHADOW (#134). */
const GAUGE_BEARING: ReadonlySet<number> = new Set([FIRE, WATER, WOOD, SHADOW]);

/**
 * Strong-block decrement table (GDD §7.1, case 3). When a tracked component of the
 * DEFENDING ring STRONGLY beats the incoming attack's primary element, the beaten
 * gauge(s) are reduced by 1. Fire is strong against BOTH Wood and Shadow (§3.5), so
 * a Fire strong block decrements BOTH the wood and shadow gauges (#134), regardless
 * of which of the two it blocked.
 *   Water component beats Fire           → fire−1
 *   Wood  component beats Water          → water−1
 *   Fire  component beats Wood or Shadow → wood−1 AND shadow−1
 */
const STRONG_BLOCK_DECREMENT: Record<number, Record<number, number[]>> = {
  [WATER]: { [FIRE]: [FIRE] },
  [WOOD]: { [WATER]: [WATER] },
  [FIRE]: { [WOOD]: [WOOD, SHADOW], [SHADOW]: [WOOD, SHADOW] },
};

export function classifyTiming(
  offsetMs: number,
  pressed: boolean,
  parryMs = 70,
  blockMs = 180,
): 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK' {
  if (!pressed) return 'NO_BLOCK';
  const mag = Math.abs(offsetMs);
  if (mag <= parryMs) return 'PARRY';
  if (mag <= blockMs) return 'BLOCK';
  return 'MISTIME';
}

type Timing = 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';

/** The GAUGE_BEARING (FIRE/WATER/WOOD/SHADOW) components of a ring's element. */
function trackedComponentsOf(el: number): number[] {
  return componentsOf(el).filter((c) => GAUGE_BEARING.has(c));
}

/**
 * Integer-safe ceil of `a / b` (Contract B, EPIC #511). Both the raw force gap
 * and `hpForce` are non-negative integers, so `Math.floor((a + b - 1) / b)`
 * avoids the float rounding of `Math.ceil(a / b)` and keeps every heart count a
 * clean integer. `b` (an `hpForce`) is always ≥ 1 at the call sites here.
 */
function ceilDiv(a: number, b: number): number {
  return Math.floor((a + b - 1) / b);
}

/**
 * Resolve an exchange under the compound-element model (GDD §3.4, §7.1). A fusion
 * ring resolves as ONE compound element — never decomposed into per-component
 * heart loss. The relationship is `resolve(attacker, defender, 'defense')`, which
 * A2 made compound-aware (fusion attacker, fusion defender, base, Shadow).
 *
 * Heart loss is force-scaled (Contract B, EPIC #511). `atkForce`/`defForce` are
 * derived here via `force()`; only the defender's heart-ring force (`hpForce`,
 * the mitigation divisor) is passed in — the resolver cannot derive it. Every
 * count uses the integer-safe `ceilDiv`:
 *   - No-block / Mistime / no ring → `max(1, ceilDiv(atkForce, hpForce))`.
 *   - Block/Parry WEAK             → `max(1, ceilDiv(atkForce, hpForce))` — the
 *     defending ring's own force gives ZERO credit (elementally overmatched).
 *   - Block NEUTRAL / Parry NEUTRAL / Block STRONG
 *                                  → `max(0, ceilDiv(max(0, atkForce − defForce), hpForce))`
 *     — `defForce` is a real subtractive shield; Parry-Neutral is identical to
 *     Block-Neutral (no flat-0 special case).
 *   - Parry STRONG                 → `0` (rally + clearAllGauges, unchanged).
 *
 * - NO_BLOCK / MISTIME: the attack lands as a hit. Each tracked component of the
 *   attacker fills the defender's matching gauge +1 (§7.1 case 1, tier-
 *   independent). Defender pays 0 uses (NO_BLOCK) or 1 use (MISTIME).
 * - BLOCK / PARRY: the defender pays exactly 1 use.
 *     WEAK   → no gauge movement (a weak catch moves no gauge).
 *     NEUTRAL→ case 2 block gauge: each tracked parent of the DEFENDER fills its
 *              gauge by `delta = 1 / force(defender.xp)` — full rate per
 *              tracked parent (Tier-2 Steam → Fire +0.500 AND Water +0.500).
 *     STRONG + BLOCK → the NEUTRAL block deltas PLUS case-3 decrements: for each
 *              tracked parent of the defender that strong-beats the attack's primary
 *              element, push the beaten gauge(s) to blockedGaugeElement.
 *     STRONG + PARRY → rallyContinues + clearAllGauges (case 4, all reset).
 */
export function resolveBlock(
  attackerRing: Ring,
  defenderRing: Ring | null,
  timing: Timing,
  hpForce: number,
): BlockResult {
  const atkForce = force(attackerRing.xp);
  const attackComponents = componentsOf(attackerRing.element);
  const attackPrimary = attackComponents[0];

  // Summary relationship: the compound matchup of the two rings (A2).
  const summaryRel: Relationship = defenderRing
    ? resolve(attackerRing.element, defenderRing.element, 'defense')
    : 'NEUTRAL';

  const r: BlockResult = {
    timing,
    relationship: summaryRel,
    defenderHeartsLost: 0,
    attackerHeartsLost: 0,
    rallyContinues: false,
    volleyedElement: 0,
    hitGaugeElements: [],
    blockGaugeDeltas: [],
    blockedGaugeElement: [],
    clearAllGauges: false,
  };

  if (timing === 'NO_BLOCK' || timing === 'MISTIME' || !defenderRing) {
    // Uncontested hit (or a caught-timing classification with no defense ring):
    // force-scaled heart loss (no def_force credit), +1 per tracked attacker
    // component (§7.1 case 1). Floored at 1 so any landed hit still costs a heart.
    r.defenderHeartsLost = Math.max(1, ceilDiv(atkForce, hpForce));
    r.hitGaugeElements = trackedComponentsOf(attackerRing.element);
    // MISTIME burns 1 defender use; NO_BLOCK never committed a ring.
    if (timing === 'MISTIME' && defenderRing) consumeUse(defenderRing);
    setUses(attackerRing, attackerRing.currentUses);
    return r;
  }

  // BLOCK / PARRY with a committed defense ring — exactly 1 use for the catch.
  consumeUse(defenderRing);
  const rel = summaryRel;
  const defForce = force(defenderRing.xp);
  const defenderTracked = trackedComponentsOf(defenderRing.element);

  if (rel === 'WEAK') {
    // A weak catch — elementally overmatched. The defending ring's own force
    // gives ZERO credit (no def_force subtraction); only hp_force mitigates, and
    // any landed hit still costs a heart (§7.1). Moves no gauge.
    r.defenderHeartsLost = Math.max(1, ceilDiv(atkForce, hpForce));
  } else if (rel === 'NEUTRAL') {
    // Case 2 — block gauge: full force-reduced rate per tracked parent. def_force
    // is a real subtractive shield against heart loss (Contract B).
    r.defenderHeartsLost = Math.max(0, ceilDiv(Math.max(0, atkForce - defForce), hpForce));
    const delta = 1 / defForce;
    for (const el of defenderTracked) r.blockGaugeDeltas.push({ element: el, delta });
  } else {
    // STRONG.
    if (timing === 'PARRY') {
      // Case 4 — strong parry: rally continues, all tracked gauges clear, no
      // heart loss (defenderHeartsLost stays 0).
      r.rallyContinues = true;
      r.clearAllGauges = true;
      const triComps = triangleComponentsOf(defenderRing.element);
      r.volleyedElement = triComps.length > 0 ? triComps[0] : 0;
    } else {
      // STRONG + BLOCK — same subtractive heart formula as NEUTRAL, PLUS case 2
      // deltas and case 3 decrements.
      r.defenderHeartsLost = Math.max(0, ceilDiv(Math.max(0, atkForce - defForce), hpForce));
      const delta = 1 / defForce;
      for (const el of defenderTracked) r.blockGaugeDeltas.push({ element: el, delta });
      for (const comp of defenderTracked) {
        const dec = STRONG_BLOCK_DECREMENT[comp]?.[attackPrimary];
        if (dec) for (const g of dec) r.blockedGaugeElement.push(g);
      }
    }
  }

  setUses(attackerRing, attackerRing.currentUses);
  return r;
}
