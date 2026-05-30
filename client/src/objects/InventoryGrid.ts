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

// #85 Fix 2A — scroll UI geometry. The ▲/▼ buttons sit just right of the last
// column at the visible window's top/bottom. The exact x is computed per-instance
// from numCols (see arrowX()) so a 3-column grid pushes the arrows further right.

export const GRID_CARD_W = CARD_W;
export const GRID_COL_GAP = COL_GAP;
export const GRID_ROW_GAP = ROW_GAP;

/**
 * A grid of ring cards (numCols-wide, default 2) rendered from plain REST API
 * ring data.
 * Clicking a card selects it (or deselects if already selected). Escrowed
 * rings are dimmed and not interactive. Fires `onSelect` on every change.
 *
 * #85 Fix 2A — when many rings overflow the panel's modal column the grid is made
 * scrollable: cards live in an inner `cardContainer` clipped by a GeometryMask so
 * only `visibleRows` are shown, with ▲/▼ buttons (on the grid itself, NOT the
 * scrolled container) advancing one row at a time. setVisibleRows(0) restores the
 * pre-#85 unbounded behavior. Hit-testing of cards inside the visible window is
 * preserved because the mask clips render only — the bg hit areas are unaffected.
 */
export class InventoryGrid extends Phaser.GameObjects.Container {
  private selected: RingData | null = null;
  private readonly cards: Map<string, Phaser.GameObjects.Container> = new Map();
  // Background rectangle per ring id, used to toggle selection stroke without
  // relying on the card container's child ordering.
  private readonly cardBgs: Map<string, Phaser.GameObjects.Rectangle> = new Map();
  private readonly onSelect: (ring: RingData | null) => void;

