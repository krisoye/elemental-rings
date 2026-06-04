import Phaser from 'phaser';
import { ELEMENT_NAMES } from '../../../../shared/elements';
import { FusedCardFill } from '../fusedFill';
import { crispCanvasText } from './DomLabel';

/**
 * Shared ring-card widget (EPIC #291 / WS D — DRY remediation). RingSlot,
 * StakePanel, and LoadoutPanel each independently painted the same card body: a
 * background rectangle (which also carries the stroke + hit area), a two-tone
 * {@link FusedCardFill} on top, then four stacked stat rows — element name, use
 * pips, XP, and tier — plus a selection / active stroke. RingCard owns that body;
 * each panel keeps only its own chrome (RingSlot's combo glow / Blinded `?` / dim
 * overlay, StakePanel's escrow lock + hint, LoadoutPanel's 2×2 grid + per-slot
 * label) and composes a RingCard for the shared visuals.
 *
 * Display-only: the server is authoritative on every ring stat shown here.
 */

/** A minimal ring view the card renders. Both the REST RingData and the schema
 * Ring satisfy it (callers pass current/max uses explicitly). */
export interface RingCardData {
  element: number;
  tier: number;
  xp: number;
  currentUses: number;
  maxUses: number;
  /** Dominant-first fusion component order; [] / undefined for a base ring. */
  fusionParents?: number[];
}

/** Tuning so each panel reproduces its existing look exactly. */
export interface RingCardOpts {
  width: number;
  height: number;
  /** Center x of the card within its parent (default 0). */
  cx?: number;
  /** Center y of the card within its parent (default 0). */
  cy?: number;
  /** Camera scrollFactor for bg + fill (default 1; panels pin to 0). */
  scrollFactor?: number;
  /** bg fill color (default 0x333333). */
  bgColor?: number;
  /** Default (deselected) stroke color (default 0x888888). */
  strokeColor?: number;
  /** Default stroke width (default 2). */
  strokeWidth?: number;
  /** Text color for the stat rows (default '#000000', the dark-on-fill look). */
  textColor?: string;
  /** Color for the use-pips row when it differs from the other rows (default = textColor). */
  pipsColor?: string;
  /** Font size for element/xp/tier rows (default '9px'). */
  fontSize?: string;
  /** Font size for the use-pips row (default matches `fontSize`). */
  pipsFontSize?: string;
  /** Vertical offsets (relative to card center) for each stat row. */
  elementY?: number;
  pipsY?: number;
  xpY?: number;
  tierY?: number;
  /** XP row prefix (some panels show 'XP:', others 'Xp: '). */
  xpPrefix?: string;
}

/**
 * The use-pip string: `current` filled pips (●) followed by the remaining empty
 * pips (○) up to `max`. The single canonical implementation of a string that was
 * inlined across seven files.
 */
export function usePips(current: number, max: number): string {
  return '●'.repeat(Math.max(0, current)) + '○'.repeat(Math.max(0, max - current));
}

/**
 * The shared ring-card body. Renders bg + fused fill + four stat rows centered on
 * (cx, cy) within its own container space. `setRing` repaints from a ring view;
 * `clear` blanks it to the empty-slot look; `setStroke` drives the selection /
 * active border.
 */
export class RingCard extends Phaser.GameObjects.Container {
  readonly bg: Phaser.GameObjects.Rectangle;
  private readonly fusedFill: FusedCardFill;
  private readonly elementLabel: Phaser.GameObjects.Text;
  private readonly pipsLabel: Phaser.GameObjects.Text;
  private readonly xpLabel: Phaser.GameObjects.Text;
  private readonly tierLabel: Phaser.GameObjects.Text;
  private readonly o: Required<
    Pick<
      RingCardOpts,
      | 'cx' | 'cy' | 'scrollFactor' | 'bgColor' | 'strokeColor' | 'strokeWidth'
      | 'textColor' | 'pipsColor' | 'fontSize' | 'pipsFontSize' | 'elementY' | 'pipsY'
      | 'xpY' | 'tierY' | 'xpPrefix'
    >
  > & { width: number; height: number };

