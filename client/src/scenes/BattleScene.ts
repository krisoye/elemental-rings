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
  DoubleAttackStartPayload,
  DoubleAttackCancelledPayload,
} from '../../../shared/types';
import type { OrbHandle } from '../objects/Orb';
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
// Maps each defense slot to its sibling, for the 3+4 forfeit chord in attack phase
// (EPIC #266 relocated the forfeit chord from A1+A2 to D1+D2).
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
  // #259 — one-shot latch so the boss-enrage banner flashes exactly once on the
  // transition (the broadcast `enraged` flag stays true for the rest of the duel).
  private enrageBannerShown = false;
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

  // EPIC #264 / #266 — hold-cross-tap double-attack gesture state. heldAt records
  // the keydown time of each ATTACK slot while it is held (undefined once
  // released); the hold callback fires a `selectDoubleAttack` when one A-slot is
  // held and the OTHER is freshly pressed. comboFired guards against re-sending
  // for the same hold pair (until both keys lift). gapMs = inter-keydown time.
  private heldAt: { a1?: number; a2?: number } = {};
  private comboFired = false;
  // When an armed single attack's window lapses while its key is STILL physically
  // held (a potential combo-in-progress), the attack is not fired immediately — it
  // is deferred here and fired on key release if no combo committed. This lets a
  // player hold one attack key for longer than RECHARGE_DOUBLE_TAP_MS before tapping
  // the other without the held key prematurely resolving as a single attack.
  private deferredHeldAttack: SlotKey | null = null;

  // EPIC #264 / #267 — dual-orb telegraph render state. Orb 1 is auto-launched by
  // checkPhaseTransition (the normal DEFEND_WINDOW path); doubleAttackStart marks
  // comboRenderActive and schedules orb 2 after gapMs. comboOrbIndex keys each combo
  // exchangeResult to its orb (1, then 2). orb2Handle lets a parry-disperse scatter
  // orb 2 mid-flight; orb2LaunchTimer is its gapMs delayed launch (cancelled on
  // shutdown / orb-2 cancel).
  private comboRenderActive = false;
  private comboOrbIndex = 0;
  private orb2Handle: OrbHandle | null = null;
  private orb2LaunchTimer: Phaser.Time.TimerEvent | null = null;

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
    this.heldAt = {};
    this.comboFired = false;
    this.deferredHeldAttack = null;
    this.comboRenderActive = false;
    this.comboOrbIndex = 0;
    this.orb2Handle = null;
    this.orb2LaunchTimer = null;
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
    this.hand = new Hand(
      this,
      (slot, isAlias) => this.onSlotPressed(slot, isAlias),
      (slot, down) => this.onAttackHold(slot, down),
    );

    // The room outlives this scene, so clear any state-change listeners left by
    // a previous scene (LobbyScene / a prior BattleScene) before adding ours.
    room.onStateChange.clear();

    const onState = (state: any): void => {
      this.hand.updateFromState(state, myId);
      this.playerDuelist.updateFromState(state.players.get(myId));
      this.opponentDuelist.updateFromState(state, myId, this.revealedOpponentElements);
      this.hud.updateFromState(state, myId);
      this.publishHudView();
      this.checkBossEnrage(state, myId);
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
      // EPIC #267 — during a combo, attribute each result to its orb (orb 1 first,
      // orb 2 second) and tag the outcome flash so the player sees which orb it
      // answered. Outside a combo this is a no-op (orbIndex 0).
      const orbIndex = this.nextComboOrb();
      this.showExchangeOutcome(result, orbIndex);
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

    // EPIC #264 / #267 — dual-orb telegraph. The server broadcasts doubleAttackStart
    // the moment a combo commits; orb 1 is launched by the normal DEFEND_WINDOW
    // auto-launch (checkPhaseTransition) and this handler schedules orb 2 gapMs later.
    // Per-orb exchangeResults arrive via the normal handler and are routed to their
    // orb by comboOrbIndex.
    const offDoubleStart = room.onMessage('doubleAttackStart', (p: DoubleAttackStartPayload) => {
      this.handleDoubleAttackStart(p, myId);
    });
    // Orb 2 cancelled (orb-1 PARRY or KO): disperse it instead of impacting.
    const offDoubleCancel = room.onMessage(
      'doubleAttackCancelled',
      (_p: DoubleAttackCancelledPayload) => this.handleDoubleAttackCancelled(),
    );

    this.events.once('shutdown', () => {
      room.onStateChange.remove(onState);
      offExchange();
      offSummary();
      offRecharge();
      offDoubleStart();
      offDoubleCancel();
      this.orb2LaunchTimer?.remove(false);
      this.orb2LaunchTimer = null;
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
    // EPIC #264 / #266 — whether A1/A2 currently show the double-attack eligibility
    // cue (canDoubleAttack on the local hand, during the player's attack phase). For
    // E2E to assert the cue without reading pixels.
    window.__comboEligible = this.hand.comboEligible;
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
  private showExchangeOutcome(result: ExchangeResultPayload, orbIndex = 0): void {
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
    // EPIC #267 — during a combo, prefix the outcome with which orb it answered and
    // stack orb 2's label below orb 1's so two rapid results stay legible. Outside
    // a combo (orbIndex 0) the label and position are unchanged.
    const label = orbIndex > 0 ? `Orb ${orbIndex}: ${outcome.label}` : outcome.label;
    const y = orbIndex === 2 ? 240 : 205;
    window.__lastOrbOutcome = orbIndex > 0 ? { orb: orbIndex, label: outcome.label } : null;
    // E2E — append every per-orb combo outcome to a durable log (a single
    // __lastOrbOutcome can be overwritten before a test reads it between two rapid
    // combo results).
    if (orbIndex > 0) {
      window.__orbOutcomeLog = window.__orbOutcomeLog ?? [];
      window.__orbOutcomeLog.push({ orb: orbIndex, label: outcome.label });
    }
    const t = this.add.text(512, y, label, {
      fontSize: outcome.size, color: outcome.color, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(1100);
    this.tweens.add({
      targets: t, alpha: 0, y: y - 40,
      duration: 750, ease: 'Power2',
      onComplete: () => t.destroy(),
    });
  }

  /**
   * #259 — boss phase-2. When the opponent's broadcast `enraged` flag first turns
   * true, flash a one-shot banner. The opponent sprite tint/pulse is handled by
   * OpponentDuelist.updateFromState; this only adds the headline. Presentation
   * only — the server owns the difficulty change. `__enrageBannerCount` is a
   * test-observable counter for the E2E spec.
   */
  private checkBossEnrage(state: any, myId: string): void {
    if (this.enrageBannerShown) return;
    const oppId = Array.from(state.players.keys()).find((id: any) => id !== myId) as
      | string
      | undefined;
    if (!oppId) return;
    const opp = state.players.get(oppId);
    if (!opp?.enraged) return;

    this.enrageBannerShown = true;
    const w = (window as unknown as { __enrageBannerCount?: number });
    w.__enrageBannerCount = (w.__enrageBannerCount ?? 0) + 1;

    const name = opp.displayName ? opp.displayName : 'The boss';
    const banner = this.add
      .text(512, 120, `${name} roars!`, {
        fontSize: '32px',
        color: '#ff4444',
        fontStyle: 'bold',
        stroke: '#000000',
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setDepth(1200)
      .setName('enrageBanner');
    this.cameras.main.flash(260, 120, 0, 0, true);
    this.tweens.add({
      targets: banner,
      alpha: 0,
      y: 90,
      duration: 1400,
      ease: 'Power2',
      onComplete: () => banner.destroy(),
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
   *   - the two DEFENSE siblings within FORFEIT_CHORD_MS (3+4 → d1+d2) → a forfeit
   *     confirm prompt (EPIC #266 relocated this off A1+A2; that chord space now
   *     belongs to the hold-cross-tap double attack — see onAttackHold)
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

    // Forfeit chord (EPIC #264 / #266): the two DEFENSE siblings (d1+d2, from 3+4)
    // pressed within FORFEIT_CHORD_MS during the attack phase. The former A1+A2
    // (Z+C) attack-sibling chord NO LONGER forfeits — that gesture space is freed
    // for the hold-cross-tap double attack (handled in onAttackHold). Defense-slot
    // presses otherwise do nothing in this phase.
    const sibling = DEFENSE_SIBLING[slot];
    if (sibling) {
      const siblingAt = this.lastPressAt[sibling];
      if (siblingAt !== undefined && now - siblingAt <= FORFEIT_CHORD_MS) {
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
      if (!pending) return;
      // EPIC #266 — if the key is STILL physically held, this could be the first
      // half of a hold-cross-tap combo. Defer the single attack until release rather
      // than throwing it now (which would end the attacker's turn and forfeit the
      // combo). On release, fireDeferredHeldAttack resolves it if no combo committed.
      if (this.heldAt[pending as 'a1' | 'a2'] !== undefined) {
        this.deferredHeldAttack = pending;
        return;
      }
      this.sendSingleAttack(pending);
    });
  }

  /**
   * EPIC #266 — fire a single attack that was deferred while its key was held, now
   * that the key has been released. Skips if a combo committed (comboFired) or the
   * deferred slot does not match. Clearing deferredHeldAttack is unconditional so a
   * stale defer never leaks into a later turn.
   */
  private fireDeferredHeldAttack(slot: SlotKey): void {
    if (this.deferredHeldAttack !== slot) return;
    this.deferredHeldAttack = null;
    if (this.comboFired) return; // the hold became a combo — no single attack
    this.sendSingleAttack(slot);
  }

  /** Send a single `selectAttack` for `slot` if the turn is still the player's. */
  private sendSingleAttack(slot: SlotKey): void {
    const s = window.__room?.state;
    const myId = window.__room?.sessionId;
    const slotState = myId ? s?.players?.get(myId)?.[slot] : null;
    if (
      s?.phase === 'ATTACK_SELECT' &&
      s.currentAttackerId === myId &&
      slotState &&
      slotState.currentUses > 0
    ) {
      window.__room!.send('selectAttack', { slot });
    }
  }

  /**
   * EPIC #264 / #266 — hold-cross-tap double-attack gesture. Tracks each ATTACK
   * slot's held state (keyboard 1/2 or Z/C, or a touch hold on the A-card). When
   * one A-slot is held and the OTHER is freshly pressed, fire a single
   * `selectDoubleAttack { first, second, gapMs }`:
   *   - `first`  = the slot that was already held (its keydown came first)
   *   - `second` = the slot just tapped
   *   - `gapMs`  = inter-keydown time (the held duration); the server re-clamps it.
   * Order-independent. Cancels any single-attack/recharge armed for these slots,
   * since the combo supersedes them.
   *
   * Eligibility is mirrored locally (Hand.canDoubleAttack) ONLY to avoid a wasted
   * round-trip — the server re-validates authoritatively and drops an ineligible
   * send. An ineligible hand sends nothing here; its keys still arm single attacks
   * through handleAttackPhasePress as normal.
   */
  private onAttackHold(slot: 'a1' | 'a2', down: boolean): void {
    if (!down) {
      this.heldAt[slot] = undefined;
      // If a single attack was deferred while this key was held (waiting to see if
      // it became the first half of a combo), fire it now on release — provided no
      // combo committed and the turn is still live.
      this.fireDeferredHeldAttack(slot);
      // Re-arm the gesture once BOTH attack keys have lifted.
      if (this.heldAt.a1 === undefined && this.heldAt.a2 === undefined) {
        this.comboFired = false;
      }
      return;
    }

    const now = Date.now();
    const other: 'a1' | 'a2' = slot === 'a1' ? 'a2' : 'a1';
    const otherAt = this.heldAt[other];
    this.heldAt[slot] = now;

    // Only the SECOND key of a held pair fires the combo, once per hold.
    if (this.comboFired || otherAt === undefined) return;

    // Gate the send on local eligibility + the live attack phase (presentation
    // mirror only — the server is the authority).
    const state = window.__room?.state;
    const myId = window.__room?.sessionId;
    if (!state || !myId) return;
    if (state.phase !== 'ATTACK_SELECT' || state.currentAttackerId !== myId) return;
    if (!this.hand.comboEligible) return;

    // first = the already-held slot (earlier keydown); second = this tap. gapMs is
    // the inter-keydown interval; the server clamps to [MIN,MAX]_COMBO_GAP_MS.
    const first = other;
    const second = slot;
    const gapMs = now - otherAt;

    this.comboFired = true;
    this.cancelPendingAttack(); // supersede any single attack armed for these slots
    window.__room!.send('selectDoubleAttack', { first, second, gapMs });
  }

  /**
   * EPIC #264 / #267 — render a committed double attack. Orb 1 is launched by the
   * normal DEFEND_WINDOW auto-launch in checkPhaseTransition (it reads
   * attackerSlot=first and gets orb 1's elements) — this handler does NOT re-launch
   * it, which sidesteps any doubleAttackStart-message vs state-patch ordering race.
   * It only marks the combo render active (so per-orb result routing engages) and
   * schedules orb 2 `gapMs` later, keeping orb 2's handle for a possible disperse.
   * The two orbs render their own component colours and arrive in sequence.
   */
  private handleDoubleAttackStart(p: DoubleAttackStartPayload, myId: string): void {
    const state = window.__room?.state;
    if (!state) return;

    this.comboRenderActive = true;
    this.comboOrbIndex = 0;

    const imAttacker = state.currentAttackerId === myId;
    const from = imAttacker ? { x: PLAYER_X, y: PLAYER_Y } : { x: OPPONENT_X, y: OPPONENT_Y };
    const to = imAttacker ? { x: OPPONENT_X, y: OPPONENT_Y } : { x: PLAYER_X, y: PLAYER_Y };

    // Orb 2 fires gapMs after orb 1's auto-launch; keep its handle so a parry-disperse
    // can scatter it. (secondElements are the fired ring's component elements.)
    this.orb2LaunchTimer?.remove(false);
    this.orb2LaunchTimer = this.time.delayedCall(p.gapMs, () => {
      this.orb2LaunchTimer = null;
      if (!this.comboRenderActive) return; // cancelled before it launched
      this.orb2Handle = Orb.launch(
        this,
        p.secondElements.length ? p.secondElements : [0],
        from,
        to,
      );
    });
  }

  /**
   * EPIC #264 / #267 — orb-2 cancellation (orb-1 PARRY or KO). If orb 2 is already
   * in flight, disperse it (the returning counter scatters it mid-air); if it has
   * not launched yet, cancel its pending launch so it never appears. Either way the
   * combo render is finished.
   */
  private handleDoubleAttackCancelled(): void {
    if (this.orb2LaunchTimer) {
      this.orb2LaunchTimer.remove(false);
      this.orb2LaunchTimer = null;
    }
    this.orb2Handle?.disperse();
    this.orb2Handle = null;
    window.__orbDispersed = (window.__orbDispersed ?? 0) + 1;
    this.endComboRender();
  }

  /**
   * EPIC #267 — return the orb index (1, then 2) the next combo exchangeResult
   * belongs to, advancing the per-combo counter. Returns 0 outside a combo. After
   * orb 2's result the combo render is closed.
   */
  private nextComboOrb(): number {
    if (!this.comboRenderActive) return 0;
    this.comboOrbIndex += 1;
    const index = this.comboOrbIndex;
    // Close the combo epoch AFTER capturing the index — endComboRender resets the
    // counter, so reading this.comboOrbIndex post-call would wrongly return 0.
    if (index >= 2) this.endComboRender();
    return index;
  }

  /** Close the combo render epoch (after orb 2 resolves or orb 2 is cancelled). */
  private endComboRender(): void {
    this.comboRenderActive = false;
    this.comboOrbIndex = 0;
  }

  /** Cancel any armed single-attack press (the double-tap timer + any deferral). */
  private cancelPendingAttack(): void {
    if (this.pendingAttackTimer) {
      this.pendingAttackTimer.remove(false);
      this.pendingAttackTimer = null;
    }
    this.pendingAttackSlot = null;
    this.deferredHeldAttack = null;
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
