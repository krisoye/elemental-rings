import Phaser from 'phaser';
import { RingSlot } from './RingSlot';
import { addDomLabel } from './ui/DomLabel';
import {
  HAND_SLOT_X,
  HAND_Y,
  CANVAS_W,
  CANVAS_H,
  SLOT_KEYS,
  SLOT_LABELS,
  SlotKey,
  ringComponents,
  RECHARGE_SLOT_X,
  RECHARGE_DIVIDER_X,
  RECHARGE_FILL,
  RECHARGE_ALPHA,
  RECHARGE_STROKE,
  RECHARGE_STROKE_WIDTH,
} from '../Constants';

/**
 * The local player's 5 named ring slots (Thumb, A1, A2, D1, D2) plus keyboard
 * and touch input. Keyboard: a1='1', a2='2', d1='3', d2='4'. The Thumb is a
 * passive, non-pressable indicator. On press it invokes the supplied callback
 * with the slot KEY string; the callback (BattleScene) decides whether to send
 * `selectAttack` or `submitDefense` based on the authoritative phase. Also
 * publishes screen-space slot centers to `window.__slotPositions` (indexed
 * thumb,a1,a2,d1,d2) so the E2E harness can tap them.
 */
export class Hand extends Phaser.GameObjects.Container {
  private readonly slots: Record<SlotKey, RingSlot> = {} as Record<SlotKey, RingSlot>;
  private readonly onPress: (slot: SlotKey, isAlias?: boolean) => void;
  // EPIC #264 / #266 — optional hold-cross-tap reporter. Fires on press/release of
  // the two ATTACK slots (A1/A2) — keyboard (1/2 or Z/C) AND touch (A1/A2 cards) —
  // so BattleScene can detect "hold one, tap the other" without re-wiring input.
  private readonly onAttackHold?: (slot: 'a1' | 'a2', down: boolean) => void;
  // #487 — optional callback to arm the R-key recharge state. Fired by the touch
  // "↻ Recharge" button, mirrors the R key handler in BattleScene.
  private readonly onArmRecharge?: () => void;

