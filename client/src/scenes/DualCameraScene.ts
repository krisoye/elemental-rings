import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';

/**
 * DualCameraScene — the shared dual-camera spatial-scene base (EPIC #291 / #296).
 *
 * The Sanctum (CampScene) and every overworld biome (BaseBiomeScene → Forest /
 * Swamp) render the world through `cameras.main` (which may zoom: 2× for the
 * Sanctum's 16px interior, 1–2× for biomes) while keeping the HUD/overlays at a
 * fixed 1:1 through a second `uiCam`. Before this base each scene independently
 * forked the identical setup (#118 in CampScene, #137 in BaseBiomeScene); the
 * setup, the world/UI routing helpers, and the `cameras.main` un-ignore trick are
 * hoisted here so the two scenes share one implementation.
 *
 * Camera contract (faithfully reproduced from both scenes):
 *   - `uiRoot` is a depth-4000 container holding persistent HUD. `cameras.main`
 *     ignores the whole subtree ONCE, so anything added to it later is
 *     automatically excluded from the world camera and drawn only by `uiCam`.
 *   - `uiCam` is a full-viewport camera (zoom 1, no follow) added AFTER
 *     `cameras.main`, so it draws on top — correct for UI occluding the world.
 *   - `routeToUi(...)` excludes a scene-root object (e.g. a modal container kept
 *     at the root for E2E flatMap traversal) from `cameras.main` so it renders at
 *     1:1 via `uiCam` instead of zooming with the world.
 *   - `ignoreWorldObjects(...)` is the symmetric inverse: it tells `uiCam` to
 *     ignore world objects (tilemap layers, player, zones, NPCs) so they render
 *     only through the zooming world camera and never double-render.
 *   - `unignoreMain(...)` clears the per-object main-camera ignore bit before a
 *     transient UI object is destroyed (Phaser 4.1's `ignore()` only sets
 *     `obj.cameraFilter |= camera.id`; the clean undo is to clear that bit).
 *
 * NOTE (WS E): `cameras.main.setZoom(...)` is intentionally NOT done here — the
 * zoom factor is per-scene (CampScene fixes 2×; BaseBiomeScene uses worldZoom()),
 * so each subclass keeps its own setZoom call in create(). `initDualCamera()` only
 * builds `uiRoot` + `uiCam`, which is byte-for-byte identical across both scenes.
 *
 * The generic `beginOverlay()/closeOverlay()` dim pair below is a thin, optional
 * convenience for simple "dim the world, draw a UI layer" overlays. CampScene does
 * NOT use it — its modal system (panel adoption, named overlays, fusion
 * entanglement) is far richer and stays in CampScene under its own method names.
 * BaseBiomeScene does not dim at all. The pair is provided so the dual-camera API
 * is complete and a future scene can opt in without re-deriving the dim layer.
 */
export abstract class DualCameraScene extends Phaser.Scene {
  /**
   * UI camera: full-viewport, zoom 1, no follow. Renders `uiRoot` (and any
   * scene-root object passed to `routeToUi`) at a fixed 1:1 while the world zooms.
   */
  protected uiCam!: Phaser.Cameras.Scene2D.Camera;
  /**
   * Persistent depth-4000 container for HUD objects. `cameras.main` ignores this
   * whole subtree once, so children added later are auto-excluded from the world
   * camera. Modal-style overlays that need E2E flatMap traversal stay at the scene
   * root and are routed individually via `routeToUi`.
   */
  protected uiRoot!: Phaser.GameObjects.Container;

  /** Optional generic dim backdrop created by the base `beginOverlay()`; null when closed. */
  private dimOverlay: Phaser.GameObjects.Rectangle | null = null;

  /**
   * Build the dual-camera split: create `uiRoot` at depth 4000, tell
   * `cameras.main` to ignore it once, then add `uiCam` AFTER `cameras.main` so it
   * draws on top. Call this from `create()` AFTER `cameras.main` exists (and after
   * any `cameras.main.setZoom()` the subclass applies). Does not set zoom — that is
   * per-scene.
   */
  protected initDualCamera(): void {
    this.uiRoot = this.add.container(0, 0).setDepth(4000);
    this.cameras.main.ignore(this.uiRoot);
    this.uiCam = this.cameras.add(0, 0, CANVAS_W, CANVAS_H);
  }

  /**
   * Route scene-root objects to the UI camera: exclude them from `cameras.main` so
   * they render at 1:1 via `uiCam` rather than zooming with the world. Used for
   * modal containers kept at the scene root (not inside `uiRoot`) so single-level
   * E2E flatMap traversal still reaches their children. Ignoring a container
   * cascades to its whole subtree.
   */
  protected routeToUi(...objs: Phaser.GameObjects.GameObject[]): void {
    for (const obj of objs) this.cameras.main.ignore(obj);
  }

  /**
   * Tell `uiCam` to ignore world objects so they render only through the zooming
   * world (main) camera — without this every world object double-renders (once per
   * camera). Guards a null `uiCam` / empty list defensively. This is the symmetric
   * inverse of `routeToUi`.
   */
  protected ignoreWorldObjects(objs: Phaser.GameObjects.GameObject[]): void {
    if (!this.uiCam || objs.length === 0) return;
    this.uiCam.ignore(objs);
  }

  /**
   * Inverse of `cameras.main.ignore(obj)`. Phaser 4.1's `ignore()` only sets
   * `obj.cameraFilter |= camera.id` (a bit flag on the object; the camera keeps no
   * collection), so the clean undo is to clear that bit. Called on transient UI
   * (barrier/toast/error text) just before destroy so no stale main-camera filter
   * survives if the object id is ever reused.
   */
  protected unignoreMain(...objs: Phaser.GameObjects.GameObject[]): void {
    for (const obj of objs) obj.cameraFilter &= ~this.cameras.main.id;
  }

  /**
   * Generic optional overlay: dim the world with a camera-pinned backdrop drawn on
   * the 1:1 `uiCam` layer (added to `uiRoot`). Idempotent — a second call without
   * `closeOverlay()` leaves the single backdrop in place. Subclasses with a richer
   * modal system (CampScene) do NOT use this and keep their own overlay methods.
   */
  protected beginOverlay(): void {
    if (this.dimOverlay) return;
    const dim = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setScrollFactor(0)
      .setDepth(3999);
    this.uiRoot.add(dim);
    this.dimOverlay = dim;
  }

  /** Reverse {@link beginOverlay}: remove and destroy the dim backdrop, if any. */
  protected closeOverlay(): void {
    if (!this.dimOverlay) return;
    this.uiRoot.remove(this.dimOverlay);
    this.dimOverlay.destroy();
    this.dimOverlay = null;
  }
}
