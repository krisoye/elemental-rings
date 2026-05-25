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

    this.publishSlotPositions();
    scene.add.existing(this);
  }

  private triggerSlot(key: SlotKey): void {
    if (key === 'thumb') return;
    if (this.slots[key].isExtinguished) return;
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
