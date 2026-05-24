import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';

/**
 * One ring-slot card in the local player's hand. Renders the element color, a
 * label, use pips (filled vs spent), and a dim overlay when the ring is
 * extinguished. Purely presentational — driven by the server's Ring schema.
 */
export class RingSlot extends Phaser.GameObjects.Container {
  public readonly bg: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;
  private readonly usesText: Phaser.GameObjects.Text;
  private readonly dimOverlay: Phaser.GameObjects.Rectangle;
  private _element = 0;
  private _isExtinguished = false;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);
    this.bg = scene.add.rectangle(0, 0, 58, 80, 0x333333).setStrokeStyle(2, 0x888888);
    this.label = scene.add.text(0, -20, '', { fontSize: '10px', color: '#ffffff' }).setOrigin(0.5);
    this.usesText = scene.add.text(0, 22, '', { fontSize: '12px', color: '#ffff88' }).setOrigin(0.5);
    this.dimOverlay = scene.add.rectangle(0, 0, 58, 80, 0x000000, 0.6);
    this.dimOverlay.setVisible(false);
    this.add([this.bg, this.label, this.usesText, this.dimOverlay]);
    scene.add.existing(this);
  }

  /** Sync the card to a server-side Ring schema object. */
  updateFromRing(ring: any): void {
    this._element = ring.element;
    this._isExtinguished = ring.isExtinguished;
    this.bg.setFillStyle(ELEMENT_COLORS[ring.element]);
    this.label.setText(ELEMENT_NAMES[ring.element]);
    const used = ring.maxUses - ring.currentUses;
    this.usesText.setText('●'.repeat(ring.currentUses) + '○'.repeat(used));
    this.dimOverlay.setVisible(ring.isExtinguished);
  }

  get element(): number {
    return this._element;
  }

  get isExtinguished(): boolean {
    return this._isExtinguished;
  }
}
