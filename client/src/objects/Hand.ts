import Phaser from 'phaser';
import { RingSlot } from './RingSlot';
import { HAND_SLOT_X, HAND_Y, CANVAS_W, CANVAS_H, SLOT_KEYS, SLOT_LABELS, SlotKey } from '../Constants';

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
  private readonly onPress: (slot: SlotKey) => void;

  constructor(scene: Phaser.Scene, onPress: (slot: SlotKey) => void) {
    super(scene, 0, 0);
    this.onPress = onPress;

    SLOT_KEYS.forEach((key, i) => {
      const slot = new RingSlot(scene, HAND_SLOT_X[i], HAND_Y, SLOT_LABELS[key]);
      this.slots[key] = slot;
      // Touch / mouse: thumb is passive (never pressable).
      if (key !== 'thumb') {
        slot.bg.setInteractive();
        slot.bg.on('pointerdown', () => this.triggerSlot(key));
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
      scene.input.keyboard!.addKey(code).on('down', () => this.triggerSlot(key));
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
      scene.input.keyboard!.addKey(code).on('down', () => this.triggerSlot(key));
    });

    this.publishSlotPositions();
    scene.add.existing(this);
  }

  private triggerSlot(key: SlotKey): void {
    if (key === 'thumb') return;
    this.onPress(key);
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
  }

  /** The rendered use-count string for a slot (`?` when Blinded). For E2E/#135. */
  displayedUses(key: SlotKey): string {
    return this.slots[key].displayedUses;
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
