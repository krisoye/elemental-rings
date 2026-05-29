import { ElementEnum } from '../../../shared/types';
import { TRIANGLE, NEUTRAL } from './Fusions';

export { isFusion, fusionParents, componentsOf, triangleComponentsOf } from './Fusions';

const { FIRE, WATER, EARTH, WIND, WOOD, SHADOW } = ElementEnum;

export type Relationship = 'STRONG' | 'NEUTRAL' | 'WEAK';

// Triangle cycle (GDD §3.2): Fire → Wood → Water → Fire.
//   BEATS[x] = the triangle element that x defeats.
//   FIRE beats WOOD, WOOD beats WATER, WATER beats FIRE.
// Wind & Earth have NO triangle relationship — they are absent from this map.
const BEATS: Record<number, number> = {
  [FIRE]: WOOD,
  [WOOD]: WATER,
  [WATER]: FIRE,
};

/** True when `a` (triangle) beats `b` (triangle) in the cycle. */
function triangleBeats(a: number, b: number): boolean {
  return BEATS[a] === b;
}

// Shadow's asymmetric matchup (GDD §3.5), independent of the triangle:
//   Shadow BEATS Wood; Shadow LOSES TO Fire; Shadow is NEUTRAL vs Water/Earth/Wind
//   and vs Shadow (mirror). SHADOW_BEATS[x] = what x defeats (Shadow→Wood, Fire→Shadow).
const SHADOW_BEATS: Record<number, number> = {
  [SHADOW]: WOOD,
  [FIRE]: SHADOW,
};

/**
 * Shadow matchup resolver. Returns the relationship from the perspective of
 * `role` when Shadow is involved on either side, or null when no Shadow rule
 * applies (the caller falls through to the triangle/neutral logic).
 */
function shadowRelationship(
  attackerEl: number,
  defenderEl: number,
  role: 'attack' | 'defense',
): Relationship | null {
  if (attackerEl !== SHADOW && defenderEl !== SHADOW) return null;

  // Determine the raw advantage along the Shadow axis (attacker-vs-defender).
  let advantage: Relationship;
  if (SHADOW_BEATS[attackerEl] === defenderEl) advantage = 'STRONG'; // attacker overpowers
  else if (SHADOW_BEATS[defenderEl] === attackerEl) advantage = 'WEAK'; // attacker loses
  else advantage = 'NEUTRAL'; // Shadow vs Water/Earth/Wind/Shadow, either direction

  // resolve() reports the named side's standing. The attacker's standing is the
  // raw advantage; the defender's is its mirror (STRONG↔WEAK).
  if (role === 'attack') return advantage;
  if (advantage === 'STRONG') return 'WEAK';
  if (advantage === 'WEAK') return 'STRONG';
  return 'NEUTRAL';
}

/**
 * Role-aware element relationship.
 *
 * Returns the Strong/Neutral/Weak standing from the perspective of the side named
 * by `role`. The Block Resolution Table needs the DEFENDER's standing, so
 * BlockResolver always calls this with role='defense'.
 *
 * @param attackerEl the attacking ring's element
 * @param defenderEl the defending ring's element
 * @param role whose standing to report ('attack' or 'defense')
 */
export function resolve(attackerEl: number, defenderEl: number, role: 'attack' | 'defense'): Relationship {
  // Shadow (§3.5) sits outside the triangle/neutral sets; resolve its asymmetric
  // matchup first when either side is Shadow, then fall through otherwise.
  const shadow = shadowRelationship(attackerEl, defenderEl, role);
  if (shadow !== null) return shadow;

  if (role === 'defense') {
    // Defender's standing — the Block Resolution Table input.
    if (defenderEl === WIND) return 'WEAK'; // Wind defense always loses the heart
    if (defenderEl === EARTH) return 'NEUTRAL'; // Earth defense never punished, never rallies
    if (TRIANGLE.has(defenderEl)) {
      if (attackerEl === WIND || attackerEl === EARTH) return 'NEUTRAL'; // neutrals carry no threat
      if (TRIANGLE.has(attackerEl)) {
        if (triangleBeats(defenderEl, attackerEl)) return 'STRONG';
        if (triangleBeats(attackerEl, defenderEl)) return 'WEAK';
        return 'NEUTRAL'; // same element
      }
    }
    return 'NEUTRAL';
  }

  // role === 'attack' — attacker's standing (mirror, for completeness/tests).
  if (attackerEl === WIND) return 'NEUTRAL'; // Wind attack always neutral; nothing counters it
  if (attackerEl === EARTH) return 'WEAK'; // Earth attack carries no advantage
  if (TRIANGLE.has(attackerEl)) {
    if (defenderEl === WIND) return 'STRONG'; // Wind defense is weak → attacker dominates
    if (defenderEl === EARTH) return 'NEUTRAL'; // Earth defense neutral
    if (TRIANGLE.has(defenderEl)) {
      if (triangleBeats(attackerEl, defenderEl)) return 'STRONG';
      if (triangleBeats(defenderEl, attackerEl)) return 'WEAK';
      return 'NEUTRAL'; // same element
    }
  }
  return 'NEUTRAL';
}

// COUNTERED_BY[x] = the triangle element that beats x. Derived from BEATS.
const COUNTERED_BY: Record<number, number> = (() => {
  const out: Record<number, number> = {};
  for (const x of Object.keys(BEATS).map(Number)) out[BEATS[x]] = x;
  return out;
})();

/**
 * Returns the single triangle element that beats `el` — the ring a defender
 * picks for a STRONG relationship (and, with PARRY timing, a rally) against an
 * attack of element `el`. Defined only for base TRIANGLE elements; returns -1
 * for WIND, EARTH, and all fusions (no single counter exists). Used by the AI.
 */
export function counterOf(el: number): number {
  if (NEUTRAL.has(el)) return -1;
  const c = COUNTERED_BY[el];
  return c === undefined ? -1 : c;
}
