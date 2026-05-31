import Phaser from 'phaser';

/** Warm orange flame color. */
const COLOR_FLAME = 0xff8833;
/** Log brown color. */
const COLOR_LOG = 0x6b3d1e;
/** Soft amber glow. */
const COLOR_GLOW = 0xffaa44;

/**
 * Programmatic animated campfire marker placed at every Anchorage (GDD §10.7a).
 * Mirrors the {@link Waystone} class: purely presentational, no interaction logic.
 *
 * Positioned 24 px south-east of the Anchorage center so it sits visibly beside
 * the Sanctum exterior when summoned, matching the GDD flavor of campfires creating
 * a gathering space. Always drawn — does not disappear when the Sanctum is summoned.
 */
export class Campfire {
  private readonly logs: Phaser.GameObjects.Graphics;
  private readonly flame: Phaser.GameObjects.Ellipse;
  private readonly glow: Phaser.GameObjects.Ellipse;

  constructor(scene: Phaser.Scene, center: { x: number; y: number }) {
    const fx = center.x + 24;
    const fy = center.y + 24;

    // Soft glow disc beneath the flame.
    this.glow = scene.add
      .ellipse(fx, fy + 4, 20, 8, COLOR_GLOW, 0.3)
      .setDepth(5);

    // Two crossed log rectangles (drawn with Graphics).
    this.logs = scene.add.graphics().setDepth(6);
    this.logs.fillStyle(COLOR_LOG);
    // Horizontal log.
    this.logs.fillRect(fx - 9, fy + 1, 18, 5);
    // Diagonal log (approximate via a rotated rect at same position).
    this.logs.fillRect(fx - 3, fy - 4, 5, 10);

    // Flame ellipse.
    this.flame = scene.add
      .ellipse(fx, fy - 4, 10, 14, COLOR_FLAME, 0.9)
      .setDepth(6);

    // Subtle flicker tween on the flame.
    scene.tweens.add({
      targets: this.flame,
      scaleX: { from: 1, to: 0.8 },
      scaleY: { from: 1, to: 1.15 },
      alpha: { from: 0.9, to: 0.6 },
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /**
   * World-space display objects owned by this campfire. Returned so the owning
   * scene can tell the UI camera to ignore them (#137), keeping the campfire
   * visible only through the world (main) camera.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.glow, this.logs, this.flame];
  }

  /** Destroy all owned game objects (scene shutdown). */
  destroy(): void {
    this.glow.destroy();
    this.logs.destroy();
    this.flame.destroy();
  }
}
