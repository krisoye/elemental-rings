import Phaser from 'phaser';
import { Hand } from '../objects/Hand';
import { Orb } from '../objects/Orb';
import { PlayerDuelist } from '../objects/PlayerDuelist';
import { OpponentDuelist } from '../objects/OpponentDuelist';
import { Hud } from '../objects/Hud';
import type { ExchangeResultPayload } from '../../../shared/types';
import { PLAYER_X, PLAYER_Y, OPPONENT_X, OPPONENT_Y } from '../Constants';

/**
 * The duel view. Owns every game object and routes input to server messages.
 * It never resolves combat locally: on `selectAttack` / `submitDefense` it sends
 * to the server and re-renders from the broadcast BattleState and the
 * `exchangeResult` event.
 */
export class BattleScene extends Phaser.Scene {
  private hand!: Hand;
  private playerDuelist!: PlayerDuelist;
  private opponentDuelist!: OpponentDuelist;
  private hud!: Hud;
  revealedOpponentElements: Set<number> = new Set();
  private prevPhase = '';
  private prevRallyActive = false;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(): void {
    // Reset per-start state (scene may be re-entered on a rematch).
    this.revealedOpponentElements = new Set();
    this.prevPhase = '';
    this.prevRallyActive = false;
  }

  create(): void {
    window.__scene = this;

    const room = window.__room!;
    const myId = room.sessionId;

    this.playerDuelist = new PlayerDuelist(this);
    this.opponentDuelist = new OpponentDuelist(this);
    this.hud = new Hud(this);
    this.hand = new Hand(this, (slot) => this.onSlotPressed(slot));

    // The room outlives this scene, so clear any state-change listeners left by
    // a previous scene (LobbyScene / a prior BattleScene) before adding ours.
    room.onStateChange.clear();

    const onState = (state: any): void => {
      this.hand.updateFromState(state, myId);
      this.playerDuelist.updateFromState(state.players.get(myId));
      this.opponentDuelist.updateFromState(state, myId, this.revealedOpponentElements);
      this.hud.updateFromState(state, myId);
      this.checkPhaseTransition(state, myId);
    };
    room.onStateChange(onState);

    // onMessage returns its own unregister function.
    const offExchange = room.onMessage('exchangeResult', (result: ExchangeResultPayload) => {
      window.__lastExchangeResult = result;
      this.recordRevealedElements(result, myId);
    });

    this.events.once('shutdown', () => {
      room.onStateChange.remove(onState);
      offExchange();
      window.__scene = null;
    });
  }

  /** Track which opponent elements have become visible this duel. */
  private recordRevealedElements(result: ExchangeResultPayload, myId: string): void {
    if (result.attackerId !== myId) {
      // Opponent attacked — reveal the element(s) they threw.
      result.attackerElements.forEach((el) => this.revealedOpponentElements.add(el));
    } else if (result.defenderSlot >= 0) {
      // We attacked and the opponent blocked — reveal the ring they defended with.
      const oppState = window.__room!.state.players.get(result.defenderId);
      const ring = oppState?.hand[result.defenderSlot];
      if (ring) this.revealedOpponentElements.add(ring.element);
    }
  }

  private onSlotPressed(slot: number): void {
    const state = window.__room?.state;
    const myId = window.__room?.sessionId;
    if (!state || !myId) return;

    if (state.phase === 'ATTACK_SELECT' && state.currentAttackerId === myId) {
      window.__room!.send('selectAttack', { slot });
    } else if (state.phase === 'DEFEND_WINDOW' && state.currentAttackerId !== myId) {
      // pressTime is retained for future lag comp; the server timestamps on arrival.
      window.__room!.send('submitDefense', { slot, pressTime: Date.now() });
    }
  }

  /** Launch the orb telegraph when a defend window opens, including rally volleys. */
  private checkPhaseTransition(state: any, myId: string): void {
    const phaseChanged = state.phase !== this.prevPhase;
    // A rally keeps phase=DEFEND_WINDOW but flips rallyActive true — Colyseus
    // batches RESOLVE→DEFEND_WINDOW into one patch so prevPhase stays DEFEND_WINDOW.
    const rallyStarted = state.rallyActive && !this.prevRallyActive;

    this.prevPhase = state.phase;
    this.prevRallyActive = state.rallyActive;

    if (state.phase === 'DEFEND_WINDOW' && (phaseChanged || rallyStarted)) {
      const imAttacker = state.currentAttackerId === myId;
      const from = imAttacker ? { x: PLAYER_X, y: PLAYER_Y } : { x: OPPONENT_X, y: OPPONENT_Y };
      const to   = imAttacker ? { x: OPPONENT_X, y: OPPONENT_Y } : { x: PLAYER_X, y: PLAYER_Y };

      const attackerState = window.__room!.state.players.get(state.currentAttackerId);
      const attackerRing = attackerState?.hand[state.attackerSelectedSlot];
      const elements = attackerRing ? [attackerRing.element] : [0];
      Orb.launch(this, elements, from, to);
    }
  }
}
