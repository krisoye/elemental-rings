import Phaser from 'phaser';
import { COMPASS_ARROW_COLOR, COMPASS_ARROW_SIZE, CANVAS_W } from '../../Constants';

/** Screen-space anchor: top-center, 16px from the top edge (camera-pinned). */
const ANCHOR_X = CANVAS_W / 2;
const ANCHOR_Y = 16 + COMPASS_ARROW_SIZE;
/** Render above world content but below modal overlays. */
const DEPTH = 900;
/** Intensity → alpha / scale mapping (0 = faint/small, 1 = bright/large). */
const ALPHA_MIN = 0.35;
const ALPHA_SPAN = 0.65;
const SCALE_MIN = 1.0;
const SCALE_SPAN = 0.5;

/**
 * The Compass HUD (GDD §10.7) — a camera-pinned arrow that pulls toward the
 * nearest undiscovered (unattuned) waystone. The owning scene computes the
 * bearing + intensity each frame from the cached server state and the waystone
 * positions, then calls {@link point} or {@link hide}; this object only renders
 * the pull. No game logic lives here.
 *
 * The arrow is drawn pointing along +x (the math-angle zero direction) so the
 * container's `rotation` can be set directly to a bearing from
 * `Phaser.Math.Angle.Between(px, py, wx, wy)` without any offset.
 */
export class Compass {
  private readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene) {
    const arrow = scene.add.graphics();
    arrow.fillStyle(COMPASS_ARROW_COLOR, 1);
    // A chevron-like arrowhead pointing right (+x): tip at +size, base behind 0.
    const s = COMPASS_ARROW_SIZE;
    arrow.fillTriangle(s, 0, -s * 0.6, -s * 0.6, -s * 0.6, s * 0.6);
    // A short tail rectangle so the pointer reads as an arrow, not a plain wedge.
    arrow.fillStyle(COMPASS_ARROW_COLOR, 0.85);
    arrow.fillRect(-s * 0.9, -s * 0.18, s * 0.5, s * 0.36);

    this.container = scene.add
      .container(ANCHOR_X, ANCHOR_Y, [arrow])
      .setScrollFactor(0)
      .setDepth(DEPTH)
      .setVisible(false);
  }

  /**
   * Aim the compass along `angleRad` (a math-angle bearing, 0 = +x) and set its
   * brightness/size from `intensity` ∈ [0,1] (1 = closest). Makes it visible.
   */
  point(angleRad: number, intensity: number): void {
    const t = Phaser.Math.Clamp(intensity, 0, 1);
    this.container.rotation = angleRad;
    this.container.setAlpha(ALPHA_MIN + ALPHA_SPAN * t);
    this.container.setScale(SCALE_MIN + SCALE_SPAN * t);
    this.container.setVisible(true);
  }

  /** Hide the compass (no unattuned waystone within range). */
  hide(): void {
    this.container.setVisible(false);
  }

  /**
   * The camera-pinned container backing the compass. Returned so the owning scene
   * can re-parent it into `uiRoot` (#137), rendering it at 1:1 through the UI
   * camera rather than the zoomed world camera.
   */
  getContainer(): Phaser.GameObjects.Container {
    return this.container;
  }

  /** Destroy the owned container (on scene shutdown). */
  destroy(): void {
    this.container.destroy();
  }
}
