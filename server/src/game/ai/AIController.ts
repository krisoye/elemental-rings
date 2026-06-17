import {
  AIPersonality,
  SelectAttackPayload,
  SelectDoubleAttackPayload,
  SubmitDefensePayload,
  RechargePayload,
  SlotKey,
  AttackSlot,
  ChargeStartPayload,
  ReleaseAttackPayload,
} from '../../../../shared/types';
import { sweepHoldMs } from '../../../../shared/oscillation';
import { BASE_SWEEP_MS, SWEEP_SPEEDUP } from '../../../../shared/chargeConstants';
import { BattleState } from '../../schemas/BattleState';
import { canDoubleAttack } from '../DoubleAttack';
import { AI_PROFILES, AIProfile, makeRng, Rng, isLowHearts } from './AIProfiles';
import {
  decideAttack,
  decideDefense,
  decideRecharge,
  BoardView,
  AttackSlotView,
  DefenseSlotView,
} from './AIPolicy';
import { BLOCK_WINDOW_MS, MAX_COMBO_GAP_MS } from '../constants';

/** EPIC #265 — poll interval (ms) for detecting orb 2's launch as AI defender. */
const ORB2_POLL_MS = 50;

/**
 * Structural interface for the bits of BattleRoom the AI drives. Declared here
 * (rather than importing BattleRoom) to avoid a circular import.
 */
export interface AIRoomHandle {
  readonly state: BattleState;
  readonly currentImpactTime: number;
  // EPIC #265 — fusion-thumb double attack. comboInFlight is true while a two-orb
  // combo is airborne; currentImpact2Time is orb 2's impact (impact1 + gapMs). The
  // AI uses these to schedule a SECOND defense press when defending a double attack.
  readonly comboInFlight: boolean;
  readonly currentImpact2Time: number;
  /** Remaining NPC spirit pool (BattleRoom-owned). 0 once exhausted. */
  readonly npcSpirit: number;
  handleSelectAttack(id: string, payload: SelectAttackPayload): void;
  // EPIC #268 — AI double-attack OFFENSE. When an eligible boss decides to combo,
  // the controller calls this (the same handler a human's `selectDoubleAttack`
  // message reaches), mirroring how handleSelectAttack is called for a single throw.
  handleSelectDoubleAttack(id: string, payload: SelectDoubleAttackPayload): void;
  // #493 — AI charged attack. Record hold-start timestamp (same path as human chargeStart).
  handleChargeStart(id: string, payload: ChargeStartPayload): void;
  // #493 — AI charged release. Resolves using the stored chargeStart timestamp.
  handleReleaseAttack(id: string, payload: ReleaseAttackPayload): void;
  handleSubmitDefense(id: string, payload: SubmitDefensePayload): void;
  handleRecharge(id: string, payload: RechargePayload): void;
  handleForfeit(id: string): void;
}

/**
 * Wires the pure AIPolicy to a live BattleRoom. The AI is a virtual player with
 * no Colyseus client, so it calls the room's sessionId-keyed handler methods
 * directly — the exact same code path a human's messages take. A single pending
 * timer models the think-delay (as attacker) or the scheduled press (as
 * defender); it is cleared on every phase entry and on dispose.
 */
/**
 * #259 — boss phase-2 enrage. When the boss's hearts drop to ≤ `threshold`, the
 * controller swaps to `profile` (a sharper enraged profile built by BattleRoom)
 * and, if `aggressive`, drives attack selection like AGGRESSIVE (chase counters).
 */
export interface EnrageConfig {
  threshold: number;
  profile: AIProfile;
  aggressive: boolean;
}

export class AIController {
  /** Base (or #258 boss-modified) combat profile, used while NOT enraged. */
  private readonly baseProfile: AIProfile;
  private readonly enrage: EnrageConfig | null;
  private readonly rng: Rng;
  private pending: ReturnType<typeof setTimeout> | null = null;
  /**
   * EPIC #265 — a SECOND pending timer used only when defending a fusion-thumb
   * double attack: orb 1's press is scheduled on `pending`, orb 2's on `pending2`.
   * Cleared alongside `pending` on every phase entry and on dispose.
   */
  private pending2: ReturnType<typeof setTimeout> | null = null;
  /** STATUS_HUNTER commits to one element across turns; persisted here. */
  private committedElement = -1;

