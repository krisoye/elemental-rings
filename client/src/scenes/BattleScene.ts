import Phaser from 'phaser';
import { Hand } from '../objects/Hand';
import { Orb } from '../objects/Orb';
import { PlayerDuelist } from '../objects/PlayerDuelist';
import { OpponentDuelist } from '../objects/OpponentDuelist';
import { Hud } from '../objects/Hud';
import type { ExchangeResultPayload, BattleSummaryPayload } from '../../../shared/types';
import {
  PLAYER_X,
  PLAYER_Y,
  OPPONENT_X,
  OPPONENT_Y,
  SlotKey,
  ringComponents,
} from '../Constants';

const ATTACK_KEYS: ReadonlySet<SlotKey> = new Set<SlotKey>(['a1', 'a2']);
const DEFENSE_KEYS: ReadonlySet<SlotKey> = new Set<SlotKey>(['d1', 'd2']);

// Compile-time flag injected by Vite (see client/vite.config.ts). True only in
// the E2E fast build; production bundles inline `false`.
declare const __E2E_FAST__: boolean;

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
  private returning = false;
  // #78 ② — post-battle reward summary. The server sends `battleSummary` after
  // the ENDED state patch, so the message can arrive before, after, or around
  // the moment checkEnded() renders the banner. We render the lines whenever both
  // the banner exists (bannerShown) and the summary has arrived; whichever
  // happens second triggers renderBattleSummary().
  private pendingBattleSummary: BattleSummaryPayload | null = null;
  private bannerShown = false;
  private summaryRendered = false;

  constructor() {
    super({ key: 'BattleScene' });
  }

  init(): void {
    // Reset per-start state (scene may be re-entered on a rematch).
    this.revealedOpponentElements = new Set();
    this.prevPhase = '';
    this.prevRallyActive = false;
    this.returning = false;
    this.pendingBattleSummary = null;
    this.bannerShown = false;
    this.summaryRendered = false;
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
      this.checkEnded(state, myId);
    };
    room.onStateChange(onState);
    // Colyseus onStateChange only fires on new patches from the server. For
    // instant-forfeit duels (e.g. aiUses:0, both attack rings extinguished before
    // the first ATTACK_SELECT), the room arrives ENDED and no further patch is
    // broadcast. Force an immediate check so checkEnded runs if state is already
    // ENDED before this listener was registered. checkEnded is idempotent (guarded
    // by `this.returning`) so double-firing on a later patch is harmless.
    onState(room.state as any);

    // onMessage returns its own unregister function.
    const offExchange = room.onMessage('exchangeResult', (result: ExchangeResultPayload) => {
      window.__lastExchangeResult = result;
      this.recordRevealedElements(result, myId);
    });

    // NOTE: the server's `wonRing` message (post-battle ring grant, #40) is
    // captured in connectToRoom() at the connection level, not here — a duel can
    // end before BattleScene mounts (e.g. an instant forfeit), so the listener
    // must outlive any single scene.

    // #78 ② — render the reward lines once both the banner and the summary are
    // ready. The summary may already have been captured at the connection level
    // before this scene mounted (Connection.ts stashes it on window), so seed
    // from there first, then keep listening for a later arrival.
    if (window.__lastBattleSummary) {
      this.pendingBattleSummary = window.__lastBattleSummary;
      this.renderBattleSummary();
    }
    const offSummary = room.onMessage('battleSummary', (payload: BattleSummaryPayload) => {
      this.pendingBattleSummary = payload;
      this.renderBattleSummary();
    });

    this.events.once('shutdown', () => {
      room.onStateChange.remove(onState);
      offExchange();
      offSummary();
      window.__scene = null;
    });
  }

  /** Track which opponent elements have become visible this duel. */
  private recordRevealedElements(result: ExchangeResultPayload, myId: string): void {
    if (result.attackerId !== myId) {
      // Opponent attacked — reveal the element(s) they threw.
      result.attackerElements.forEach((el) => this.revealedOpponentElements.add(el));
    } else if (result.defenderSlot) {
      // We attacked and the opponent blocked — reveal the ring they defended with.
      const oppState = window.__room!.state.players.get(result.defenderId);
      const ring = oppState?.[result.defenderSlot as SlotKey];
      if (ring) this.revealedOpponentElements.add(ring.element);
    }
  }

  /**
   * Phase-locked input. During ATTACK_SELECT only a1/a2 send `selectAttack`;
   * during DEFEND_WINDOW only d1/d2 send `submitDefense`. The server remains the
   * authoritative phase-lock; this is purely to avoid sending wrong-phase noise.
   */
  private onSlotPressed(slot: SlotKey): void {
    const state = window.__room?.state;
    const myId = window.__room?.sessionId;
    if (!state || !myId) return;

    if (state.phase === 'ATTACK_SELECT' && state.currentAttackerId === myId) {
      if (!ATTACK_KEYS.has(slot)) return;
      window.__room!.send('selectAttack', { slot });
    } else if (state.phase === 'DEFEND_WINDOW' && state.currentAttackerId !== myId) {
      if (!DEFENSE_KEYS.has(slot)) return;
      // pressTime is retained for future lag comp; the server timestamps on arrival.
      window.__room!.send('submitDefense', { slot, pressTime: Date.now() });
    }
  }

  /**
   * On phase ENDED, show a brief winner banner then return to the post-duel
   * destination. The er_pending_ring localStorage key (if set by Connection.ts on
   * a win) is picked up the next time the player returns to CampScene via "Return
   * to Sanctum". Guarded so it fires once.
   *
   * #88 — destination routing:
   *   - Overworld NPC duels (launched from ForestScene/SwampScene) record their
   *     origin biome + the player's world position in window.__duelOrigin. On END
   *     we return to that biome scene (which restores the player near {x,y}), and
   *     clear __duelOrigin so it is never reused.
   *   - Hub/marker duels leave __duelOrigin unset → return to the EncounterScene
   *     hub. We pass an EXPLICIT `{}` so Phaser overwrites settings.data (a no-data
   *     scene.start leaves the previous { npcId, personality } in place, which made
   *     EncounterScene re-launch the duel in an infinite loop — see #88 root cause).
   */
  private checkEnded(state: any, myId: string): void {
    if (state.phase !== 'ENDED' || this.returning) return;
    this.returning = true;

    const won = state.winnerId === myId;
    this.add
      .text(512, 288, won ? 'YOU WIN!' : 'YOU LOSE!', {
        fontSize: '48px',
        color: won ? '#44ff44' : '#ff4444',
        backgroundColor: '#000000aa',
        padding: { x: 20, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(1000);

    // #78 ② — the banner exists now; if the summary already arrived, render the
    // reward lines (else the onMessage handler will render once it does).
    this.bannerShown = true;
    this.renderBattleSummary();

    // #88 — resolve the post-duel destination. A biome origin returns to that
    // biome scene; anything else (unset, or 'EncounterScene') returns to the hub
    // with explicit empty data so no stale NPC-duel data is retained.
    const origin = window.__duelOrigin;
    const toBiome =
      origin && (origin.scene === 'ForestScene' || origin.scene === 'SwampScene')
        ? origin.scene
        : null;

    // Under E2E fast mode the 2s winner banner is pure dead time; collapse it to
    // ~0ms so duels return immediately (#68).
    const bannerMs = __E2E_FAST__ ? 0 : 2000;
    this.time.delayedCall(bannerMs, () => {
      if (toBiome) {
        // The biome scene reads __duelOrigin in its create() to restore the player
        // position, then clears it. Don't clear it here.
        this.scene.start(toBiome);
      } else {
        // Hub return — clear any stray origin and pass explicit empty data so
        // EncounterScene.init sees undefined personality → npcDuel=null → hub.
        window.__duelOrigin = null;
        this.scene.start('EncounterScene', {});
      }
    });
  }

  /**
   * Render the two reward lines (#78 ②) under the WIN/LOSE banner. Idempotent and
   * order-independent: it no-ops until BOTH the banner has been drawn
   * (bannerShown) and the server's `battleSummary` has arrived
   * (pendingBattleSummary), and only renders once (summaryRendered guard).
   */
  private renderBattleSummary(): void {
    if (this.summaryRendered) return;
    if (!this.pendingBattleSummary || !this.bannerShown) return;
    this.summaryRendered = true;

    const { goldGained, xpGained, aggregateXp } = this.pendingBattleSummary;
    // Below the y=288 banner (48px text + padding ≈ ±40px); depth 1001 keeps the
    // lines above the banner's depth-1000 background.
    this.add
      .text(512, 348, `+${goldGained} gold`, { fontSize: '18px', color: '#ffd700' })
      .setOrigin(0.5)
      .setDepth(1001);
    this.add
      .text(512, 378, `+${xpGained} XP  (total ${aggregateXp})`, {
        fontSize: '18px',
        color: '#88ffaa',
      })
      .setOrigin(0.5)
      .setDepth(1001);
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
      const attackerRing = state.attackerSlot ? attackerState?.[state.attackerSlot as SlotKey] : null;
      // Fusion rings show both component colors; base rings show one.
      const elements = attackerRing ? ringComponents(attackerRing) : [0];
      Orb.launch(this, elements, from, to);
    }
  }
}
