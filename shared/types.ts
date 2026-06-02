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

// Canonical ordering of the named loadout slots (GDD §6.1). thumb is passive
// (never pressed); a1/a2 fire during ATTACK_SELECT, d1/d2 during DEFEND_WINDOW.
// Rendered left→right: Thumb, A1, A2, D1, D2. Single source of truth — the
// client Hand/BattleHandOverlay/CampScene and server PlayerRepo all iterate this.
export const SLOT_KEYS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
/** Every named loadout slot on the dominant hand (GDD §6.1). */
export type SlotKey = (typeof SLOT_KEYS)[number];
/** The two attack slots (A1/A2 buttons). */
export type AttackSlot = 'a1' | 'a2';
/** The two defense slots (D1/D2 buttons). */
export type DefenseSlot = 'd1' | 'd2';

export type PhaseType = 'WAITING' | 'ATTACK_SELECT' | 'DEFEND_WINDOW' | 'RESOLVE' | 'ENDED';

// Server-side NPC personalities (§10.5). Bluffing is deferred to Phase 5.
export type AIPersonality = 'AGGRESSIVE' | 'DEFENSIVE' | 'STATUS_HUNTER' | 'RESILIENT';

// EPIC #279 — player-chosen difficulty tier. Scales the spirit_max multiplier
// (DIFFICULTY_MULTIPLIERS) applied to the sum of Reliquary ring max_uses. Stored
// in players.difficulty (default 'seeker'); changeable anytime via
// PUT /api/difficulty. Lives in shared/ so client and server import one source.
export type DifficultyTier = 'wanderer' | 'seeker' | 'ascendant';

export const DIFFICULTY_MULTIPLIERS: Record<DifficultyTier, number> = {
  wanderer: 5,
  seeker: 4,
  ascendant: 3,
};

/** Runtime type guard for an incoming difficulty tier value (request bodies). */
export function isDifficultyTier(v: unknown): v is DifficultyTier {
  return v === 'wanderer' || v === 'seeker' || v === 'ascendant';
}

// Boss tiers (EPIC #256). A boss NPC carries a tier on its NpcSpawnDef.boss
// descriptor; the tier keys BOSS_MODIFIERS (difficulty bundle, #258), the enrage
// thresholds (#259), gauge pressure (#260), and passives (#261). 'major' is the
// toughest (Thornwood Warden), 'gate' an exit-blocking mid boss (Bogwood Warden),
// 'sub' a roaming sub-boss (the fusion-shrine guardians).
export type BossTier = 'major' | 'gate' | 'sub';

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
  // #199 — the intended staked (thumb) element for this vsAI duel, threaded from
  // the overworld NPC's spawn data so generateAILoadout filters its variant pool
  // to the matching thumb. This makes the AI's battle stake element equal the
  // element shown by the overworld sprite colour and the approach warning. Only
  // set on overworld-launched NPC duels; the encounter-hub markers leave it
  // undefined (the per-personality preview seed already pins their stake).
  thumbElement?: number;
  // #244 — the joining player's battle-hand weighted-average ring XP (thumb 1/3,
  // attack pair 1/3, defense pair 1/3), used to scale the AI's loadout (tier /
  // uses / thumb XP) to the rings the player actually brings to the fight. When
  // omitted, the server reads it from the DB via the supplied token; absent both,
  // it defaults to 0 (a fresh opponent, preserving backwards-compat for
  // unauthenticated E2E). Only meaningful on vsAI rooms; PvP rooms ignore it.
  playerBattleHandAvgXp?: number;
  // #262 — set by EncounterScene when launching a boss practice rematch so the
  // server skips all economy (gold, XP, ring-uses drain, stake transfer). The
  // client also skips the stake/lock call on this path. Production NPC duels and
  // hub-marker duels never set this flag.
  isPracticeRematch?: boolean;
}

export interface SelectAttackPayload {
  slot: AttackSlot;
}

// EPIC #264 / #265 — fusion-thumb double attack. Sent once, on chord completion,
// when the attacker holds a fusion thumb whose two component elements occupy A1
// and A2 (server re-validates via canDoubleAttack and silently drops if
// ineligible). `first` fires immediately; `second` fires `gapMs` later (the held
// duration). The server clamps `gapMs` to [MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS]
// regardless of the client value.
export interface SelectDoubleAttackPayload {
  first: AttackSlot;
  second: AttackSlot;
  gapMs: number;
}

