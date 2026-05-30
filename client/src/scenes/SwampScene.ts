import Phaser from 'phaser';
import { BaseBiomeScene } from './BaseBiomeScene';
import { SWAMP_SCREENS } from '../../../shared/world/swamp';
import { FOREST_GENERATED_TILESETS } from './ForestScene';

/**
 * The Swamp biome (GDD §10.17, Phase 8E.4). Migrated onto BaseBiomeScene alongside
 * the Forest, so it now shares the entire spatial engine (tilemap, Player, camera,
 * compass, waystones, NPC detection, blink, talisman) instead of cloning it.
 *
 * After EPIC #149 (#161) the Swamp uses the same 16px/3-layer pipeline as the Forest:
 * 6-tileset GID contract (forest-gid-map.mjs), autotiled terrain (T_WATER background,
 * T_CLIFF reed clumps, T_DIRT walkways), and the map at swamp/swamp_entry.json.
 * The only Swamp-specific overrides are the fog overlay, shorter detection radius, and
 * disabled edge transitions (the biome_exit object drives the return to Forest).
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
    return 'autotile_grass_16'; // unused — buildTilesets() handles multi-tileset loading
  }

  mapKeyForScreen(_id: string): string {
    return 'swamp_entry';
  }

  /** All Swamp screens use 16px tiles at 2× world zoom (#149 / #161). */
  protected is16pxScreen(): boolean {
    return true;
  }

  /** Multi-tileset loader — same 6-tileset GID contract as generated Forest screens. */
  protected buildTilesets(map: Phaser.Tilemaps.Tilemap): Phaser.Tilemaps.Tileset[] {
    return map.tilesets
      .filter((t) => this.textures.exists(t.name))
      .map((t) => map.addTilesetImage(t.name, t.name))
      .filter((t): t is Phaser.Tilemaps.Tileset => t !== null);
  }

  /** 3-layer contract: ground (depth 0) / behind (depth 2) / in-front (depth 5). */
  protected tileLayerNames(): string[] {
    return ['ground', 'behind', 'in-front'];
  }

  /** `behind` uses non-empty collision (trunks/rocks block movement). */
  protected tileLayerCollisionMode(layerName: string): 'property' | 'non-empty' {
    if (layerName === 'behind') return 'non-empty';
    return super.tileLayerCollisionMode(layerName);
  }

  protected tileLayerDepth(layerName: string): number {
    if (layerName === 'behind') return 2;
    if (layerName === 'in-front') return 5;
    return 0; // ground
  }

  preload(): void {
    for (const [key, path] of FOREST_GENERATED_TILESETS) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
    this.loadCommonAssets();
    this.load.tilemapTiledJSON('swamp_entry', 'assets/maps/swamp/swamp_entry.json');
  }

  /** The Swamp's biome_exit object drives the return to Forest; no edge transitions. */
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
