import { BlockResult } from '../../../shared/types';
import { ElementEnum } from '../../../shared/types';
import { Ring } from '../schemas/Ring';
import { resolve, Relationship } from './ElementSystem';
import { componentsOf, triangleComponentsOf } from './Fusions';
import { tierForXp } from './Tiers';
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
 * Resolve an exchange under the compound-element model (GDD §3.4, §7.1). A fusion
 * ring resolves as ONE compound element — never decomposed into per-component
 * heart loss. The relationship is `resolve(attacker, defender, 'defense')`, which
 * A2 made compound-aware (fusion attacker, fusion defender, base, Shadow).
 *
 * - NO_BLOCK / MISTIME: the attack lands as a single hit (−1 heart). Each tracked
 *   component of the attacker fills the defender's matching gauge +1 (§7.1 case 1,
 *   tier-independent). Defender pays 0 uses (NO_BLOCK) or 1 use (MISTIME).
 * - BLOCK / PARRY: the defender pays exactly 1 use.
 *     WEAK   → −1 heart, no gauge movement (a weak catch moves no gauge).
 *     NEUTRAL→ case 2 block gauge: each tracked parent of the DEFENDER fills its
 *              gauge by `delta = 1 / 2^tierForXp(defender.xp)` — full rate per
 *              tracked parent (Tier-2 Steam → Fire +0.250 AND Water +0.250).
 *     STRONG + BLOCK → the NEUTRAL block deltas PLUS case-3 decrements: for each
 *              tracked parent of the defender that strong-beats the attack's primary
 *              element, push the beaten gauge(s) to blockedGaugeElement.
 *     STRONG + PARRY → rallyContinues + clearAllGauges (case 4, all reset).
 */
export function resolveBlock(
  attackerRing: Ring,
  defenderRing: Ring | null,
  timing: Timing,
): BlockResult {
  const attackComponents = componentsOf(attackerRing.element);
  const attackPrimary = attackComponents[0];

  // Summary relationship: the compound matchup of the two rings (A2).
  const summaryRel: Relationship = defenderRing
    ? resolve(attackerRing.element, defenderRing.element, 'defense')
    : 'NEUTRAL';

  const r: BlockResult = {
    timing,
    relationship: summaryRel,
    defenderHeartLost: false,
    attackerHeartLost: false,
    rallyContinues: false,
    volleyedElement: 0,
    hitGaugeElements: [],
    blockGaugeDeltas: [],
    blockedGaugeElement: [],
    clearAllGauges: false,
  };

  if (timing === 'NO_BLOCK' || timing === 'MISTIME' || !defenderRing) {
    // Uncontested hit (or a caught-timing classification with no defense ring):
    // one heart, +1 per tracked attacker component (§7.1 case 1).
    r.defenderHeartLost = true;
    r.hitGaugeElements = trackedComponentsOf(attackerRing.element);
    // MISTIME burns 1 defender use; NO_BLOCK never committed a ring.
    if (timing === 'MISTIME' && defenderRing) consumeUse(defenderRing);
    setUses(attackerRing, attackerRing.currentUses);
    return r;
  }

  // BLOCK / PARRY with a committed defense ring — exactly 1 use for the catch.
  consumeUse(defenderRing);
  const rel = summaryRel;
  const defenderTracked = trackedComponentsOf(defenderRing.element);

  if (rel === 'WEAK') {
    // A weak catch — wrong element. Costs a heart, moves no gauge (§7.1).
    r.defenderHeartLost = true;
  } else if (rel === 'NEUTRAL') {
    // Case 2 — block gauge: full tier-reduced rate per tracked parent.
    const delta = 1 / Math.pow(2, tierForXp(defenderRing.xp));
    for (const el of defenderTracked) r.blockGaugeDeltas.push({ element: el, delta });
  } else {
    // STRONG.
    if (timing === 'PARRY') {
      // Case 4 — strong parry: rally continues, all tracked gauges clear.
      r.rallyContinues = true;
      r.clearAllGauges = true;
      const triComps = triangleComponentsOf(defenderRing.element);
      r.volleyedElement = triComps.length > 0 ? triComps[0] : 0;
    } else {
      // STRONG + BLOCK — case 2 deltas PLUS case 3 decrements.
      const delta = 1 / Math.pow(2, tierForXp(defenderRing.xp));
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
