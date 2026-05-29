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
  // Shadow (§3.5) sits OUTSIDE the pentagon: a rare overworld drop, not craftable
  // from base rings. Indexed after DUST so no existing element index shifts. Its
  // 5 dark-variant fusions (Eclipse/Void/Abyss/Wraith/Plague) are deferred.
  SHADOW = 15,
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
  token?: string;
  // Deterministic-test overrides. Only the E2E harness passes these; the
  // production client never does. They make a vsAI duel's OUTCOME a property of
  // setup rather than millisecond timing, and apply ONLY to the AI opponent:
  //   aiHearts: 1  → AI dies on the first hit → guaranteed protagonist win
  //   aiHearts: 99 → AI unkillable → protagonist forfeits once uses exhausted
  //   aiUses: 0    → AI attacks/defends with extinguished rings → AI forfeits
  aiHearts?: number;
  aiUses?: number;
  // E2E-only: a unique key used by Colyseus `filterBy(['e2eRoomId'])` matchmaking
  // (gated by E2E_TEST_ROUTES on the server) so two contexts that joinOrCreate
  // 'battle' with the SAME id pair into one isolated room. Absent in production,
  // where 'battle' stays a pure global pool. See server/index.ts and #67.
  e2eRoomId?: string;
  // #83 — the overworld NPC id this vsAI duel is against. When the human wins,
  // BattleRoom records the defeat (recordNpcDefeat) so the NPC respawns per its
  // spawn-table cadence. Only set on overworld-launched NPC duels (EncounterScene
  // NPC path); the encounter-hub markers and PvP rooms leave it undefined.
  npcId?: string;
  // #87 Part C — ambush first-strike. When set on a vsAI join with a valid token
  // and the player can afford AMBUSH_SPIRIT_COST, the server spends the spirit and
  // grants the joining human the opening attack (currentAttackerId) instead of the
  // default ids[0]. If unaffordable the flag is silently ignored (server is the
  // guard) and the duel proceeds with default initiative.
  firstStrike?: boolean;
}

export interface SelectAttackPayload {
  slot: AttackSlot;
}
// GDD §6.3 — recharge one of the attacker's two attack rings, spending spirit
// (1 per use restored) up to the ring's deficit.
export interface RechargePayload {
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
}

/**
 * Sent to each human client once a duel resolves (after XP/gold have been
 * persisted), so the BattleScene can show the post-battle reward summary under
 * the WIN/LOSE banner. Server-authoritative — every value is computed from the
 * DB-backed award totals, not the client.
 */
export interface BattleSummaryPayload {
  won: boolean;
  goldGained: number; // GOLD_PER_WIN if this client won, else 0
  xpGained: number; // sum of this session's xpAccumulator deltas across all slots
  aggregateXp: number; // post-award total from PlayerRepo.getSpiritStats(playerId).aggregateXp
}

export interface BlockResult {
  timing: 'PARRY' | 'BLOCK' | 'MISTIME' | 'NO_BLOCK';
  relationship: 'STRONG' | 'NEUTRAL' | 'WEAK';
  defenderHeartLost: boolean;
  attackerHeartLost: boolean;
  rallyContinues: boolean;
  volleyedElement: number;
  // Four-case gauge model (GDD §7.1). The defender's gauges move as follows:
  //
  // hitGaugeElements — triangle element(s) whose DEFENDER gauge fills on an
  //   uncontested hit. A base triangle uncontested hit → [thatElement]; a fusion
  //   uncontested hit → its triangle components; a caught attack → []; a
  //   partially-caught fusion → only the landed component's triangle element(s).
  //   Wind/Earth/Shadow-non-triangle components contribute via element index too
  //   (Shadow is added by #134). Wind/Earth contribute nothing.
  hitGaugeElements: number[];
  // blockGaugeElement — the DEFENDING ring's own gauge-bearing element index that
  //   gains +1 on any block/parry (case 2). null when the defense did not catch or
  //   the defending element carries no gauge (Wind/Earth/fusion).
  blockGaugeElement: number | null;
  // blockedGaugeElement — gauge element index(es) to DECREMENT on a strong block
  //   (case 3): the beaten gauge(s). Empty when the catch was not a strong block.
  blockedGaugeElement: number[];
  // clearAllGauges — true on a STRONG parry (case 4): the defender's tracked
  //   gauges all reset to 0.
  clearAllGauges: boolean;
}
