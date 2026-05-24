export enum ElementEnum { FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4 }
export type PhaseType = 'WAITING'|'ATTACK_SELECT'|'DEFEND_WINDOW'|'RESOLVE'|'ENDED';
export interface SelectAttackPayload { slot: number }
export interface SubmitDefensePayload { slot: number; pressTime: number }
export interface BlockResult {
  timing: 'PARRY'|'BLOCK'|'MISTIME'|'NO_BLOCK';
  relationship: 'STRONG'|'NEUTRAL'|'WEAK';
  defenderHeartLost: boolean;
  attackerHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  // true when the attack landed uncontested (NO_BLOCK or MISTIME) — elemental gauge fills.
  // false when the defender caught the attack regardless of outcome — gauge does not fill.
  gaugeIncreases: boolean;
}
