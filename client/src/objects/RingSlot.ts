import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';

/**
 * One named ring-slot card (Thumb / A1 / A2 / D1 / D2). Renders the slot label,
 * the equipped ring's element color + name, use pips, a dim overlay when the ring
 * is extinguished, and an active highlight when its group is live for the phase.
 * Purely presentational — driven by the server's Ring schema.
 */
export class RingSlot extends Phaser.GameObjects.Container {
  public readonly bg: Phaser.GameObjects.Rectangle;
  private readonly slotLabel: Phaser.GameObjects.Text;
  private readonly elementLabel: Phaser.GameObjects.Text;
  private readonly usesText: Phaser.GameObjects.Text;
  private readonly dimOverlay: Phaser.GameObjects.Rectangle;
  private _element = 0;
  private _isExtinguished = false;

  constructor(scene: Phaser.Scene, x: number, y: number, slotName: string) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, 58, 80, 0x333333).setStrokeStyle(2, 0x888888);
    this.slotLabel = scene.add
      .text(0, -32, slotName, { fontSize: '9px', color: '#cccccc' })
      .setOrigin(0.5);
    this.elementLabel = scene.add
      .text(0, -14, '', { fontSize: '10px', color: '#ffffff' })
      .setOrigin(0.5);
    this.usesText = scene.add
      .text(0, 22, '', { fontSize: '12px', color: '#ffff88' })
      .setOrigin(0.5);
    this.dimOverlay = scene.add.rectangle(0, 0, 58, 80, 0x000000, 0.6);
    this.dimOverlay.setVisible(false);
    this.add([this.bg, this.slotLabel, this.elementLabel, this.usesText, this.dimOverlay]);
    scene.add.existing(this);
  }

  /** Sync the card to a server-side Ring schema object. */
  updateFromRing(ring: any): void {
    this._element = ring.element;
    this._isExtinguished = ring.isExtinguished;
    this.bg.setFillStyle(ELEMENT_COLORS[ring.element] ?? 0x333333);
    this.elementLabel.setText(ELEMENT_NAMES[ring.element] ?? '?');
    const used = ring.maxUses - ring.currentUses;
    this.usesText.setText('●'.repeat(ring.currentUses) + '○'.repeat(Math.max(0, used)));
    this.dimOverlay.setVisible(ring.isExtinguished);
  }

  /** Highlight (or dim) this slot depending on whether its group is active. */
  setActiveGroup(active: boolean): void {
    this.bg.setStrokeStyle(active ? 3 : 2, active ? 0xffff66 : 0x888888);
  }

  get element(): number {
    return this._element;
  }

  get isExtinguished(): boolean {
    return this._isExtinguished;
  }
}
