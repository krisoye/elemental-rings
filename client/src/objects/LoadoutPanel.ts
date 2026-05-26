import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';
import type { RingData } from './InventoryGrid';

export type LoadoutSlot = 'a1' | 'a2' | 'd1' | 'd2';

const CARD_W = 70;
const CARD_H = 90;
const COL_GAP = 78;
const ROW_GAP = 98;

const SLOT_DEFS: { slot: LoadoutSlot; label: string; col: number; row: number }[] = [
  { slot: 'a1', label: 'A1', col: 0, row: 0 },
  { slot: 'a2', label: 'A2', col: 1, row: 0 },
  { slot: 'd1', label: 'D1', col: 0, row: 1 },
  { slot: 'd2', label: 'D2', col: 1, row: 1 },
];

/**
 * 2×2 grid showing the four combat loadout slots (A1, A2, D1, D2). Clicking a
 * slot card while a ring is selected triggers `onAssign(slot)`. Briefly
 * highlights the slot yellow on click for feedback.
 */
export class LoadoutPanel extends Phaser.GameObjects.Container {
  private readonly slotBgs: Map<LoadoutSlot, Phaser.GameObjects.Rectangle> = new Map();
  private readonly slotLabels: Map<LoadoutSlot, Phaser.GameObjects.Text[]> = new Map();

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onAssign: (slot: LoadoutSlot) => void,
  ) {
    super(scene, x, y);

    for (const def of SLOT_DEFS) {
      const cx = def.col * COL_GAP + CARD_W / 2;
      const cy = def.row * ROW_GAP + CARD_H / 2;

      const bg = scene.add.rectangle(cx, cy, CARD_W, CARD_H, 0x333333);
      // Match the camera-pinned ring-storage overlay so the hit area aligns with
      // the render position under camera scroll (#78 ①).
      bg.setScrollFactor(0);
      bg.setStrokeStyle(2, 0x666666);
      bg.setInteractive({ useHandCursor: true });

      const slotLbl = scene.add
        .text(cx, cy - 36, def.label, { fontSize: '10px', color: '#aaaaaa' })
        .setOrigin(0.5);
      const elemLbl = scene.add
        .text(cx, cy - 18, '—', { fontSize: '10px', color: '#888888' })
        .setOrigin(0.5);
      const usesLbl = scene.add
        .text(cx, cy + 0, '', { fontSize: '9px', color: '#ffff88' })
        .setOrigin(0.5);
      const xpLbl = scene.add
        .text(cx, cy + 18, '', { fontSize: '9px', color: '#000000' })
        .setOrigin(0.5);
      const tierLbl = scene.add
        .text(cx, cy + 32, '', { fontSize: '9px', color: '#000000' })
        .setOrigin(0.5);

      bg.on('pointerdown', () => {
        bg.setStrokeStyle(3, 0xffff00);
        scene.time.delayedCall(150, () => bg.setStrokeStyle(2, 0x666666));
        onAssign(def.slot);
      });

      this.slotBgs.set(def.slot, bg);
      this.slotLabels.set(def.slot, [slotLbl, elemLbl, usesLbl, xpLbl, tierLbl]);

      this.add([bg, slotLbl, elemLbl, usesLbl, xpLbl, tierLbl]);
    }

    scene.add.existing(this);
  }

  /**
   * Update all slot cards from the current loadout and ring map.
   * @param loadout - partial loadout record (slot → ringId | null)
   * @param ringMap - ringId → RingData for element/uses lookup
   */
  updateFromLoadout(loadout: Record<string, string | null>, ringMap: Map<string, RingData>): void {
    for (const def of SLOT_DEFS) {
      const ringId = loadout[def.slot] ?? null;
      const ring = ringId ? ringMap.get(ringId) : null;
      const bg = this.slotBgs.get(def.slot)!;
      const [, elemLbl, usesLbl, xpLbl, tierLbl] = this.slotLabels.get(def.slot)!;

      if (ring) {
        bg.setFillStyle(ELEMENT_COLORS[ring.element] ?? 0x333333);
        bg.setStrokeStyle(2, 0x666666);
        elemLbl.setText(ELEMENT_NAMES[ring.element] ?? '?').setColor('#000000');
        const used = ring.max_uses - ring.current_uses;
        usesLbl
          .setText('●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used)))
          .setColor('#000000');
        xpLbl.setText(`XP:${ring.xp}`).setColor('#000000');
        tierLbl.setText(`T${ring.tier}`).setColor('#000000');
      } else {
        bg.setFillStyle(0x333333);
        bg.setStrokeStyle(2, 0x666666);
        elemLbl.setText('—').setColor('#888888');
        usesLbl.setText('');
        xpLbl.setText('');
        tierLbl.setText('');
      }
    }
  }
}
