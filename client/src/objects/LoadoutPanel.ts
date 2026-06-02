import Phaser from 'phaser';
import type { RingData } from './InventoryGrid';
import { RingCard } from './ui/RingCard';

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
 *
 * Each cell's card body (bg + fused fill + element/pips/xp/tier rows + selection
 * stroke) is a {@link RingCard}; this panel adds the per-slot label and owns the
 * 2×2 layout + selection state.
 */
const SELECTED_STROKE = 0xffff00;
const DESELECTED_STROKE = 0x666666;

export class LoadoutPanel extends Phaser.GameObjects.Container {
  private readonly slotCards: Map<LoadoutSlot, RingCard> = new Map();
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

      // Shared card body — camera-pinned (scrollFactor 0) so the hit area aligns
      // with the render position under camera scroll (#78 ①). Rows mirror the
      // legacy slot layout: element (−18), use pips (0), xp (18), tier (32).
      const card = new RingCard(scene, 0, 0, {
        width: CARD_W,
        height: CARD_H,
        cx,
        cy,
        scrollFactor: 0,
        strokeColor: DESELECTED_STROKE,
        textColor: '#000000',
        fontSize: '9px',
        elementY: -18,
        pipsY: 0,
        xpY: 18,
        tierY: 32,
        xpPrefix: 'XP:',
      });
      this.add(card);
      this.slotCards.set(def.slot, card);

      const bg = card.bg;
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerdown', () => onAssign(def.slot));

      const slotLbl = scene.add
        .text(cx, cy - 36, def.label, { fontSize: '10px', color: '#aaaaaa' })
        .setOrigin(0.5);
      // Empty-slot element row is a dim em-dash until a ring is assigned.
      card.setElementText('—', '#888888');

      this.add(slotLbl);
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
      const card = this.slotCards.get(def.slot)!;

      if (ring) {
        card.setRing({
          element: ring.element,
          tier: ring.tier,
          xp: ring.xp,
          currentUses: ring.current_uses,
          maxUses: ring.max_uses,
          fusionParents: ring.fusionParents,
        });
        card.setTextColor('#000000');
      } else {
        card.clear();
        card.setElementText('—', '#888888');
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
    const card = this.slotCards.get(slot);
    if (!card) return;
    if (this.selectedSlot === slot) card.setStroke(3, SELECTED_STROKE);
    else card.setStroke(2, DESELECTED_STROKE);
  }
}