  constructor(
    scene: Phaser.Scene,
    onPress: (slot: SlotKey, isAlias?: boolean) => void,
    onAttackHold?: (slot: 'a1' | 'a2', down: boolean) => void,
    onArmRecharge?: () => void,
  ) {
    super(scene, 0, 0);
    this.onPress = onPress;
    this.onAttackHold = onAttackHold;
    this.onArmRecharge = onArmRecharge;

    SLOT_KEYS.forEach((key, i) => {
      const slot = new RingSlot(scene, HAND_SLOT_X[i], HAND_Y, SLOT_LABELS[key]);
      this.slots[key] = slot;
      // Touch / mouse: thumb is passive (never pressable).
      if (key !== 'thumb') {
        slot.bg.setInteractive();
        slot.bg.on('pointerdown', () => this.triggerSlot(key));
        // Touch hold-tracking for the A-slots (combo parity with keyboard). A
        // pointer release OR leaving the card ends the hold; pointerdown begins it.
        if (key === 'a1' || key === 'a2') {
          const a = key;
          slot.bg.on('pointerdown', () => this.onAttackHold?.(a, true));
          slot.bg.on('pointerup', () => this.onAttackHold?.(a, false));
          slot.bg.on('pointerout', () => this.onAttackHold?.(a, false));
        }
      }
    });

    // Keyboard: a1='1', a2='2', d1='3', d2='4'. (Thumb has no key.)
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const keyMap: [number, SlotKey][] = [
      [KC.ONE, 'a1'],
      [KC.TWO, 'a2'],
      [KC.THREE, 'd1'],
      [KC.FOUR, 'd2'],
    ];
    keyMap.forEach(([code, key]) => {
      const k = scene.input.keyboard!.addKey(code);
      k.on('down', () => this.triggerSlot(key));
      // Hold-tracking for the digit attack keys (1/2). emitOnRepeat is off by
      // default, so 'down' fires once per physical press → no held-key spam.
      if (key === 'a1' || key === 'a2') {
        const a = key;
        k.on('down', () => this.onAttackHold?.(a, true));
        k.on('up', () => this.onAttackHold?.(a, false));
      }
    });

    // #87 Part E — phase-relative slot-1/slot-2 hotkeys. Z is "slot 1" and C is
    // "slot 2": each fires BOTH the attack and defense variant. BattleScene's
    // phase gate (ATTACK_KEYS/DEFENSE_KEYS) silently drops the variant that does
    // not match the current phase, so in ATTACK_SELECT Z throws A1 and in
    // DEFEND_WINDOW Z submits D1 (likewise C → A2/D2). No extra logic needed.
    const slot1Aliases: [number, SlotKey][] = [
      [KC.Z, 'a1'],
      [KC.Z, 'd1'],
    ];
    const slot2Aliases: [number, SlotKey][] = [
      [KC.C, 'a2'],
      [KC.C, 'd2'],
    ];
    [...slot1Aliases, ...slot2Aliases].forEach(([code, key]) => {
      scene.input.keyboard!.addKey(code).on('down', () => this.triggerSlot(key, true));
    });
    // Z/C hold-tracking for the A-slot aliases (combo via Z+C). One registration
    // per physical key (Z→a1, C→a2); the defense aliases need no hold-tracking.
    scene.input.keyboard!.addKey(KC.Z).on('down', () => this.onAttackHold?.('a1', true));
    scene.input.keyboard!.addKey(KC.Z).on('up', () => this.onAttackHold?.('a1', false));
    scene.input.keyboard!.addKey(KC.C).on('down', () => this.onAttackHold?.('a2', true));
    scene.input.keyboard!.addKey(KC.C).on('up', () => this.onAttackHold?.('a2', false));

    // #490 — RECHARGE slot card in the Hand row (left of Thumb at HAND_SLOT_X[0]=580).
    // Gold styling matches BenchHealthCombat's RECHARGE slot (constants shared via
    // Constants.ts). Only rendered when onArmRecharge is supplied (PvP / vsAI battle).
    if (this.onArmRecharge) {
      // Gold 'RECHARGE' label above the slot card (DOM — crisp, dark-backed).
      addDomLabel(scene, RECHARGE_SLOT_X, HAND_Y - 34, 'RECHARGE', {
        fontPx: 11,
        color: '#ffcc44',
        align: 'center',
        background: 'rgba(0,0,0,0.55)',
        padding: '1px 3px',
      });
      // Gold rectangle at slot position — same footprint as a RingSlot card (58×90).
      const rechargeBg = scene.add
        .rectangle(RECHARGE_SLOT_X, HAND_Y, 58, 90, RECHARGE_FILL, RECHARGE_ALPHA)
        .setScrollFactor(0)
        .setStrokeStyle(RECHARGE_STROKE_WIDTH, RECHARGE_STROKE)
        .setInteractive();
      rechargeBg.on('pointerdown', () => this.onArmRecharge!());
      // Vertical divider line separating the RECHARGE slot from the five ring slots.
      scene.add
        .line(0, 0, RECHARGE_DIVIDER_X, HAND_Y - 45, RECHARGE_DIVIDER_X, HAND_Y + 45, RECHARGE_STROKE, 0.5)
        .setScrollFactor(0);
    }

    this.publishSlotPositions();
    scene.add.existing(this);
  }

  private triggerSlot(key: SlotKey, isAlias = false): void {
    if (key === 'thumb') return;
    // #487 — if recharge is armed, route the slot press to the BattleScene recharge
    // path via onPress (BattleScene.handleAttackPhasePress checks rechargeArmed first).
    this.onPress(key, isAlias);
  }

