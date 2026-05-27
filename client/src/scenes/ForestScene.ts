import { BaseBiomeScene } from './BaseBiomeScene';
import { FOREST_SCREENS } from '../../../shared/world/forest';
import { placeDecoration, type DecorationSpec } from '../objects/world/Decoration';

/**
 * Per-screen decoration art direction (GDD §10.16 Biome→Asset table, 8E.5). Each
 * entry maps a Forest screen id to the DecorationSpec[] placed over its ground layer
 * by `placeDecoration` from `onEnterScreen()`. Atlas frames:
 *   forest-decoration (6 frames): 0 tree-a, 1 tree-b, 2 tree-c/rock, 3 rock/bush,
 *                                 4 bush, 5 clearing/pond blob.
 *   structures (4 frames): 0 house-wall, 1 house-roof, 2 fence, 3 post.
 * Solid trees/rocks use trunk-sized physics bodies (bodyInset) so NPCs standing
 * near them stay visible (Contract C5 of #92). Every x/y is validated to fit inside
 * its screen's pixel bounds (size [w,h] tiles × 32px) and to keep corridor screens'
 * centers clear (≥ 4-tile / 128px walkable lane). NPC spawn points (8E.3) sit in the
 * open centers, never behind a solid sprite.
 */
const SCREEN_SPECS: Record<string, DecorationSpec[]> = {
  // Hub (40×30 = 1280×960): Starter Village structures at clearing edges + sparse trees.
  forest_anchorage: [
    { atlasKey: 'structures', frame: 0, x: 320, y: 96, solid: true, bodyInset: 4 }, // house
    { atlasKey: 'structures', frame: 2, x: 480, y: 128, solid: false }, // fence
    { atlasKey: 'structures', frame: 3, x: 160, y: 192, solid: false }, // lamp post
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 96, solid: true, bodyInset: 8 }, // tree
    { atlasKey: 'forest-decoration', frame: 1, x: 1056, y: 96, solid: true, bodyInset: 8 }, // tree
    { atlasKey: 'forest-decoration', frame: 3, x: 800, y: 800, solid: false }, // bush
  ],
  // Corridor (16×32 = 512×1024): dense trees flank both verges; center lane stays clear.
  forest_north_road: [
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 256, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 384, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 512, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 256, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 384, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 512, solid: true, bodyInset: 8 },
  ],
  // Snow-adjacent (32×20 = 1024×640): Cold-Cave-style rocks at the north edge + pines.
  forest_snow_gate: [
    { atlasKey: 'forest-decoration', frame: 2, x: 160, y: 96, solid: true, bodyInset: 4 }, // rock
    { atlasKey: 'forest-decoration', frame: 2, x: 800, y: 96, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 320, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 896, y: 320, solid: true, bodyInset: 8 },
  ],
  // Mossy fen (32×22 = 1024×704): richest — trees, rock, pond blob, bushes.
  forest_mossy_fen: [
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 864, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 2, x: 160, y: 480, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 5, x: 400, y: 300, solid: false }, // pond blob
    { atlasKey: 'forest-decoration', frame: 3, x: 600, y: 200, solid: false }, // bush
    { atlasKey: 'forest-decoration', frame: 3, x: 700, y: 400, solid: false },
  ],
  // Connector (24×12 = 768×384): trees top + bottom, open center road.
  forest_east_path: [
    { atlasKey: 'forest-decoration', frame: 0, x: 128, y: 64, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 384, y: 64, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 128, y: 320, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 384, y: 320, solid: true, bodyInset: 8 },
  ],
  // Open meadow (36×28 = 1152×896): sparse edge trees, flower + bush clusters in the open.
  forest_glade: [
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 1056, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 3, x: 400, y: 200, solid: false },
    { atlasKey: 'forest-decoration', frame: 3, x: 700, y: 600, solid: false },
    { atlasKey: 'forest-decoration', frame: 5, x: 500, y: 300, solid: false }, // flower / blob
  ],
  // Junction (28×22 = 896×704): trees at corners, open center, weathered sign post.
  forest_crossroads: [
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 800, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 640, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 2, x: 500, y: 300, solid: false }, // rock cluster
    { atlasKey: 'structures', frame: 3, x: 400, y: 200, solid: false }, // sign post
  ],
  // Corridor (16×28 = 512×896): trees flank verges, mushrooms crowd; center lane clear.
  forest_south_path: [
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 64, y: 384, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 448, y: 384, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 3, x: 96, y: 256, solid: false }, // bush
    { atlasKey: 'forest-decoration', frame: 3, x: 416, y: 256, solid: false },
  ],
  // Sunken clearing (36×24 = 1152×768): darker trees, pond blobs, foraging density.
  forest_hollow: [
    { atlasKey: 'forest-decoration', frame: 1, x: 96, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 1056, y: 96, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 5, x: 300, y: 400, solid: false }, // pond
    { atlasKey: 'forest-decoration', frame: 5, x: 800, y: 300, solid: false },
    { atlasKey: 'forest-decoration', frame: 2, x: 200, y: 600, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 3, x: 600, y: 500, solid: false },
    { atlasKey: 'forest-decoration', frame: 3, x: 900, y: 500, solid: false },
  ],
  // Mud-adjacent (28×18 = 896×576): alt rocks, minimal trees.
  forest_swamp_gate: [
    { atlasKey: 'forest-decoration', frame: 2, x: 128, y: 128, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 2, x: 768, y: 128, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 3, x: 400, y: 300, solid: false },
  ],
  // Wide low corridor (40×16 = 1280×512): dense thorns on top + bottom verges.
  forest_briar_pass: [
    { atlasKey: 'forest-decoration', frame: 0, x: 128, y: 64, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 384, y: 64, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 896, y: 64, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 128, y: 448, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 640, y: 448, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 1152, y: 448, solid: true, bodyInset: 8 },
  ],
  // Rocky elevated (32×22 = 1024×704): rock clusters, sparse trees.
  forest_ridge: [
    { atlasKey: 'forest-decoration', frame: 2, x: 128, y: 128, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 2, x: 400, y: 96, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 2, x: 768, y: 480, solid: true, bodyInset: 4 },
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 448, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 896, y: 128, solid: true, bodyInset: 8 },
  ],
  // Densest coverage (40×30 = 1280×960): ancient gnarled trees, minimal open space.
  forest_deepwood: [
    { atlasKey: 'forest-decoration', frame: 1, x: 96, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 352, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 608, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 864, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 1, x: 1120, y: 128, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 96, y: 800, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 352, y: 800, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 608, y: 800, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 864, y: 800, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 0, x: 1120, y: 800, solid: true, bodyInset: 8 },
    { atlasKey: 'forest-decoration', frame: 3, x: 250, y: 400, solid: false },
    { atlasKey: 'forest-decoration', frame: 3, x: 700, y: 500, solid: false },
  ],
  // Open arena (28×22 = 896×704): ancient stone pillars flank center; NO solids in center.
  forest_boss_clearing: [
    { atlasKey: 'forest-decoration', frame: 2, x: 256, y: 352, solid: true, bodyInset: 4 }, // pillar L
    { atlasKey: 'forest-decoration', frame: 2, x: 640, y: 352, solid: true, bodyInset: 4 }, // pillar R
  ],
  // Serene secret (24×18 = 768×576): single majestic tree, soft bush ring, peaceful.
  forest_hidden_alcove: [
    { atlasKey: 'forest-decoration', frame: 0, x: 384, y: 240, solid: true, bodyInset: 6 }, // big tree
    { atlasKey: 'forest-decoration', frame: 3, x: 256, y: 320, solid: false },
    { atlasKey: 'forest-decoration', frame: 3, x: 512, y: 320, solid: false },
    { atlasKey: 'forest-decoration', frame: 3, x: 384, y: 400, solid: false },
  ],
};

