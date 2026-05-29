import { BlockResult } from '../../../shared/types';
import { ElementEnum } from '../../../shared/types';
import { Ring } from '../schemas/Ring';
import { resolve, Relationship } from './ElementSystem';
import { componentsOf, triangleComponentsOf, TRIANGLE } from './Fusions';

const { FIRE, WATER, WOOD, SHADOW } = ElementEnum;

/** Gauge-bearing elements: the triangle (FIRE/WATER/WOOD) plus SHADOW (#134). */
const GAUGE_BEARING: ReadonlySet<number> = new Set([FIRE, WATER, WOOD, SHADOW]);

/**
 * Strong-block decrement table (GDD §7.1, four-case model). When the defending
 * ring's element STRONGLY beats the incoming attack element, the beaten gauge(s)
 * are reduced by 1 (case 3). Fire is strong against BOTH Wood and Shadow (§3.5),
 * and a Fire strong block decrements BOTH the wood and shadow gauges (#134/#132
 * C2), regardless of which of the two it blocked.
 *   Water blocks Fire          → fire−1
 *   Wood  blocks Water         → water−1
 *   Fire  blocks Wood or Shadow → wood−1 AND shadow−1
 */
const STRONG_BLOCK_DECREMENT: Record<number, Record<number, number[]>> = {
  [WATER]: { [FIRE]: [FIRE] },
  [WOOD]: { [WATER]: [WATER] },
  [FIRE]: { [WOOD]: [WOOD, SHADOW], [SHADOW]: [WOOD, SHADOW] },
};

/**
 * The single gauge element a defending ring's element fills on a block (case 2).
 * Returns the element index for a gauge-bearing base element (triangle + SHADOW),
 * or null for Wind/Earth and every fusion (no single gauge).
 */
function gaugeElementOf(defenderEl: number): number | null {
  return GAUGE_BEARING.has(defenderEl) ? defenderEl : null;
}

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

/** An attack component that landed uncontested (NO_BLOCK): -1 heart + gauge if gauge-bearing (triangle or Shadow). */
function landedComponent(attackComponent: number): ComponentOutcome {
  return {
    heartLost: true,
    gauge: GAUGE_BEARING.has(attackComponent) ? [attackComponent] : [],
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
    hitGaugeElements: [],
    blockGaugeElement: null,
    blockedGaugeElement: [],
    clearAllGauges: false,
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
    for (const g of o.gauge) r.hitGaugeElements.push(g);
    if (o.rally && !r.rallyContinues) {
      r.rallyContinues = true;
      r.volleyedElement = o.volleyedElement >= 0 ? o.volleyedElement : 0;
    }
  }

  // Four-case gauge model (GDD §7.1). A genuine catch (BLOCK or PARRY with a
  // committed defense ring) drives cases 2-4:
  //   case 2 — block gauge: the defending ring's own gauge-bearing element +1
  //   case 3 — strong block: each beaten gauge −1 (per attack component)
  //   case 4 — strong parry: all tracked gauges reset to 0
  if ((timing === 'BLOCK' || timing === 'PARRY') && defenderRing) {
    const defenderEl = defenderRing.element;
    // case 2 — the defending element's own gauge fills (triangle/Shadow only;
    // Wind/Earth/fusion carry no single gauge element → null).
    r.blockGaugeElement = gaugeElementOf(defenderEl);

    // case 3 — strong-block decrement: for each attack component the defending
    // element STRONGLY beats, decrement that beaten gauge.
    const decRow = STRONG_BLOCK_DECREMENT[defenderEl];
    if (decRow) {
      for (const c of attackComponents) {
        const dec = decRow[c];
        if (dec) for (const g of dec) r.blockedGaugeElement.push(g);
      }
    }

    // case 4 — a STRONG parry clears all tracked gauges. r.rallyContinues is the
    // authoritative "strong parry" signal (set only on PARRY × STRONG above).
    if (timing === 'PARRY' && r.rallyContinues) r.clearAllGauges = true;
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
