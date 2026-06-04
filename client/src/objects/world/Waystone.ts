import Phaser from 'phaser';
import { WorldInteractable } from './WorldInteractable';
import { crispCanvasText } from '../ui/DomLabel';

// Standing-stone silhouette dimensions (px, measured from the stone center).
const STONE_H = 34;
const TOP_HALF_W = 7;   // half-width at the top of the stone
const BASE_HALF_W = 11; // half-width at the base (wider = more monument-like)

// Palette: unattuned = slate grey-blue, attuned = glowing cyan.
const COLOR_UNATTUNED = 0x5a6a7f;
const COLOR_UNATTUNED_DARK = 0x374455;
const COLOR_UNATTUNED_RUNE = 0x7a8fa0;
const COLOR_ATTUNED = 0x49d3e0;
const COLOR_ATTUNED_DARK = 0x1e8a94;
const COLOR_ATTUNED_RUNE = 0xb0ffff;

/**
 * A persistent, visible overworld waystone marker (GDD §10.7). Draws a
 * tapered standing-stone graphic with rune marks over its map tile and wraps
 * an {@link InteractionZone} so the player can press E to attune. The stone
 * recolors (slate → glowing cyan) once attuned.
 *
 * Purely presentational: pressing E fires the supplied `onInteract` callback,
 * which the owning scene routes to POST /api/waystones/attune (the server is
 * the authority for attunement). The `id`/position are read from the Tiled
 * `waystone` object; the scene matches them against GET /api/waystones for
 * the initial attuned state.
 */
export class Waystone extends WorldInteractable {
  /** Stable waystone id (matches shared/waystones.ts + the server payload). */
  readonly waystoneId: string;
  /** Center of the marker in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly gfx: Phaser.GameObjects.Graphics;
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
    // Reuse the InteractionZone overlap + "Press E" prompt machinery (via the
    // WorldInteractable base), naming the zone with the stable waystone id.
    super(scene, { ...obj, name: waystoneId }, onInteract);
    this.waystoneId = waystoneId;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Soft glow disc under the stone base (only visible when attuned).
    this.glow = scene.add
      .ellipse(
        this.center.x,
        this.center.y + BASE_HALF_W - 2,
        BASE_HALF_W * 2 + 12,
        14,
        COLOR_ATTUNED,
        0.35,
      )
      .setDepth(5)
      .setVisible(false);

    // Graphics object: the full stone silhouette + rune marks.
    this.gfx = scene.add
      .graphics()
      .setDepth(6)
      .setName(`waystone-${waystoneId}`);

    // Floating name label above the stone.
    // #382 — world-space label (scrolls with the world camera) → crispCanvasText.
    this.label = crispCanvasText(
      scene.add
        .text(this.center.x, this.center.y - STONE_H - 8, name, {
          fontSize: '11px',
          color: '#cfe3ff',
        })
        .setOrigin(0.5, 1)
        .setDepth(6),
    );

    this.setAttuned(attuned);
  }

  /**
   * The world-space display objects owned by this waystone. Returned so the
   * owning scene can tell the UI camera to ignore them (#137), keeping the
   * marker visible only through the world (main) camera.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.gfx, this.glow, this.label, ...this._zone.displayObjects];
  }

  /** Redraw the stone for the given attuned state (true → glowing cyan). */
  setAttuned(attuned: boolean): void {
    this.attuned = attuned;
    this.redraw();
    this.glow.setVisible(attuned);
  }

  /** Whether this waystone is currently shown as attuned. */
  isAttuned(): boolean {
    return this.attuned;
  }

  /** Destroy owned game objects + the wrapped zone (on scene shutdown). */
  destroy(): void {
    this._zone.destroy();
    this.gfx.destroy();
    this.glow.destroy();
    this.label.destroy();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /**
   * Draw the standing stone: a tapered trapezoid body, a rounded cap at the
   * top, a right-edge shadow for depth, and two horizontal rune marks. The
   * graphic is cleared and redrawn on every state change.
   */
  private redraw(): void {
    this.gfx.clear();

    const cx = this.center.x;
    const cy = this.center.y;
    const stoneTop = cy - STONE_H;
    const stoneBase = cy;

    const fillColor = this.attuned ? COLOR_ATTUNED : COLOR_UNATTUNED;
    const darkColor = this.attuned ? COLOR_ATTUNED_DARK : COLOR_UNATTUNED_DARK;
    const runeColor = this.attuned ? COLOR_ATTUNED_RUNE : COLOR_UNATTUNED_RUNE;

    // Main body — trapezoid as two triangles: narrower at top, wider at base.
    this.gfx.fillStyle(fillColor, 1);
    this.gfx.fillTriangle(
      cx - TOP_HALF_W, stoneTop,
      cx + TOP_HALF_W, stoneTop,
      cx - BASE_HALF_W, stoneBase,
    );
    this.gfx.fillTriangle(
      cx + TOP_HALF_W, stoneTop,
      cx + BASE_HALF_W, stoneBase,
      cx - BASE_HALF_W, stoneBase,
    );

    // Right-edge shadow triangle (gives illusion of depth / rounded volume).
    this.gfx.fillStyle(darkColor, 1);
    this.gfx.fillTriangle(
      cx + TOP_HALF_W, stoneTop,
      cx + BASE_HALF_W, stoneBase,
      cx + TOP_HALF_W, stoneBase,
    );

    // Rounded cap at the top (irregular rock silhouette).
    this.gfx.fillStyle(fillColor, 1);
    this.gfx.fillEllipse(cx, stoneTop, TOP_HALF_W * 2, 8);

    // Two horizontal rune marks (at ~35% and ~62% down the stone height).
    this.gfx.lineStyle(1, runeColor, 0.85);
    const drawRune = (t: number): void => {
      // Interpolate half-width at this vertical position along the trapezoid.
      const hw = Phaser.Math.Linear(TOP_HALF_W, BASE_HALF_W, t) - 3;
      const ry = stoneTop + STONE_H * t;
      this.gfx.strokeLineShape(new Phaser.Geom.Line(cx - hw, ry, cx + hw, ry));
    };
    drawRune(0.36);
    drawRune(0.63);
  }
}
