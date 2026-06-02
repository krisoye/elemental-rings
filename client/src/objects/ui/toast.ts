import Phaser from 'phaser';

/**
 * Transient on-screen text that appears, holds, then alpha-fades out and destroys
 * itself (EPIC #291 / WS D — DRY remediation). The "add a label → tween alpha
 * 1→0 → destroy" pattern was duplicated across BaseBiomeScene (barrier + toast),
 * CampfireModal, and MerchantModal; the fade/teardown logic now lives here.
 *
 * Display-only — callers compute the message; this just renders and fades it.
 */

/** Tuning for {@link showTransientText}. */
export interface TransientTextOpts {
  /** Screen-space x (camera-pinned via scrollFactor 0). */
  x: number;
  /** Screen-space y. */
  y: number;
  /** The message to show. */
  text: string;
  /** Total visible time before the fade begins, in ms (default 1200). */
  duration?: number;
  /** Fade-out duration in ms once the hold elapses (default 600). */
  fadeDuration?: number;
  /** Text color (default white). */
  color?: string;
  /** Optional CSS background (e.g. '#000000aa' for the biome toast pill). */
  backgroundColor?: string;
  /** Optional padding when a background is used. */
  padding?: { x: number; y: number };
  /** Text origin (default centered, 0.5 / 0.5). */
  originX?: number;
  originY?: number;
  /** Render depth (default 1000). */
  depth?: number;
  /** Optional name so concurrent toasts can find/replace each other. */
  name?: string;
  /**
   * Fired once with the freshly created text, before the fade tween starts. Lets a
   * dual-camera host route the label to its 1:1 UI camera (`routeToUi`).
   */
  onSetup?: (text: Phaser.GameObjects.Text) => void;
  /**
   * Fired once just before the faded label is destroyed. Lets a dual-camera host
   * clear a stale main-camera ignore bit (`unignoreMain`) ahead of teardown.
   */
  onDestroy?: (text: Phaser.GameObjects.Text) => void;
}

/**
 * Create a camera-pinned label at (x, y), hold it for `duration` ms, then
 * alpha-fade it over `fadeDuration` ms and destroy it. The `onSetup`/`onDestroy`
 * hooks let a dual-camera scene route the label to its UI camera and undo that
 * routing before destroy without re-deriving the fade logic.
 */
export function showTransientText(scene: Phaser.Scene, opts: TransientTextOpts): void {
  const style: Phaser.Types.GameObjects.Text.TextStyle = {
    fontSize: '14px',
    color: opts.color ?? '#ffffff',
  };
  if (opts.backgroundColor) style.backgroundColor = opts.backgroundColor;
  if (opts.padding) style.padding = opts.padding;

  const text = scene.add
    .text(opts.x, opts.y, opts.text, style)
    .setOrigin(opts.originX ?? 0.5, opts.originY ?? 0.5)
    .setScrollFactor(0)
    .setDepth(opts.depth ?? 1000);
  if (opts.name) text.setName(opts.name);

  opts.onSetup?.(text);

  scene.tweens.add({
    targets: text,
    alpha: { from: 1, to: 0 },
    delay: opts.duration ?? 1200,
    duration: opts.fadeDuration ?? 600,
    onComplete: () => {
      opts.onDestroy?.(text);
      text.destroy();
    },
  });
}
