// Element model v4 (GDD §3). Base indices 0-4 are unchanged from v3; the 10
// fusion rings (every distinct pair of base elements, 5C2) occupy indices 5-14.
export enum ElementEnum {
  FIRE = 0,
  WATER = 1,
  EARTH = 2,
  WIND = 3,
  WOOD = 4,
  STEAM = 5, // Fire + Water
  WILDFIRE = 6, // Fire + Wood
  INFERNO = 7, // Fire + Wind
  MAGMA = 8, // Fire + Earth
  TIDAL = 9, // Water + Wood
  STORM = 10, // Water + Wind
  MUD = 11, // Water + Earth
  THORNADO = 12, // Wood + Wind
  BLOOM = 13, // Wood + Earth   (GDD "Nature/Bloom")
  DUST = 14, // Wind + Earth
}

/** Every named loadout slot on the dominant hand (GDD §6.1). */
export type SlotKey = 'thumb' | 'a1' | 'a2' | 'd1' | 'd2';
/** The two attack slots (A1/A2 buttons). */
export type AttackSlot = 'a1' | 'a2';
/** The two defense slots (D1/D2 buttons). */
export type DefenseSlot = 'd1' | 'd2';

export type PhaseType = 'WAITING' | 'ATTACK_SELECT' | 'DEFEND_WINDOW' | 'RESOLVE' | 'ENDED';

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

export interface SelectAttackPayload {
  slot: AttackSlot;
}
// pressTime is retained for future client-side lag compensation, but the server
// IGNORES it for timing authority — it timestamps on message arrival instead.
export interface SubmitDefensePayload {
  slot: DefenseSlot;
  pressTime: number;
}

// Broadcast by the server after each exchange resolves, so the client can render
// the result (orb impact, block flash, heart/gauge changes, rally volley).
export interface ExchangeResultPayload {
  attackerId: string;
  defenderId: string;
  // Slot keys ('a1'|'a2' for a normal attack; 'd1'|'d2' for a rally volley); '' when none.
  attackerSlot: string;
  defenderSlot: string;
  // The attacking ring's component elements (1 for a base ring, 2 for a fusion),
  // so the client telegraph can render all component colors.
  attackerElements: number[];
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';
  relationship: 'STRONG' | 'NEUTRAL' | 'WEAK';
  defenderHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  // Triangle elements (FIRE/WATER/WOOD) whose defender gauge should increment.
  // Empty for a fully-caught attack; one or two entries for landed components.
  gaugeElements: number[];
}

export interface BlockResult {
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';
  relationship: 'STRONG' | 'NEUTRAL' | 'WEAK';
  defenderHeartLost: boolean;
  attackerHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  // Triangle element(s) whose defender gauge fills this exchange. A base triangle
  // uncontested hit → [thatElement]; a fusion uncontested hit → its triangle
  // components; a caught attack → []; a partially-caught fusion → only the landed
  // component's triangle element(s). Wind/Earth components contribute nothing.
  gaugeElements: number[];
}
