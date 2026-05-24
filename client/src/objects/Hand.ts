import Phaser from 'phaser';
import { RingSlot } from './RingSlot';
import { HAND_SLOT_X, HAND_Y, CANVAS_W, CANVAS_H } from '../Constants';

/**
 * The local player's 5 ring slots plus keyboard (keys 1–5) and touch input.
 * On press it invokes the supplied callback with the slot index; the callback
 * (BattleScene) decides whether to send `selectAttack` or `submitDefense` based
 * on the authoritative phase. Also publishes screen-space slot centers to
 * `window.__slotPositions` so the E2E harness can tap them.
 */
export class Hand extends Phaser.GameObjects.Container {
  private readonly slots: RingSlot[] = [];
  private readonly onPress: (slot: number) => void;

  constructor(scene: Phaser.Scene, onPress: (slot: number) => void) {
    super(scene, 0, 0);
    this.onPress = onPress;

    for (let i = 0; i < 5; i++) {
      const slot = new RingSlot(scene, HAND_SLOT_X[i], HAND_Y);
      this.slots.push(slot);
      // Touch / mouse input on each card.
      slot.bg.setInteractive();
      slot.bg.on('pointerdown', () => this.triggerSlot(i));
    }

    // Keyboard input: keys 1–5 map to slots 0–4.
    const KC = Phaser.Input.Keyboard.KeyCodes;
    const keyCodes = [KC.ONE, KC.TWO, KC.THREE, KC.FOUR, KC.FIVE];
    keyCodes.forEach((code, i) => {
      scene.input.keyboard!.addKey(code).on('down', () => this.triggerSlot(i));
    });

    this.publishSlotPositions();
    scene.add.existing(this);
  }

  private triggerSlot(i: number): void {
    if (this.slots[i].isExtinguished) return;
    this.onPress(i);
  }

  /** Sync each slot card to the local player's hand in the broadcast state. */
  updateFromState(state: any, myId: string): void {
    const me = state.players.get(myId);
    if (!me) return;
    for (let i = 0; i < 5; i++) {
      if (me.hand[i]) this.slots[i].updateFromRing(me.hand[i]);
    }
  }

  /**
   * Publish each slot's center in viewport (page) coordinates so an E2E harness
   * can tap the real screen location. We map the game-internal slot position
   * through the canvas display size and add the canvas's page offset, since the
   * canvas is letterboxed/centered inside the page.
   */
  private publishSlotPositions(): void {
    const canvas = this.scene.game.canvas;
    const rect = canvas.getBoundingClientRect();
    // Display-size to internal-resolution ratio (handles CSS scaling).
    const scaleX = rect.width / CANVAS_W;
    const scaleY = rect.height / CANVAS_H;
    window.__slotPositions = HAND_SLOT_X.map((x) => ({
      x: rect.left + x * scaleX,
      y: rect.top + HAND_Y * scaleY,
    }));
  }
}