  constructor(
    private readonly room: AIRoomHandle,
    private readonly aiId: string,
    private readonly personality: AIPersonality,
    seed: number,
    profileOverride?: AIProfile,
    enrage?: EnrageConfig,
  ) {
    // #258 — a boss room passes a tier-modified profile (tighter σ / lower no-block
    // / faster think) so the boss fights sharper than a roamer of the same
    // personality. Omitted for normal duels → the unmodified per-personality
    // profile, no behaviour change.
    this.baseProfile = profileOverride ?? AI_PROFILES[personality];
    // #259 — enrage config (major boss only). Disabled when threshold ≤ 0.
    this.enrage = enrage && enrage.threshold > 0 ? enrage : null;
    this.rng = makeRng(seed);
  }

  /** True when this boss is currently enraged (hearts ≤ threshold). */
  private isEnraged(): boolean {
    if (!this.enrage) return false;
    const me = this.room.state.players.get(this.aiId);
    return !!me && me.hearts <= this.enrage.threshold;
  }

  /** The profile in force right now: enraged when enraged, else the base. */
  private get profile(): AIProfile {
    return this.isEnraged() && this.enrage ? this.enrage.profile : this.baseProfile;
  }

  /** Personality driving attack selection: AGGRESSIVE while enraged-aggressive. */
  private get attackPersonality(): AIPersonality {
    return this.isEnraged() && this.enrage?.aggressive ? 'AGGRESSIVE' : this.personality;
  }

  /**
   * Called after every phase transition (no-op in PvP rooms). Always clears any
   * pending timer first so a stale schedule can never fire into a new phase.
   */
  onPhaseEnter(phase: string): void {
    this.clearPending();
    if (phase === 'ENDED') return;

    const state = this.room.state;
    if (phase === 'ATTACK_SELECT' && state.currentAttackerId === this.aiId) {
      this.scheduleAttack();
    } else if (phase === 'DEFEND_WINDOW' && state.currentAttackerId !== this.aiId) {
      this.scheduleDefense();
    }
  }

  dispose(): void {
    this.clearPending();
  }

  private clearPending(): void {
    if (this.pending) {
      clearTimeout(this.pending);
      this.pending = null;
    }
    if (this.pending2) {
      clearTimeout(this.pending2);
      this.pending2 = null;
    }
  }

  /** Build the read-only board snapshot the policy reasons over. */
  private readBoard(): BoardView {
    const state = this.room.state;
    const me = state.players.get(this.aiId)!;

    const attackSlots: AttackSlotView[] = (['a1', 'a2'] as const).map((key) => {
      const r = me.getSlot(key);
      return {
        key,
        ring: {
          element: r.element,
          currentUses: r.currentUses,
          maxUses: r.maxUses,
          isExtinguished: r.isExtinguished,
        },
      };
    });
    const defenseSlots: DefenseSlotView[] = (['d1', 'd2'] as const).map((key) => {
      const r = me.getSlot(key);
      return {
        key,
        ring: {
          element: r.element,
          currentUses: r.currentUses,
          maxUses: r.maxUses,
          isExtinguished: r.isExtinguished,
        },
      };
    });

    // Incoming element when defending: the current attacker's firing ring.
    let incomingElement = -1;
    if (state.currentAttackerId !== this.aiId && state.attackerSlot) {
      const attacker = state.players.get(state.currentAttackerId);
      if (attacker) incomingElement = attacker.getSlot(state.attackerSlot as SlotKey).element;
    }

    // Elements the opponent still holds a usable ring for (full info on the
    // server; the AI is permitted to read the authoritative board). Only the
    // four combat slots count — the thumb is passive. EPIC #268 — also snapshot the
    // opponent's TWO defense rings (d1/d2) so the policy can judge whether a double
    // attack is favorable (can the defender PARRY orb 1 and cancel/flip the combo?).
    const opponentUsableElements: number[] = [];
    const opponentDefenseSlots: DefenseSlotView[] = [];
    for (const [id, ps] of state.players) {
      if (id === this.aiId) continue;
      for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
        const r = ps.getSlot(key);
        if (!r.isExtinguished && r.currentUses > 0) opponentUsableElements.push(r.element);
      }
      for (const key of ['d1', 'd2'] as const) {
        const r = ps.getSlot(key);
        opponentDefenseSlots.push({
          key,
          ring: {
            element: r.element,
            currentUses: r.currentUses,
            maxUses: r.maxUses,
            isExtinguished: r.isExtinguished,
          },
        });
      }
    }

