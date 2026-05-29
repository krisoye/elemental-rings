import Phaser from 'phaser';
import { InteractionZone } from './InteractionZone';

/** Standing-stone body dimensions (px). */
const STONE_W = 22;
const STONE_H = 30;
/** Fill colors: dim grey-blue when unattuned, glowing cyan when attuned. */
const COLOR_UNATTUNED = 0x4a5568;
const COLOR_ATTUNED = 0x49d3e0;
/** Outline + glow accent under the stone. */
const COLOR_OUTLINE = 0x1a1f2b;

/**
 * A persistent, visible overworld waystone marker (GDD §10.7). Draws a
 * standing-stone graphic over its map tile and wraps an {@link InteractionZone}
 * so the player can walk onto it and press E to attune. The stone recolors
 * (dim → glowing) once attuned.
 *
 * Purely presentational: pressing E fires the supplied `onInteract` callback,
 * which the owning scene routes to POST /api/waystones/attune (the server is the
 * authority for attunement — see the architecture rule). The `id`/position are
 * read from the Tiled `waystone` object; the scene matches them against the
 * `GET /api/waystones` payload for the attuned color.
 */
export class Waystone {
  /** Stable waystone id (matches shared/waystones.ts + the server payload). */
  readonly waystoneId: string;
  /** Center of the marker in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly zone: InteractionZone;
  private readonly stone: Phaser.GameObjects.Rectangle;
  private readonly glow: Phaser.GameObjects.Ellipse;
  private readonly label: Phaser.GameObjects.Text;
  private attuned = false;

  /**
   * @param scene owning overworld scene
   * @param obj the Tiled `waystone` rectangle object (x/y top-left, in px)
   * @param waystoneId stable id from the object's `waystoneId` property
   * @param name display name (from the server payload) for the floating label
   * @param attuned initial attuned state (from GET /api/waystones)
   * @param onInteract fired on E / interact while this marker is the active zone
   */
  constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    waystoneId: string,
    name: string,
    attuned: boolean,
    onInteract: () => void,
  ) {
    this.waystoneId = waystoneId;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Soft glow disc under the stone (brightens when attuned).
    this.glow = scene.add
      .ellipse(this.center.x, this.center.y + 6, STONE_W + 10, 14, COLOR_ATTUNED, 0.25)
      .setDepth(5)
      .setVisible(false);

    // The standing stone itself.
    this.stone = scene.add
      .rectangle(this.center.x, this.center.y - 4, STONE_W, STONE_H, COLOR_UNATTUNED)
      .setStrokeStyle(2, COLOR_OUTLINE)
      .setDepth(6)
      .setName(`waystone-${waystoneId}`);

    // Floating name label.
    this.label = scene.add
      .text(this.center.x, this.center.y - STONE_H - 6, name, {
        fontSize: '11px',
        color: '#cfe3ff',
      })
      .setOrigin(0.5, 1)
      .setDepth(6);

    // Reuse the InteractionZone overlap + "Press E" prompt machinery. The zone
    // is named with the waystone id so the scene's existing zone bookkeeping
    // (window.__sanctumZones / nearest-zone selection) treats it like any zone.
    this.zone = new InteractionZone(scene, { ...obj, name: waystoneId }, onInteract);

    this.setAttuned(attuned);
  }

  /** The InteractionZone wrapping this marker (for overlap + nearest selection). */
  get interactionZone(): InteractionZone {
    return this.zone;
  }

  /**
   * The world-space display objects owned by this waystone (the stone sprite, its
   * glow disc, the name label) plus the wrapped InteractionZone's display objects.
   * Returned so the owning scene can tell the UI camera to ignore them (#137),
   * keeping the marker visible only through the world (main) camera.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.stone, this.glow, this.label, ...this.zone.displayObjects];
  }

  /** Recolor the stone for the given attuned state (true → glowing). */
  setAttuned(attuned: boolean): void {
    this.attuned = attuned;
    this.stone.setFillStyle(attuned ? COLOR_ATTUNED : COLOR_UNATTUNED);
    this.glow.setVisible(attuned);
  }

  /** Whether this waystone is currently shown as attuned. */
  isAttuned(): boolean {
    return this.attuned;
  }

  /** Destroy owned game objects + the wrapped zone (on scene shutdown). */
  destroy(): void {
    this.zone.destroy();
    this.stone.destroy();
    this.glow.destroy();
    this.label.destroy();
  }
}
