// Pentagon: BEATS[x] = element that x defeats
// FIRE(0)>WOOD(4), WATER(1)>FIRE(0), EARTH(2)>WIND(3), WIND(3)>WATER(1), WOOD(4)>EARTH(2)
const BEATS = [4, 0, 3, 1, 2];

export function resolve(attacker: number, defender: number): -1|0|1 {
  if (attacker === defender) return 0;
  if (BEATS[attacker] === defender) return 1;
  if (BEATS[defender] === attacker) return -1;
  return 0;
}

export function relationship(attackerEl: number, defenderEl: number): 'STRONG'|'NEUTRAL'|'WEAK' {
  const r = resolve(defenderEl, attackerEl); // defender's view vs attacker
  return r === 1 ? 'STRONG' : r === -1 ? 'WEAK' : 'NEUTRAL';
}

// COUNTERED_BY[x] = the element that beats x (the STRONG counter to an attack of
// element x). Derived from BEATS: if BEATS[d] === x then d beats x.
const COUNTERED_BY: number[] = (() => {
  const out = [-1, -1, -1, -1, -1];
  for (let d = 0; d < BEATS.length; d++) out[BEATS[d]] = d;
  return out;
})();

/**
 * Returns the element that beats `el` — i.e. the ring a defender should pick to
 * land a STRONG relationship (and, with PARRY timing, a rally) against an attack
 * of element `el`. Pure; no Colyseus state.
 */
export function counterOf(el: number): number {
  return COUNTERED_BY[el];
}
