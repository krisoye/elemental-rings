import Phaser from 'phaser';
import { ELEMENT_NAMES } from '../Constants';
import type { RingData } from './InventoryGrid';
import { FusedCardFill } from './fusedFill';

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
const SELECTED_STROKE = 0xffff00;
const DESELECTED_STROKE = 0x666666;

export class LoadoutPanel extends Phaser.GameObjects.Container {
  private readonly slotBgs: Map<LoadoutSlot, Phaser.GameObjects.Rectangle> = new Map();
  // #263 — two-tone fused fill per slot card.
  private readonly slotFills: Map<LoadoutSlot, FusedCardFill> = new Map();
  private readonly slotLabels: Map<LoadoutSlot, Phaser.GameObjects.Text[]> = new Map();
  // #154 — the slot currently highlighted as the active swap selection (yellow
  // border), or null. updateFromLoadout preserves this stroke across refreshes.
  private selectedSlot: LoadoutSlot | null = null;

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
      this.add(bg);
      // #263 — two-tone fill above bg (stroke/hit kept), below labels added next.
      const fill = new FusedCardFill(scene, this, cx, cy, CARD_W, CARD_H, 0);
      this.slotFills.set(def.slot, fill);

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

      bg.on('pointerdown', () => onAssign(def.slot));

      this.slotBgs.set(def.slot, bg);
      this.slotLabels.set(def.slot, [slotLbl, elemLbl, usesLbl, xpLbl, tierLbl]);

      this.add([slotLbl, elemLbl, usesLbl, xpLbl, tierLbl]);
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
      const fill = this.slotFills.get(def.slot)!;
      const [, elemLbl, usesLbl, xpLbl, tierLbl] = this.slotLabels.get(def.slot)!;

      if (ring) {
        bg.setFillStyle(0x333333);
        fill.paint(ring.element, ring.fusionParents);
        elemLbl.setText(ELEMENT_NAMES[ring.element] ?? '?').setColor('#000000');
        const used = ring.max_uses - ring.current_uses;
        usesLbl
          .setText('●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used)))
          .setColor('#000000');
        xpLbl.setText(`XP:${ring.xp}`).setColor('#000000');
        tierLbl.setText(`T${ring.tier}`).setColor('#000000');
      } else {
        bg.setFillStyle(0x333333);
        fill.clear();
        elemLbl.setText('—').setColor('#888888');
        usesLbl.setText('');
        xpLbl.setText('');
        tierLbl.setText('');
      }
      // Preserve the yellow selection border across refreshes (#154).
      this.applySlotStroke(def.slot);
    }
  }

  /**
   * Highlight `slot` as the active swap selection (yellow border), or pass null
   * to clear any selection. Re-applies the stroke immediately. #154.
   */
  setSelectedSlot(slot: LoadoutSlot | null): void {
    const prev = this.selectedSlot;
    this.selectedSlot = slot;
    if (prev && prev !== slot) this.applySlotStroke(prev);
    if (slot) this.applySlotStroke(slot);
  }

  /** Draw a slot's border in the selected (yellow) or deselected (grey) style. */
  private applySlotStroke(slot: LoadoutSlot): void {
    const bg = this.slotBgs.get(slot);
    if (!bg) return;
    if (this.selectedSlot === slot) bg.setStrokeStyle(3, SELECTED_STROKE);
    else bg.setStrokeStyle(2, DESELECTED_STROKE);
  }
}
