import Phaser from 'phaser';
import { BaseBiomeScene } from './BaseBiomeScene';
import { SNOW_SCREENS } from '../../../shared/world/snow';
import { FOREST_GENERATED_TILESETS } from './ForestScene';

/**
 * The Snow biome (GDD §10.15). Single-screen biome north of forest_snow_gate,
 * reached by defeating the Frost Sentinel gate warden. Mirrors SwampScene's
 * architecture: 16px/3-layer pipeline (forest-gid-map GID contract + snow
 * tileset), biome_exit object drives the return to Forest, edge transitions
 * disabled. Snow ambiance: a semi-transparent cool-blue overlay (depth 50)
 * evoking the pale open sky and frost air of the Snow Fields.
 */
const SNOW_DETECTION_RADIUS = 100; // same as Swamp — biome parity

/**
 * Snow-palette tilesets used by the hand-authored Snow maps. Each entry's key
 * equals the tileset `name` declared in the map JSON so buildTilesets() resolves
 * it by name; the path points at the in-repo committed copy of the raou snow art.
 */
const SNOW_TILESETS: ReadonlyArray<readonly [string, string]> = [
  ['autoTile_snow', 'assets/terrain/autotile_snow_16.png'],
  ['ts_snow', 'assets/terrain/terrain_snow_main.png'],
];

export class SnowScene extends BaseBiomeScene {
  constructor() {
    super({ key: 'SnowScene' });
  }

  init(data?: { screenId?: string; spawnEdge?: string }): void {
    this.screenId = data?.screenId ?? 'snow_entry';
    this.screenDef = SNOW_SCREENS.find((s) => s.id === this.screenId);
  }

  tilesetKey(): string {
    return 'autotile_grass_16'; // unused — buildTilesets() handles multi-tileset loading
  }

  mapKeyForScreen(_id: string): string {
    return 'snow_entry';
  }

  /** All Snow screens use 16px tiles at 2× world zoom (mirrors Swamp). */
  protected is16pxScreen(): boolean {
    return true;
  }

  /** Multi-tileset loader — same flexible loader as SwampScene. */
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
    // Snow palette: keys match the tileset names declared in snow_entry.json
    // (autoTile_snow / ts_snow) so buildTilesets() resolves them by name.
    for (const [key, path] of SNOW_TILESETS) {
      if (!this.textures.exists(key)) this.load.image(key, path);
    }
    this.loadCommonAssets();
    this.load.tilemapTiledJSON('snow_entry', 'assets/maps/snow/snow_entry.json');
  }

  /** The Snow biome's biome_exit object drives the return to Forest; no edge transitions. */
  protected edgeTransitionsEnabled(): boolean {
    return false;
  }

  protected detectionRadius(): number {
    return SNOW_DETECTION_RADIUS;
  }

  /**
   * Snow ambiance: a semi-transparent cool-blue/white overlay pinned to the
   * camera (depth 50) evoking the pale, open sky and frost light of the Snow
   * Fields. Lighter and cooler than the Swamp's deep-green fog.
   */
  biomeVisuals(): void {
    const { width, height } = this.scale;
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x9bb8d4, 0.15)
      .setScrollFactor(0)
      .setDepth(50)
      .setName('snow-overlay');
  }
}
