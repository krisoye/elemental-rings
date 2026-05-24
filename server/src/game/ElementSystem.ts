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
