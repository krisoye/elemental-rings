import { BlockResult } from '../../../shared/types';
import { Ring } from '../schemas/Ring';
import { resolve, Relationship } from './ElementSystem';
import { componentsOf, triangleComponentsOf, TRIANGLE } from './Fusions';

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

const RANK: Record<Relationship, number> = { STRONG: 2, NEUTRAL: 1, WEAK: 0 };

type Timing = 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';

/** Per-component outcome of a timed defense (BLOCK/PARRY) under the §6.4 table. */
interface ComponentOutcome {
  heartLost: boolean;
  gauge: number[]; // triangle element(s) added to defender's gauge (only on a landing component)
  rally: boolean;
  volleyedElement: number; // the engaged STRONG component's triangle volley element (-1 when none)
}

/** An attack component that landed uncontested (NO_BLOCK): -1 heart + gauge if triangle. */
function landedComponent(attackComponent: number): ComponentOutcome {
  return {
    heartLost: true,
    gauge: TRIANGLE.has(attackComponent) ? [attackComponent] : [],
    rally: false,
    volleyedElement: -1,
  };
}

/** A caught attack component resolved under timing × relationship (no gauge — it was caught). */
function caughtComponent(
  defenderEl: number,
  attackComponent: number,
  timing: 'BLOCK' | 'PARRY',
): ComponentOutcome {
  const rel = resolve(attackComponent, defenderEl, 'defense');
  const out: ComponentOutcome = { heartLost: false, gauge: [], rally: false, volleyedElement: -1 };
  if (rel === 'WEAK') {
    out.heartLost = true; // wrong element — costs a heart, no gauge
  } else if (rel === 'STRONG' && timing === 'PARRY') {
    out.rally = true;
    // Volley element: the parrying ring's engaged triangle component (its own element here).
    out.volleyedElement = TRIANGLE.has(defenderEl) ? defenderEl : -1;
  }
  return out;
}

/**
 * Auto-align (§3.4): given the defense components and the attack components,
 * greedily assign each defense component (in defender-ring order) to the
 * not-yet-assigned attack component it is STRONGEST against (rank STRONG>NEUTRAL>WEAK
 * via role='defense'); tiebreak by the attack component's listed order (which is
 * the fusion's fusionParents order — first listed wins).
 *
 * CLOSES the GDD §3.4 "Open Question": fusion-vs-fusion matching is resolved by
 * this deterministic greedy assignment in defense-component order with an
 * attack-component-order tiebreak — fully reproducible, no randomness.
 *
 * Returns, for each attack component index, the defense component element engaged
 * against it (or -1 if that attack component is unengaged → resolves NO_BLOCK).
 */
function autoAlign(defenseComponents: number[], attackComponents: number[]): number[] {
  const engaged: number[] = attackComponents.map(() => -1);
  const taken: boolean[] = attackComponents.map(() => false);

  for (const defEl of defenseComponents) {
    let bestIdx = -1;
    let bestRank = -1;
    for (let i = 0; i < attackComponents.length; i++) {
      if (taken[i]) continue;
      const rank = RANK[resolve(attackComponents[i], defEl, 'defense')];
      if (rank > bestRank) {
        bestRank = rank;
        bestIdx = i; // earlier attack component wins ties (strict >)
      }
    }
    if (bestIdx >= 0) {
      engaged[bestIdx] = defEl;
      taken[bestIdx] = true;
    }
  }
  return engaged;
}

/**
 * Resolve an exchange. Handles base and fusion attack rings, and base or fusion
 * defense rings, per GDD §3.4 and §6.4.
 *
 * - NO_BLOCK / MISTIME: every attack component lands (−1 heart + gauge per
 *   triangle component). Defender ring pays 0 uses (NO_BLOCK) or 1 use (MISTIME).
 * - BLOCK / PARRY: the defense ring auto-aligns; engaged components resolve under
 *   the timing × relationship table, unengaged attack components resolve NO_BLOCK.
 *   The defense ring pays exactly 1 use total.
 *
 * `rel` on the result is the relationship of the FIRST attack component vs the
 * defender (the summary axis the client/HUD displays).
 */
export function resolveBlock(
  attackerRing: Ring,
  defenderRing: Ring | null,
  timing: Timing,
): BlockResult {
  const attackComponents = componentsOf(attackerRing.element);

  // Summary relationship (first attack component's standing for the defender).
  const summaryRel: Relationship = defenderRing
    ? resolve(attackComponents[0], componentsOf(defenderRing.element)[0], 'defense')
    : 'NEUTRAL';

  const r: BlockResult = {
    timing,
    relationship: summaryRel,
    defenderHeartLost: false,
    attackerHeartLost: false,
    rallyContinues: false,
    volleyedElement: 0,
    gaugeElements: [],
  };

  const outcomes: ComponentOutcome[] = [];

  if (timing === 'NO_BLOCK' || timing === 'MISTIME') {
    // Every component lands uncontested.
    for (const c of attackComponents) outcomes.push(landedComponent(c));
    // MISTIME burns 1 defender ring use (NO_BLOCK never committed a ring).
    if (timing === 'MISTIME' && defenderRing) spendUse(defenderRing);
  } else {
    // BLOCK / PARRY — auto-align the defense ring's components to the attack.
    if (!defenderRing) {
      // No defense ring submitted but timing classified as caught — treat as NO_BLOCK.
      for (const c of attackComponents) outcomes.push(landedComponent(c));
    } else {
      const defenseComponents = componentsOf(defenderRing.element);
      const engaged = autoAlign(defenseComponents, attackComponents);
      spendUse(defenderRing); // exactly 1 use for the catch, regardless of components
      for (let i = 0; i < attackComponents.length; i++) {
        outcomes.push(
          engaged[i] >= 0
            ? caughtComponent(engaged[i], attackComponents[i], timing)
            : landedComponent(attackComponents[i]), // unengaged → NO_BLOCK
        );
      }
    }
  }

  // Union the component outcomes.
  for (const o of outcomes) {
    if (o.heartLost) r.defenderHeartLost = true;
    for (const g of o.gauge) r.gaugeElements.push(g);
    if (o.rally && !r.rallyContinues) {
      r.rallyContinues = true;
      r.volleyedElement = o.volleyedElement >= 0 ? o.volleyedElement : 0;
    }
  }

  // Rally volley fallback: a STRONG parry with a fusion whose engaged component
  // was not triangle (shouldn't happen — STRONG implies a triangle component —
  // but stay safe) volleys the defense ring's first component.
  if (r.rallyContinues && r.volleyedElement === 0 && defenderRing) {
    const triComps = triangleComponentsOf(defenderRing.element);
    r.volleyedElement = triComps.length > 0 ? triComps[0] : componentsOf(defenderRing.element)[0];
  }

  attackerRing.isExtinguished = attackerRing.currentUses === 0;
  return r;
}

function spendUse(ring: Ring): void {
  ring.currentUses = Math.max(0, ring.currentUses - 1);
  ring.isExtinguished = ring.currentUses === 0;
}
