import Phaser from 'phaser';
import { ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';

export interface RingData {
  id: string;
  element: number;
  tier: number;
  max_uses: number;
  current_uses: number;
  xp: number;
  escrowed: number; // 0 or 1
  in_carry: number; // 0 or 1 (#40 — carried on expedition)
}

const CARD_W = 64;
const CARD_H = 88;
const COL_GAP = 72; // column 1 at x=0, column 2 at x=72
const ROW_GAP = 92; // card height + 4px gap

const DESELECTED_STROKE = 0x888888;
const SELECTED_STROKE = 0xffff00;

/**
 * A 2-column grid of ring cards rendered from plain REST API ring data.
 * Clicking a card selects it (or deselects if already selected). Escrowed
 * rings are dimmed and not interactive. Fires `onSelect` on every change.
 */
export class InventoryGrid extends Phaser.GameObjects.Container {
  private selected: RingData | null = null;
  private readonly cards: Map<string, Phaser.GameObjects.Container> = new Map();
  // Background rectangle per ring id, used to toggle selection stroke without
  // relying on the card container's child ordering.
  private readonly cardBgs: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private readonly onSelect: (ring: RingData | null) => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onSelect: (ring: RingData | null) => void,
  ) {
    super(scene, x, y);
    this.onSelect = onSelect;
    scene.add.existing(this);
  }

  /**
   * Clear and re-render all ring cards. Sort by element then id for stable
   * ordering across refreshes.
   */
  populate(rings: RingData[]): void {
    // Destroy previous card game objects.
    this.cards.forEach((c) => c.destroy());
    this.cards.clear();
    this.cardBgs.clear();
    this.selected = null;

    const sorted = [...rings].sort((a, b) =>
      a.element !== b.element ? a.element - b.element : a.id.localeCompare(b.id),
    );

    sorted.forEach((ring, idx) => {
      const col = idx % 2;
      const row = Math.floor(idx / 2);
      const cx = col * COL_GAP + CARD_W / 2;
      const cy = row * ROW_GAP + CARD_H / 2;

      const container = this.scene.add.container(cx, cy);

      const bg = this.scene.add.rectangle(0, 0, CARD_W, CARD_H, ELEMENT_COLORS[ring.element] ?? 0x444444);
      bg.setStrokeStyle(2, DESELECTED_STROKE);

      const nameText = this.scene.add
        .text(0, -32, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' })
        .setOrigin(0.5);

      const usedCount = ring.max_uses - ring.current_uses;
      const pips = '●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, usedCount));
      const pipsText = this.scene.add
        .text(0, -10, pips, { fontSize: '10px', color: '#000000' })
        .setOrigin(0.5);

      const xpText = this.scene.add
        .text(0, 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' })
        .setOrigin(0.5);

      const tierText = this.scene.add
        .text(0, 26, `T${ring.tier}`, { fontSize: '9px', color: '#000000' })
        .setOrigin(0.5);

      container.add([bg, nameText, pipsText, xpText, tierText]);

      if (ring.escrowed) {
        container.setAlpha(0.4);
      } else {
        bg.setInteractive({ useHandCursor: true });
        bg.on('pointerdown', () => this.handleClick(ring, bg));
      }

      this.add(container);
      this.cards.set(ring.id, container);
      this.cardBgs.set(ring.id, bg);
    });
  }

  private handleClick(ring: RingData, bg: Phaser.GameObjects.Rectangle): void {
    if (this.selected?.id === ring.id) {
      // Deselect.
      bg.setStrokeStyle(2, DESELECTED_STROKE);
      this.selected = null;
      this.onSelect(null);
    } else {
      // Deselect previous via its background ref (not container child ordering).
      if (this.selected) {
        this.cardBgs.get(this.selected.id)?.setStrokeStyle(2, DESELECTED_STROKE);
      }
      bg.setStrokeStyle(3, SELECTED_STROKE);
      this.selected = ring;
      this.onSelect(ring);
    }
  }

  getSelected(): RingData | null {
    return this.selected;
  }

  clearSelection(): void {
    if (this.selected) {
      this.cardBgs.get(this.selected.id)?.setStrokeStyle(2, DESELECTED_STROKE);
      this.selected = null;
      this.onSelect(null);
    }
  }
}
