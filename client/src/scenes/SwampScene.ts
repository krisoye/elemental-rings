import { BaseBiomeScene } from './BaseBiomeScene';
import { SWAMP_SCREENS } from '../../../shared/world/swamp';

/**
 * The Swamp biome (GDD §10.17, Phase 8E.4). Migrated onto BaseBiomeScene alongside
 * the Forest, so it now shares the entire spatial engine (tilemap, Player, camera,
 * compass, waystones, NPC detection, blink, talisman) instead of cloning it. The
 * only Swamp-specific overrides are:
 *   - the dedicated `swamp` tileset + `swamp.json` map (a single entry screen),
 *   - a shorter detection radius (the foggy Swamp reveals NPCs later — GDD §10.5),
 *   - a fog overlay drawn over the tilemap.
 *
 * The Forest→Swamp gate (forest_sw_stone) and the Ironbark Rune reveal
 * (swamp_secret_forest → forest_hidden_anchor) remain server rules; the Swamp map
 * still ships those catalog objects (swamp_secret_forest, swamp_anchor_2,
 * swamp_depths) directly, which BaseBiomeScene.loadWaystones renders unchanged.
 */
const SWAMP_DETECTION_RADIUS = 100; // shorter than Forest's DETECTION_RADIUS (160)

export class SwampScene extends BaseBiomeScene {
  constructor() {
    super({ key: 'SwampScene' });
  }

  init(data?: { screenId?: string; spawnEdge?: string }): void {
    this.screenId = data?.screenId ?? 'swamp_entry';
    this.screenDef = SWAMP_SCREENS.find((s) => s.id === this.screenId);
  }

  tilesetKey(): string {
    return 'swamp-tiles';
  }

  mapKeyForScreen(_id: string): string {
    return 'swamp';
  }

  preload(): void {
    if (!this.textures.exists('swamp-tiles')) {
      this.load.image('swamp-tiles', 'assets/terrain/terrain_swamp_main.png');
    }
    this.loadCommonAssets();
    this.load.tilemapTiledJSON('swamp', 'assets/maps/swamp.json');
  }

  /** The Swamp's single screen reuses the hand-authored swamp.json (solid perimeter
   *  except its NW biome_exit zone), so edge transitions stay off — the return to
   *  the Forest is driven by the biome_exit overlap zone, not an edge. */
  protected edgeTransitionsEnabled(): boolean {
    return false;
  }

  protected detectionRadius(): number {
    return SWAMP_DETECTION_RADIUS;
  }

  /** Fog overlay: a semi-transparent dark rect pinned to the camera (depth 50). */
  biomeVisuals(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x001a00, 0.35)
      .setScrollFactor(0)
      .setDepth(50)
      .setName('fog-overlay');
  }
}
