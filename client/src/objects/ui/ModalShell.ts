import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../../Constants';
import { crispCanvasText } from './DomLabel';

/**
 * Shared modal shell (EPIC #291 / WS D — DRY remediation). Five simple modals
 * (CampfireModal, FusionPanel, MerchantModal, OverworldMapModal, BattleEndModal)
 * each re-implemented the same scaffold: a depth-stacked container, a full-canvas
 * semi-transparent interactive backdrop, a stroked centered panel, a centered
 * title, and a top-right close glyph — every piece pinned with `scrollFactor(0)`
 * so the overlay never scrolls with the world camera. The close glyph had drifted
 * across files (`[×]` vs `×` vs `✕`); the canonical glyph is now ✕ (U+2715).
 *
 * `createOverlay` builds that scaffold and returns the container (callers add
 * their own content to it), the panel rect (so a caller can recolor its stroke —
 * e.g. BattleEndModal's win/lose border), and a `setStatus` helper that drives an
 * optional bottom status line. Modals with no status line simply never call it.
 *
 * Display-only: this is pure scaffolding; the server owns all game logic.
 */

/** The canonical close glyph (U+2715). All migrated modals adopt this. */
export const CLOSE_GLYPH = '✕';

/** Options for {@link createOverlay}. Required fields match the WS D spec. */
export interface ModalShellOpts {
  /** Panel width in px. */
  width: number;
  /** Panel height in px. */
  height: number;
  /** Title shown centered at the panel top. */
  title: string;
  /** Fired when the close glyph is clicked. */
  onClose: () => void;

  // ── Optional styling (each modal kept its own palette) ──────────────────────
  /** Container depth (default 4000). */
  depth?: number;
  /** Backdrop fill alpha (default 0.78). */
  backdropAlpha?: number;
  /** Panel fill color (default 0x161622). */
  panelColor?: number;
  /** Panel stroke color (default 0x6082aa). */
  strokeColor?: number;
  /** Panel stroke width (default 2). */
  strokeWidth?: number;
  /** Title text color (default '#ffffff'). */
  titleColor?: string;
  /** Title font size (default '20px'). */
  titleSize?: string;
  /**
   * Center the panel at the canvas center (default true). Pass false to position
   * the panel via an explicit `panelX`/`panelY` (OverworldMapModal anchors its
   * panel at a computed top-left).
   */
  centered?: boolean;
  /** Explicit panel center x when `centered` is false. */
  panelX?: number;
  /** Explicit panel center y when `centered` is false. */
  panelY?: number;
  /** Add a bottom status line wired to `setStatus` (default false). */
  withStatus?: boolean;
}

/** What {@link createOverlay} hands back to a modal. */
export interface ModalShell {
  /** The root overlay container (depth-stacked, scrollFactor 0). Add content here. */
  container: Phaser.GameObjects.Container;
  /** The panel rectangle — recolor its stroke for win/lose etc. */
  panel: Phaser.GameObjects.Rectangle;
  /** Update the optional bottom status line (no-op if `withStatus` was false). */
  setStatus: (msg: string, color?: string) => void;
}

/**
 * Build the shared modal scaffold (backdrop + panel + title + close-X), all
 * camera-pinned via `scrollFactor(0)`. The caller adds its own widgets to the
 * returned `container` and tears the modal down by destroying that container.
 */
export function createOverlay(scene: Phaser.Scene, opts: ModalShellOpts): ModalShell {
  const centered = opts.centered ?? true;
  const px = centered ? CANVAS_W / 2 : (opts.panelX ?? CANVAS_W / 2);
  const py = centered ? CANVAS_H / 2 : (opts.panelY ?? CANVAS_H / 2);

  const container = scene.add
    .container(0, 0)
    .setDepth(opts.depth ?? 4000)
    .setScrollFactor(0);

  const backdrop = scene.add
    .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, opts.backdropAlpha ?? 0.78)
    .setScrollFactor(0)
    .setInteractive();

  const panel = scene.add
    .rectangle(px, py, opts.width, opts.height, opts.panelColor ?? 0x161622)
    .setStrokeStyle(opts.strokeWidth ?? 2, opts.strokeColor ?? 0x6082aa)
    .setScrollFactor(0);

  // #382 — title and close-X are Container children → crispCanvasText.
  const title = crispCanvasText(
    scene.add
      .text(px, py - opts.height / 2 + 18, opts.title, {
        fontSize: opts.titleSize ?? '20px',
        color: opts.titleColor ?? '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0),
  );

  const closeBtn = crispCanvasText(
    scene.add
      .text(px + opts.width / 2 - 18, py - opts.height / 2 + 16, CLOSE_GLYPH, {
        fontSize: '16px',
        color: '#ff8888',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', opts.onClose),
  );

  container.add([backdrop, panel, title, closeBtn]);

  let statusText: Phaser.GameObjects.Text | null = null;
  let statusTween: Phaser.Tweens.Tween | null = null;

  if (opts.withStatus) {
    // #382 — Container child → crispCanvasText.
    statusText = crispCanvasText(
      scene.add
        .text(px, py + opts.height / 2 - 24, '', { fontSize: '13px', color: '#ff8888' })
        .setOrigin(0.5)
        .setScrollFactor(0),
    );
    container.add(statusText);
  }

  // Kill the status tween when the container is destroyed so it can never
  // fire onComplete against a destroyed statusText texture (#400 regression:
  // fetchAndReopenCampfireModal destroys the placeholder modal while a status
  // tween is still running, causing Frame.updateUVs to throw on a null texture
  // source and freeze Phaser's render loop for the session).
  container.once(Phaser.GameObjects.Events.DESTROY, () => {
    statusTween?.destroy();
    statusTween = null;
  });

  const setStatus = (msg: string, color = '#ff8888'): void => {
    if (!statusText) return;
    statusText.setColor(color).setText(msg);
    statusTween?.destroy();
    statusTween = scene.tweens.add({
      targets: statusText,
      alpha: { from: 1, to: 0 },
      delay: 2000,
      duration: 600,
      onComplete: () => {
        statusTween = null;
        // Guard: statusText may be destroyed if the modal was closed before
        // the tween completed (e.g. fetchAndReopenCampfireModal placeholder swap).
        if (statusText && !statusText.isDestroyed) {
          statusText.setAlpha(1).setText('');
        }
      },
    });
  };

  return { container, panel, setStatus };
}