/**
 * The Forest region (GDD §10.15/§10.17, Phase 8E.1). A BaseBiomeScene subclass that
 * drives the multi-screen Forest manifest (FOREST_SCREENS): walking into a screen
 * edge with a defined exit fade-transitions to the neighbouring screen, spawning the
 * player at the opposite edge.
 *
 * The hub screen `forest_anchorage` retains the hand-authored `overworld.json` map
 * (the Sanctum, the seeded discovery waystones, the SW Swamp biome_exit, and the NPC
 * roster all live there); the other 14 exploration screens use the deterministic
 * per-screen maps generated by gen-forest-screens.mjs.
 */
export class ForestScene extends BaseBiomeScene {
  constructor() {
    super({ key: 'ForestScene' });
  }

  init(data?: { screenId?: string; spawnEdge?: string }): void {
    this.screenId = data?.screenId ?? 'forest_anchorage';
    this.screenDef = FOREST_SCREENS.find((s) => s.id === this.screenId);
    window.__forestScreenId = this.screenId;
  }

  tilesetKey(): string {
    return 'forest';
  }

  mapKeyForScreen(id: string): string {
    return 'forest_' + id;
  }

  /**
   * The hub `forest_anchorage` retains the hand-authored overworld.json map, whose
   * perimeter is solid wall (no edge openings); its conceptual manifest exits are
   * not walkable there, so edge transitions stay off for it (and a test-driven
   * out-of-bounds setPosition can't trigger one). The 14 generated screens enable
   * edge transitions normally.
   */
  protected edgeTransitionsEnabled(): boolean {
    return this.screenId !== 'forest_anchorage';
  }

  preload(): void {
    if (!this.textures.exists('forest')) {
      this.load.image('forest', 'assets/tiles/forest.png');
    }
    this.loadCommonAssets();
    // The hub screen keeps the hand-authored overworld.json layout (Sanctum, seeded
    // discovery waystones, NPC roster, SW Swamp exit); the rest use generated maps.
    const mapFile =
      this.screenId === 'forest_anchorage'
        ? 'assets/maps/overworld.json'
        : `assets/maps/forest/${this.screenId}.json`;
    this.load.tilemapTiledJSON(this.mapKeyForScreen(this.screenId), mapFile);
  }

  /**
   * 8E.5 — per-screen decoration placement (GDD §10.16). Called by BaseBiomeScene
   * during create() AFTER the decorationGroup + player↔group collider are wired, so
   * solid sprites block the player and non-solid ones (bushes / ponds / flowers) are
   * walk-through. window.__decorationCount is published as the total sprites placed
   * (solid + non-solid) for the E2E harness. A screen with no spec is a no-op.
   */
  onEnterScreen(): void {
    const specs = SCREEN_SPECS[this.screenId];
    if (!specs?.length || !this.decorationGroup) return;
    this.decorHandle = placeDecoration(this, this.decorationGroup, specs);
    window.__decorationCount = specs.length;
  }
}
