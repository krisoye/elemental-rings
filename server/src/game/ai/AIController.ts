import {
  AIPersonality,
  SelectAttackPayload,
  SubmitDefensePayload,
  SlotKey,
} from '../../../../shared/types';
import { BattleState } from '../../schemas/BattleState';
import { AI_PROFILES, AIProfile, makeRng, Rng, isLowHearts } from './AIProfiles';
import {
  decideAttack,
  decideDefense,
  BoardView,
  AttackSlotView,
  DefenseSlotView,
} from './AIPolicy';
import { BLOCK_WINDOW_MS } from '../constants';

/**
 * Structural interface for the bits of BattleRoom the AI drives. Declared here
 * (rather than importing BattleRoom) to avoid a circular import.
 */
export interface AIRoomHandle {
  readonly state: BattleState;
  readonly currentImpactTime: number;
  handleSelectAttack(id: string, payload: SelectAttackPayload): void;
  handleSubmitDefense(id: string, payload: SubmitDefensePayload): void;
}

/**
 * Wires the pure AIPolicy to a live BattleRoom. The AI is a virtual player with
 * no Colyseus client, so it calls the room's sessionId-keyed handler methods
 * directly — the exact same code path a human's messages take. A single pending
 * timer models the think-delay (as attacker) or the scheduled press (as
 * defender); it is cleared on every phase entry and on dispose.
 */
export class AIController {
  private readonly profile: AIProfile;
  private readonly rng: Rng;
  private pending: ReturnType<typeof setTimeout> | null = null;
  /** STATUS_HUNTER commits to one element across turns; persisted here. */
  private committedElement = -1;

  constructor(
    private readonly room: AIRoomHandle,
    private readonly aiId: string,
    personality: AIPersonality,
    seed: number,
  ) {
    this.profile = AI_PROFILES[personality];
    this.rng = makeRng(seed);
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
  }

  /** Build the read-only board snapshot the policy reasons over. */
  private readBoard(): BoardView {
    const state = this.room.state;
    const me = state.players.get(this.aiId)!;

    const attackSlots: AttackSlotView[] = (['a1', 'a2'] as const).map((key) => {
      const r = me.getSlot(key);
      return { key, ring: { element: r.element, currentUses: r.currentUses, isExtinguished: r.isExtinguished } };
    });
    const defenseSlots: DefenseSlotView[] = (['d1', 'd2'] as const).map((key) => {
      const r = me.getSlot(key);
      return { key, ring: { element: r.element, currentUses: r.currentUses, isExtinguished: r.isExtinguished } };
    });

    // Incoming element when defending: the current attacker's firing ring.
    let incomingElement = -1;
    if (state.currentAttackerId !== this.aiId && state.attackerSlot) {
      const attacker = state.players.get(state.currentAttackerId);
      if (attacker) incomingElement = attacker.getSlot(state.attackerSlot as SlotKey).element;
    }

    // Elements the opponent still holds a usable ring for (full info on the
    // server; the AI is permitted to read the authoritative board). Only the
    // four combat slots count — the thumb is passive.
    const opponentUsableElements: number[] = [];
    for (const [id, ps] of state.players) {
      if (id === this.aiId) continue;
      for (const key of ['a1', 'a2', 'd1', 'd2'] as const) {
        const r = ps.getSlot(key);
        if (!r.isExtinguished && r.currentUses > 0) opponentUsableElements.push(r.element);
      }
    }

    return {
      attackSlots,
      defenseSlots,
      hearts: me.hearts,
      incomingElement,
      opponentUsableElements,
      committedElement: this.committedElement,
    };
  }

  private scheduleAttack(): void {
    const view = this.readBoard();
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
      const decision = decideAttack(v, this.profile, this.rng);
      this.committedElement = decision.committedElement;
      this.room.handleSelectAttack(this.aiId, { slot: decision.slot });
    }, delay);
  }

  private scheduleDefense(): void {
    const view = this.readBoard();
    const decision = decideDefense(view, this.profile, this.rng);
    if (decision.slot === null || decision.pressOffsetMs === null) return; // deliberate no-block

    const jittered = decision.pressOffsetMs + this.timingJitter(view.hearts);
    const clamped = Math.min(jittered, BLOCK_WINDOW_MS - 1);
    const fireInMs = this.room.currentImpactTime - Date.now() + clamped;
    const slot = decision.slot;
    this.pending = setTimeout(() => {
      this.pending = null;
      this.room.handleSubmitDefense(this.aiId, { slot, pressTime: Date.now() });
    }, Math.max(0, fireInMs));
  }

  /** Gaussian timing error around the intended offset, in ms. */
  private timingJitter(hearts: number): number {
    const sigma = isLowHearts(this.profile, hearts)
      ? this.profile.lowHeartTimingSigmaMs
      : this.profile.timingSigmaMs;
    return this.rng.normal() * sigma;
  }
}
