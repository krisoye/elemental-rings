import Phaser from 'phaser';
import { ELEMENT_COLORS, FUSED_CARD_SPLIT } from '../Constants';
import { componentsOf } from '../../../shared/fusions';

/**
 * #263 — two-tone fused ring card fill. A fused ring paints two half-rects, one
 * per component color (Mud = Water-blue + Earth-brown), matching the two-orb
 * combat telegraph. A base ring (1 component) paints a single fill, identical to
 * the pre-#263 look.
 *
 * Geometry (card centered at the bg's local origin, width `w` × height `h`):
 *   - 'vertical'   → top half (component 0) at y = −h/4, bottom (1) at y = +h/4,
 *                    each w × h/2.
 *   - 'horizontal' → left half (0) at x = −w/4, right (1) at x = +w/4,
 *                    each w/2 × h.
 *
 * The card's existing background Rectangle is reused for the stroke border and
 * hit area; this helper draws the colored halves ON TOP of it (and below the
 * card's text labels, which are added after). The halves are inset by
 * `STROKE_INSET` px on every side so the bg's stroke border stays visible
 * around the fill. `orderedComponents[0]` is always the top/left half (the
 * dominant parent — EPIC #256 Contracts).
 */

// Inset (px per side) so the underlying bg stroke border shows around the fill.
const STROKE_INSET = 2;

export class FusedCardFill {
  private readonly halfA: Phaser.GameObjects.Rectangle;
  private readonly halfB: Phaser.GameObjects.Rectangle;
  private readonly fw: number;
  private readonly fh: number;

  /**
   * Build the two half-rects centered at (cx, cy) within `container`. They are
   * inserted directly after construction; callers add their text labels AFTER so
   * labels render on top. Both rects copy the bg's scrollFactor when supplied so
   * camera-pinned overlays keep the fill aligned with the card.
   */
  constructor(
    scene: Phaser.Scene,
    container: Phaser.GameObjects.Container,
    private readonly cx: number,
    private readonly cy: number,
    w: number,
    h: number,
    scrollFactor = 1,
  ) {
    this.fw = w - STROKE_INSET * 2;
    this.fh = h - STROKE_INSET * 2;
    this.halfA = scene.add.rectangle(cx, cy, this.fw, this.fh, 0x000000, 0).setScrollFactor(scrollFactor);
    this.halfB = scene.add.rectangle(cx, cy, this.fw, this.fh, 0x000000, 0).setScrollFactor(scrollFactor);
    container.add([this.halfA, this.halfB]);
  }

  /**
   * Paint the fill for `element`. For a fusion, `ordered` (dominant-first) sets
   * which color leads (top/left); when omitted it falls back to the static
   * `componentsOf(element)` order (shop preview rows / rings with no recorded
   * parent). For a base ring both halves render the single element color so the
   * card looks like the pre-#263 single fill.
   *
   * Returns the rendered component order so callers can publish it for E2E.
   */
  paint(element: number, ordered?: number[]): number[] {
    const components =
      ordered && ordered.length >= 2 ? ordered : componentsOf(element);
    const split = FUSED_CARD_SPLIT;

    if (components.length < 2) {
      // Base ring — a single uniform fill across both halves at full size.
      const color = ELEMENT_COLORS[element] ?? 0x333333;
      this.layoutHalf(this.halfA, color, 0, split, true);
      this.halfB.setAlpha(0);
      return [element];
    }

    const colorA = ELEMENT_COLORS[components[0]] ?? 0x333333;
    const colorB = ELEMENT_COLORS[components[1]] ?? 0x333333;
    this.layoutHalf(this.halfA, colorA, 0, split, false);
    this.layoutHalf(this.halfB, colorB, 1, split, false);
    return [components[0], components[1]];
  }

  /** Hide both halves (empty slot — the bg's own grey fill shows through). */
  clear(): void {
    this.halfA.setAlpha(0);
    this.halfB.setAlpha(0);
  }

  /**
   * Resize and position one half-rect. `index` 0 = top/left, 1 = bottom/right.
   * `full` makes the rect cover the whole card (base-ring single fill).
   */
  private layoutHalf(
    rect: Phaser.GameObjects.Rectangle,
    color: number,
    index: number,
    split: 'horizontal' | 'vertical',
    full: boolean,
  ): void {
    rect.setFillStyle(color, 1).setAlpha(1);
    if (full) {
      rect.setSize(this.fw, this.fh);
      rect.setPosition(this.cx, this.cy);
      return;
    }
    if (split === 'vertical') {
      rect.setSize(this.fw, this.fh / 2);
      rect.setPosition(this.cx, this.cy + (index === 0 ? -this.fh / 4 : this.fh / 4));
    } else {
      rect.setSize(this.fw / 2, this.fh);
      rect.setPosition(this.cx + (index === 0 ? -this.fw / 4 : this.fw / 4), this.cy);
    }
  }
}
