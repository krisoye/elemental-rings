import { Room, Client, ServerError } from 'colyseus';
import { BattleState } from '../schemas/BattleState';
import { PlayerState } from '../schemas/PlayerState';
import { classifyTiming, resolveBlock } from '../game/BlockResolver';
import { componentsOf, fusionParents, isFusion } from '../game/ElementSystem';
import { canDoubleAttack } from '../game/DoubleAttack';
import * as StatusEffects from '../game/StatusEffects';
import { AIController, type EnrageConfig } from '../game/ai/AIController';
import { makeRng, AI_PROFILES, type AIProfile } from '../game/ai/AIProfiles';
import { generateAILoadout, PERSONALITY_SPIRIT_MULT, type SlotSpec } from '../game/ai/AILoadout';
import * as StakeResolver from '../game/StakeResolver';
import {
  consumeUse,
  setUses,
  wonRingPayload,
  battleSummaryPayload,
  rechargeResultPayload,
} from '../game/ringHelpers';
import * as PlayerRepo from '../persistence/PlayerRepo';
import { NPC_SPAWNS, type BossDescriptor } from '../persistence/NpcSpawns';
import { verifyToken } from '../auth/auth';
import {
  TELEGRAPH_MS,
  DEFEND_WINDOW_MS,
  BLOCK_WINDOW_MS,
  PARRY_WINDOW_MS,
  MIN_COMBO_GAP_MS,
  MAX_COMBO_GAP_MS,
  STARTING_HEARTS,
  STARTING_USES,
  GOLD_PER_WIN,
  XP_ATK_HIT,
  XP_ATK_BLOCK,
  XP_ATK_COUNTER,
  XP_DEF_COUNTER,
  XP_DEF_BLOCK,
  XP_DEF_WEAK,
  XP_THUMB_BUFF,
  XP_THUMB_MID,
  GAUGE_SOFT_CAP,
  SHADOW_GAUGE_CAP,
  AMBUSH_SPIRIT_COST,
  SPIRIT_PER_RING_USE,
  GOLD_FORFEIT_PENALTY,
  BIOME_BOSS_SPIRIT_BONUS,
  BOSS_MODIFIERS,
  type BossModifier,
} from '../game/constants';
import {
  ElementEnum,
  SelectAttackPayload,
  SelectDoubleAttackPayload,
  DoubleAttackStartPayload,
  DoubleAttackCancelledPayload,
  SubmitDefensePayload,
  RechargePayload,
  ExchangeResultPayload,
  BattleRoomOptions,
  SlotKey,
  AttackSlot,
  DefenseSlot,
  AIPersonality,
} from '../../../shared/types';

/** Fixed sessionId used for the virtual AI player (it has no Colyseus client). */
const AI_ID = 'AI';

/**
 * Test-only payload for the `__testSetState` handler (E2E_TEST_ROUTES gate).
 * `target` selects whose state to mutate: 'self' = the sender, 'opponent' = the
 * other seat (the AI in a vsAI room), or an explicit sessionId. Any provided
 * field is written; absent fields are left untouched. NEVER reachable in prod.
 */
interface TestSetStatePayload {
  target?: 'self' | 'opponent' | string;
  hearts?: number;
  fireGauge?: number;
  waterGauge?: number;
  woodGauge?: number;
  shadowGauge?: number;
  /** Per-slot currentUses overrides; sets isExtinguished accordingly. */
  uses?: Partial<Record<SlotKey, number>>;
  /** Per-slot element overrides (so a test can give a defense slot WATER, etc.). */
  elements?: Partial<Record<SlotKey, number>>;
}

const ATTACK_SLOTS: ReadonlySet<string> = new Set<AttackSlot>(['a1', 'a2']);
const DEFENSE_SLOTS: ReadonlySet<string> = new Set<DefenseSlot>(['d1', 'd2']);
// All four combat rings are rechargeable in-duel (Thumb is not).
const RECHARGEABLE_SLOTS: ReadonlySet<string> = new Set<string>([...ATTACK_SLOTS, ...DEFENSE_SLOTS]); // a1, a2, d1, d2

// Default loadout (GDD §6.1). thumb is a passive staked ring (never pressed).
//   thumb=FIRE, a1=FIRE, a2=WATER, d1=WOOD, d2=EARTH.
// Rationale: Fire/Water triangle attacks; Wood defense gives a STRONG parry vs
// Water and a rally path; Earth defense is the guaranteed-neutral safety valve.
// This exercises both the triangle cycle and Earth's asymmetry. (Wind's
// asymmetry — always-WEAK on defense — is covered by the unit suite.)
// thumb=FIRE chosen so that no reactive combat passive (Tailwind/Precision Parry)
// disrupts the integration test suite. The FIRE all-in setup passive spends the
// thumb's 3 uses onto a1 (the only FIRE base ring) → a1 3→6 uses, which
// integration tests do not assert on post-seat.
const DEFAULT_LOADOUT: Record<SlotKey, number> = {
  thumb: ElementEnum.FIRE,
  a1: ElementEnum.FIRE,
  a2: ElementEnum.WATER,
  d1: ElementEnum.WOOD,
  d2: ElementEnum.EARTH,
};

// SlotSpec imported from AILoadout (shared type for AI + human seating).

export class BattleRoom extends Room<{ state: BattleState }> {
  private impactTime: number = 0;
  private defenseSubmitted: boolean = false;
  private defenseSlotKey: DefenseSlot | '' = '';
  private defensePressTime: number = 0;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;

  // EPIC #264 / #265 — fusion-thumb double-attack combo state. comboActive is
  // true between orb 1's launch and orb 2's resolution. Orb 1 reuses the primary
  // defense capture (defenseSubmitted/defenseSlotKey/defensePressTime + impactTime
  // above); orb 2 carries its OWN second capture and impact2 below. The orb-2
  // launch timer fires `gapMs` after orb 1; orb2Timer schedules orb 2's resolution.
  private comboActive: boolean = false;
  private comboSecondSlot: AttackSlot | '' = '';
  private comboGapMs: number = 0;
  private impact2: number = 0;
  private defense2Submitted: boolean = false;
  private defense2SlotKey: DefenseSlot | '' = '';
  private defense2PressTime: number = 0;
  /** Fires gapMs after orb 1 to launch orb 2 (set impact2, open its window). */
  private orb2LaunchTimer: ReturnType<typeof setTimeout> | null = null;
  /** Fires DEFEND_WINDOW_MS after orb 2's launch to resolve it. */
  private orb2Timer: ReturnType<typeof setTimeout> | null = null;
  /** Non-null only in vsAI (`battle-ai`) rooms; a no-op via notifyAI() in PvP. */
  private ai: AIController | null = null;
  /**
   * #83 — the overworld NPC id this duel is against (only set on the
   * EncounterScene NPC path). When the human wins a vsAI duel and this is set,
   * persistBattleResult records the defeat so the NPC respawns per its cadence.
   */
  private npcId: string | undefined;
  // #262 — true when launched as a boss practice rematch (no economy impact).
  private isPracticeRematch = false;
  /**
   * The session ID of the player who held initiative when the current chain
   * began (i.e. who was currentAttackerId at the last ATTACK_SELECT entry).
   * After any chain resolves — regardless of rally depth — the next
   * ATTACK_SELECT always goes to the OTHER player. Never flips mid-chain.
   */
  private initiativeHolderId: string = '';

  /**
   * EPIC #256 — the boss descriptor for this duel's NPC (tier / name / fused
   * thumb), resolved from NPC_SPAWNS in onCreate. undefined for non-boss vsAI
   * duels and all PvP. Drives the fused-thumb stake (#257), the BOSS_MODIFIERS
   * difficulty bundle (#258), enrage (#259), gauge pressure (#260), and unique
   * passives (#261).
   */
  private boss: BossDescriptor | undefined;

  /**
   * #464 — the biome of this duel's NPC, resolved from NPC_SPAWNS in onCreate.
   * Used to look up the per-biome boss spirit bonus (if this is a boss duel).
   * undefined for non-boss vsAI duels and all PvP.
   */
  private npcBiome: string | undefined;

  /**
   * #261 — remaining Thornwood "Heartwood" charges: the first N heart-losses the
   * boss AI would suffer are redirected to the Thumb (absorbed) instead of costing
   * a heart. Seeded at AI seat from BOSS_PASSIVES; decremented per absorbed hit.
   * 0 for every other boss / non-boss duel (no absorption).
   */
  private heartwoodCharges = 0;

  /**
   * NPC spirit pool. Finite for all vsAI duels: set to
   * floor(playerSpiritMax × npcSpiritMult) when the human player joins.
   * Decremented in handleRecharge for AI sessions (same as a player spends from
   * their DB balance). Infinity until the human joins (safe sentinel — any recharge
   * before that would be a bug, but Infinity prevents a silent lock-up).
   */
  private _npcSpirit = Infinity;
  /** Spirit-pool multiplier computed in onCreate from personality + boss tier. */
  private npcSpiritMult = 0;

  get npcSpirit(): number {
    return this._npcSpirit;
  }

  /**
   * #87 Part C — the sessionId that paid AMBUSH_SPIRIT_COST to ambush this duel.
   * When set, it overrides the default ids[0] opening attacker so the ambusher
   * strikes first. null in normal duels (no first-strike purchase).
   */
  private firstStrikeId: string | null = null;

  /** Maps Colyseus sessionId → DB player id (only present for authenticated humans). */
  private sessionToPlayerId = new Map<string, string>();
  /** Maps Colyseus sessionId → ring id per slot (null when slot used default). */
  private sessionToRingIds = new Map<string, Record<SlotKey, string | null>>();
  /**
   * EPIC #302 / #304 — maps Colyseus sessionId → the player's equipped heart ring
   * id (null when the heart slot was empty). Cached at seat time so
   * persistBattleResult can write the surviving HP back to the heart ring without
   * re-querying the DB. Only present for token-authenticated human seats.
   */
  private sessionToHeartRingId = new Map<string, string | null>();
  /**
   * Outcome-based XP accrued during the duel: sessionId → slotKey → xp delta.
   * Only humans are tracked (a key exists per human session). Persisted in
   * persistBattleResult once the duel ends.
   */
  private xpAccumulator: Map<string, Map<string, number>> = new Map();
  /** Guard: persistBattleResult() runs exactly once per room lifetime. */
  private ended = false;

