import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';
import type { RingData } from './InventoryGrid';

const CARD_W = 70;
const CARD_H = 90;

/**
 * Displays the Thumb (staked) ring slot with escrow indicator. Clicking the
 * card (when not escrowed) fires `onAssign()` to trigger ring assignment.
 */
export class StakePanel extends Phaser.GameObjects.Container {
  private readonly bg: Phaser.GameObjects.Rectangle;
  private readonly titleLbl: Phaser.GameObjects.Text;
  private readonly elemLbl: Phaser.GameObjects.Text;
  private readonly usesLbl: Phaser.GameObjects.Text;
  private readonly lockLbl: Phaser.GameObjects.Text;
  private readonly hintLbl: Phaser.GameObjects.Text;

  private escrowed = false;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onAssign: () => void,
  ) {
    super(scene, x, y);

    const cx = CARD_W / 2;
    const cy = CARD_H / 2;

    this.bg = scene.add.rectangle(cx, cy, CARD_W, CARD_H, 0x333333);
    this.bg.setStrokeStyle(2, 0xaa8800);

    this.titleLbl = scene.add
      .text(cx, cy - 34, 'THUMB', { fontSize: '9px', color: '#ffcc44' })
      .setOrigin(0.5);

    this.elemLbl = scene.add
      .text(cx, cy - 14, '—', { fontSize: '10px', color: '#888888' })
      .setOrigin(0.5);

    this.usesLbl = scene.add
      .text(cx, cy + 8, '', { fontSize: '9px', color: '#ffff88' })
      .setOrigin(0.5);

    this.lockLbl = scene.add
      .text(cx, cy + 24, '', { fontSize: '10px', color: '#ff6666' })
      .setOrigin(0.5);

    this.hintLbl = scene.add
      .text(cx, cy + 38, 'click to stake', { fontSize: '8px', color: '#666666' })
      .setOrigin(0.5);

    this.bg.setInteractive({ useHandCursor: true });
    this.bg.on('pointerdown', () => {
      if (!this.escrowed) onAssign();
    });

    this.add([this.bg, this.titleLbl, this.elemLbl, this.usesLbl, this.lockLbl, this.hintLbl]);
    scene.add.existing(this);
  }

  /**
   * Update the thumb card from the current loadout and ring map.
   * @param thumbRingId - the ring id assigned to thumb, or null
   * @param ringMap - ringId → RingData
   */
  updateFromLoadout(thumbRingId: string | null, ringMap: Map<string, RingData>): void {
    const ring = thumbRingId ? ringMap.get(thumbRingId) : null;

    if (ring) {
      this.bg.setFillStyle(ELEMENT_COLORS[ring.element] ?? 0x333333);
      this.elemLbl.setText(ELEMENT_NAMES[ring.element] ?? '?').setColor('#000000');
      const used = ring.max_uses - ring.current_uses;
      this.usesLbl
        .setText('●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used)))
        .setColor('#000000');
      this.hintLbl.setText('');

      this.escrowed = ring.escrowed === 1;
      if (this.escrowed) {
        this.lockLbl.setText('LOCKED');
        this.bg.setStrokeStyle(2, 0xff6666);
      } else {
        this.lockLbl.setText('');
        this.bg.setStrokeStyle(2, 0xaa8800);
      }
    } else {
      this.escrowed = false;
      this.bg.setFillStyle(0x333333);
      this.bg.setStrokeStyle(2, 0xaa8800);
      this.elemLbl.setText('—').setColor('#888888');
      this.usesLbl.setText('');
      this.lockLbl.setText('');
      this.hintLbl.setText('click to stake');
    }
  }
}