  /** Sync each slot card to the local player's loadout and highlight the active group. */
  updateFromState(state: any, myId: string): void {
    const me = state.players.get(myId);
    if (!me) return;
    for (const key of SLOT_KEYS) {
      const ring = me[key];
      if (ring) this.slots[key].updateFromRing(ring);
    }

    // #135 Blinded — progressively hide the LOCAL player's own use counts as their
    // shadowGauge climbs (≥1 A1, ≥2 A2, ≥3 D1, ≥4 D2; hearts at ≥5 are handled by
    // PlayerDuelist). Restores immediately when the gauge drops (e.g. a parry
    // clears it). The thumb is never hidden. This affects only THIS client's view
    // of its own hand — the opponent's view is unaffected.
    const shadow = me.shadowGauge ?? 0;
    this.slots.a1.setUsesHidden(shadow >= 1);
    this.slots.a2.setUsesHidden(shadow >= 2);
    this.slots.d1.setUsesHidden(shadow >= 3);
    this.slots.d2.setUsesHidden(shadow >= 4);

    // Highlight the active group: A1/A2 during the local player's attack phase,
    // D1/D2 during the local player's defense phase.
    const imAttacker = state.currentAttackerId === myId;
    const attackActive = state.phase === 'ATTACK_SELECT' && imAttacker;
    const defendActive = state.phase === 'DEFEND_WINDOW' && !imAttacker;
    this.slots.a1.setActiveGroup(attackActive);
    this.slots.a2.setActiveGroup(attackActive);
    this.slots.d1.setActiveGroup(defendActive);
    this.slots.d2.setActiveGroup(defendActive);
    this.slots.thumb.setActiveGroup(false);

    // EPIC #264 / #266 — double-attack eligibility cue. Mirror the SERVER predicate
    // canDoubleAttack(attacker) from the broadcast state for the LOCAL player, and
    // glow A1/A2 only while the combo is actionable (the player's own attack phase).
    // The cue is purely advisory; the server re-validates and silently drops an
    // ineligible selectDoubleAttack.
    const eligible = attackActive && this.canDoubleAttack(me);
    this.slots.a1.setComboEligible(eligible);
    this.slots.a2.setComboEligible(eligible);
  }

  /**
   * EPIC #264 / #266 — client mirror of the server's canDoubleAttack predicate
   * (BattleRoom). The thumb must be a fusion whose two component elements are
   * exactly the set held by A1 and A2, and the thumb, A1, and A2 must each have
   * ≥1 use. Fusion components come straight from the ring's broadcast
   * fusionParents (via ringComponents) — the server already computed them, so
   * this does NOT reimplement fusion logic.
   */
  private canDoubleAttack(me: any): boolean {
    const thumb = me.thumb;
    const a1 = me.a1;
    const a2 = me.a2;
    if (!thumb?.isFusion || !a1 || !a2) return false;
    if (thumb.currentUses <= 0 || a1.currentUses <= 0 || a2.currentUses <= 0) return false;
    const components = ringComponents(thumb); // the fusion's two component elements
    if (components.length !== 2) return false;
    const slotElements = [a1.element, a2.element];
    // Set equality between {component pair} and {A1, A2 elements}.
    return (
      components.every((c) => slotElements.includes(c)) &&
      slotElements.every((s) => components.includes(s))
    );
  }

  /** The rendered use-count string for a slot (`?` when Blinded). For E2E/#135. */
  displayedUses(key: SlotKey): string {
    return this.slots[key].displayedUses;
  }

  /** Whether A1/A2 currently show the double-attack eligibility cue (for E2E/#266). */
  get comboEligible(): boolean {
    return this.slots.a1.comboEligible && this.slots.a2.comboEligible;
  }

  /**
   * #125 — brief recharge feedback pulse on a slot card. Non-blocking: a quick
   * scale-up-and-settle tween on the slot's background. The authoritative use
   * count still arrives via the normal state diff.
   */
  pulseSlot(key: SlotKey): void {
    const slot = this.slots[key];
    if (!slot) return;
    this.scene.tweens.add({
      targets: slot,
      scaleX: 1.25,
      scaleY: 1.25,
      duration: 90,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /**
   * Publish each slot's center in viewport (page) coordinates so an E2E harness
   * can tap the real screen location. Indexed thumb,a1,a2,d1,d2.
   */
  private publishSlotPositions(): void {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / CANVAS_W;
    const scaleY = rect.height / CANVAS_H;
    window.__slotPositions = HAND_SLOT_X.map((x) => ({
      x: rect.left + x * scaleX,
      y: rect.top + HAND_Y * scaleY,
    }));
  }
}
