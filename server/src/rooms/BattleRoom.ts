import { Room, Client } from 'colyseus';
import { BattleState } from '../schemas/BattleState';
import { PlayerState } from '../schemas/PlayerState';
import { Ring } from '../schemas/Ring';
import { classifyTiming, resolveBlock } from '../game/BlockResolver';
import { componentsOf, fusionParents, isFusion } from '../game/ElementSystem';
import { AIController } from '../game/ai/AIController';
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
  XP_PER_USE,
  GOLD_PER_WIN,
} from '../game/constants';
import {
  ElementEnum,
  SelectAttackPayload,
  SubmitDefensePayload,
  ExchangeResultPayload,
  BattleRoomOptions,
  SlotKey,
  AttackSlot,
  DefenseSlot,
} from '../../../shared/types';

/** Fixed sessionId used for the virtual AI player (it has no Colyseus client). */
const AI_ID = 'AI';

const ATTACK_SLOTS: ReadonlySet<string> = new Set<AttackSlot>(['a1', 'a2']);
const DEFENSE_SLOTS: ReadonlySet<string> = new Set<DefenseSlot>(['d1', 'd2']);

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

/** Per-slot spec supplied when seating a player from their persisted loadout. */
interface SlotSpec {
  element: number;
  tier: number;
  currentUses: number;
  maxUses: number;
  xp: number;
}

export class BattleRoom extends Room<{ state: BattleState }> {
  private impactTime: number = 0;
  private defenseSubmitted: boolean = false;
  private defenseSlotKey: DefenseSlot | '' = '';
  private defensePressTime: number = 0;
  private windowTimer: ReturnType<typeof setTimeout> | null = null;
  /** Non-null only in vsAI (`battle-ai`) rooms; a no-op via notifyAI() in PvP. */
  private ai: AIController | null = null;

  /** Maps Colyseus sessionId → DB player id (only present for authenticated humans). */
  private sessionToPlayerId = new Map<string, string>();
  /** Maps Colyseus sessionId → ring id per slot (null when slot used default). */
  private sessionToRingIds = new Map<string, Record<SlotKey, string | null>>();
  /** Guard: persistBattleResult() runs exactly once per room lifetime. */
  private ended = false;

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

