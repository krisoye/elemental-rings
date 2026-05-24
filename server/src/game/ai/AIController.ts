import { AIPersonality, SelectAttackPayload, SubmitDefensePayload } from '../../../../shared/types';
import { BattleState } from '../../schemas/BattleState';
import { AI_PROFILES, AIProfile, makeRng, Rng, isLowHearts } from './AIProfiles';
import { decideAttack, decideDefense, BoardView, RingView } from './AIPolicy';
import { BLOCK_WINDOW_MS } from '../constants';

/**
 * Structural interface for the bits of BattleRoom the AI drives. Declared here
 * (rather than importing BattleRoom) to avoid a circular import — BattleRoom
 * imports AIController.
 */
export interface AIRoomHandle {
  readonly state: BattleState;
  readonly currentImpactTime: number;
  handleSelectAttack(id: string, payload: SelectAttackPayload): void;
  handleSubmitDefense(id: string, payload: SubmitDefensePayload): void;
}

/**
 * Wires the pure AIPolicy to a live BattleRoom. The AI is a virtual player: it
 * has no Colyseus client, so it calls the room's sessionId-keyed handler methods
 * directly — the exact same code path a human's `selectAttack` / `submitDefense`
 * messages take. A single pending timer models the AI's think-delay (as
 * attacker) or its scheduled press (as defender); it is cleared on every phase
 * entry and on dispose.
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
    const hand: RingView[] = me.hand.map((r) => ({
      element: r.element,
      currentUses: r.currentUses,
      isExtinguished: r.isExtinguished,
    }));

    // Incoming element when defending: the current attacker's selected ring.
    let incomingElement = -1;
    if (state.currentAttackerId !== this.aiId) {
      const attacker = state.players.get(state.currentAttackerId);
      const ring = attacker?.hand[state.attackerSelectedSlot];
      if (ring) incomingElement = ring.element;
    }

    // Elements the opponent still holds a usable ring for (full info on the
    // server; the AI is permitted to read the authoritative board).
    const opponentUsableElements: number[] = [];
    for (const [id, ps] of state.players) {
      if (id === this.aiId) continue;
      for (const r of ps.hand) {
        if (!r.isExtinguished && r.currentUses > 0) opponentUsableElements.push(r.element);
      }
    }

    return {
      hand,
      hearts: me.hearts,
      incomingElement,
      opponentUsableElements,
      committedElement: this.committedElement,
    };
  }

  private scheduleAttack(): void {
    const view = this.readBoard();
    const low = isLowHearts(this.profile, view.hearts);
    const minMs = low ? this.profile.lowHeartThinkDelayMinMs : this.profile.thinkDelayMinMs;
    const maxMs = low ? this.profile.lowHeartThinkDelayMaxMs : this.profile.thinkDelayMaxMs;
    const delay = this.rng.intBetween(minMs, maxMs);

    this.pending = setTimeout(() => {
      this.pending = null;
      // Re-read in case state shifted while we "thought".
      const v = this.readBoard();
      const decision = decideAttack(v, this.profile, this.rng);
      this.committedElement = decision.committedElement;
      this.room.handleSelectAttack(this.aiId, { slot: decision.slot });
    }, delay);
  }

  private scheduleDefense(): void {
    const view = this.readBoard();
    const decision = decideDefense(view, this.profile, this.rng);
    if (decision.pressOffsetMs === null || decision.slot < 0) return; // deliberate no-block

    const jittered = decision.pressOffsetMs + this.timingJitter(view.hearts);
    // Clamp so an intended catch lands before the resolve fires (offset < the
    // BLOCK shell). The resolve timer fires at impact + BLOCK_WINDOW_MS; landing
    // after it is harmless (becomes an effective no-block) but we avoid it.
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
