import { Room, Client } from 'colyseus';
import { BattleState } from '../schemas/BattleState';
import { PlayerState } from '../schemas/PlayerState';
import { Ring } from '../schemas/Ring';
import { classifyTiming, resolveBlock } from '../game/BlockResolver';
import { componentsOf, fusionParents, isFusion } from '../game/ElementSystem';
import * as StatusEffects from '../game/StatusEffects';
import { AIController } from '../game/ai/AIController';
import { makeRng } from '../game/ai/AIProfiles';
import { generateAILoadout, type SlotSpec } from '../game/ai/AILoadout';
import * as StakeResolver from '../game/StakeResolver';
import * as PlayerRepo from '../persistence/PlayerRepo';
import { verifyToken } from '../auth/auth';
import {
  TELEGRAPH_MS,
  DEFEND_WINDOW_MS,
  BLOCK_WINDOW_MS,
  PARRY_WINDOW_MS,
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
  XP_THUMB_ABSORB,
  GAUGE_SOFT_CAP,
  SHADOW_GAUGE_CAP,
  AMBUSH_SPIRIT_COST,
  SPIRIT_PER_RING_USE,
  GOLD_FORFEIT_PENALTY,
} from '../game/constants';
import {
  ElementEnum,
  SelectAttackPayload,
  SubmitDefensePayload,
  RechargePayload,
  ExchangeResultPayload,
  BattleRoomOptions,
  SlotKey,
  AttackSlot,
  DefenseSlot,
  BattleSummaryPayload,
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
// thumb=FIRE chosen so that no combat passives (Deep Roots/Tailwind/Wellspring)
// disrupt the integration test suite. Kindling (the FIRE setup passive) buffs
// a1 from 3→4 uses, which integration tests do not assert on post-seat.
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
  /** Non-null only in vsAI (`battle-ai`) rooms; a no-op via notifyAI() in PvP. */
  private ai: AIController | null = null;
  /**
   * #83 — the overworld NPC id this duel is against (only set on the
   * EncounterScene NPC path). When the human wins a vsAI duel and this is set,
   * persistBattleResult records the defeat so the NPC respawns per its cadence.
   */
  private npcId: string | undefined;

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

  onCreate(options: BattleRoomOptions = {}): void {
    this.setState(new BattleState());
    this.maxClients = 2;

    this.onMessage('selectAttack', (client, payload: SelectAttackPayload) =>
      this.handleSelectAttack(client.sessionId, payload),
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
      const personality = options.personality ?? 'AGGRESSIVE';
      const seed = options.aiSeed ?? (Date.now() & 0xffffffff);
      // Use a separate RNG stream for loadout generation so the combat RNG
      // (inside AIController) is unaffected by the number of template variants.
      const loadoutRng = makeRng(seed ^ 0x1a2b3c4d);
      // #196 — scale the AI loadout to the joining player's aggregate XP. Prefer an
      // explicitly-supplied value; otherwise resolve it from the token's player id
      // (server-authoritative — the client cannot inflate it). Absent both, 0 → a
      // fresh opponent (floored at the old hardcoded thumb XP inside the loadout).
      const tokenPayload = options.token ? verifyToken(options.token) : null;
      const playerXp =
        options.playerAggregateXp ??
        (tokenPayload ? PlayerRepo.getAggregateXp(tokenPayload.playerId) : 0);
      // #199 — pass the overworld NPC's intended stake element (when supplied) so
      // the loadout's thumb matches the element shown on the overworld marker.
      const aiSpec = generateAILoadout(
        personality,
        loadoutRng,
        undefined,
        undefined,
        undefined,
        options.thumbElement,
        playerXp,
      );
      // Deterministic-test AI-strength overrides (see BattleRoomOptions): a weak
      // AI yields a guaranteed protagonist win; a tanky AI a guaranteed loss.
      // Applied to the AI seat ONLY — the human is seated from its real loadout.
      const aiOverrides =
        options.aiHearts !== undefined || options.aiUses !== undefined
          ? { hearts: options.aiHearts, uses: options.aiUses }
          : undefined;
      this.seatPlayer(AI_ID, personality, aiSpec, aiOverrides);
      this.ai = new AIController(this, AI_ID, personality, seed);
    }
  }

  /**
   * Seat a player (human or AI) with their loadout.
   *
   * If `spec` is provided, each slot with an entry uses the given element /
   * currentUses / maxUses. Slots absent from spec fall back to DEFAULT_LOADOUT
   * (with currentUses = maxUses = STARTING_USES). After seating, the thumb's
   * setup passive is applied (Kindling / Bulwark) — a no-op for most elements.
   *
   * Returns the number of rings buffed by the setup passive so the caller can
   * award thumb XP (XP_THUMB_BUFF per ring).
   */
  private seatPlayer(
    id: string,
    displayName: string,
    spec?: Partial<Record<SlotKey, SlotSpec>>,
    overrides?: { hearts?: number; uses?: number },
  ): number {
    const ps = new PlayerState();
    ps.playerId = id;
    ps.displayName = displayName;
    // `overrides` (deterministic E2E only, AI seat only) replaces hearts and/or
    // sets a uniform per-slot uses value so a duel outcome can be forced.
    ps.hearts = overrides?.hearts ?? STARTING_HEARTS;

    for (const key of Object.keys(DEFAULT_LOADOUT) as SlotKey[]) {
      const ring = ps.getSlot(key);
      const slotSpec = spec?.[key];
      const element = slotSpec ? slotSpec.element : DEFAULT_LOADOUT[key];
      const baseCurrent = slotSpec ? slotSpec.currentUses : STARTING_USES;
      const baseMax = slotSpec ? slotSpec.maxUses : STARTING_USES;
      const currentUses = overrides?.uses ?? baseCurrent;
      const maxUses =
        overrides?.uses !== undefined ? Math.max(baseMax, overrides.uses) : baseMax;
      ring.element = element;
      ring.tier = slotSpec ? slotSpec.tier : 1;
      ring.currentUses = currentUses;
      ring.maxUses = maxUses;
      ring.xp = slotSpec ? slotSpec.xp : 0;
      ring.isExtinguished = currentUses === 0;
      ring.isFusion = isFusion(element);
      const parents = fusionParents(element);
      ring.fusionParents.clear();
      if (parents) ring.fusionParents.push(parents[0], parents[1]);
    }

    this.state.players.set(id, ps);

    // Apply setup passive (Kindling / Bulwark). No-op for all other elements.
    // Returns how many rings were buffed so the caller can award thumb XP.
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
              };
              ringIds[key] = ringId;
            }
          }
        }
      }

      const buffed = this.seatPlayer(sessionId, '', spec);
      this.sessionToPlayerId.set(sessionId, playerId);
      this.sessionToRingIds.set(sessionId, ringIds);
      // Kindling/Bulwark thumb XP: 1 per ring buffed at seat time.
      if (buffed > 0) this.addXp(sessionId, 'thumb', XP_THUMB_BUFF * buffed);

      // #171 — seed spareCapacity from the live Reliquary XP so the client HUD
      // reflects the correct carry headroom as soon as the battle room opens.
      const ps = this.state.players.get(sessionId);
      if (ps) ps.spareCapacity = PlayerRepo.getSpareCapacity(playerId);

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
  private applyAttackerTurnStart(): boolean {
    const state = this.state;
    const attackerId = state.currentAttackerId;
    const ids = Array.from(state.players.keys());
    const defenderId = ids.find((id) => id !== attackerId)!;
    const attacker = state.players.get(attackerId)!;

    const { heartLost } = StatusEffects.applyTurnStart(attacker);
    if (heartLost && attacker.hearts <= 0) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      this.finalizeEnded();
      return true;
    }
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
        } else {
          // vsAI: winner has no DB record — delete the ring (+ penalty), atomically.
          PlayerRepo.forfeitRingWithGoldPenalty(loserThumbRingId, loserPlayerId, goldPenalty);
        }
      } else if (!loserPlayerId && winnerPlayerId && loserId) {
        // vsAI win: AI has no DB ring to transfer, so grant the winner a new
        // ring matching the AI's thumb element (GDD §9.1).
        const aiPs = this.state.players.get(loserId);
        if (aiPs) {
          const t = aiPs.thumb;
          wonRingId = PlayerRepo.grantRing(winnerPlayerId, t.element, t.tier, t.maxUses, t.xp);
          wonRingElement = t.element;
        }
        // #83 — this was a win over an overworld NPC: record the defeat so the
        // NPC respawns per its spawn-table cadence (permanent NPCs stay beaten).
        if (this.npcId) PlayerRepo.recordNpcDefeat(winnerPlayerId, this.npcId);
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

      // #171 — sync spareCapacity on the live PlayerState after XP changes so the
      // client receives the updated carry headroom without a round-trip to /api/me.
      for (const [sessionId, ps] of this.state.players) {
        const pid = this.sessionToPlayerId.get(sessionId);
        if (!pid) continue; // AI / no-token: skip
        ps.spareCapacity = PlayerRepo.getSpareCapacity(pid);
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
        winnerClient?.send('wonRing', { ringId: wonRingId, element: wonRingElement ?? 0 });
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

        client.send('battleSummary', {
          won,
          goldGained,
          xpGained,
          aggregateXp,
        } satisfies BattleSummaryPayload);
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
      ring.currentUses = Math.max(0, ring.currentUses - 1);
      ring.isExtinguished = ring.currentUses === 0;
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
    // _resolveExchange → BlockResolver.spendUse (outcome-dependent), not here.
    const defender = state.players.get(id)!;
    if (defender.getSlot(payload.slot).isExtinguished) return;

    if (!this.defenseSubmitted) {
      this.defenseSubmitted = true;
      this.defenseSlotKey = payload.slot;
      // Server-authoritative timing: timestamp on message ARRIVAL.
      this.defensePressTime = Date.now();
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

    if (cost > 0) {
      // Spirit is a DB-backed resource; humans (token sessions) have a balance,
      // the AI / no-token sessions recharge "for free" (no DB row to read).
      const playerId = this.sessionToPlayerId.get(id);
      let affordable = cost;
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
      }
      if (affordable > 0) {
        ring.currentUses = Math.min(ring.maxUses, ring.currentUses + affordable);
        ring.isExtinguished = ring.currentUses === 0;
      }
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

    const ids = Array.from(state.players.keys());
    const opponentId = ids.find((pid) => pid !== id)!;
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
    const ids = Array.from(state.players.keys());
    const opponentId = ids.find((pid) => pid !== state.currentAttackerId)!;
    state.currentAttackerId = opponentId;
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
    const ids = Array.from(this.state.players.keys());
    const opponentId = ids.find((id) => id !== senderId);
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
        ring.currentUses = Math.max(0, v);
        ring.isExtinguished = ring.currentUses === 0;
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

  private _resolveExchange(): void {
    if (this.windowTimer) {
      clearTimeout(this.windowTimer);
      this.windowTimer = null;
    }
    const state = this.state;
    state.phase = 'RESOLVE';

    const attackerId = state.currentAttackerId;
    const ids = Array.from(state.players.keys());
    const defenderId = ids.find((pid) => pid !== attackerId)!;

    const attackerPlayer = state.players.get(attackerId)!;
    const defenderPlayer = state.players.get(defenderId)!;

    const attackerRing = attackerPlayer.getSlot(state.attackerSlot as SlotKey);
    const defenderRing =
      this.defenseSubmitted && this.defenseSlotKey
        ? defenderPlayer.getSlot(this.defenseSlotKey)
        : null;

    const offsetMs = this.defensePressTime - this.impactTime;
    const timing = classifyTiming(offsetMs, this.defenseSubmitted, PARRY_WINDOW_MS, BLOCK_WINDOW_MS);

    const result = resolveBlock(attackerRing, defenderRing, timing);

    // Snapshot the slots for this exchange before any rally swap mutates them,
    // so outcome XP is attributed to the rings that actually engaged.
    const xpAttackerSlot = state.attackerSlot as string;
    const xpDefenderSlot = this.defenseSlotKey as string;

    // Award outcome-based XP for the engaged attack/defense rings.
    this.awardExchangeXp(attackerId, xpAttackerSlot, defenderId, xpDefenderSlot, result);

    // Deep Roots passive: Wood thumb absorbs a heart loss. The absorbing player's
    // thumb earns XP_THUMB_ABSORB per heart absorbed.
    if (result.defenderHeartLost) {
      if (StakeResolver.applyDeepRoots(defenderPlayer)) {
        this.addXp(defenderId, 'thumb', XP_THUMB_ABSORB);
      } else {
        defenderPlayer.hearts = Math.max(0, defenderPlayer.hearts - 1);
      }
    }
    if (result.attackerHeartLost) {
      if (StakeResolver.applyDeepRoots(attackerPlayer)) {
        this.addXp(attackerId, 'thumb', XP_THUMB_ABSORB);
      } else {
        attackerPlayer.hearts = Math.max(0, attackerPlayer.hearts - 1);
      }
    }

    // Wellspring passive: Water thumb refunds the defender ring use on a rally.
    // Awards the defender's thumb mid-tier XP when it fires.
    if (result.rallyContinues && defenderRing) {
      if (StakeResolver.applyWellspring(defenderPlayer, defenderRing)) {
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
      //   hitGaugeElements — uncontested-hit components +1 each (case 1)
      //   blockGaugeDeltas — each tracked parent of the defending ring += its
      //     tier-reduced delta (case 2; full rate per tracked parent, §7.1)
      //   blockedGaugeElement — strong-block beaten gauge(s) −1 (case 3)
      for (const el of result.hitGaugeElements) this.adjustGauge(defenderPlayer, el, +1);
      for (const { element, delta } of result.blockGaugeDeltas) {
        this.adjustGauge(defenderPlayer, element, delta);
      }
      for (const el of result.blockedGaugeElement) this.adjustGauge(defenderPlayer, el, -1);
    }

    if (defenderRing && this.defenseSlotKey) {
      state.defenderSlot = this.defenseSlotKey;
    }

    // Broadcast THIS exchange's result BEFORE any KO early-return or the rally
    // swap, so the slots/ids captured reflect this exchange.
    const exchangeResult: ExchangeResultPayload = {
      attackerId,
      defenderId,
      attackerSlot: state.attackerSlot,
      defenderSlot: this.defenseSlotKey,
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
      this.notifyAI();
      return;
    }
    if (attackerPlayer.hearts <= 0) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      this.finalizeEnded();
      this.notifyAI();
      return;
    }

    state.rallyActive = result.rallyContinues;
    state.volleyedElement = result.volleyedElement;

    if (result.rallyContinues) {
      // Swap roles: former defender becomes attacker in DEFEND_WINDOW. The
      // attacker slot is the defense slot they parried with ('d1'/'d2'). The
      // parry already cost 1 use — no extra charge for the volley.
      state.currentAttackerId = defenderId;
      state.attackerSlot = this.defenseSlotKey;
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
      // Normal: swap roles, go to ATTACK_SELECT.
      state.currentAttackerId = defenderId;
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

  onDispose(): void {
    if (this.windowTimer) clearTimeout(this.windowTimer);
    if (this.ai) {
      this.ai.dispose();
      this.ai = null;
    }
  }
}