  // #85 Fix 2A — scroll state. Cards render into cardContainer (scrolled by row);
  // the arrows live on `this` so they never scroll themselves. Clipping is done
  // by visibility-windowing (show only cards in [scrollRow, scrollRow+visibleRows))
  // rather than a GeometryMask, which is unreliable in nested Container / multi-
  // camera setups in Phaser 4 (stencil coordinate system diverges from render).
  private readonly cardContainer: Phaser.GameObjects.Container;
  // Per-ring row index used to show/hide cards outside the visible window.
  private readonly cardRows: Map<string, number> = new Map();
  private upArrow: Phaser.GameObjects.Text | null = null;
  private downArrow: Phaser.GameObjects.Text | null = null;
  private visibleRows = 0; // 0 → scroll/windowing disabled (unbounded grid)
  private totalRows = 0;
  private scrollRow = 0;
  // Explicit screen-space mask origin set by the owning scene after adoptPanel.
  // When set, applyMask uses these coordinates directly instead of the potentially
  // unreliable getWorldTransformMatrix() (which can disagree with actual render
  // position when the grid is inside a multi-camera nested Container hierarchy).
  private maskOriginX: number | null = null;
  private maskOriginY: number | null = null;
  // #154 — number of columns the grid wraps at. The Reliquary/Spare grids in the
  // Reliquary modal are 3-wide; legacy callers default to 2. Drives populate()'s
  // col wrap and the scroll-arrow x.
  private readonly numCols: number;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    onSelect: (ring: RingData | null) => void,
    numCols = 2,
  ) {
    super(scene, x, y);
    this.onSelect = onSelect;
    this.numCols = numCols;
    this.cardContainer = scene.add.container(0, 0);
    this.add(this.cardContainer);
    scene.add.existing(this);
  }

  /**
   * Pin the mask clip rectangle to an explicit screen-space position. Call this
   * after adoptPanel() positions the grid in the overlay so applyMask() doesn't
   * have to infer the position from getWorldTransformMatrix(), which can diverge
   * from the actual render position in a multi-camera nested Container hierarchy.
   * Pass null/null to revert to the world-transform fallback.
   */
  setMaskOrigin(screenX: number | null, screenY: number | null): void {
    this.maskOriginX = screenX;
    this.maskOriginY = screenY;
  }

  /**
   * Local x for the ▲/▼ scroll arrows: just right of the last column. Computed
   * from numCols so a wider grid pushes the arrows out instead of overlapping the
   * rightmost card column.
   */
  private arrowX(): number {
    return (this.numCols - 1) * COL_GAP + CARD_W + 12;
  }

  /**
   * Clear and re-render all ring cards. Sort by element then id for stable
   * ordering across refreshes. Resets scroll to row 0 (#85 Fix 2A).
   */
  populate(rings: RingData[]): void {
    // Destroy previous card game objects.
    this.cards.forEach((c) => c.destroy());
    this.cards.clear();
    this.cardBgs.clear();
    this.cardRows.clear();
    this.selected = null;

    const sorted = [...rings].sort((a, b) =>
      a.element !== b.element ? a.element - b.element : a.id.localeCompare(b.id),
    );

    sorted.forEach((ring, idx) => {
      const col = idx % this.numCols;
      const row = Math.floor(idx / this.numCols);
      const cx = col * COL_GAP + CARD_W / 2;
      const cy = row * ROW_GAP + CARD_H / 2;

      const container = this.scene.add.container(cx, cy);

      const bg = this.scene.add.rectangle(0, 0, CARD_W, CARD_H, ELEMENT_COLORS[ring.element] ?? 0x444444);
      // The ring-storage overlay is camera-pinned (scrollFactor 0). The leaf bg's
      // own scrollFactor must match, or Phaser's hit-test offsets the hit area by
      // the camera scroll amount (card renders right, clicks land off — #78 ①).
      bg.setScrollFactor(0);
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

      // Cards go into the scrolled inner container, not directly on the grid, so
      // setScrollRow can offset them while the arrows stay put (#85 Fix 2A).
      this.cardContainer.add(container);
      this.cards.set(ring.id, container);
      this.cardBgs.set(ring.id, bg);
      this.cardRows.set(ring.id, row);
    });

    this.totalRows = Math.ceil(sorted.length / this.numCols);
    this.scrollRow = 0;
    this.cardContainer.y = 0;
    this.updateCardVisibility();
    this.updateScrollUI();
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

  /** Returns the interactive background rectangle for a card by ring id (E2E). */
  getCardBg(ringId: string): Phaser.GameObjects.Rectangle | undefined {
    return this.cardBgs.get(ringId);
  }

  clearSelection(): void {
    if (this.selected) {
      this.cardBgs.get(this.selected.id)?.setStrokeStyle(2, DESELECTED_STROKE);
      this.selected = null;
      this.onSelect(null);
    }
  }

  // ── Scroll API (#85 Fix 2A) ───────────────────────────────────────────────

  /**
   * Enable visibility-windowed scrolling to `rows` visible rows; pass 0 to disable
   * (unbounded grid, all cards visible). Shows scroll arrows when scrollable.
   * Cards outside [scrollRow, scrollRow+rows) are hidden rather than masked —
   * this is reliable across all camera/container configurations in Phaser 4.
   */
  setVisibleRows(rows: number): void {
    this.visibleRows = rows;
    if (rows > 0) {
      this.ensureArrows(rows);
    } else {
      this.removeArrows();
    }
    // Re-clamp scroll, re-apply card visibility, refresh arrow state.
    this.setScrollRow(this.scrollRow);
    this.updateScrollUI();
  }

  /** Scroll by a number of rows (positive = down), clamped to the valid range. */
  scrollBy(delta: number): void {
    this.setScrollRow(this.scrollRow + delta);
  }

  /**
   * Set the top visible row, clamped to [0, totalRows - visibleRows]. Offsets the
   * inner cardContainer (cardContainer.y = -row * ROW_GAP) so the arrows and mask
   * stay anchored to the grid. No-op semantics when not scrollable (clamps to 0).
   */
  setScrollRow(row: number): void {
    const maxRow = Math.max(0, this.totalRows - this.visibleRows);
    const clamped = Phaser.Math.Clamp(row, 0, this.visibleRows > 0 ? maxRow : 0);
    this.scrollRow = clamped;
    this.cardContainer.y = -clamped * ROW_GAP;
    this.updateCardVisibility();
    this.updateScrollUI();
  }

  /** Whether the grid currently overflows its visible window (scroll is active). */
  isScrollable(): boolean {
    return this.visibleRows > 0 && this.totalRows > this.visibleRows;
  }

  /** Local-space visible-window dimensions used for wheel hit-testing (#85). */
  getMaskSize(): { width: number; height: number } {
    const rows = this.visibleRows > 0 ? this.visibleRows : this.totalRows;
    return {
      width: (this.numCols - 1) * COL_GAP + CARD_W,
      height: Math.max(0, rows * ROW_GAP),
    };
  }

  /** E2E read accessors for the scroll state (#85 Fix 2A). */
  getScrollRow(): number {
    return this.scrollRow;
  }
  getTotalRows(): number {
    return this.totalRows;
  }
  getVisibleRows(): number {
    return this.visibleRows;
  }
  /** The inner scrolled container — used by E2E to assert local y offset. */
  getCardContainer(): Phaser.GameObjects.Container {
    return this.cardContainer;
  }

  // ── Scroll internals ──────────────────────────────────────────────────────

  /**
   * Show only cards whose row falls within [scrollRow, scrollRow + visibleRows).
   * When visibleRows = 0 (unbounded), all cards are shown. This replaces the
   * former GeometryMask approach, which was unreliable in nested Container /
   * multi-camera configurations in Phaser 4 (stencil coordinate space diverged
   * from actual render position, causing overflow above the visible window).
   */
  private updateCardVisibility(): void {
    this.cards.forEach((container, ringId) => {
      if (this.visibleRows <= 0) {
        container.setVisible(true);
        return;
      }
      const row = this.cardRows.get(ringId) ?? 0;
      container.setVisible(row >= this.scrollRow && row < this.scrollRow + this.visibleRows);
    });
  }

  /** Lazily create the ▲/▼ scroll buttons on the grid (not the cardContainer). */
  private ensureArrows(rows: number): void {
    const ax = this.arrowX();
    if (!this.upArrow) {
      this.upArrow = this.scene.add
        .text(ax, ROW_GAP / 2 - 8, '▲', { fontSize: '20px', color: '#cfe3ff' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setName('grid-scroll-up')
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scrollBy(-1));
      this.add(this.upArrow);
    }
    if (!this.downArrow) {
      this.downArrow = this.scene.add
        .text(ax, 0, '▼', { fontSize: '20px', color: '#cfe3ff' })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setName('grid-scroll-down')
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.scrollBy(1));
      this.add(this.downArrow);
    }
    this.downArrow.setY(rows * ROW_GAP - 16);
  }

  private removeArrows(): void {
    this.upArrow?.destroy();
    this.downArrow?.destroy();
    this.upArrow = null;
    this.downArrow = null;
  }

  /**
   * Show each arrow only when scrollable AND there is room to move in its
   * direction; hide both at the edges or when the grid fits the window.
   */
  private updateScrollUI(): void {
    const canScroll = this.isScrollable();
    this.upArrow?.setVisible(canScroll && this.scrollRow > 0);
    this.downArrow?.setVisible(
      canScroll && this.scrollRow < this.totalRows - this.visibleRows,
    );
  }
}