    return {
      attackSlots,
      defenseSlots,
      hearts: me.hearts,
      incomingElement,
      opponentUsableElements,
      committedElement: this.committedElement,
      // EPIC #268 — authoritative eligibility for THIS AI's fusion-thumb combo.
      // False for every base-thumb AI, so the policy's double-attack branch is dead
      // code for non-bosses (they keep single-attacking).
      canDoubleAttack: canDoubleAttack(me),
      opponentDefenseSlots,
      spirit: this.room.npcSpirit,
    };
  }

  private scheduleAttack(): void {
    const view = this.readBoard();

    // GDD §6.3 (#197): recharge policy. Before attacking, the AI checks whether it
    // should spend the turn restoring a combat ring instead. When both attack rings
    // are spent AND spirit remains it MUST recharge; some personalities also recharge
    // a depleted defense ring. When spirit is exhausted AND no attack uses remain the
    // AI forfeits — it can no longer sustain the fight.
    const rechargeDecision = decideRecharge(view, this.profile);
    if (rechargeDecision) {
      const delay = process.env.E2E_FAST === '1' ? 20 : 300;
      this.pending = setTimeout(() => {
        this.pending = null;
        this.room.handleRecharge(this.aiId, { slot: rechargeDecision.slot });
      }, delay);
      return;
    }

    // No recharge — check whether we have any attack uses left. If the AI's spirit
    // is exhausted AND both attack rings are spent, decideRecharge returned null
    // because it cannot recharge, not because it chose to attack. Forfeit.
    const canAttack = view.attackSlots.some(s => s.ring.currentUses > 0 && !s.ring.isExtinguished);
    if (!canAttack) {
      const delay = process.env.E2E_FAST === '1' ? 20 : 300;
      this.pending = setTimeout(() => {
        this.pending = null;
        this.room.handleForfeit(this.aiId);
      }, delay);
      return;
    }

    // E2E_FAST collapses AI think time so vsAI duels complete within the
    // driveAiDuel timeout (10 s) despite parallel-worker CPU contention.
    // Normal think delays (300–1500 ms) would push a 3-heart duel past 10 s
    // under TELEGRAPH_MS=150; 20–50 ms keeps each turn ~400 ms or less.
    const fast = process.env.E2E_FAST === '1';
    const low = isLowHearts(this.profile, view.hearts);
    const minMs = fast ? 20 : (low ? this.profile.lowHeartThinkDelayMinMs : this.profile.thinkDelayMinMs);
    const maxMs = fast ? 50 : (low ? this.profile.lowHeartThinkDelayMaxMs : this.profile.thinkDelayMaxMs);
    const delay = this.rng.intBetween(minMs, maxMs);

    this.pending = setTimeout(() => {
      this.pending = null;
      const v = this.readBoard();
      // #259 — while enraged-aggressive the boss SELECTS attacks like AGGRESSIVE
      // (chase counters), keeping the enraged profile's timing fields. Off-enrage
      // (or non-aggressive enrage) this is just the active profile unchanged.
      const attackProfile =
        this.profile.personality === this.attackPersonality
          ? this.profile
          : { ...this.profile, personality: this.attackPersonality };
      const decision = decideAttack(v, attackProfile, this.rng);
      this.committedElement = decision.committedElement;
      // #493 — charged attack: send chargeStart, wait holdMs, then release.
      if (decision.charge) {
        const slot = decision.slot;
        const targetSweep = decision.charge.targetSweep;
        this.room.handleChargeStart(this.aiId, { slot });
        const releaseDeg = this.rng.normal() * this.profile.chargeReleaseSigmaDeg;
        const holdMs = sweepHoldMs(targetSweep, releaseDeg, BASE_SWEEP_MS, SWEEP_SPEEDUP);
        this.pending = setTimeout(() => {
          this.pending = null;
          this.room.handleReleaseAttack(this.aiId, { slot, holdDuration: holdMs });
        }, holdMs);
      // EPIC #268 — when the policy chose a fusion-thumb DOUBLE attack (eligible +
      // favorable; only ever set for a boss hand), fire both orbs via the same
      // server handler a human's `selectDoubleAttack` reaches. Otherwise the normal
      // single-attack path. The server re-validates eligibility and re-clamps gapMs.
      } else if (decision.double) {
        this.room.handleSelectDoubleAttack(this.aiId, decision.double);
      } else {
        this.room.handleSelectAttack(this.aiId, { slot: decision.slot });
      }
    }, delay);
  }

  private scheduleDefense(): void {
    // Orb 1 (or the only orb of a single attack): decide + schedule on `pending`.
    this.scheduleOnePress(this.room.currentImpactTime, (t) => {
      this.pending = t;
    });

    // EPIC #265 — when defending a fusion-thumb double attack, schedule a SECOND
    // independent defense press for orb 2 against its own impact (impact2 =
    // impact1 + gapMs). Orb 2 launches gapMs AFTER orb 1, so its impact may not be
    // known yet at this DEFEND_WINDOW entry; defer until comboInFlight reports orb
    // 2 airborne (currentImpact2Time set), polling a few times across the gap.
    if (this.room.comboInFlight) {
      this.scheduleOrb2Defense(0);
    }
  }

  /**
   * Schedule one defense press against `impactTime`: re-read the live board,
   * decide via the policy, and (unless it's a deliberate no-block) fire a
   * `submitDefense` at the jittered intended offset. The chosen timer handle is
   * handed to `assign` so the caller stores it in the right slot (pending /
   * pending2). A no-block leaves the slot empty.
   */
  private scheduleOnePress(
    impactTime: number,
    assign: (t: ReturnType<typeof setTimeout>) => void,
  ): void {
    const view = this.readBoard();
    const decision = decideDefense(view, this.profile, this.rng);
    if (decision.slot === null || decision.pressOffsetMs === null) return; // deliberate no-block

    const jittered = decision.pressOffsetMs + this.timingJitter(view.hearts);
    const clamped = Math.min(jittered, BLOCK_WINDOW_MS - 1);
    const fireInMs = impactTime - Date.now() + clamped;
    const slot = decision.slot;
    const handle = setTimeout(() => {
      this.room.handleSubmitDefense(this.aiId, { slot, pressTime: Date.now() });
    }, Math.max(0, fireInMs));
    assign(handle);
  }

  /**
   * EPIC #265 — defer orb 2's defense scheduling until its impact is known. Orb 2
   * launches gapMs after orb 1, so currentImpact2Time is 0 at the combo's start;
   * poll across the clamped gap window until it is set, then schedule the press on
   * `pending2`. Bails if the combo ended (no longer in flight) before orb 2 flew.
   */
  private scheduleOrb2Defense(attempt: number): void {
    // Cap the poll attempts: orb 2 launches gapMs (≤ MAX_COMBO_GAP_MS = 600) after
    // orb 1, so a 50ms poll covering MAX_COMBO_GAP_MS + a margin always observes it.
    const maxAttempts = Math.ceil((MAX_COMBO_GAP_MS + 200) / ORB2_POLL_MS);
    if (attempt > maxAttempts) return;
    if (!this.room.comboInFlight) return; // orb 1 parried/KO'd → orb 2 cancelled

    const impact2 = this.room.currentImpact2Time;
    if (impact2 <= 0) {
      // Orb 2 not airborne yet — poll again shortly.
      this.pending2 = setTimeout(() => this.scheduleOrb2Defense(attempt + 1), ORB2_POLL_MS);
      return;
    }
    this.scheduleOnePress(impact2, (t) => {
      this.pending2 = t;
    });
  }

  /** Gaussian timing error around the intended offset, in ms. */
  private timingJitter(hearts: number): number {
    const sigma = isLowHearts(this.profile, hearts)
      ? this.profile.lowHeartTimingSigmaMs
      : this.profile.timingSigmaMs;
    return this.rng.normal() * sigma;
  }
}
