import Phaser from 'phaser';
import { Hand } from '../objects/Hand';
import { Orb } from '../objects/Orb';
import { PlayerDuelist } from '../objects/PlayerDuelist';
import { OpponentDuelist } from '../objects/OpponentDuelist';
import { Hud } from '../objects/Hud';
import { BattleEndModal } from '../objects/BattleEndModal';
import type {
  ExchangeResultPayload,
  RechargeResultPayload,
  BattleSummaryPayload,
} from '../../../shared/types';
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

// All battler_front sprites per element (index = ElementEnum: 0=FIRE…4=WOOD).
// Multiple variants let each encounter roll a different monster appearance.
const MONSTER_BATTLERS: readonly (readonly string[])[] = [
  // FIRE (0)
  [
    'assets/monsters/monster_fire_02_alt02_battler_front.png',
    'assets/monsters/monster_fire_02_alt03_battler_front.png',
    'assets/monsters/monster_fire_02_alt04_battler_front.png',
    'assets/monsters/monster_fire_03_alt01_battler_front.png',
    'assets/monsters/monster_fire_03_alt02_battler_front.png',
    'assets/monsters/monster_fire_03_alt03_battler_front.png',
    'assets/monsters/monster_fire_03_alt04_battler_front.png',
  ],
  // WATER (1)
  [
    'assets/monsters/monster_water_grass_19_alt01_battler_front.png',
    'assets/monsters/monster_water_grass_19_alt02_battler_front.png',
    'assets/monsters/monster_water_grass_19_alt03_battler_front.png',
  ],
  // EARTH (2)
  [
    'assets/monsters/monster_electro_ghost_14_alt01_battler_front.png',
    'assets/monsters/monster_electro_ghost_15_alt01_battler_front.png',
    'assets/monsters/monster_electro_ghost_16_alt01_battler_front.png',
  ],
  // WIND (3)
  [
    'assets/monsters/monster_water_fly_11_alt01_battler_front.png',
    'assets/monsters/monster_water_fly_11_alt02_battler_front.png',
    'assets/monsters/monster_water_fly_11_alt03_battler_front.png',
    'assets/monsters/monster_water_fly_11_alt04_battler_front.png',
    'assets/monsters/monster_water_fly_12_alt01_battler_front.png',
    'assets/monsters/monster_water_fly_12_alt02_battler_front.png',
    'assets/monsters/monster_water_fly_12_alt03_battler_front.png',
    'assets/monsters/monster_water_fly_12_alt04_battler_front.png',
    'assets/monsters/monster_water_fly_13_alt01_battler_front.png',
    'assets/monsters/monster_water_fly_13_alt02_battler_front.png',
    'assets/monsters/monster_water_fly_13_alt03_battler_front.png',
    'assets/monsters/monster_water_fly_13_alt04_battler_front.png',
  ],
  // WOOD (4)
  [
    'assets/monsters/monster_water_grass_20_alt01_battler_front.png',
    'assets/monsters/monster_water_grass_20_alt02_battler_front.png',
    'assets/monsters/monster_water_grass_20_alt03_battler_front.png',
    'assets/monsters/monster_water_grass_21_alt01_battler_front.png',
    'assets/monsters/monster_water_grass_21_alt02_battler_front.png',
    'assets/monsters/monster_water_grass_21_alt03_battler_front.png',
  ],
];

// Compile-time flag injected by Vite (see client/vite.config.ts). True only in
// the E2E fast build; production bundles inline `false`.
declare const __E2E_FAST__: boolean;

