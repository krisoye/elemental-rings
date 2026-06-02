import Phaser from 'phaser';
import { InteractionZone } from './InteractionZone';

/**
 * Shared base for visible overworld objects that wrap a single
 * {@link InteractionZone} (waystones, merchant NPCs, forage nodes, shrine
 * altars). Each subclass draws its own world art and owns one zone built from
 * the Tiled object rectangle; this base removes the copy-pasted zone field +
 * `interactionZone` accessor boilerplate (#297).
 *
 * The zone is constructed from a Tiled rectangle object — the same shape
 * {@link InteractionZone} already takes — so every subclass keeps its exact
 * zone footprint, name, prompt text, and callback. Subclasses pass the (often
 * spread-and-renamed) object through unchanged.
 */
export abstract class WorldInteractable {
  /** The single zone this object wraps (overlap + nearest-zone selection). */
  protected readonly _zone: InteractionZone;

  /**
   * @param scene owning spatial scene
   * @param obj the Tiled rectangle object the zone covers (name carries the
   *   subclass's stable id; x/y are top-left in px)
   * @param onInteract fired on E / interact while this object's zone is active
   * @param promptText floating-prompt label, or null to suppress it; defaults
   *   to the {@link InteractionZone} "Press E" prompt
   */
  protected constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    onInteract: () => void,
    promptText: string | null = 'Press E',
  ) {
    this._zone = new InteractionZone(scene, obj, onInteract, promptText);
  }

  /** The InteractionZone wrapping this object (for overlap + nearest selection). */
  get interactionZone(): InteractionZone {
    return this._zone;
  }

  /**
   * The world-space display objects owned by this object (its own art plus the
   * wrapped zone's objects). Returned so the owning scene can tell the UI
   * camera to ignore them (#137), keeping them visible only through the world
   * (main) camera.
   */
  abstract get displayObjects(): Phaser.GameObjects.GameObject[];
}