// EPIC #264 / #265 — broadcast by the server the moment a double attack commits,
// so the client can schedule BOTH orb telegraphs/animations up front. Per-orb
// OUTCOMES still arrive via the existing `ExchangeResultPayload` (one per resolved
// orb). `firstElements`/`secondElements` are the component elements of each fired
// ring (always the 2 fusion components, since A1/A2 match the thumb), so the
// client can render all component colours. `gapMs` is the server-clamped gap.
export interface DoubleAttackStartPayload {
  first: AttackSlot;
  second: AttackSlot;
  firstElements: number[];
  secondElements: number[];
  gapMs: number;
}

// Broadcast when orb-2 of a double attack is cancelled (orb-1 PARRY or KO).
// The client uses this to play the disperse VFX instead of an impact.
export interface DoubleAttackCancelledPayload {
  orb: 2;
}
// GDD §6.3 — recharge one of the attacker's four COMBAT rings (a1/a2/d1/d2;
// the Thumb is never rechargeable in-duel), spending spirit (1 per use restored)
// up to the ring's deficit. Attack rings recharge via double-tap 1/2 (Z/C);
// defense rings via double-tap 3/4 or the D1/D2 card (#188).
export interface RechargePayload {
  slot: AttackSlot | DefenseSlot;
}
// #211 — Sent per-client (to the recharging attacker only) after handleRecharge
// resolves, so the client can flash partial/insufficient-spirit feedback. The
// turn is consumed regardless (existing server rule, GDD §6.3) — this only
// surfaces the outcome of the spend; affordability is computed server-side.
export interface RechargeResultPayload {
  // The combat ring the recharge targeted (never the Thumb).
  slot: AttackSlot | DefenseSlot;
  restored: number; // uses actually restored this action (0 = none)
  requested: number; // uses the ring was missing (cost = maxUses − currentUses)
  spiritCurrent: number; // post-spend spirit balance
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
  // Pre-absorption verdict from BlockResolver — true if the resolver judged the
  // defender's hearts should decrease. May not match the actual heart delta when
  // a boss passive (e.g. Heartwood) absorbs the hit server-side; use state patches
  // for the authoritative hearts value.
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

/**
 * Sent to the winning client when they gain the loser's staked thumb ring (or, in
 * a vsAI win, a freshly granted ring matching the AI's thumb). The client stores
 * the id and renders the carry/leave/discard prompt in CampScene (#40). The grant
 * itself is server-authoritative; this payload only carries display fields.
 */
export interface WonRingPayload {
  ringId: string;
  element: number;
  xp: number;
}

/**
 * The shape of GET /api/me — the canonical player snapshot the client reads to
 * repopulate carry/loadout pools, HUDs, and overlays. The server is the single
 * source of truth; the client only renders what it receives here.
 *
 * `player` is intentionally a broad index map: the underlying row carries many
 * optional fields (gold, food_units, spirit_current/max, carry_cap, difficulty,
 * reliquary caps, …) that individual call sites narrow as needed, so the type is
 * kept permissive rather than enumerating every column. `rings` and `loadout`
 * use `unknown`/loose shapes for the same reason — callers cast to their local
 * RingData view.
 */
export interface MeState {
  player: Record<string, unknown>;
  rings: unknown[];
  loadout: Record<string, string | null> | null;
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
  // blockGaugeDeltas — the DEFENDING ring's gauge fills on a NEUTRAL/STRONG block or
  //   parry (case 2). One entry per tracked-element (FIRE/WATER/WOOD/SHADOW) component
  //   of the defender ring, each `delta = 1 / 2^tierForXp(defender.xp)` — full
  //   tier-reduced rate per tracked parent (GDD §7.1). Empty when the defense did not
  //   catch, on a WEAK catch (no gauge movement), or when the defender carries no
  //   tracked component (Wind/Earth/Dust).
  blockGaugeDeltas: { element: number; delta: number }[];
  // blockedGaugeElement — gauge element index(es) to DECREMENT on a strong block
  //   (case 3): the beaten gauge(s). Empty when the catch was not a strong block.
  blockedGaugeElement: number[];
  // clearAllGauges — true on a STRONG parry (case 4): the defender's tracked
  //   gauges all reset to 0.
  clearAllGauges: boolean;
}