  /**
   * The sessionId that forfeited the duel (GDD §6.3), or null for a normal KO.
   * When set, persistBattleResult deducts GOLD_FORFEIT_PENALTY (floored at 0)
   * from this session's player on top of the standard loser thumb-transfer.
   */
  private forfeiterId: string | null = null;

  /** Server's real impact time for the current exchange (read by the AI). */
  get currentImpactTime(): number {
    return this.impactTime;
  }

  /**
   * EPIC #265 — true while a fusion-thumb double attack is mid-flight (between
   * orb 1's launch and orb 2's resolution). The AI reads this to schedule a
   * SECOND defense press for orb 2.
   */
  get comboInFlight(): boolean {
    return this.comboActive;
  }

  /** EPIC #265 — orb 2's impact time (impact1 + clamped gapMs); read by the AI. */
  get currentImpact2Time(): number {
    return this.impact2;
  }

  onCreate(options: BattleRoomOptions = {}): void {
    this.setState(new BattleState());
    this.maxClients = 2;

    this.onMessage('selectAttack', (client, payload: SelectAttackPayload) =>
      this.handleSelectAttack(client.sessionId, payload),
    );
    // EPIC #264 / #265 — fusion-thumb double attack. Eligibility is re-validated
    // server-side (canDoubleAttack); an ineligible request is silently dropped.
    this.onMessage('selectDoubleAttack', (client, payload: SelectDoubleAttackPayload) =>
      this.handleSelectDoubleAttack(client.sessionId, payload),
    );
    this.onMessage('submitDefense', (client, payload: SubmitDefensePayload) =>
      this.handleSubmitDefense(client.sessionId, payload),
    );
    // GDD §6.3 — the attacker's two alternative turn actions. Recharge spends
    // spirit to restore an attack ring; forfeit concedes the duel (loses the
    // staked ring + a gold penalty). Both are phase-/turn-locked in their handlers.
    this.onMessage('recharge', (client, payload: RechargePayload) =>
      this.handleRecharge(client.sessionId, payload),
    );
    this.onMessage('forfeit', (client) => this.handleForfeit(client.sessionId));

    // Test-only state-setter. Mounted ONLY when E2E_TEST_ROUTES=1 (set by the
    // Playwright webServer env), never in production. Lets E2E status-effect
    // specs seed an exact gauge / hearts / ring-use configuration on a player
    // deterministically — engineering a precise gauge value through real timed
    // play vs the AI is impractical (GDD §7 thresholds depend on uncontested
    // hits landing at specific counts). The setter only WRITES state; all status
    // resolution still runs through the authoritative server paths.
    if (process.env.E2E_TEST_ROUTES === '1') {
      this.onMessage('__testSetState', (client, payload: TestSetStatePayload) =>
        this.handleTestSetState(client.sessionId, payload),
      );
    }

    if (options.vsAI) {
      // #83 — remember which overworld NPC this duel represents (if any) so a
      // human win can be persisted as that NPC's defeat in persistBattleResult.
      this.npcId = options.npcId;
      this.isPracticeRematch = options.isPracticeRematch === true;
      // EPIC #256 — resolve the boss descriptor (if this NPC is a boss) from the
      // spawn table. Server-authoritative: the tier / fused thumb come from
      // NPC_SPAWNS, never the client. Cached for the difficulty/passive paths.
      const bossSpawn = options.npcId
        ? NPC_SPAWNS.find((n) => n.id === options.npcId)
        : undefined;
      this.boss = bossSpawn?.boss;
      if (this.boss) this.npcBiome = bossSpawn?.biome;
      const personality = options.personality ?? 'AGGRESSIVE';
      const seed = options.aiSeed ?? (Date.now() & 0xffffffff);
      // Use a separate RNG stream for loadout generation so the combat RNG
      // (inside AIController) is unaffected by the number of template variants.
      const loadoutRng = makeRng(seed ^ 0x1a2b3c4d);
      // #244 — scale the AI loadout to the joining player's battle-hand average XP.
      // Prefer an explicitly-supplied value; otherwise resolve it from the token's
      // player id (server-authoritative — the client cannot inflate it). Absent
      // both, 0 → a fresh opponent (floored at the hardcoded thumb XP in the loadout).
      const tokenPayload = options.token ? verifyToken(options.token) : null;
      const playerXp =
        options.playerBattleHandAvgXp ??
        (tokenPayload ? PlayerRepo.getBattleHandAvgXp(tokenPayload.playerId) : 0);
      // #199/#257 — the AI's staked thumb element. A boss stakes its thematic
      // FUSION (resolved from the spawn descriptor, server-authoritative), which
      // generateAILoadout routes to a fused-thumb loadout. A non-boss NPC uses the
      // overworld marker's base element (options.thumbElement). The boss's fused
      // thumb takes precedence over any client-supplied thumbElement.
      const thumbElement = this.boss?.fusedThumb ?? options.thumbElement;
      const aiSpec = generateAILoadout(
        personality,
        loadoutRng,
        undefined,
        undefined,
        undefined,
        thumbElement,
        playerXp,
      );
      // #258 — BOSS_MODIFIERS difficulty bundle. A boss tier resolves a modifier
      // that STACKS on top of the existing XP scaling: +hearts / +uses on the seat,
      // and a sharpened combat profile (tighter σ / fewer no-blocks / faster think).
      const mod = this.boss ? BOSS_MODIFIERS[this.boss.tier] : undefined;

      // Spirit pool multiplier: boss tier overrides personality (bosses have fixed
      // spiritMult in their BossModifier); roamers use the per-personality fraction.
      this.npcSpiritMult = mod?.spiritMult ?? PERSONALITY_SPIRIT_MULT[personality];

      // Deterministic-test AI-strength overrides (see BattleRoomOptions): a weak
      // AI yields a guaranteed protagonist win; a tanky AI a guaranteed loss.
      // Applied to the AI seat ONLY — the human is seated from its real loadout.
      // E2E aiHearts/aiUses take PRECEDENCE over the boss modifier (override wins).
      const bossHearts = mod ? STARTING_HEARTS + mod.bonusHearts : undefined;
      const hearts = options.aiHearts ?? bossHearts;
      const aiOverrides =
        hearts !== undefined || options.aiUses !== undefined || mod !== undefined
          ? { hearts, uses: options.aiUses, bonusUses: mod?.bonusUses ?? 0 }
          : undefined;
      this.seatPlayer(AI_ID, personality, aiSpec, aiOverrides);

      // #261 — boss unique passives (data-driven, keyed by boss id). Applies the
      // seat-time effect (Bulwark: +1 use on both defense rings) and returns the
      // Heartwood charge count (Thornwood: first N heart-losses absorbed). No-op
      // for bosses without a passive row (the guardians) and all non-boss duels.
      if (this.npcId) {
        this.heartwoodCharges = StakeResolver.applyBossSetupPassive(
          this.state.players.get(AI_ID)!,
          this.npcId,
        );
        // E2E override: aiHeartwoodCharges=0 disables Heartwood so the duel ends
        // on the first heart-loss (makes Thornwood tests deterministic under load).
        if (options.aiHeartwoodCharges !== undefined) {
          this.heartwoodCharges = options.aiHeartwoodCharges;
        }
      }

      // Build the boss-modified AI profile (no-op when not a boss). The modifier
      // multiplies the base profile's σ / no-block / think fields (both healthy
      // and low-heart variants stay proportional).
      const profileOverride = mod ? this.buildBossProfile(personality, mod) : undefined;
      // #259 — enrage config (major boss only; threshold 0 disables it). The
      // enraged profile sharpens the already-modified profile further.
      const enrage: EnrageConfig | undefined =
        mod && profileOverride && mod.enrageThreshold > 0
          ? {
              threshold: mod.enrageThreshold,
              profile: this.buildEnragedProfile(profileOverride, mod),
              aggressive: mod.enrageAggressive,
            }
          : undefined;
      this.ai = new AIController(this, AI_ID, personality, seed, profileOverride, enrage);
    }
  }

  /**
   * #259 — derive the ENRAGED profile from the already boss-modified profile by
   * tightening σ further and speeding think further (the enrage multipliers stack
   * on the #258 modifiers). no-block is left as the modified value (an enraged
   * boss is already near-zero no-block). Pure — returns a fresh object.
   */
  private buildEnragedProfile(modified: AIProfile, mod: BossModifier): AIProfile {
    return {
      ...modified,
      timingSigmaMs: modified.timingSigmaMs * mod.enrageSigmaMult,
      lowHeartTimingSigmaMs: modified.lowHeartTimingSigmaMs * mod.enrageSigmaMult,
      thinkDelayMinMs: modified.thinkDelayMinMs * mod.enrageThinkMult,
      thinkDelayMaxMs: modified.thinkDelayMaxMs * mod.enrageThinkMult,
      lowHeartThinkDelayMinMs: modified.lowHeartThinkDelayMinMs * mod.enrageThinkMult,
      lowHeartThinkDelayMaxMs: modified.lowHeartThinkDelayMaxMs * mod.enrageThinkMult,
    };
  }

  /**
   * #259 — set the AI's `enraged` schema flag once its hearts cross to ≤ the boss
   * enrage threshold. Idempotent (the flag never unsets — enrage is permanent for
   * the rest of the duel). No-op for non-enraging bosses and non-boss AI. Called
   * after any path that can lower the AI's hearts.
   */
  private updateBossEnrage(): void {
    if (!this.boss) return;
    const mod = BOSS_MODIFIERS[this.boss.tier];
    if (mod.enrageThreshold <= 0) return;
    const ai = this.state.players.get(AI_ID);
    if (!ai || ai.enraged) return;
    if (ai.hearts > 0 && ai.hearts <= mod.enrageThreshold) {
      ai.enraged = true;
    }
  }

