import Phaser from 'phaser';
import { InteractionZone } from './InteractionZone';

declare const __SERVER_URL__: string;
const _WS_FN = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE_FN = _WS_FN.replace(/^ws/, 'http');

// berry_and_trees.png is 80×176, frame size 16×16 → 5 cols × 11 rows.
//   Frame  0 (row 0, col 0): green berry bush — available state.
//   Frame 10 (row 2, col 0): bare/brown plant — depleted state.
// Adjust these indices once the exact layout is verified in-engine.
const FRAME_AVAILABLE = 0;
const FRAME_DEPLETED = 10;

/**
 * A forageable berry / fruit-tree node in the overworld (GDD §10.10).
 *
 * Renders a sprite from the `berry-nodes` spritesheet at the Tiled object
 * position. Two visual states: **available** (full green bush) and **depleted**
 * (bare/brown frame). Wraps an {@link InteractionZone} so the player can walk
 * up and press E to forage via POST /api/overworld/forage. After a successful
 * forage the sprite immediately switches to the depleted frame; a 409 response
 * shows an "Already foraged" toast. The initial state is set by the owning
 * scene from the GET /api/overworld/forage-status response on load.
 *
 * Purely presentational — all economy logic lives on the authoritative server.
 */
export class ForageNode {
  /** Stable node id (matches the server forage_nodes key). */
  readonly nodeId: string;
  /** Center of the node in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly zone: InteractionZone;
  private readonly sprite: Phaser.GameObjects.Image;
  private depleted = false;

  /**
   * @param scene owning spatial scene
   * @param obj the Tiled `forage_node` object (x/y top-left, in px)
   * @param nodeId stable node id from the object's `node_id` custom property
   * @param onForage callback fired after a successful forage (passes food_units)
   * @param onToast callback for brief status messages (error / info toasts)
   */
  constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    nodeId: string,
    onForage: (food_units: number) => void,
    onToast: (msg: string, color?: string) => void,
  ) {
    this.nodeId = nodeId;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Sprite at the tile center (depth 6 — same as waystone standing stones).
    this.sprite = scene.add
      .image(this.center.x, this.center.y, 'berry-nodes', FRAME_AVAILABLE)
      .setDepth(6)
      .setName(`forage-${nodeId}`);

    // InteractionZone: covers the Tiled object rectangle, prompt text is "Forage [E]".
    const zoneObj: Phaser.Types.Tilemaps.TiledObject = {
      ...obj,
      name: nodeId,
    };
    this.zone = new InteractionZone(scene, zoneObj, () => {
      void this.interact(onForage, onToast);
    });
    // Override the default "Press E" prompt with a more descriptive label.
    // InteractionZone always shows "Press E"; we rely on the zone being active
    // to signal the player — no additional prompt text needed here.
  }

  /** The InteractionZone wrapping this node (for overlap + nearest selection). */
  get interactionZone(): InteractionZone {
    return this.zone;
  }

  /**
   * The world-space display objects owned by this forage node (the bush/tree
   * sprite) plus the wrapped InteractionZone's display objects. Returned so the
   * owning scene can tell the UI camera to ignore them (#137) — ForageNode is a
   * WORLD object that must zoom with the main camera, not the 1:1 UI camera.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.sprite, ...this.zone.displayObjects];
  }

  /**
   * Set the available / depleted visual state (called on scene load from
   * GET /api/overworld/forage-status, and after a successful forage POST).
   */
  setDepleted(depleted: boolean): void {
    this.depleted = depleted;
    this.sprite.setFrame(depleted ? FRAME_DEPLETED : FRAME_AVAILABLE);
  }

  /** Whether this node is currently shown as depleted. */
  isDepleted(): boolean {
    return this.depleted;
  }

  /** Destroy owned game objects + the wrapped zone (on scene shutdown). */
  destroy(): void {
    this.zone.destroy();
    this.sprite.destroy();
  }

  private async interact(
    onForage: (food_units: number) => void,
    onToast: (msg: string, color?: string) => void,
  ): Promise<void> {
    if (this.depleted) {
      onToast('Already foraged', '#ff8888');
      return;
    }
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_FN}/api/overworld/forage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ node_id: this.nodeId }),
      });
      if (res.status === 409) {
        // Server confirms depleted (could have been foraged via another path).
        this.setDepleted(true);
        onToast('Already foraged', '#ff8888');
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as { food_units: number; yielded: number };
      this.setDepleted(true);
      onToast(`+${data.yielded} food`, '#aaffaa');
      onForage(data.food_units);
    } catch {
      // Network failure — silent.
    }
  }
}
