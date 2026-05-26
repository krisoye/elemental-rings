import { ElementEnum } from '../../../shared/types';

const { FIRE, WATER, EARTH, WIND, WOOD } = ElementEnum;

/** The three triangle base elements (carry counters and gauges). */
export const TRIANGLE: ReadonlySet<number> = new Set([FIRE, WATER, WOOD]);
/** The two asymmetric neutral base elements (no triangle relationship). */
export const NEUTRAL: ReadonlySet<number> = new Set([WIND, EARTH]);

/**
 * Component element pairs for each fusion. The FIRST element listed is the
 * deterministic tiebreak winner used by the auto-align rule (§3.4). Indexed by
 * ElementEnum value; base elements (0-4) map to null.
 */
const FUSION_PARENTS: Record<number, [number, number] | null> = {
  [FIRE]: null,
  [WATER]: null,
  [EARTH]: null,
  [WIND]: null,
  [WOOD]: null,
  [ElementEnum.STEAM]: [FIRE, WATER],
  [ElementEnum.WILDFIRE]: [FIRE, WOOD],
  [ElementEnum.INFERNO]: [FIRE, WIND],
  [ElementEnum.MAGMA]: [FIRE, EARTH],
  [ElementEnum.TIDAL]: [WATER, WOOD],
  [ElementEnum.STORM]: [WATER, WIND],
  [ElementEnum.MUD]: [WATER, EARTH],
  [ElementEnum.THORNADO]: [WOOD, WIND],
  [ElementEnum.BLOOM]: [WOOD, EARTH],
  [ElementEnum.DUST]: [WIND, EARTH],
};

/** True when `el` is one of the 10 fusion rings (indices 5-14). */
export function isFusion(el: number): boolean {
  return FUSION_PARENTS[el] != null;
}

/**
 * Inverted FUSION_PARENTS: a stable lookup keyed by the unordered base-element
 * pair (encoded as `min*100 + max`) → the fusion element index. Built once at
 * module load so fusionOf() is a single Map.get().
 */
const FUSION_BY_PAIR: ReadonlyMap<number, number> = (() => {
  const m = new Map<number, number>();
  for (const [fusionStr, parents] of Object.entries(FUSION_PARENTS)) {
    if (!parents) continue;
    const [a, b] = parents;
    const key = Math.min(a, b) * 100 + Math.max(a, b);
    m.set(key, Number(fusionStr));
  }
  return m;
})();

/**
 * Resolve the fusion element produced by combining two base elements (§5.2).
 * Order-independent. Returns the fusion element index for any of the 10 valid
 * cross-element pairs, or null when the two are the same element (or either is
 * not a base element forming a recognised pair).
 *
 * @param elA one base element index (FIRE..WOOD).
 * @param elB the other base element index.
 * @returns the fusion element index, or null if the pair is not a valid fusion.
 */
export function fusionOf(elA: number, elB: number): number | null {
  if (elA === elB) return null;
  const key = Math.min(elA, elB) * 100 + Math.max(elA, elB);
  return FUSION_BY_PAIR.get(key) ?? null;
}

/** Returns a fusion's [first, second] component pair, or null for a base element. */
export function fusionParents(el: number): [number, number] | null {
  const p = FUSION_PARENTS[el];
  return p ? [p[0], p[1]] : null;
}

/** A fusion's two components, or `[el]` for a base element. */
export function componentsOf(el: number): number[] {
  const p = FUSION_PARENTS[el];
  return p ? [p[0], p[1]] : [el];
}

/** Only the triangle (FIRE/WATER/WOOD) components — the gauge-bearing ones. */
export function triangleComponentsOf(el: number): number[] {
  return componentsOf(el).filter((c) => TRIANGLE.has(c));
}