  /**
   * #260 — the status-gauge fill multiplier for this room's boss (1.0 for a
   * non-boss). Applied to the DEFENDER's uncontested-hit gauge credit when the
   * boss AI is the attacker, per orb.
   */
  private bossGaugeFillMult(): number {
    return this.boss ? BOSS_MODIFIERS[this.boss.tier].gaugeFillMult : 1;
  }

  /**
   * #261 — Thornwood "Heartwood". When `id` is the boss AI and it has Heartwood
   * charges left, ABSORB this heart-loss: consume one charge, redirect the hit to
   * the Thumb (spend a thumb use as the visual sink, never below 0), and return
   * true so the caller skips the heart decrement. Returns false for any non-boss /
   * charge-exhausted case (the heart is lost normally). Idempotent on a 0-use
   * thumb — the absorb still works (charges are the source of truth, not thumb uses).
   */
  private absorbBossHeartLoss(id: string): boolean {
    if (id !== AI_ID || this.heartwoodCharges <= 0) return false;
    this.heartwoodCharges -= 1;
    const ai = this.state.players.get(AI_ID);
    if (ai && ai.thumb.currentUses > 0) {
      consumeUse(ai.thumb);
    }
    return true;
  }

  /**
   * #258 — derive a boss-modified AIProfile from the base personality profile by
   * scaling its timing-σ / no-block / think-delay fields by the tier modifier.
   * Both the healthy and the low-heart variants are scaled so the boss stays
   * proportionally sharper at every health level. Pure — returns a fresh object,
   * never mutates AI_PROFILES.
   */
  private buildBossProfile(personality: AIPersonality, mod: BossModifier): AIProfile {
    const base = AI_PROFILES[personality];
    return {
      ...base,
      timingSigmaMs: base.timingSigmaMs * mod.sigmaMult,
      lowHeartTimingSigmaMs: base.lowHeartTimingSigmaMs * mod.sigmaMult,
      noBlockProb: base.noBlockProb * mod.noBlockMult,
      lowHeartNoBlockProb: base.lowHeartNoBlockProb * mod.noBlockMult,
      thinkDelayMinMs: base.thinkDelayMinMs * mod.thinkMult,
      thinkDelayMaxMs: base.thinkDelayMaxMs * mod.thinkMult,
      lowHeartThinkDelayMinMs: base.lowHeartThinkDelayMinMs * mod.thinkMult,
      lowHeartThinkDelayMaxMs: base.lowHeartThinkDelayMaxMs * mod.thinkMult,
      // EPIC #268 — a boss picks the tightest legal double-attack gap so its two
      // orbs land in rapid succession (still ≥ MIN_COMBO_GAP_MS, so an orb-1 parry
      // deterministically cancels orb 2 per the EPIC #264 gap contract).
      comboGapMinMs: MIN_COMBO_GAP_MS,
      comboGapMaxMs: MIN_COMBO_GAP_MS,
    };
  }

  /**
   * Seat a player (human or AI) with their loadout.
   *
   * If `spec` is provided, each slot with an entry uses the given element /
   * currentUses / maxUses. Slots absent from spec fall back to DEFAULT_LOADOUT
   * (with currentUses = maxUses = STARTING_USES). After seating, the thumb's
   * all-in setup passive is applied (Fire/Water/Wood) — a no-op for other
   * elements or when no matching base-element ring is in the hand.
   *
   * Returns the number of uses distributed by the setup passive so the caller
   * can award thumb XP (XP_THUMB_BUFF per use distributed).
   */
  private seatPlayer(
    id: string,
    displayName: string,
    spec?: Partial<Record<SlotKey, SlotSpec>>,
    overrides?: { hearts?: number; uses?: number; bonusUses?: number },
  ): number {
    const ps = new PlayerState();
    ps.playerId = id;
    ps.displayName = displayName;
    // `overrides` (AI seat only) replaces hearts and/or sets a uniform per-slot
    // uses value (deterministic E2E) or adds `bonusUses` to every COMBAT ring's
    // depth (#258 BOSS_MODIFIERS). The E2E uniform `uses` takes precedence over
    // bonusUses so an aiUses override still forces a duel outcome.
    ps.hearts = overrides?.hearts ?? STARTING_HEARTS;
    const bonusUses = overrides?.bonusUses ?? 0;

    for (const key of Object.keys(DEFAULT_LOADOUT) as SlotKey[]) {
      const ring = ps.getSlot(key);
      const slotSpec = spec?.[key];
      const element = slotSpec ? slotSpec.element : DEFAULT_LOADOUT[key];
      const baseCurrent = slotSpec ? slotSpec.currentUses : STARTING_USES;
      const baseMax = slotSpec ? slotSpec.maxUses : STARTING_USES;
      // #258 — the boss bonusUses deepens the four COMBAT rings (not the passive
      // thumb). Skipped when the E2E uniform `uses` override is set (it wins).
      const slotBonus = overrides?.uses === undefined && key !== 'thumb' ? bonusUses : 0;
      const currentUses = overrides?.uses ?? baseCurrent + slotBonus;
      const maxUses =
        overrides?.uses !== undefined ? Math.max(baseMax, overrides.uses) : baseMax + slotBonus;
      ring.element = element;
      ring.tier = slotSpec ? slotSpec.tier : 1;
      ring.maxUses = maxUses;
      ring.xp = slotSpec ? slotSpec.xp : 0;
      setUses(ring, currentUses);
      ring.isFusion = isFusion(element);
      // #263 — prefer the human ring's dominant-first order ([dominant, other])
      // when the DB recorded a parent (slotSpec.fusionParents), so the in-duel
      // hand/opponent cards match the static REST cards. AI/boss fused thumbs and
      // base rings have no recorded parent → fall back to the static
      // fusionParents(element) order (EPIC #256 Contracts).
      ring.fusionParents.clear();
      const ordered =
        slotSpec?.fusionParents && slotSpec.fusionParents.length >= 2
          ? slotSpec.fusionParents
          : fusionParents(element);
      if (ordered) ring.fusionParents.push(ordered[0], ordered[1]);
    }

    this.state.players.set(id, ps);

    // Apply the all-in setup passive (Fire/Water/Wood). No-op for other
    // elements or when no matching base-element ring is in the hand. Returns how
    // many uses were distributed so the caller can award thumb XP.
    return StakeResolver.applySetupPassive(ps);
  }