    if (options.vsAI) {
      const personality = options.personality ?? 'AGGRESSIVE';
      const seed = options.aiSeed ?? (Date.now() & 0xffffffff);
      this.seatPlayer(AI_ID, personality);
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
   */
  private seatPlayer(
    id: string,
    displayName: string,
    spec?: Partial<Record<SlotKey, SlotSpec>>,
  ): void {
    const ps = new PlayerState();
    ps.playerId = id;
    ps.displayName = displayName;
    ps.hearts = STARTING_HEARTS;

    for (const key of Object.keys(DEFAULT_LOADOUT) as SlotKey[]) {
      const ring = ps.getSlot(key);
      const slotSpec = spec?.[key];
      const element = slotSpec ? slotSpec.element : DEFAULT_LOADOUT[key];
      const currentUses = slotSpec ? slotSpec.currentUses : STARTING_USES;
      const maxUses = slotSpec ? slotSpec.maxUses : STARTING_USES;
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
    StakeResolver.applySetupPassive(ps);
  }

  onJoin(client: Client, options: BattleRoomOptions = {}): void {
    const sessionId = client.sessionId;

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

      this.seatPlayer(sessionId, '', spec);
      this.sessionToPlayerId.set(sessionId, playerId);
      this.sessionToRingIds.set(sessionId, ringIds);

      // Escrow the thumb ring for staking.
      if (ringIds.thumb) {
        PlayerRepo.setEscrowed(ringIds.thumb, true);
      }
    } else {
      // No/invalid token: seat with default loadout (backward-compat for E2E / integration tests).
      this.seatPlayer(sessionId, '');
    }

    if (this.ai) {
      void this.lock();
    }

    if (this.state.players.size === 2) {
      const ids = Array.from(this.state.players.keys());
      this.state.currentAttackerId = ids[0];
      this.state.phase = 'ATTACK_SELECT';
      this.checkAttackForfeit();
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

  /** A player can still attack iff at least one of their attack rings is lit. */
  private hasUsableAttack(ps: PlayerState): boolean {
    return !ps.a1.isExtinguished || !ps.a2.isExtinguished;
  }

  /**
   * GDD §6.6 forfeit: if the current attacker begins their turn with both A1 and
   * A2 extinguished, they immediately forfeit and the opponent wins. Spending all
   * attack-ring uses is a loss condition even with hearts remaining. Call at the
   * top of every ATTACK_SELECT entry (whoever is the current attacker forfeits).
   *
   * Does NOT notify the AI itself: every call site fires this.notifyAI()
   * unconditionally on the next line, which broadcasts the resulting phase
   * (ENDED or ATTACK_SELECT) exactly once.
   */
  private checkAttackForfeit(): void {
    const state = this.state;
    const attackerId = state.currentAttackerId;
    const ids = Array.from(state.players.keys());
    const defenderId = ids.find((id) => id !== attackerId)!;
    if (!this.hasUsableAttack(state.players.get(attackerId)!)) {
      state.winnerId = defenderId;
      state.phase = 'ENDED';
      this.finalizeEnded();
    }
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
          const usesSpent = ring.maxUses - ring.currentUses;
          if (usesSpent > 0) PlayerRepo.awardXP(ringId, usesSpent * XP_PER_USE);
        }

        if (sessionId === winnerId) PlayerRepo.addGold(playerId, GOLD_PER_WIN);
      }

      // Staking transfer (GDD §9.1 — loser ALWAYS forfeits the thumb ring).
      const loserPlayerId = loserId ? this.sessionToPlayerId.get(loserId) : undefined;
      const winnerPlayerId = winnerId ? this.sessionToPlayerId.get(winnerId) : undefined;
      const loserThumbRingId = loserId
        ? this.sessionToRingIds.get(loserId)?.thumb
        : undefined;

      if (loserPlayerId && loserThumbRingId) {
        if (winnerPlayerId) {
          PlayerRepo.transferRing(loserThumbRingId, loserPlayerId, winnerPlayerId);
        } else {
          // vsAI: winner has no DB record — just delete the ring.
          PlayerRepo.forfeitRing(loserThumbRingId, loserPlayerId);
        }
      } else if (!loserPlayerId && winnerPlayerId && loserId) {
        // vsAI win: AI has no DB ring to transfer, so grant the winner a new
        // ring matching the AI's thumb element (GDD §9.1).
        const aiPs = this.state.players.get(loserId);
        if (aiPs) {
          const t = aiPs.thumb;
          PlayerRepo.grantRing(winnerPlayerId, t.element, t.tier, t.maxUses, t.xp);
        }
      }

      // Release escrow on every human thumb ring still escrowed.
      for (const sessionId of sessions) {
        const tid = this.sessionToRingIds.get(sessionId)?.thumb;
        if (tid) PlayerRepo.setEscrowed(tid, false);
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

    // Tailwind passive: Wind thumb pays the use cost instead of the attack ring.
    const usePaidByStake = StakeResolver.applyTailwind(attacker, ring);
    if (!usePaidByStake) {
      ring.currentUses = Math.max(0, ring.currentUses - 1);
      ring.isExtinguished = ring.currentUses === 0;
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

    if (!this.defenseSubmitted) {
      this.defenseSubmitted = true;
      this.defenseSlotKey = payload.slot;
      // Server-authoritative timing: timestamp on message ARRIVAL.
      this.defensePressTime = Date.now();
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

    // Deep Roots passive: Wood thumb absorbs a heart loss for the defender.
    if (result.defenderHeartLost && !StakeResolver.applyDeepRoots(defenderPlayer)) {
      defenderPlayer.hearts = Math.max(0, defenderPlayer.hearts - 1);
    }
    if (result.attackerHeartLost && !StakeResolver.applyDeepRoots(attackerPlayer)) {
      attackerPlayer.hearts = Math.max(0, attackerPlayer.hearts - 1);
    }

    // Wellspring passive: Water thumb refunds the defender ring use on a rally.
    if (result.rallyContinues && defenderRing) {
      StakeResolver.applyWellspring(defenderPlayer, defenderRing);
    }

    // Increment the defender's matching triangle gauges (FIRE/WATER/WOOD), capped
    // at 8 (2x the GDD §6.1 threshold of 4). Fusions can fill two gauges at once.
    for (const el of result.gaugeElements) {
      if (el === ElementEnum.FIRE) defenderPlayer.fireGauge = Math.min(8, defenderPlayer.fireGauge + 1);
      else if (el === ElementEnum.WATER) defenderPlayer.waterGauge = Math.min(8, defenderPlayer.waterGauge + 1);
      else if (el === ElementEnum.WOOD) defenderPlayer.woodGauge = Math.min(8, defenderPlayer.woodGauge + 1);
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
      gaugeElements: result.gaugeElements,
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
      // Rally stays in DEFEND_WINDOW — checkAttackForfeit fires at the
      // ATTACK_SELECT entry after this rally resolves, never mid-rally.
      this.notifyAI();
    } else {
      // Normal: swap roles, go to ATTACK_SELECT.
      state.currentAttackerId = defenderId;
      state.attackerSlot = '';
      state.defenderSlot = '';
      state.rallyActive = false;
      state.volleyedElement = 0;
      state.phase = 'ATTACK_SELECT';
      this.checkAttackForfeit();
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