// #125 attack-phase gesture windows (GDD §6.3). A single attack-key press is held
// for DOUBLE_TAP_MS before firing the attack, so a second same-key press inside
// the window can convert it into a recharge. Two DIFFERENT attack keys within
// CHORD_MS are the forfeit chord (Z+C → a1+a2, or 3+4 → d1+d2). Fast mode shrinks
// the arming window so the E2E suite's single-press attacks resolve quickly.
const RECHARGE_DOUBLE_TAP_MS = __E2E_FAST__ ? 120 : 300;
const FORFEIT_CHORD_MS = 50;
// Maps each attack slot to its sibling (the other attack key) for chord detection.
const ATTACK_SIBLING: Record<string, SlotKey> = { a1: 'a2', a2: 'a1' };
// Maps each defense slot to its sibling, for the 3+4 forfeit chord in attack phase.
const DEFENSE_SIBLING: Record<string, SlotKey> = { d1: 'd2', d2: 'd1' };

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
  private prevCurrentAttackerId = '';
  private returning = false;
  // #78 ② / #212 — post-battle reward summary. The server sends `battleSummary`
  // after the ENDED state patch, so the message can arrive before, after, or
  // around the moment checkEnded() runs. The end-of-battle modal is shown once
  // BOTH the duel has ENDED (ended) and the summary has arrived
  // (pendingBattleSummary); whichever happens second triggers maybeShowEndModal().
  private pendingBattleSummary: BattleSummaryPayload | null = null;
  private ended = false;
  // #212 — resolved post-duel destination, captured on ENDED and used by the
  // modal's route choice. toBiome is the biome scene key (ForestScene/SwampScene)
  // or null for the EncounterScene hub; screenId restores the correct biome screen.
  private endDestination: { toBiome: string | null; screenId?: string } | null = null;
  // #212 — the persistent end-of-battle modal (null until shown).
  private endModal: BattleEndModal | null = null;

  // #125 attack-phase gesture state. pendingAttackSlot/Timer hold a single
  // attack-key press until the double-tap window lapses (then it fires); a second
  // same-key press cancels it into a recharge. lastPressAt tracks the most recent
  // press time per slot for chord detection. forfeitPrompt is the active confirm
  // overlay (null when none).
  private pendingAttackSlot: SlotKey | null = null;
  private pendingAttackTimer: Phaser.Time.TimerEvent | null = null;
  private lastPressAt: Record<string, number> = {};
  private forfeitPrompt: Phaser.GameObjects.Container | null = null;
  private forfeitKeyHandlers: (() => void) | null = null;

  constructor() {
    super({ key: 'BattleScene' });
  }

  /** spriteFrame (0-11) from the overworld NPC that started this duel. */
  private opponentSpriteFrame = 0;
  /** Canonical battler texture key matching the overworld sprite (#158). When set,
   *  the opponent uses this variant instead of a random pick. */
  private battleKey?: string;

  preload(): void {
    // Opponent monster battle sprites (80×80, one per element + charset for duelists)
    if (!this.textures.exists('battle-charset'))
      this.load.spritesheet('battle-charset', 'assets/characters/charset_a1.png', {
        frameWidth: 16,
        frameHeight: 32,
      });
    MONSTER_BATTLERS.forEach((variants, element) => {
      variants.forEach((path, variantIdx) => {
        const key = `battle-monster-${element}-${variantIdx}`;
        if (!this.textures.exists(key)) this.load.image(key, path);
      });
    });
  }

  init(data?: { opponentSpriteFrame?: number; battleKey?: string }): void {
    this.opponentSpriteFrame = data?.opponentSpriteFrame ?? 0;
    this.battleKey = data?.battleKey;
    // Reset per-start state (scene may be re-entered on a rematch).
    this.revealedOpponentElements = new Set();
    this.prevPhase = '';
    this.prevRallyActive = false;
    this.prevCurrentAttackerId = '';
    this.returning = false;
    this.pendingBattleSummary = null;
    this.ended = false;
    this.endDestination = null;
    this.endModal = null;
    this.pendingAttackSlot = null;
    this.pendingAttackTimer = null;
    this.lastPressAt = {};
    this.forfeitPrompt = null;
    this.forfeitKeyHandlers = null;
  }

  create(): void {
    window.__scene = this;

    const room = window.__room!;
    const myId = room.sessionId;

    this.playerDuelist = new PlayerDuelist(this);
    // Prefer the overworld-matched variant (#158) so the battler is the same creature
    // shown on the map; else roll a random variant for this element.
    const monsterTexKey =
      this.battleKey && this.textures.exists(this.battleKey)
        ? this.battleKey
        : this.opponentSpriteFrame <= 4
          ? `battle-monster-${this.opponentSpriteFrame}-${Math.floor(Math.random() * MONSTER_BATTLERS[this.opponentSpriteFrame].length)}`
          : undefined;
    this.opponentDuelist = new OpponentDuelist(this, this.opponentSpriteFrame, monsterTexKey);
    this.hud = new Hud(this);
    this.hand = new Hand(this, (slot, isAlias) => this.onSlotPressed(slot, isAlias));

    // The room outlives this scene, so clear any state-change listeners left by
    // a previous scene (LobbyScene / a prior BattleScene) before adding ours.
    room.onStateChange.clear();

    const onState = (state: any): void => {
      this.hand.updateFromState(state, myId);
      this.playerDuelist.updateFromState(state.players.get(myId));
      this.opponentDuelist.updateFromState(state, myId, this.revealedOpponentElements);
      this.hud.updateFromState(state, myId);
      this.publishHudView();
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
      this.showExchangeOutcome(result);
    });

    // NOTE: the server's `wonRing` message (post-battle ring grant, #40) is
    // captured in connectToRoom() at the connection level, not here — a duel can
    // end before BattleScene mounts (e.g. an instant forfeit), so the listener
    // must outlive any single scene.

    // #78 ② / #212 — show the end-of-battle modal once both the duel has ENDED and
    // the reward summary is ready. The summary may already have been captured at
    // the connection level before this scene mounted (Connection.ts stashes it on
    // window), so seed from there first, then keep listening for a later arrival.
    if (window.__lastBattleSummary) {
      this.pendingBattleSummary = window.__lastBattleSummary;
      this.maybeShowEndModal();
    }
    const offSummary = room.onMessage('battleSummary', (payload: BattleSummaryPayload) => {
      this.pendingBattleSummary = payload;
      this.maybeShowEndModal();
    });

    // #211 — per-client recharge result. The turn is consumed regardless (server
    // rule); this only surfaces a PARTIAL or INSUFFICIENT-spirit outcome. A full
    // success (restored === requested) flashes nothing — the HUD readout already
    // reflects the spend. Published to window for E2E.
    const offRecharge = room.onMessage('rechargeResult', (p: RechargeResultPayload) => {
      window.__lastRechargeResult = p;
      this.showRechargeFeedback(p);
    });

    this.events.once('shutdown', () => {
      room.onStateChange.remove(onState);
      offExchange();
      offSummary();
      offRecharge();
      this.cancelPendingAttack();
      this.dismissForfeitPrompt();
      this.endModal?.destroy();
      this.endModal = null;
      window.__scene = null;
    });
  }

  /**
   * #135 — publish the LOCAL player's RENDERED HUD (what they can actually see)
   * to window.__hudView, so E2E can assert the Blinded `?` substitution on the
   * own-HUD without reading pixels. Reflects the displayed strings, not the raw
   * broadcast numbers (those remain readable via __room.state — the opponent's
   * view is the unaffected authoritative state).
   */
  private publishHudView(): void {
    window.__hudView = {
      a1: this.hand.displayedUses('a1'),
      a2: this.hand.displayedUses('a2'),
      d1: this.hand.displayedUses('d1'),
      d2: this.hand.displayedUses('d2'),
      hearts: this.playerDuelist.displayedHearts,
      // #211 — rendered ⚡ current/max (undefined when hidden: AI / no-token).
      spirit: this.hud.displayedSpirit,
    };
  }

  /**
   * Show a brief outcome label after each exchange (GDD §6.4).
   *
   * Two independent axes — timing (PARRY/BLOCK/MISTIME/NO_BLOCK) and element
   * relationship (STRONG/NEUTRAL/WEAK) — combine into five distinct outcomes:
   *
   *   PERFECT + STRONG  → COUNTER!   (gold)   — rally triggered
   *   PERFECT + NEUTRAL → PERFECT!   (cyan)   — tight window, no rally
   *   PERFECT + WEAK    → ABSORBED   (red)    — pressed but heart lost
   *   GOOD    + STRONG or NEUTRAL → BLOCKED!  (green) — safe catch
   *   GOOD    + WEAK    → ABSORBED   (red)    — caught but heart lost
   *   MISSED  (any)     → MISS       (grey)   — no successful catch
   *
   * "PERFECT" = PARRY timing band; "GOOD" = BLOCK timing band;
   * "MISSED"  = MISTIME or NO_BLOCK.
   */
  private showExchangeOutcome(result: ExchangeResultPayload): void {
    type Outcome = { label: string; color: string; size: string; flash?: [number, number, number] };
    let outcome: Outcome | null = null;

    const { timing, relationship, rallyContinues, defenderHeartLost } = result;
    const missed = timing === 'MISTIME' || timing === 'NO_BLOCK';

    if (missed) {
      outcome = { label: 'MISS', color: '#888888', size: '26px' };
    } else if (rallyContinues) {
      // PERFECT + STRONG
      outcome = { label: 'COUNTER!', color: '#ffdd00', size: '42px', flash: [255, 200, 50] };
    } else if (timing === 'PARRY' && !defenderHeartLost) {
      // PERFECT + NEUTRAL
      outcome = { label: 'PERFECT!', color: '#44eeff', size: '32px', flash: [100, 220, 255] };
    } else if (defenderHeartLost) {
      // PERFECT or GOOD + WEAK
      outcome = { label: 'ABSORBED', color: '#ff4444', size: '28px' };
    } else {
      // GOOD + STRONG or NEUTRAL (relationship doesn't change the outcome mechanically)
      outcome = { label: 'BLOCKED!', color: '#88ff88', size: '28px' };
    }

    if (!outcome) return;
    if (outcome.flash) {
      this.cameras.main.flash(220, ...outcome.flash as [number, number, number], true);
    }
    const t = this.add.text(512, 205, outcome.label, {
      fontSize: outcome.size, color: outcome.color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(1100);
    this.tweens.add({
      targets: t, alpha: 0, y: 165,
      duration: 750, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }

  /**
   * #211 — flash a brief recharge-spend label near the player's slots when the
   * spend was less than requested. The turn is consumed either way (server rule),
   * so this only communicates the spirit shortfall:
   *   - restored === 0 && requested > 0 → "Not enough spirit!" (red)
   *   - 0 < restored < requested        → "Restored X/Y — low spirit" (amber)
   *   - restored === requested (full)   → no flash
   * Reuses the showExchangeOutcome rise-and-fade tween pattern.
   */
  private showRechargeFeedback(p: RechargeResultPayload): void {
    if (p.requested <= 0 || p.restored >= p.requested) return;
    const { label, color } =
      p.restored === 0
        ? { label: 'Not enough spirit!', color: '#ff4444' }
        : { label: `Restored ${p.restored}/${p.requested} — low spirit`, color: '#ffaa33' };
    // Positioned just above the player's slot row (the bottom hand), low on screen.
    const t = this.add
      .text(512, 470, label, {
        fontSize: '24px', color, fontStyle: 'bold',
        stroke: '#000000', strokeThickness: 4,
      })
      .setOrigin(0.5)
      .setDepth(1100);
    this.tweens.add({
      targets: t, alpha: 0, y: 430,
      duration: 900, ease: 'Power2',
      onComplete: () => t.destroy(),
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
   * Phase-locked input. The server remains the authoritative phase-lock; this is
   * presentation/intent only.
   *
   * DEFEND_WINDOW: d1/d2 send `submitDefense` immediately (single-key, unchanged).
   *
   * ATTACK_SELECT (#125, GDD §6.3): three gestures.
   *   - single attack key → `selectAttack` (armed for RECHARGE_DOUBLE_TAP_MS so a
   *     double-tap can reinterpret it)
   *   - double-tap the same attack key → `recharge` that slot (+ a slot pulse)
   *   - the two siblings within FORFEIT_CHORD_MS (Z+C → a1+a2, or 3+4 → d1+d2) →
   *     a forfeit confirm prompt
   */
  private onSlotPressed(slot: SlotKey, isAlias = false): void {
    const state = window.__room?.state;
    const myId = window.__room?.sessionId;
    if (!state || !myId) return;

    if (state.phase === 'DEFEND_WINDOW' && state.currentAttackerId !== myId) {
      if (!DEFENSE_KEYS.has(slot)) return;
      // If the ring is exhausted the server will silently drop the defense — give
      // the player immediate feedback so they know why nothing happened.
      const me = state.players?.get(myId);
      if (me?.[slot]?.isExtinguished) {
        const t = this.add
          .text(512, 205, 'Ring exhausted!', {
            fontSize: '22px', color: '#ff8888', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 3,
          })
          .setOrigin(0.5)
          .setDepth(1100)
          .setScrollFactor(0);
        this.tweens.add({ targets: t, alpha: 0, y: 170, duration: 700, ease: 'Power2', onComplete: () => t.destroy() });
        return;
      }
      // pressTime is retained for future lag comp; the server timestamps on arrival.
      window.__room!.send('submitDefense', { slot, pressTime: Date.now() });
      return;
    }

    if (state.phase === 'ATTACK_SELECT' && state.currentAttackerId === myId) {
      // Z/C fire BOTH attack- and defense-slot callbacks; skip the defense-slot alias
      // during the attack phase so it doesn't pollute lastPressAt or trigger a spurious
      // defense recharge alongside the intended attack gesture (#188).
      if (isAlias && DEFENSE_KEYS.has(slot)) return;
      this.handleAttackPhasePress(slot);
    }
  }

  /** Route an attack-phase key press through the §6.3 gesture state machine. */
  private handleAttackPhasePress(slot: SlotKey): void {
    // While the forfeit prompt is open, ignore further slot input (Y/N decide it).
    if (this.forfeitPrompt) return;

    const now = Date.now();
    const prev = this.lastPressAt[slot];
    this.lastPressAt[slot] = now;

    // Forfeit chord: the two attack siblings (a1+a2, from Z+C) or the two defense
    // siblings (d1+d2, from 3+4) pressed within FORFEIT_CHORD_MS during the attack
    // phase. Defense-slot presses otherwise do nothing in this phase.
    const sibling = ATTACK_SIBLING[slot] ?? DEFENSE_SIBLING[slot];
    if (sibling) {
      const siblingAt = this.lastPressAt[sibling];
      if (siblingAt !== undefined && now - siblingAt <= FORFEIT_CHORD_MS) {
        this.cancelPendingAttack(); // a half-armed single attack is part of the chord
        this.showForfeitPrompt();
        return;
      }
    }

    // d1/d2 have no single-press attack to arm, but a same-key double-tap recharges
    // that defense ring — symmetric to the attack double-tap below. `3 3` / `4 4` or
    // a double-tap on the D1/D2 card. The forfeit chord (3+4) was already handled above.
    if (!ATTACK_KEYS.has(slot)) {
      if (
        DEFENSE_KEYS.has(slot) &&
        prev !== undefined &&
        now - prev <= RECHARGE_DOUBLE_TAP_MS
      ) {
        window.__room!.send('recharge', { slot });
        this.hand.pulseSlot(slot);
      }
      return; // first/lone defense press: no action (no first-press cue)
    }

    // Double-tap the SAME attack key inside the window → recharge that slot.
    if (
      this.pendingAttackSlot === slot &&
      prev !== undefined &&
      now - prev <= RECHARGE_DOUBLE_TAP_MS
    ) {
      this.cancelPendingAttack();
      window.__room!.send('recharge', { slot });
      this.hand.pulseSlot(slot);
      return;
    }

    // Otherwise arm a single attack; it fires when the double-tap window lapses
    // (unless a second same-key press converts it to a recharge first).
    this.cancelPendingAttack();
    this.pendingAttackSlot = slot;
    this.pendingAttackTimer = this.time.delayedCall(RECHARGE_DOUBLE_TAP_MS, () => {
      this.pendingAttackTimer = null;
      const pending = this.pendingAttackSlot;
      this.pendingAttackSlot = null;
      // Re-check the live phase: the turn may have advanced while armed.
      const s = window.__room?.state;
      const myId = window.__room?.sessionId;
      const slotState = pending && myId ? s?.players?.get(myId)?.[pending] : null;
      if (pending && s?.phase === 'ATTACK_SELECT' && s.currentAttackerId === myId &&
          slotState && slotState.currentUses > 0) {
        window.__room!.send('selectAttack', { slot: pending });
      }
    });
  }

  /** Cancel any armed single-attack press (the double-tap timer). */
  private cancelPendingAttack(): void {
    if (this.pendingAttackTimer) {
      this.pendingAttackTimer.remove(false);
      this.pendingAttackTimer = null;
    }
    this.pendingAttackSlot = null;
  }

  /**
   * Show the forfeit confirm overlay. Y sends `forfeit`; N (or any other choice)
   * dismisses and returns to the normal attack phase. Idempotent — a prompt
   * already open is left as-is.
   */
  private showForfeitPrompt(): void {
    if (this.forfeitPrompt) return;

    const bg = this.add.rectangle(512, 288, 560, 90, 0x000000, 0.85).setStrokeStyle(2, 0xff4444);
    const text = this.add
      .text(512, 288, 'Forfeit duel? Lose staked ring + 25 gold  [Y/N]', {
        fontSize: '18px',
        color: '#ffdddd',
      })
      .setOrigin(0.5);
    const prompt = this.add.container(0, 0, [bg, text]).setDepth(1500);
    this.forfeitPrompt = prompt;
    // E2E hook so a test can assert the prompt is open without reading pixels.
    window.__forfeitPromptOpen = true;

    const KC = Phaser.Input.Keyboard.KeyCodes;
    const yKey = this.input.keyboard!.addKey(KC.Y);
    const nKey = this.input.keyboard!.addKey(KC.N);
    const onYes = (): void => {
      this.dismissForfeitPrompt();
      window.__room!.send('forfeit');
    };
    const onNo = (): void => this.dismissForfeitPrompt();
    yKey.on('down', onYes);
    nKey.on('down', onNo);
    this.forfeitKeyHandlers = () => {
      yKey.off('down', onYes);
      nKey.off('down', onNo);
    };
  }

  /** Tear down the forfeit confirm overlay and its Y/N listeners. */
  private dismissForfeitPrompt(): void {
    if (this.forfeitKeyHandlers) {
      this.forfeitKeyHandlers();
      this.forfeitKeyHandlers = null;
    }
    this.forfeitPrompt?.destroy();
    this.forfeitPrompt = null;
    window.__forfeitPromptOpen = false;
    // Clear stale chord timestamps so the dismissed chord can't immediately retrigger.
    this.lastPressAt = {};
  }

  /**
   * #212 — On phase ENDED, resolve the post-duel destination and arm the
   * persistent end-of-battle modal. There is NO auto-route timer: the modal is the
   * single exit for everyone (including E2E fast mode). The er_pending_ring
   * localStorage key (set by Connection.ts on a win) is left intact by BOTH routes
   * so the won-ring carry prompt still surfaces on arrival. Guarded so it fires once.
   *
   * Input is inert once ENDED: onSlotPressed gates every send on the live
   * ATTACK_SELECT/DEFEND_WINDOW phase, so no room.send can fire after ENDED.
   *
   * #88 — destination routing (preserved exactly):
   *   - Overworld NPC duels (launched from ForestScene/SwampScene) record their
   *     origin biome + the player's world position in window.__duelOrigin. We
   *     return to that biome scene (which restores the player near {x,y}) and clear
   *     __duelOrigin so it is never reused.
   *   - Hub/marker duels leave __duelOrigin unset → return to the EncounterScene
   *     hub with EXPLICIT data so Phaser overwrites settings.data (a no-data
   *     scene.start leaves the previous { npcId, personality } in place, which made
   *     EncounterScene re-launch the duel in an infinite loop — see #88 root cause).
   */
  private checkEnded(state: any, myId: string): void {
    if (state.phase !== 'ENDED' || this.returning) return;
    this.returning = true;
    this.ended = true;

    // #88 — resolve the post-duel destination now (before any scene.start). A biome
    // origin returns to that biome scene; anything else returns to the hub.
    const origin = window.__duelOrigin;
    const toBiome =
      origin && (origin.scene === 'ForestScene' || origin.scene === 'SwampScene')
        ? origin.scene
        : null;
    this.endDestination = { toBiome, screenId: origin?.screenId };

    // Show the modal once the reward summary is also ready (maybeShowEndModal is
    // idempotent; the battleSummary handler calls it too if it arrives later).
    this.maybeShowEndModal();
  }

  /**
   * #212 — show the persistent end-of-battle modal once BOTH the duel has ENDED
   * (ended) and the reward summary has arrived (pendingBattleSummary). Idempotent
   * and order-independent (whichever happens second triggers it). On a win the
   * won-ring element comes from the connection-level wonRing stash; on a loss the
   * forfeited staked thumb element comes from the live BattleState.
   */
  private maybeShowEndModal(): void {
    if (this.endModal || !this.ended || !this.pendingBattleSummary || !this.endDestination) return;

    const { won, goldGained, xpGained, aggregateXp } = this.pendingBattleSummary;
    // Won ring (WIN) or the forfeited staked thumb (LOSS).
    let ringElement: number | null = null;
    let ringXp: number | null = null;
    if (won) {
      ringElement = window.__lastWonRing?.element ?? null;
      ringXp = window.__lastWonRing?.xp ?? null;
    } else {
      const myId = window.__room?.sessionId;
      const myThumb = myId ? window.__room?.state?.players?.get(myId)?.thumb : null;
      ringElement = myThumb ? (myThumb.element as number) : null;
      ringXp = myThumb ? (myThumb.xp as number) : null;
    }

    this.endModal = new BattleEndModal(
      this,
      { won, ringElement, ringXp, goldGained, xpGained, aggregateXp },
      (choice) => this.routeAfterBattle(choice),
    );
    this.endModal.show();
  }

  /**
   * #212 — perform the post-duel scene transition for the chosen route. Both routes
   * use the SAME destination resolved on ENDED (#88) and leave er_pending_ring
   * intact (the won-ring carry prompt surfaces on arrival):
   *   - 'managehand' → openBattleHand: true (lands with the Manage Battle-Hand overlay)
   *   - 'overworld'  → openBattleHand omitted (lands in the biome/hub, no overlay)
   */
  private routeAfterBattle(choice: 'managehand' | 'overworld'): void {
    const openBattleHand = choice === 'managehand';
    const dest = this.endDestination;
    if (!dest) return;

    if (dest.toBiome) {
      // The biome scene reads __duelOrigin in its create() to restore the player
      // position, then clears it. Pass screenId so the correct screen loads.
      this.scene.start(dest.toBiome, {
        ...(openBattleHand ? { openBattleHand: true } : {}),
        ...(dest.screenId ? { screenId: dest.screenId } : {}),
      });
    } else {
      // Hub return — clear any stray origin and pass explicit data so
      // EncounterScene.init sees undefined personality → npcDuel=null → hub.
      window.__duelOrigin = null;
      this.scene.start('EncounterScene', openBattleHand ? { openBattleHand: true } : {});
    }
  }

  /** Launch the orb telegraph when a defend window opens, including rally volleys. */
  private checkPhaseTransition(state: any, myId: string): void {
    const phaseChanged = state.phase !== this.prevPhase;
    // A rally keeps phase=DEFEND_WINDOW but flips rallyActive true — Colyseus
    // batches RESOLVE→DEFEND_WINDOW into one patch so prevPhase stays DEFEND_WINDOW.
    const rallyStarted = state.rallyActive && !this.prevRallyActive;
    // A COUNTER-of-a-COUNTER (volley 2+): rallyActive stays true across the whole
    // chain, so neither phaseChanged nor rallyStarted fires. Detect by watching
    // currentAttackerId flip — each volley swaps roles while staying in DEFEND_WINDOW.
    const rallyVolley =
      state.rallyActive && state.currentAttackerId !== this.prevCurrentAttackerId;

    this.prevPhase = state.phase;
    this.prevRallyActive = state.rallyActive;
    this.prevCurrentAttackerId = state.currentAttackerId ?? '';

    if (state.phase === 'DEFEND_WINDOW' && (phaseChanged || rallyStarted || rallyVolley)) {
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