  onJoin(client: Client, options: BattleRoomOptions = {}): void {
    const sessionId = client.sessionId;

    // Every onJoin seat is a human client (the AI is seated in onCreate). Track
    // its outcome-based XP for the duration of the duel.
    this.xpAccumulator.set(sessionId, new Map());

    // Attempt to load a real loadout from the DB if the client supplied a token.
    const payload = options.token ? verifyToken(options.token) : null;

    if (payload) {
      const { playerId } = payload;
      const loadout = PlayerRepo.getLoadout(playerId);
      const allRings = PlayerRepo.getRingsByOwner(playerId);
      const ringMap = new Map(allRings.map((r) => [r.id, r]));

      const spec: Partial<Record<SlotKey, SlotSpec>> = {};
      const ringIds: Record<SlotKey, string | null> = {
        thumb: null,
        a1: null,
        a2: null,
        d1: null,
        d2: null,
      };

      if (loadout) {
        for (const key of ['thumb', 'a1', 'a2', 'd1', 'd2'] as SlotKey[]) {
          const ringId = loadout[key];
          if (ringId) {
            const row = ringMap.get(ringId);
            if (row) {
              spec[key] = {
                element: row.element,
                tier: row.tier,
                currentUses: row.current_uses,
                maxUses: row.max_uses,
                xp: row.xp,
                // #263 — thread the dominant-first parent order for a human fusion
                // whose higher-XP parent was persisted (parent_dominant >= 0), so
                // the in-duel cards match the static REST cards. getRingsByOwner
                // already computed it (row.fusionParents = [dominant, other]). For
                // base rings / pre-migration fusions we omit it and seatPlayer uses
                // its static fusionParents(element) fallback.
                ...(row.parent_dominant >= 0 ? { fusionParents: row.fusionParents } : {}),
              };
              ringIds[key] = ringId;
            }
          }
        }
      }

      const buffed = this.seatPlayer(sessionId, '', spec);
      this.sessionToPlayerId.set(sessionId, playerId);
      this.sessionToRingIds.set(sessionId, ringIds);
      // All-in setup thumb XP: 1 per use distributed at seat time.
      if (buffed > 0) this.addXp(sessionId, 'thumb', XP_THUMB_BUFF * buffed);

      // EPIC #302 / #304 — a human's starting HP comes from their equipped heart
      // ring (current_uses, clamped to max_uses), NOT the default STARTING_HEARTS.
      // An empty heart slot is 0 HP, which the 0-HP guard below rejects. The heart
      // ring id is cached so persistBattleResult can write surviving HP back.
      const heartRing = PlayerRepo.getHeartRing(playerId);
      this.sessionToHeartRingId.set(sessionId, heartRing ? heartRing.id : null);
      const seatPs = this.state.players.get(sessionId);
      if (seatPs) {
        seatPs.hearts = heartRing ? Math.min(heartRing.current_uses, heartRing.max_uses) : 0;
      }
      // Reject the duel before it starts when this human has no usable HP (empty
      // heart slot, or a fully-drained heart ring). Throwing in onJoin rejects only
      // this client's seat — no consequences are persisted (we throw before any
      // escrow / spirit spend below). Unwind the partial seat (state row + session
      // maps) first so a rejected join leaves no stale player behind, then throw;
      // the message surfaces on the client.
      if (seatPs && seatPs.hearts === 0) {
        this.state.players.delete(sessionId);
        this.sessionToPlayerId.delete(sessionId);
        this.sessionToRingIds.delete(sessionId);
        this.sessionToHeartRingId.delete(sessionId);
        this.xpAccumulator.delete(sessionId);
        throw new ServerError(4000, 'No HP: equip and recharge your heart ring first');
      }
      // #319/A1 — Reject the duel when the human has no ring staked to the thumb
      // slot. A drained ring (current_uses = 0) is permitted; only a completely
      // unassigned thumb slot (null) blocks. Unwind the partial seat before throwing
      // so the rejected join leaves no stale player state behind.
      if (ringIds.thumb === null) {
        this.state.players.delete(sessionId);
        this.sessionToPlayerId.delete(sessionId);
        this.sessionToRingIds.delete(sessionId);
        this.sessionToHeartRingId.delete(sessionId);
        this.xpAccumulator.delete(sessionId);
        throw new ServerError(4001, 'No staked ring: stake a ring before battling');
      }

      // #171/#378 — seed spareCapacity from the per-player spare_ring_max so the
      // client HUD reflects the correct carry headroom as soon as the room opens.
      const ps = this.state.players.get(sessionId);
      if (ps) {
        ps.spareCapacity = PlayerRepo.getSpareRingMax(playerId);
        // #211 — seed the spirit gauge from the DB so the local HUD shows the
        // ⚡ current/max readout immediately (and recharge feedback has a baseline).
        // Only token sessions reach this branch; AI / no-token sessions leave
        // spiritCurrent/spiritMax at 0, which the HUD treats as "hide".
        // #313 — spirit is a vsAI / boss mechanic; PvP human seats must NOT broadcast
        // spiritMax so the opponent panel stays hidden for both players. Spirit is
        // meaningful only when there is an AI whose pool we want to count down.
        const { spirit_current, spirit_max } = PlayerRepo.getSpiritAndFood(playerId);
        if (this.ai) {
          // vsAI room: broadcast the player's live spirit so the local HUD gauge shows.
          ps.spiritCurrent = spirit_current;
          ps.spiritMax = spirit_max;
        }
        // Set the NPC spirit pool now that we have the player's spirit_max.
        // npcSpiritMult is 0 for PvP rooms (no AI) — guard so we don't touch _npcSpirit there.
        if (this.ai && this.npcSpiritMult > 0) {
          this._npcSpirit = Math.floor(spirit_max * this.npcSpiritMult);
          // #464 — apply per-biome boss spirit bonus (flat addition) to boss-tier NPCs only.
          if (this.boss && this.npcBiome) {
            const bonus = BIOME_BOSS_SPIRIT_BONUS[this.npcBiome]?.[this.boss.tier] ?? 0;
            this._npcSpirit += bonus;
          }
          // #313 — broadcast the AI's finite spirit pool so the opponent panel can
          // render ⚡ current/max. The AI seat is created at room setup (seatPlayer
          // AI_ID) before any human joins, so this get() always resolves here.
          // PvP rooms have npcSpiritMult === 0 and never reach this branch, so the
          // human opponent's seat keeps spiritMax === 0 and the readout stays hidden.
          const aiPs = this.state.players.get(AI_ID);
          if (aiPs) {
            aiPs.spiritMax = this._npcSpirit;
            aiPs.spiritCurrent = this._npcSpirit;
          }
        }
      }

      // Escrow the thumb ring for staking.
      if (ringIds.thumb) {
        PlayerRepo.setEscrowed(ringIds.thumb, true);
      }

      // #87 Part C — ambush first-strike. When the join requested firstStrike and
      // the (authenticated) player can afford AMBUSH_SPIRIT_COST, spend it and
      // grant this session the opening attack. If unaffordable the flag is
      // silently ignored and the duel proceeds with default initiative — the
      // server is the sole guard for the spirit balance.
      if (options.firstStrike) {
        const { spirit_current } = PlayerRepo.getSpiritAndFood(playerId);
        if (spirit_current >= AMBUSH_SPIRIT_COST) {
          PlayerRepo.spendSpirit(playerId, AMBUSH_SPIRIT_COST);
          this.firstStrikeId = sessionId;
        }
      }
    } else {
      // No/invalid token: seat with default loadout (backward-compat for E2E / integration tests).
      const buffed = this.seatPlayer(sessionId, '');
      if (buffed > 0) this.addXp(sessionId, 'thumb', XP_THUMB_BUFF * buffed);
    }

    if (this.ai) {
      void this.lock();
    }

    if (this.state.players.size === 2) {
      const ids = Array.from(this.state.players.keys());
      // #87 Part C — an ambusher who paid AMBUSH_SPIRIT_COST opens the duel;
      // otherwise the first-seated session attacks first (default initiative).
      this.state.currentAttackerId =
        this.firstStrikeId && ids.includes(this.firstStrikeId) ? this.firstStrikeId : ids[0];
      this.initiativeHolderId = this.state.currentAttackerId;
      this.state.phase = 'ATTACK_SELECT';
      if (this.applyAttackerTurnStart()) {
        this.notifyAI();
        return;
      }
      // GDD §6.6 (PR #120): ring exhaustion no longer auto-loses. A player who
      // begins their turn with both attack rings extinguished simply has no
      // `attack` action — they must `recharge` or `forfeit`.
      this.notifyAI();
    }
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
  }

  /** Notify the AI of a phase transition. No-op in PvP rooms. */
  private notifyAI(): void {
    if (!this.ai) return;
    this.ai.onPhaseEnter(this.state.phase);
  }

  /**
   * Accumulate outcome-based XP for a player's ring slot. No-op for the AI or
   * any untracked session (no accumulator entry) — only humans accrue XP.
   */
  private addXp(sessionId: string, slot: string, delta: number): void {
    const m = this.xpAccumulator.get(sessionId);
    if (!m) return; // AI or untracked — skip
    m.set(slot, (m.get(slot) ?? 0) + delta);
  }

  /**
   * Award outcome-based XP for a single resolved exchange. Shared by initial
   * exchanges and rally volleys (roles already reversed by the caller). The
   * attack ring earns by what happened to its blow; the defense ring earns only
   * if the defender actually pressed a key (skipped on NO_BLOCK).
   */
  private awardExchangeXp(
    attackerSessionId: string,
    attackerSlot: string,
    defenderSessionId: string,
    defenderSlot: string,
    result: { timing: string; relationship: string; defenderHeartLost: boolean },
  ): void {
    const isCounter = result.timing === 'PARRY' && result.relationship === 'STRONG';
    const isHit = result.defenderHeartLost;

    const atkXp = isCounter ? XP_ATK_COUNTER : isHit ? XP_ATK_HIT : XP_ATK_BLOCK;
    this.addXp(attackerSessionId, attackerSlot, atkXp);

    // Defense XP only when the defender committed a ring (NO_BLOCK = no press).
    if (result.timing !== 'NO_BLOCK' && defenderSlot) {
      const defXp = isCounter
        ? XP_DEF_COUNTER
        : !result.defenderHeartLost
          ? XP_DEF_BLOCK
          : XP_DEF_WEAK;
      this.addXp(defenderSessionId, defenderSlot, defXp);
    }
  }

  /** A player can still attack iff at least one of their attack rings is lit. */
  private hasUsableAttack(ps: PlayerState): boolean {
    return !ps.a1.isExtinguished || !ps.a2.isExtinguished;
  }

  /**
   * GDD §7 start-of-turn status tick for the current attacker, run at every
   * ATTACK_SELECT entry (Burning is lethal — design decision #46). Applies:
   *   - Burning: −1 heart. If it KOs the attacker, ends the duel (opponent wins).
   *   - Drowning: the attacker's highest-capacity attack ring loses 1 use.
   *   - Entangled: the attacker's highest-capacity defense ring loses 1 use.
   *
   * Returns true if the duel ended here (Burning KO) — the caller must then
   * return after notifyAI(). Does NOT notify the AI itself (the caller owns the
   * single notifyAI() per transition).
   */
  /**
   * The other seated player's PlayerState (a duel always has exactly two seats).
   * Centralises the former hand-rolled `ids.find(id => id !== X)` + `players.get`
   * + null-guard pattern. Its `.playerId` is the opponent's session id (seatPlayer
   * sets playerId = the session key), so callers needing the id use that field.
   * Throws if no opponent / no PlayerState is seated — an invariant violation that
   * should never occur mid-duel and must surface loudly rather than silently.
   */
  private opponentOf(sessionId: string): PlayerState {
    const ids = Array.from(this.state.players.keys());
    const opponentId = ids.find((id) => id !== sessionId);
    if (!opponentId) throw new Error(`No opponent for ${sessionId}`);
    const player = this.state.players.get(opponentId);
    if (!player) throw new Error(`Opponent player state missing: ${opponentId}`);
    return player;
  }