  constructor(scene: Phaser.Scene, x: number, y: number, opts: RingCardOpts) {
    super(scene, x, y);
    const fontSize = opts.fontSize ?? '9px';
    this.o = {
      width: opts.width,
      height: opts.height,
      cx: opts.cx ?? 0,
      cy: opts.cy ?? 0,
      scrollFactor: opts.scrollFactor ?? 1,
      bgColor: opts.bgColor ?? 0x333333,
      strokeColor: opts.strokeColor ?? 0x888888,
      strokeWidth: opts.strokeWidth ?? 2,
      textColor: opts.textColor ?? '#000000',
      pipsColor: opts.pipsColor ?? opts.textColor ?? '#000000',
      fontSize,
      pipsFontSize: opts.pipsFontSize ?? fontSize,
      elementY: opts.elementY ?? -20,
      pipsY: opts.pipsY ?? -4,
      xpY: opts.xpY ?? 10,
      tierY: opts.tierY ?? 26,
      xpPrefix: opts.xpPrefix ?? 'Xp: ',
    };
    const { cx, cy } = this.o;

    this.bg = scene.add
      .rectangle(cx, cy, this.o.width, this.o.height, this.o.bgColor)
      .setScrollFactor(this.o.scrollFactor)
      .setStrokeStyle(this.o.strokeWidth, this.o.strokeColor);
    this.add(this.bg);

    // Two-tone fill sits ON TOP of bg (which keeps the stroke + hit area) and
    // BELOW the labels added next.
    this.fusedFill = new FusedCardFill(scene, this, cx, cy, this.o.width, this.o.height, this.o.scrollFactor);

    this.elementLabel = crispCanvasText(
      scene.add
        .text(cx, cy + this.o.elementY, '', { fontSize: this.o.fontSize, color: this.o.textColor })
        .setOrigin(0.5),
    );
    this.pipsLabel = crispCanvasText(
      scene.add
        .text(cx, cy + this.o.pipsY, '', { fontSize: this.o.pipsFontSize, color: this.o.pipsColor })
        .setOrigin(0.5),
    );
    this.xpLabel = crispCanvasText(
      scene.add
        .text(cx, cy + this.o.xpY, '', { fontSize: this.o.fontSize, color: this.o.textColor })
        .setOrigin(0.5),
    );
    this.tierLabel = crispCanvasText(
      scene.add
        .text(cx, cy + this.o.tierY, '', { fontSize: this.o.fontSize, color: this.o.textColor })
        .setOrigin(0.5),
    );
    this.add([this.elementLabel, this.pipsLabel, this.xpLabel, this.tierLabel]);
  }

  /** Paint the card from a ring view. Returns the rendered fused-fill order. */
  setRing(ring: RingCardData): number[] {
    const ordered =
      ring.fusionParents && ring.fusionParents.length >= 2 ? ring.fusionParents : undefined;
    const order = this.fusedFill.paint(ring.element, ordered);
    this.elementLabel.setText(ELEMENT_NAMES[ring.element] ?? '?');
    this.pipsLabel.setText(usePips(ring.currentUses, ring.maxUses));
    this.xpLabel.setText(`${this.o.xpPrefix}${ring.xp}`);
    this.tierLabel.setText(`T${ring.tier}`);
    return order;
  }

  /** Blank the card to the empty-slot look (single em-dash for the element row). */
  clear(emptyElementLabel = '—'): void {
    this.fusedFill.clear();
    this.elementLabel.setText(emptyElementLabel);
    this.pipsLabel.setText('');
    this.xpLabel.setText('');
    this.tierLabel.setText('');
  }

  /** Override the element-row text/color (Blinded `?`, dim em-dash, etc.). */
  setElementText(text: string, color?: string): void {
    this.elementLabel.setText(text);
    if (color) this.elementLabel.setColor(color);
  }

  /** Override the pips-row text directly (Blinded `?`). */
  setPipsText(text: string): void {
    this.pipsLabel.setText(text);
  }

  /** The currently rendered pips string (for E2E / Blinded checks). */
  get pipsText(): string {
    return this.pipsLabel.text;
  }

  /** Recolor every stat row in one call (the dark-on-fill ↔ blank toggle). */
  setTextColor(color: string): void {
    this.elementLabel.setColor(color);
    this.pipsLabel.setColor(color);
    this.xpLabel.setColor(color);
    this.tierLabel.setColor(color);
  }

  /** Set the selection / active border. */
  setStroke(width: number, color: number): void {
    this.bg.setStrokeStyle(width, color);
  }
}
