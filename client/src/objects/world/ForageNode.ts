import Phaser from 'phaser';
import { InteractionZone } from './InteractionZone';

declare const __SERVER_URL__: string;
const _WS_FN = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE_FN = _WS_FN.replace(/^ws/, 'http');

/** The Tiled tileset name carrying the berry/fruit-tree plant frames. */
const BERRY_TILESET = 'berry_and_trees';
/**
 * The berry sheet is 5 columns wide (0–4).  Column semantics differ by type:
 *
 *   2-tile-wide types (Bush rows 0–1, Purple tree rows 2–3,
 *                      Bramble rows 6–7, Star tree rows 8–10):
 *     col 0–1 = without-food   col 2–3 = with-food   col 4 = item icon
 *     depletion offset = −2  (col 2→0, col 3→1)
 *
 *   1-tile-wide types (Tall tree rows 4–5):
 *     col 0 = without-food   col 1 = with-food   col 2 = item icon
 *     depletion offset = −1  (col 1→0)
 *
 * ForageNode detects with-food tiles by row group and records the correct
 * per-tile offset so the swap is always type-agnostic at runtime.
 */
const BERRY_COLS = 5;
/** Sheet row range (inclusive) that uses the narrow 1-tile layout (tall tree). */
const TALL_TREE_ROW_MIN = 4;
const TALL_TREE_ROW_MAX = 5;
/** Layers whose tiles compose the plant (trunk/lower + canopy/upper). */
const PLANT_LAYERS = ['behind', 'in-front'] as const;

/** One with-food plant tile recorded for toggling. */
interface FoodTile {
  layerName: string;
  tileX: number;
  tileY: number;
  /** The with-food (available) global gid as authored in the map. */
  availableGid: number;
  /** Columns to subtract to reach the without-food gid (−1 for tall tree, −2 for all others). */
  offset: number;
}

/**
 * A forageable berry / fruit-tree node in the overworld (GDD §10.10).
 *
 * The plant itself is NOT a sprite — it is the 2×2 with-food block the map author
 * paints into the `behind` (trunk/lower, depth 2, collides) + `in-front` (canopy,
 * depth 5) tile layers. ForageNode toggles those tiles between the with-food
 * (available) and without-food (depleted) variants by a fixed −2 column gid shift
 * (#195), so it is fully type-agnostic. Maps ship in the with-food state;
 * `loadForageNodeStatus()` swaps a node to depleted on load when the server says
 * so. A successful forage POST swaps it live; a 409 shows "Already foraged".
 *
 * **Map convention:** the available state of a node is whatever 2×2 with-food
 * plant the author paints into behind+in-front over the object's footprint; the
 * node auto-derives its type and depleted visual via the −2 offset.
 *
 * Purely presentational — all economy logic lives on the authoritative server.
 */
export class ForageNode {
  /** Stable node id (matches the server forage_nodes key). */
  readonly nodeId: string;
  /** Center of the node in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly zone: InteractionZone;
  private readonly map: Phaser.Tilemaps.Tilemap;
  /** The with-food plant tiles this node toggles (recorded from the map). */
  private readonly foodTiles: FoodTile[] = [];
  private depleted = false;

  /**
   * @param scene owning spatial scene
   * @param map the live tilemap (whose behind/in-front layers carry the plant)
   * @param obj the Tiled `forage_node` object (x/y top-left, in px)
   * @param nodeId stable node id from the object's `node_id` custom property
   * @param onForage callback fired after a successful forage (passes food_units)
   * @param onToast callback for brief status messages (error / info toasts)
   */
  constructor(
    scene: Phaser.Scene,
    map: Phaser.Tilemaps.Tilemap,
    obj: Phaser.Types.Tilemaps.TiledObject,
    nodeId: string,
    onForage: (food_units: number) => void,
    onToast: (msg: string, color?: string) => void,
  ) {
    this.nodeId = nodeId;
    this.map = map;
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Resolve the berry tileset and scan the object's tile footprint for with-food
    // tiles in the plant layers, recording them for later toggling.
    const ts = map.getTileset(BERRY_TILESET);
    if (ts) {
      const firstgid = ts.firstgid;
      const lastgid = firstgid + ts.total; // exclusive
      const tw = map.tileWidth;
      const tx0 = Math.floor(x / tw);
      const ty0 = Math.floor(y / tw);
      const cols = Math.max(1, Math.round(w / tw));
      const rows = Math.max(1, Math.round(h / tw));
      for (const layerName of PLANT_LAYERS) {
        if (!map.getLayer(layerName)) continue;
        for (let dy = 0; dy < rows; dy++) {
          for (let dx = 0; dx < cols; dx++) {
            const tile = map.getTileAt(tx0 + dx, ty0 + dy, false, layerName);
            if (!tile) continue;
            const gid = tile.index;
            if (gid < firstgid || gid >= lastgid) continue; // not a berry tile
            const local = gid - firstgid;
            const localRow = Math.floor(local / BERRY_COLS);
            const localCol = local % BERRY_COLS;
            // Tall-tree rows use col 1 as with-food (1-tile-wide, offset −1).
            // All other row groups use col 2–3 as with-food (2-tile-wide, offset −2).
            const isTallTree = localRow >= TALL_TREE_ROW_MIN && localRow <= TALL_TREE_ROW_MAX;
            const isWithFood = isTallTree ? localCol === 1 : (localCol === 2 || localCol === 3);
            if (isWithFood) {
              this.foodTiles.push({
                layerName,
                tileX: tx0 + dx,
                tileY: ty0 + dy,
                availableGid: gid,
                offset: isTallTree ? -1 : -2,
              });
            }
          }
        }
      }
    }
    if (this.foodTiles.length === 0) {
      // Mis-authored (no with-food tiles painted) or a screen without the berry
      // tileset — fail safe: the visual toggle becomes a no-op (empty foodTiles),
      // but the node stays interactable so foraging still works server-side.
      // eslint-disable-next-line no-console
      console.warn(`ForageNode ${nodeId}: no with-food plant tiles found — visual toggle disabled`);
    }

    // InteractionZone: covers the Tiled object rectangle; "Press E" prompt.
    const zoneObj: Phaser.Types.Tilemaps.TiledObject = { ...obj, name: nodeId };
    this.zone = new InteractionZone(scene, zoneObj, () => {
      void this.interact(onForage, onToast);
    });
  }

  /** The InteractionZone wrapping this node (for overlap + nearest selection). */
  get interactionZone(): InteractionZone {
    return this.zone;
  }

  /**
   * World-space display objects owned by this node. The plant lives in the tilemap
   * layers (already routed to the world camera), so only the wrapped
   * InteractionZone's objects are returned for the #137 UI-camera ignore.
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [...this.zone.displayObjects];
  }

  /**
   * Set the available / depleted visual state by swapping each food tile between
   * the with-food gid and the without-food gid. The offset is −1 for tall-tree
   * tiles (col 1→0) and −2 for all other types (col 2→0, col 3→1). Called on
   * scene load from GET /api/overworld/forage-status and after a forage POST.
   */
  setDepleted(depleted: boolean): void {
    this.depleted = depleted;
    for (const t of this.foodTiles) {
      const gid = depleted ? t.availableGid + t.offset : t.availableGid;
      this.map.putTileAt(gid, t.tileX, t.tileY, true, t.layerName);
    }
  }

  /** Whether this node is currently shown as depleted. */
  isDepleted(): boolean {
    return this.depleted;
  }

  /** Destroy the wrapped zone (on scene shutdown). The plant tiles belong to the map. */
  destroy(): void {
    this.zone.destroy();
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