  private applyAttackerTurnStart(): boolean {
    const state = this.state;
    const attackerId = state.currentAttackerId;
    const defenderId = this.opponentOf(attackerId).playerId;
    const attacker = state.players.get(attackerId)!;

    const { heartLost } = StatusEffects.applyTurnStart(attacker);
    if (heartLost && attacker.hearts <= 0) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      this.finalizeEnded();
      return true;
    }
    // #259 — a Burning heart loss on the boss's own turn may trigger enrage.
    if (heartLost) this.updateBossEnrage();
    return false;
  }

  /**
   * Persist battle result exactly once per room lifetime. Guarded by this.ended.
   * Called synchronously after state.phase = 'ENDED' is set.
   */
  private finalizeEnded(): void {
    if (this.ended) return;
    this.ended = true;
    this.persistBattleResult();
  }

  /** Persist XP, uses, gold awards, and stake transfer to the DB (synchronous). */
  private persistBattleResult(): void {
    // #262 — practice rematches are fully consequence-free: no uses drain, no gold,
    // no XP, no stake transfer. The duel still resolves normally for fun/training.
    if (this.isPracticeRematch) return;
    try {
      const state = this.state;
      const winnerId = state.winnerId;
      const sessions = Array.from(state.players.keys());
      const loserId = sessions.find((s) => s !== winnerId);

      for (const [sessionId, ps] of state.players) {
        const playerId = this.sessionToPlayerId.get(sessionId);
        if (!playerId) continue; // AI / no-token: skip
        const ringIds = this.sessionToRingIds.get(sessionId);
        if (!ringIds) continue;

        for (const key of ['thumb', 'a1', 'a2', 'd1', 'd2'] as SlotKey[]) {
          const ringId = ringIds[key];
          if (!ringId) continue;
          const ring = ps.getSlot(key);
          PlayerRepo.saveRingUses(ringId, ring.currentUses);
        }

        // EPIC #302 / #304 — write the surviving HP back to the heart ring as its
        // current_uses (HP is the heart ring's depleting use pool). The heart ring
        // is NOT a battle slot and earns NO XP from the duel; it is intentionally
        // absent from sessionToRingIds / xpAccumulator. Skipped when the heart slot
        // was empty (id null). Practice rematches never reach here (early return).
        //
        // #318 — a loss by depletion shatters the heart ring: ps.hearts === 0
        // uniquely identifies the loser-by-depletion (a winner never finishes at 0,
        // and a forfeit always ends with hearts > 0), so the ring is permanently
        // destroyed. Otherwise the surviving HP is written back exactly as before.
        const heartRingId = this.sessionToHeartRingId.get(sessionId);
        if (heartRingId) {
          if (ps.hearts === 0) PlayerRepo.destroyHeartRing(heartRingId, playerId);
          else PlayerRepo.saveRingUses(heartRingId, ps.hearts);
        }

        if (sessionId === winnerId) PlayerRepo.addGold(playerId, GOLD_PER_WIN);
      }

      // Award accumulated outcome-based XP for each human player. Each ring
      // earns the XP it accrued from exchange outcomes and passive activations.
      for (const [sessionId, slotDeltas] of this.xpAccumulator) {
        const slotMap = this.sessionToRingIds.get(sessionId);
        if (!slotMap) continue;
        for (const [slot, delta] of slotDeltas) {
          if (delta <= 0) continue;
          const ringId = slotMap[slot as keyof typeof slotMap];
          if (ringId) PlayerRepo.awardXP(ringId, delta);
        }
      }

      // Staking transfer (GDD §9.1 — loser ALWAYS forfeits the thumb ring).
      const loserPlayerId = loserId ? this.sessionToPlayerId.get(loserId) : undefined;
      const winnerPlayerId = winnerId ? this.sessionToPlayerId.get(winnerId) : undefined;
      const loserThumbRingId = loserId
        ? this.sessionToRingIds.get(loserId)?.thumb
        : undefined;

      // Track the ring the (human) winner gains so the client can prompt the
      // player to carry/leave/discard it on returning to camp (#40).
      let wonRingId: string | undefined;
      let wonRingElement: number | undefined;
      let wonRingXp: number | undefined;

      // GDD §6.3 forfeit gold penalty: when THIS loss was a forfeit (the loser is
      // the forfeiter), the loser also pays GOLD_FORFEIT_PENALTY (floored at 0).
      // It is bundled into the SAME transaction as the staked-ring loss so the two
      // can never desync. A KO loss (forfeiterId null) pays no penalty.
      const forfeiterIsLoser =
        this.forfeiterId !== null && loserId !== undefined && this.forfeiterId === loserId;
      const goldPenalty = forfeiterIsLoser ? GOLD_FORFEIT_PENALTY : 0;

      if (loserPlayerId && loserThumbRingId) {
        if (winnerPlayerId) {
          const loserPs = loserId ? this.state.players.get(loserId) : undefined;
          // Atomic: ring transfer + (any) forfeit gold penalty in one transaction.
          wonRingId = PlayerRepo.transferRingWithGoldPenalty(
            loserThumbRingId,
            loserPlayerId,
            winnerPlayerId,
            goldPenalty,
          );
          wonRingElement = loserPs?.thumb.element;
          wonRingXp = loserPs?.thumb.xp;
        } else {
          // vsAI: winner has no DB record — delete the ring (+ penalty), atomically.
          PlayerRepo.forfeitRingWithGoldPenalty(loserThumbRingId, loserPlayerId, goldPenalty);
        }
      } else if (!loserPlayerId && winnerPlayerId && loserId) {
        // vsAI win: AI has no DB ring to transfer, so grant the winner a new
        // ring matching the AI's thumb element (GDD §9.1: winner receives the
        // staked ring). This fires for fused-thumb bosses too — a boss stakes its
        // thematic fusion, and defeating it transfers that fusion to the winner
        // exactly like any duel (the fused element flows straight into the
        // two-tone won-ring card; no per-NPC wiring needed). The only stake-free
        // duel is a practice rematch, which early-returns above (#262).
        const aiPs = this.state.players.get(loserId);
        if (aiPs) {
          const t = aiPs.thumb;
          wonRingId = PlayerRepo.grantRing(winnerPlayerId, t.element, t.tier, t.maxUses, t.xp);
          wonRingElement = t.element;
          wonRingXp = t.xp;
        }
        // #83 — this was a win over an overworld NPC: record the defeat so the
        // NPC respawns per its spawn-table cadence (permanent NPCs stay beaten).
        if (this.npcId) {
          // Check first-defeat BEFORE recordNpcDefeat so one-time rewards are
          // only credited once even if a client somehow rematches a permanent NPC.
          const firstDefeat = !PlayerRepo.getDefeatedNpcs(winnerPlayerId).has(this.npcId);
          PlayerRepo.recordNpcDefeat(winnerPlayerId, this.npcId);
          if (firstDefeat) {
            // #229/#230 — permanent boss NPCs (respawnDays === 0) drop a food cache
            // on first defeat only. The overworld hides beaten permanent NPCs, but
            // gating here closes the authority gap for scripted room creates.
            const npcSpawn = NPC_SPAWNS.find((n) => n.id === this.npcId);
            if (npcSpawn?.respawnDays === 0) {
              const foodDrop = npcSpawn.foodDrop ?? 0;
              if (foodDrop > 0) PlayerRepo.addFood(winnerPlayerId, foodDrop);
            }
          }
        }
      }

      // Forfeit gold penalty fallback: if the forfeiting loser had NO staked thumb
      // ring (so the combined ring+penalty transaction above didn't run), still
      // apply the floored penalty here. The common path already bundled it.
      if (goldPenalty > 0 && !(loserPlayerId && loserThumbRingId) && loserPlayerId) {
        PlayerRepo.deductGoldFloored(loserPlayerId, goldPenalty);
      }

      // Recompute each human player's XP-derived spirit_max now that XP has been
      // awarded and rings transferred/granted, so a post-battle /api/me reflects
      // the new cap. AI players have no DB record and are skipped.
      if (winnerPlayerId) PlayerRepo.refreshSpiritMax(winnerPlayerId);
      if (loserPlayerId) PlayerRepo.refreshSpiritMax(loserPlayerId);

      // #171/#378 — sync spareCapacity on the live PlayerState after XP changes so
      // the client receives the updated carry headroom without a round-trip to /api/me.
      for (const [sessionId, ps] of this.state.players) {
        const pid = this.sessionToPlayerId.get(sessionId);
        if (!pid) continue; // AI / no-token: skip
        ps.spareCapacity = PlayerRepo.getSpareRingMax(pid);
      }

      // Release escrow on every human thumb ring still escrowed.
      for (const sessionId of sessions) {
        const tid = this.sessionToRingIds.get(sessionId)?.thumb;
        if (tid) PlayerRepo.setEscrowed(tid, false);
      }

      // Notify the winning client of the ring they gained so CampScene can show
      // the carry/leave/discard prompt. The grant is server-authoritative; the
      // client only stores the id and renders the modal.
      if (wonRingId && winnerId) {
        const winnerClient = this.clients.find((c) => c.sessionId === winnerId);
        winnerClient?.send('wonRing', wonRingPayload(wonRingId, wonRingElement, wonRingXp));
      }

      // Post-battle reward summary (#78 ②). Sent AFTER awardXP/refreshSpiritMax
      // above so getSpiritStats reflects the new aggregate. One per human client;
      // AI sessions (no DB player id) are skipped. The client only renders it.
      for (const client of this.clients) {
        const sessionId = client.sessionId;
        const playerId = this.sessionToPlayerId.get(sessionId);
        if (!playerId) continue; // skip AI / no-token sessions

        const won = sessionId === winnerId;
        const goldGained = won ? GOLD_PER_WIN : 0;

        // Sum this session's outcome XP across every slot (the deltas persisted
        // via awardXP above are the same values aggregated here).
        const sessionXpMap = this.xpAccumulator.get(sessionId);
        const xpGained = sessionXpMap
          ? Array.from(sessionXpMap.values()).reduce((a, b) => a + b, 0)
          : 0;

        const { aggregateXp } = PlayerRepo.getSpiritStats(playerId);

        client.send('battleSummary', battleSummaryPayload(won, goldGained, xpGained, aggregateXp));
      }
    } catch (err: unknown) {
      console.error('[BattleRoom] persistBattleResult failed:', err);
    }
  }

  handleSelectAttack(id: string, payload: SelectAttackPayload): void {
    const state = this.state;
    // PHASE-LOCK: wrong-phase / wrong-sender / wrong-slot messages are silently
    // ignored (protective, not punishing).
    if (state.phase !== 'ATTACK_SELECT') return;
    if (id !== state.currentAttackerId) return;
    if (!ATTACK_SLOTS.has(payload.slot)) return;

    const attacker = state.players.get(id)!;
    const ring = attacker.getSlot(payload.slot);
    if (ring.isExtinguished) return;

    // Tailwind passive: Wind thumb pays the throw's use cost instead of the attack
    // ring. (Drowning is no longer a per-throw surcharge — it drains an attack
    // ring at turn start; see StatusEffects.applyTurnStart.)
    const usePaidByStake = StakeResolver.applyTailwind(attacker, ring);
    if (!usePaidByStake) {
      consumeUse(ring);
    } else {
      // Tailwind fired: thumb pays the throw. Award the attacker's thumb mid-tier XP.
      this.addXp(id, 'thumb', XP_THUMB_MID);
    }

    state.attackerSlot = payload.slot;
    state.phase = 'DEFEND_WINDOW';

    this.impactTime = Date.now() + TELEGRAPH_MS;
    this.defenseSubmitted = false;
    this.defenseSlotKey = '';
    this.defensePressTime = 0;

    this.windowTimer = setTimeout(() => this._resolveExchange(), DEFEND_WINDOW_MS);
    this.notifyAI();
  }

  handleSubmitDefense(id: string, payload: SubmitDefensePayload): void {
    const state = this.state;
    // PHASE-LOCK: only the defender, only during DEFEND_WINDOW, only d1/d2.
    if (state.phase !== 'DEFEND_WINDOW') return;
    if (id === state.currentAttackerId) return;
    if (!DEFENSE_SLOTS.has(payload.slot)) return;

    // An exhausted defense ring cannot catch — mirror the attack-side guard
    // (handleSelectAttack) so a 0-use ring can't be committed to a block/parry.
    // Mirrors only the GUARD; the defense use is still spent later, in
    // resolveOrb → BlockResolver.spendUse (outcome-dependent), not here.
    const defender = state.players.get(id)!;
    if (defender.getSlot(payload.slot).isExtinguished) return;

    const now = Date.now();

    // EPIC #265 — during a double attack both orb windows can overlap (gap ≥
    // BLOCK_WINDOW_MS). Route this press to whichever orb's impact it is closer
    // to, among the orbs whose capture is still OPEN (first-write-wins per orb).
    // This lets the defender block one orb and parry the other, or skip orb 1 and
    // only defend orb 2. orb2Launched: impact2 set means orb 2 is airborne.
    if (this.comboActive) {
      const orb2Launched = this.impact2 > 0;
      const canCapture1 = !this.defenseSubmitted;
      const canCapture2 = orb2Launched && !this.defense2Submitted;

      let routeToOrb2: boolean;
      if (canCapture1 && canCapture2) {
        // Both open → nearest-impact wins (deterministic routing).
        routeToOrb2 = Math.abs(now - this.impact2) < Math.abs(now - this.impactTime);
      } else if (canCapture2) {
        routeToOrb2 = true;
      } else if (canCapture1) {
        routeToOrb2 = false;
      } else {
        return; // both captures already taken — ignore extra presses
      }

      if (routeToOrb2) {
        this.defense2Submitted = true;
        this.defense2SlotKey = payload.slot;
        this.defense2PressTime = now;
      } else {
        this.defenseSubmitted = true;
        this.defenseSlotKey = payload.slot;
        this.defensePressTime = now;
      }
      return;
    }

    if (!this.defenseSubmitted) {
      this.defenseSubmitted = true;
      this.defenseSlotKey = payload.slot;
      // Server-authoritative timing: timestamp on message ARRIVAL.
      this.defensePressTime = now;
    }
  }

  /**
   * GDD §6.3 recharge: the attacker spends spirit to restore uses to one of their
   * COMBAT rings (a1/a2/d1/d2; the Thumb is not rechargeable), consuming the turn.
   * Phase-/turn-locked; wrong-phase or wrong-sender messages are silently ignored.
   *
   * cost = maxUses − currentUses. affordable = min(cost, spirit). The affordable
   * uses are restored on both the live PlayerState ring and the persisted ring
   * row, and the affordable spirit is spent. A full ring (cost 0) is a no-op that
   * still consumes the turn. The turn then advances to the opponent.
   */
  handleRecharge(id: string, payload: RechargePayload): void {
    const state = this.state;
    if (state.phase !== 'ATTACK_SELECT') return;
    if (id !== state.currentAttackerId) return;
    if (!RECHARGEABLE_SLOTS.has(payload.slot)) return;

    const attacker = state.players.get(id)!;
    const ring = attacker.getSlot(payload.slot);
    const cost = Math.max(0, ring.maxUses - ring.currentUses);

    // Spirit is a DB-backed resource for human players; AI sessions draw from the
    // finite _npcSpirit pool computed at join time (floor(playerSpiritMax × mult)).
    const playerId = this.sessionToPlayerId.get(id);
    const isAI = !playerId && !!this.ai && id === AI_ID;
    let affordable = cost;
    if (cost > 0) {
      if (playerId) {
        const { spirit_current } = PlayerRepo.getSpiritAndFood(playerId);
        // Affordable in USES: spirit covers SPIRIT_PER_RING_USE per restored use.
        affordable = Math.min(cost, Math.floor(Math.max(0, spirit_current) / SPIRIT_PER_RING_USE));
        if (affordable > 0) {
          const ringId = this.sessionToRingIds.get(id)?.[payload.slot];
          // Atomic: spend (affordable × SPIRIT_PER_RING_USE) spirit AND restore the
          // uses in one transaction so a crash can't desync spirit and uses.
          if (ringId) PlayerRepo.rechargeRingInBattle(playerId, ringId, affordable);
          else PlayerRepo.spendSpirit(playerId, affordable * SPIRIT_PER_RING_USE);
        }
      } else if (isAI) {
        // NPC: capped by the finite spirit pool. Each restored use costs 1 spirit
        // (mirrors SPIRIT_PER_RING_USE = 1 for humans).
        affordable = Math.min(cost, Math.max(0, this._npcSpirit));
        this._npcSpirit -= affordable;
        // #313 — broadcast the live AI pool so the opponent ⚡ readout decrements
        // in real time. spiritMax stays constant mid-duel (matches the human
        // convention below). `attacker` is the AI seat here (id === AI_ID).
        attacker.spiritCurrent = this._npcSpirit;
      }
      if (affordable > 0) {
        setUses(ring, Math.min(ring.maxUses, ring.currentUses + affordable));
      }
    }

    // #211 — for token sessions, re-read the authoritative post-spend balance and
    // mirror it into broadcast state (spiritMax is XP-derived, static mid-duel) so
    // the HUD updates live; then send a per-client result so the client can flash
    // partial/insufficient-spirit feedback. AI sessions skip the DB re-read (no row).
    if (playerId) {
      const { spirit_current } = PlayerRepo.getSpiritAndFood(playerId);
      attacker.spiritCurrent = spirit_current;
      const client = this.clients.find((c) => c.sessionId === id);
      client?.send(
        'rechargeResult',
        rechargeResultPayload(payload.slot, affordable, cost, spirit_current),
      );
    }

    // Recharge consumes the turn → swap to the opponent and run the turn-start tick.
    this.advanceTurn();
  }

  /**
   * GDD §6.3 forfeit: the attacker concedes — the opponent wins, the forfeiter
   * loses their staked ring (existing persist path) and a flat gold penalty.
   * Phase-/turn-locked; wrong-phase or wrong-sender messages are silently ignored.
   */
  handleForfeit(id: string): void {
    const state = this.state;
    if (state.phase !== 'ATTACK_SELECT') return;
    if (id !== state.currentAttackerId) return;

    const opponentId = this.opponentOf(id).playerId;
    this.forfeiterId = id;
    state.winnerId = opponentId;
    state.phase = 'ENDED';
    this.finalizeEnded();
    this.notifyAI();
  }

  /**
   * Swap the turn to the opponent and enter ATTACK_SELECT, running the §7
   * turn-start status tick. Shared by recharge (and any future turn-consuming
   * action). A Burning KO during the tick ends the duel. Owns its single
   * notifyAI() per transition.
   */
  private advanceTurn(): void {
    const state = this.state;
    const opponentId = this.opponentOf(state.currentAttackerId).playerId;
    state.currentAttackerId = opponentId;
    this.initiativeHolderId = opponentId;
    state.attackerSlot = '';
    state.defenderSlot = '';
    state.rallyActive = false;
    state.volleyedElement = 0;
    state.phase = 'ATTACK_SELECT';
    if (this.applyAttackerTurnStart()) {
      this.notifyAI();
      return;
    }
    this.notifyAI();
  }

  /**
   * Test-only state-setter (E2E_TEST_ROUTES gate — handler is registered only in
   * that mode). Writes an exact gauge/hearts/uses configuration onto a player so
   * status-effect E2E specs are deterministic. Does NOT advance phase or trigger
   * any status resolution — the authoritative turn-start tick / cleanse paths
   * still own all effect logic; this only seeds the inputs.
   */
  private handleTestSetState(senderId: string, payload: TestSetStatePayload): void {
    // Non-throwing opponent lookup: this test-only seeder must degrade to a silent
    // return (below) when no opponent is seated, not throw like opponentOf().
    const opponentId = Array.from(this.state.players.keys()).filter((id) => id !== senderId)[0];
    const targetId =
      payload.target === 'opponent'
        ? opponentId
        : payload.target && payload.target !== 'self'
          ? payload.target
          : senderId;
    if (!targetId) return;
    const ps = this.state.players.get(targetId);
    if (!ps) return;

    if (payload.hearts !== undefined) ps.hearts = Math.max(0, payload.hearts);
    if (payload.fireGauge !== undefined) ps.fireGauge = Math.max(0, payload.fireGauge);
    if (payload.waterGauge !== undefined) ps.waterGauge = Math.max(0, payload.waterGauge);
    if (payload.woodGauge !== undefined) ps.woodGauge = Math.max(0, payload.woodGauge);
    if (payload.shadowGauge !== undefined) ps.shadowGauge = Math.max(0, payload.shadowGauge);

    if (payload.uses) {
      for (const key of Object.keys(payload.uses) as SlotKey[]) {
        const v = payload.uses[key];
        if (v === undefined) continue;
        const ring = ps.getSlot(key);
        setUses(ring, v);
      }
    }

    if (payload.elements) {
      for (const key of Object.keys(payload.elements) as SlotKey[]) {
        const el = payload.elements[key];
        if (el === undefined) continue;
        const ring = ps.getSlot(key);
        ring.element = el;
        ring.isFusion = isFusion(el);
        const parents = fusionParents(el);
        ring.fusionParents.clear();
        if (parents) ring.fusionParents.push(parents[0], parents[1]);
      }
    }
  }

  /**
   * Adjust a single tracked gauge on a player by `delta`. Maps the gauge element
   * index to its field and clamps: the triangle gauges to [0, GAUGE_SOFT_CAP], the
   * shadow gauge to [0, SHADOW_GAUGE_CAP] (the hard cap of 5, GDD §7.1). Unknown
   * elements are ignored.
   */
  private adjustGauge(ps: PlayerState, el: number, delta: number): void {
    const clampTo = (cap: number, v: number): number => Math.max(0, Math.min(cap, v));
    if (el === ElementEnum.FIRE) ps.fireGauge = clampTo(GAUGE_SOFT_CAP, ps.fireGauge + delta);
    else if (el === ElementEnum.WATER) ps.waterGauge = clampTo(GAUGE_SOFT_CAP, ps.waterGauge + delta);
    else if (el === ElementEnum.WOOD) ps.woodGauge = clampTo(GAUGE_SOFT_CAP, ps.woodGauge + delta);
    else if (el === ElementEnum.SHADOW)
      ps.shadowGauge = clampTo(SHADOW_GAUGE_CAP, ps.shadowGauge + delta);
  }

  /** Reset ALL tracked gauges to 0 (case 4, strong parry) — triangle + shadow. */
  private clearAllGauges(ps: PlayerState): void {
    ps.fireGauge = 0;
    ps.waterGauge = 0;
    ps.woodGauge = 0;
    ps.shadowGauge = 0;
  }

  /**
   * Capture of one orb's defender response (which ring caught it, when). Orb 1
   * uses the primary defense fields; orb 2 uses the `defense2*` fields. Bundling
   * them lets `resolveOrb` resolve either orb through one code path.
   */
  private orbDefenseCapture(which: 1 | 2): {
    submitted: boolean;
    slotKey: DefenseSlot | '';
    pressTime: number;
    impactTime: number;
  } {
    return which === 1
      ? {
          submitted: this.defenseSubmitted,
          slotKey: this.defenseSlotKey,
          pressTime: this.defensePressTime,
          impactTime: this.impactTime,
        }
      : {
          submitted: this.defense2Submitted,
          slotKey: this.defense2SlotKey,
          pressTime: this.defense2PressTime,
          impactTime: this.impact2,
        };
  }

  /**
   * Resolve ONE orb (single attack, rally volley, or one orb of a double attack)
   * against the supplied defense capture: classify timing → resolveBlock → award
   * XP → apply hearts → Earth parry refund → four-case gauges → broadcast
   * `exchangeResult` → check KO. Pure of any rally/turn-swap logic — the caller
   * decides what happens AFTER this orb resolves (rally, advance, schedule orb 2).
   *
   * `attackerSlot` is the firing slot ('a1'/'a2' for an attack, 'd1'/'d2' for a
   * rally volley). Mutates state.defenderSlot for HUD continuity. Returns the
   * BlockResult plus `ended` (true if this orb KO'd either player — the duel is
   * over and the caller must stop). Owns NO notifyAI() (the caller does).
   */
  private resolveOrb(
    attackerId: string,
    defenderId: string,
    attackerSlot: SlotKey,
    capture: { submitted: boolean; slotKey: DefenseSlot | ''; pressTime: number; impactTime: number },
  ): { result: ReturnType<typeof resolveBlock>; ended: boolean } {
    const state = this.state;
    const attackerPlayer = state.players.get(attackerId)!;
    const defenderPlayer = state.players.get(defenderId)!;

    const attackerRing = attackerPlayer.getSlot(attackerSlot);
    const defenderRing =
      capture.submitted && capture.slotKey ? defenderPlayer.getSlot(capture.slotKey) : null;

    const offsetMs = capture.pressTime - capture.impactTime;
    const timing = classifyTiming(offsetMs, capture.submitted, PARRY_WINDOW_MS, BLOCK_WINDOW_MS);

    const result = resolveBlock(attackerRing, defenderRing, timing);

    // Award outcome-based XP for the engaged attack/defense rings.
    this.awardExchangeXp(attackerId, attackerSlot, defenderId, capture.slotKey, result);

    // Heart-loss resolution. Each lost heart is a plain decrement (floored at 0).
    // #261 — Thornwood "Heartwood" absorbs the boss's first N heart-losses (the
    // hit is redirected to the Thumb) before the decrement applies.
    let aiHeartActuallyLost = false;
    if (result.defenderHeartLost) {
      if (!this.absorbBossHeartLoss(defenderId)) {
        defenderPlayer.hearts = Math.max(0, defenderPlayer.hearts - 1);
        if (defenderId === AI_ID) aiHeartActuallyLost = true;
      }
    }
    // attackerHeartLost is always false in the current BlockResolver (forward compat
    // for future rally counter-damage); the absorb wrapper is preserved in case it
    // fires (e.g. a boss attacker taking reflected damage).
    if (result.attackerHeartLost) {
      if (!this.absorbBossHeartLoss(attackerId)) {
        attackerPlayer.hearts = Math.max(0, attackerPlayer.hearts - 1);
        if (attackerId === AI_ID) aiHeartActuallyLost = true;
      }
    }
    // #259 — a real AI heart change may cross the enrage threshold (broadcasts the
    // `enraged` flag). An absorbed hit is NOT a heart change, so it never enrages.
    if (aiHeartActuallyLost) this.updateBossEnrage();

    // Earth passive: timing-only parry refund (fires on PARRY regardless of
    // element match). Awards the defender's thumb mid-tier XP when it fires.
    if (result.timing === 'PARRY' && defenderRing) {
      if (StakeResolver.applyEarthParry(defenderPlayer, defenderRing)) {
        this.addXp(defenderId, 'thumb', XP_THUMB_MID);
      }
    }

    // Four-case gauge model (GDD §7.1). Apply the resolver's gauge directives to
    // the DEFENDER, capped at GAUGE_SOFT_CAP / floored at 0. A strong parry (case
    // 4) zeroes every tracked gauge and is TERMINAL — no +1/−1 directives apply on
    // top of it (the parry's net effect is a full reset, per §7.1 scenario 3).
    if (result.clearAllGauges) {
      this.clearAllGauges(defenderPlayer);
    } else {
      // #260 — boss status-gauge pressure. When the ATTACKER is the boss AI, an
      // uncontested hit credits the DEFENDER's gauge at base × gaugeFillMult per
      // triangle component (per orb — a double attack runs this twice, so each orb
      // gets the multiplier independently). Player→player and player→non-boss gauge
      // math is unchanged (mult = 1). Defense-side block deltas (case 2) are the
      // defender's own ring cost and are NOT boss-scaled.
      const hitMult = attackerId === AI_ID ? this.bossGaugeFillMult() : 1;
      //   hitGaugeElements — uncontested-hit components +mult each (case 1)
      //   blockGaugeDeltas — each tracked parent of the defending ring += its
      //     tier-reduced delta (case 2; full rate per tracked parent, §7.1)
      //   blockedGaugeElement — strong-block beaten gauge(s) −1 (case 3)
      for (const el of result.hitGaugeElements) this.adjustGauge(defenderPlayer, el, hitMult);
      for (const { element, delta } of result.blockGaugeDeltas) {
        this.adjustGauge(defenderPlayer, element, delta);
      }
      for (const el of result.blockedGaugeElement) this.adjustGauge(defenderPlayer, el, -1);
    }

    if (defenderRing && capture.slotKey) {
      state.defenderSlot = capture.slotKey;
    }

    // Broadcast THIS orb's result BEFORE any KO early-return or rally swap, so
    // the slots/ids captured reflect this orb.
    const exchangeResult: ExchangeResultPayload = {
      attackerId,
      defenderId,
      attackerSlot,
      defenderSlot: capture.slotKey,
      attackerElements: componentsOf(attackerRing.element),
      timing,
      relationship: result.relationship,
      defenderHeartLost: result.defenderHeartLost,
      rallyContinues: result.rallyContinues,
      volleyedElement: result.volleyedElement,
    };
    this.broadcast('exchangeResult', exchangeResult);

    if (defenderPlayer.hearts <= 0) {
      state.winnerId = attackerId;
      state.phase = 'ENDED';
      this.finalizeEnded();
      return { result, ended: true };
    }
    if (attackerPlayer.hearts <= 0) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      this.finalizeEnded();
      return { result, ended: true };
    }

    return { result, ended: false };
  }

  /**
   * After an orb's resolution (single attack or orb 2 of a combo), continue the
   * turn from the BlockResult: a PARRY+STRONG (rallyContinues) swaps roles into a
   * rally volley in DEFEND_WINDOW; anything else swaps to ATTACK_SELECT and runs
   * the §7 turn-start tick. The defender (`defenderId`) becomes the next
   * attacker, firing `parrySlot` (their parrying defense slot) on a rally. Owns
   * its single notifyAI() per transition. The caller must NOT call this when the
   * orb ended the duel.
   */
  private continueAfterOrb(
    defenderId: string,
    parrySlot: DefenseSlot | '',
    result: ReturnType<typeof resolveBlock>,
  ): void {
    const state = this.state;
    state.rallyActive = result.rallyContinues;
    state.volleyedElement = result.volleyedElement;

    if (result.rallyContinues) {
      // Swap roles: former defender becomes attacker in DEFEND_WINDOW. The
      // attacker slot is the defense slot they parried with ('d1'/'d2'). The
      // parry already cost 1 use — no extra charge for the volley.
      state.currentAttackerId = defenderId;
      state.attackerSlot = parrySlot;
      this.defenseSubmitted = false;
      this.defenseSlotKey = '';
      this.defensePressTime = 0;
      this.impactTime = Date.now() + TELEGRAPH_MS;
      state.phase = 'DEFEND_WINDOW';
      this.windowTimer = setTimeout(() => this._resolveExchange(), DEFEND_WINDOW_MS);
      // Rally stays in DEFEND_WINDOW. Ring exhaustion no longer auto-forfeits
      // (#124, GDD §6.6): once the rally resolves to the next ATTACK_SELECT, an
      // attacker with no usable attack ring must recharge or forfeit voluntarily.
      this.notifyAI();
    } else {
      // Chain resolved: initiative passes to the non-holder (GDD §6.3).
      // Using initiativeHolderId (not defenderId) ensures a rally that ends
      // with the original attacker absorbing the counter-volley still gives
      // the turn to the reactor, not back to the original attacker.
      const nextId = this.opponentOf(this.initiativeHolderId).playerId;
      state.currentAttackerId = nextId;
      this.initiativeHolderId = nextId;
      state.attackerSlot = '';
      state.defenderSlot = '';
      state.rallyActive = false;
      state.volleyedElement = 0;
      state.phase = 'ATTACK_SELECT';
      // GDD §7 turn-start status tick (Burning/Drowning/Entangled). A Burning KO
      // ends the duel here. Ring exhaustion no longer auto-forfeits (GDD §6.6, PR
      // #120) — the new attacker recharges or forfeits if both attack rings are out.
      if (this.applyAttackerTurnStart()) {
        this.notifyAI();
        return;
      }
      this.notifyAI();
    }
  }

  private _resolveExchange(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
    const state = this.state;
    state.phase = 'RESOLVE';

    const attackerId = state.currentAttackerId;
    const defenderId = this.opponentOf(attackerId).playerId;

    const { result, ended } = this.resolveOrb(
      attackerId,
      defenderId,
      state.attackerSlot as SlotKey,
      this.orbDefenseCapture(1),
    );
    if (ended) {
      this.notifyAI();
      return;
    }

    this.continueAfterOrb(defenderId, this.defenseSlotKey, result);
  }

  /**
   * EPIC #264 / #265 — fusion-thumb double attack. Validates phase / sender /
   * distinct attack slots and the authoritative `canDoubleAttack` predicate;
   * an ineligible request is SILENTLY DROPPED (phase-lock convention) so the
   * client falls back to the normal single-attack flow with NO use spent.
   *
   * On commit: A1 −1, A2 −1, thumb −1 (no Tailwind / setup / Earth passive — those
   * are base-thumb only). Orb 1 launches immediately (impact = now + TELEGRAPH_MS,
   * phase DEFEND_WINDOW); orb 2 launches after the clamped gap with its own impact.
   */
  handleSelectDoubleAttack(id: string, payload: SelectDoubleAttackPayload): void {
    const state = this.state;
    // PHASE-LOCK: wrong-phase / wrong-sender / wrong-slot messages are silently
    // ignored (protective, not punishing).
    if (state.phase !== 'ATTACK_SELECT') return;
    if (id !== state.currentAttackerId) return;
    if (!ATTACK_SLOTS.has(payload.first) || !ATTACK_SLOTS.has(payload.second)) return;
    if (payload.first === payload.second) return;

    const attacker = state.players.get(id)!;
    // Authoritative eligibility: fusion thumb + A1/A2 = its components + all lit.
    if (!canDoubleAttack(attacker)) return;

    const firstRing = attacker.getSlot(payload.first);
    const secondRing = attacker.getSlot(payload.second);

    // Charge at commit: A1 −1, A2 −1, thumb −1. NO base-thumb passive (Tailwind /
    // setup / Earth) applies — fusion thumbs spend their own use for the combo.
    consumeUse(firstRing);
    consumeUse(secondRing);
    consumeUse(attacker.thumb);

    // Server-authoritative gap clamp regardless of the client value.
    const gapMs = Math.min(MAX_COMBO_GAP_MS, Math.max(MIN_COMBO_GAP_MS, payload.gapMs));

    // Launch orb 1 immediately (reuses the primary defense capture + impactTime).
    state.attackerSlot = payload.first;
    state.phase = 'DEFEND_WINDOW';
    this.impactTime = Date.now() + TELEGRAPH_MS;
    this.defenseSubmitted = false;
    this.defenseSlotKey = '';
    this.defensePressTime = 0;

    // Combo state: orb 2 fires gapMs after orb 1 with its own impact + capture.
    this.comboActive = true;
    this.comboSecondSlot = payload.second;
    this.comboGapMs = gapMs;
    this.impact2 = 0;
    this.defense2Submitted = false;
    this.defense2SlotKey = '';
    this.defense2PressTime = 0;

    this.broadcast('doubleAttackStart', {
      first: payload.first,
      second: payload.second,
      firstElements: componentsOf(firstRing.element),
      secondElements: componentsOf(secondRing.element),
      gapMs,
    } satisfies DoubleAttackStartPayload);

    // Orb 1 resolves DEFEND_WINDOW_MS after its launch.
    this.windowTimer = setTimeout(() => this._resolveCombo(), DEFEND_WINDOW_MS);

    // Orb 2 launches gapMs after orb 1: open its own impact + defense window.
    this.orb2LaunchTimer = setTimeout(() => {
      this.orb2LaunchTimer = null;
      // If the duel already ended (orb 1 KO) the launch is a no-op.
      if (!this.comboActive || this.state.phase === 'ENDED') return;
      this.impact2 = Date.now() + TELEGRAPH_MS;
      // Orb 2 resolves DEFEND_WINDOW_MS after ITS launch.
      this.orb2Timer = setTimeout(() => this._resolveOrb2(), DEFEND_WINDOW_MS);
    }, gapMs);

    this.notifyAI();
  }

  /** Clear all combo state + timers (after orb 2, or a cancel/KO). */
  private clearComboState(): void {
    if (this.orb2LaunchTimer) {
      clearTimeout(this.orb2LaunchTimer);
      this.orb2LaunchTimer = null;
    }
    if (this.orb2Timer) {
      clearTimeout(this.orb2Timer);
      this.orb2Timer = null;
    }
    this.comboActive = false;
    this.comboSecondSlot = '';
    this.comboGapMs = 0;
    this.impact2 = 0;
    this.defense2Submitted = false;
    this.defense2SlotKey = '';
    this.defense2PressTime = 0;
  }

  /**
   * EPIC #265 — resolve ORB 1 of a double attack. Resolves the first orb fully,
   * then branches on the outcome:
   *   - KO          → duel ends; orb 2 is cancelled (clearComboState).
   *   - orb 1 PARRY → cancel orb 2 (the returning counter disperses it); broadcast
   *                   a `doubleAttackCancelled` marker; run orb 1's rally swap. The
   *                   combo's 3 uses remain spent.
   *   - otherwise   → orb 2 stays in flight; it resolves independently in
   *                   `_resolveOrb2`. Phase stays DEFEND_WINDOW for orb 2.
   */
  private _resolveCombo(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
    const state = this.state;
    state.phase = 'RESOLVE';

    const attackerId = state.currentAttackerId;
    const defenderId = this.opponentOf(attackerId).playerId;

    const orb1Slot = state.attackerSlot as SlotKey;
    const orb1ParrySlot = this.defenseSlotKey;
    const { result, ended } = this.resolveOrb(
      attackerId,
      defenderId,
      orb1Slot,
      this.orbDefenseCapture(1),
    );

    if (ended) {
      // KO on orb 1 — duel over, orb 2 cancelled.
      this.clearComboState();
      this.notifyAI();
      return;
    }

    if (result.rallyContinues) {
      // PARRY+STRONG on orb 1: the returning counter intercepts orb 2 mid-flight.
      // Cancel orb 2 (no resolution, no heart/gauge change) and run orb 1's rally.
      this.clearComboState();
      this.broadcast('doubleAttackCancelled', { orb: 2 } satisfies DoubleAttackCancelledPayload);
      this.continueAfterOrb(defenderId, orb1ParrySlot, result);
      return;
    }

    // Non-PARRY, no KO: orb 2 proceeds. Stay in DEFEND_WINDOW for it. Its launch
    // timer (set in handleSelectDoubleAttack) opens its window; _resolveOrb2 ends
    // the combo. If orb 2 already launched (gap < orb-1 resolution), its window is
    // already open; if not, the launch timer is still pending.
    state.phase = 'DEFEND_WINDOW';
    state.attackerSlot = this.comboSecondSlot;
    // The defender continues defending; orb 2's capture is separate (defense2*).
    this.notifyAI();
  }

  /**
   * EPIC #265 — resolve ORB 2 of a double attack as an INDEPENDENT exchange (its
   * own timing/heart/gauge/XP/exchangeResult). Only reached when orb 1 did NOT
   * parry and did NOT KO. A PARRY+STRONG on orb 2 starts ITS OWN rally; anything
   * else swaps to ATTACK_SELECT as a normal turn end. Clears combo state.
   */
  private _resolveOrb2(): void {
    if (this.orb2Timer) {
      clearTimeout(this.orb2Timer);
      this.orb2Timer = null;
    }
    if (!this.comboActive || this.state.phase === 'ENDED') {
      this.clearComboState();
      return;
    }
    const state = this.state;
    state.phase = 'RESOLVE';

    const attackerId = state.currentAttackerId;
    const defenderId = this.opponentOf(attackerId).playerId;

    const orb2Slot = this.comboSecondSlot as SlotKey;
    const orb2ParrySlot = this.defense2SlotKey;
    const { result, ended } = this.resolveOrb(
      attackerId,
      defenderId,
      orb2Slot,
      this.orbDefenseCapture(2),
    );

    // Orb 2 is the last orb: combo is fully resolved either way.
    this.clearComboState();

    if (ended) {
      this.notifyAI();
      return;
    }

    this.continueAfterOrb(defenderId, orb2ParrySlot, result);
  }

  onDispose(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    if (this.orb2LaunchTimer) clearTimeout(this.orb2LaunchTimer);
    if (this.orb2Timer) clearTimeout(this.orb2Timer);
    if (this.ai) {
      this.ai.dispose();
      this.ai = null;
    }
  }
}
