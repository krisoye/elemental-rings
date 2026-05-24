export enum ElementEnum { FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4 }
export type PhaseType = 'WAITING'|'ATTACK_SELECT'|'DEFEND_WINDOW'|'RESOLVE'|'ENDED';

// Server-side NPC personalities (§10.5). Bluffing is deferred to Phase 5.
export type AIPersonality = 'AGGRESSIVE' | 'DEFENSIVE' | 'STATUS_HUNTER' | 'RESILIENT';

// Options passed to a BattleRoom on creation. PvP `battle` rooms pass nothing;
// `battle-ai` rooms pass `{ vsAI: true, personality, aiSeed? }` so the room
// seats a virtual AI player and locks itself.
export interface BattleRoomOptions {
  vsAI?: boolean;
  personality?: AIPersonality;
  aiSeed?: number;
}

export interface SelectAttackPayload { slot: number }
// pressTime is retained for future client-side lag compensation, but the server
// IGNORES it for timing authority — it timestamps on message arrival instead.
export interface SubmitDefensePayload { slot: number; pressTime: number }

// Broadcast by the server after each exchange resolves, so the client can render
// the result (orb impact, block flash, heart/gauge changes, rally volley).
export interface ExchangeResultPayload {
  attackerId: string;
  defenderId: string;
  attackerSlot: number;
  defenderSlot: number;
  attackerElements: number[];
  timing: 'PARRY'|'BLOCK'|'MISTIME'|'NO_BLOCK';
  relationship: 'STRONG'|'NEUTRAL'|'WEAK';
  defenderHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  gaugeIncreases: boolean;
}
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
