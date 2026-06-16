import Phaser from 'phaser';
import { BaseBiomeScene } from './BaseBiomeScene';
import { SNOW_SCREENS } from '../../../shared/world/snow';
import { ElementEnum } from '../../../shared/types';
import { ShrineZone } from '../objects/world/ShrineZone';
import { FOREST_GENERATED_TILESETS } from './ForestScene';

/**
 * The Snow biome (GDD docs/gdd-10-snow.md, EPIC #440) — a 9-screen region north
 * of forest_snow_gate, reached by defeating the Frost Sentinel gate warden.
 * Mirrors SwampScene's 16px/3-layer pipeline (snow + cave packs); the per-screen
 * map is keyed by screen id and edge transitions move between adjacent screens,
 * while snow_entry's biome_exit object still drives the Forest return. Two sealed
 * fusion shrines (Storm, Dust) synthesize a ShrineZone on enter. Snow ambiance:
 * a semi-transparent cool-blue overlay (depth 50) for the pale frost air.
 */
const SNOW_DETECTION_RADIUS = 100; // same as Swamp — biome parity
// Per-screen detection (GDD §10-snow): the Frost Cavern is dim and tight so
// enemies appear at close range; the exposed Upper Glacier has no cover, so
// sightlines run long (effectively doubled).
const FROST_CAVERN_DETECTION_RADIUS = 60;
const GLACIER_DETECTION_RADIUS = 200;

/**
 * Snow-palette tilesets used by the hand-authored Snow maps. Each entry's key
 * equals the tileset `name` declared in the map JSON so buildTilesets() resolves
 * it by name; the path points at the in-repo committed copy of the raou snow art.
 */
const SNOW_TILESETS: ReadonlyArray<readonly [string, string]> = [
  ['autoTile_snow', 'assets/terrain/autotile_snow_16.png'],
  ['ts_snow', 'assets/terrain/terrain_snow_main.png'],
];

/**
 * Cave-pack tilesets for the Frost Cavern (and any future cave/mine screens).
 * Keys match the tileset `name`s in snow_frost_cavern.json so buildTilesets()
 * resolves them by name. Loaded only on cave screens so open snow screens don't
 * fetch underground art they never reference.
 */
const CAVE_TILESETS: ReadonlyArray<readonly [string, string]> = [
  ['terrain_cave_main', 'assets/terrain/terrain_cave_main.png'],
  ['terrain_cave_boulder', 'assets/terrain/terrain_cave_boulder.png'],
];
const CAVE_SCREENS = new Set<string>(['snow_frost_cavern']);

export class SnowScene extends BaseBiomeScene {
  /** Storm/Dust fusion-shrine altar on the shrine screens, or null otherwise. */
  private shrineZone: ShrineZone | null = null;

  constructor() {
    super({ key: 'SnowScene' });
  }

  init(data?: { screenId?: string; spawnEdge?: string }): void {
    // Tear down the previous screen's shrine before the scene instance is reused
    // on a screen transition (prevents stale altar overlays/listeners).
    this.shrineZone?.destroy();
    this.shrineZone = null;
    this.screenId = data?.screenId ?? 'snow_entry';
    this.screenDef = SNOW_SCREENS.find((s) => s.id === this.screenId);
  }

  tilesetKey(): string {
    return 'autotile_grass_16'; // unused — buildTilesets() handles multi-tileset loading
  }

  /** Snow maps are named by screen id: assets/maps/snow/<id>.json. */
  mapKeyForScreen(id: string): string {
    return id;
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

  /** Layer contract: ground (0) / behind (2) / in-front (5), plus optional
   *  mid-front (6) / max-front (7) overhead layers for the hand-authored shrine
   *  + settlement screens (dust_shrine, snowhaven, frozen_lake) that stack
   *  multiple canopy/roof tiers above the player. Screens without the extra
   *  layers are unaffected — a missing layer is simply skipped. */
  protected tileLayerNames(): string[] {
    return ['ground', 'behind', 'in-front', 'mid-front', 'max-front'];
  }

  /** `behind` uses non-empty collision (cliffs, cabins, tree trunks block movement),
   *  matching Swamp/Forest. snow_entry is excluded: it shipped with decorative dirt
   *  on `behind` (including under its spawn), so it stays in property mode — same
   *  per-screen carve-out ForestScene uses for forest_snow_gate. */
  protected tileLayerCollisionMode(layerName: string): 'property' | 'non-empty' {
    if (layerName === 'behind' && this.screenId !== 'snow_entry') return 'non-empty';
    return super.tileLayerCollisionMode(layerName);
  }

  protected tileLayerDepth(layerName: string): number {
    if (layerName === 'behind') return 2;
    if (layerName === 'in-front') return 5;
    if (layerName === 'mid-front') return 6;   // above in-front + player (3)
    if (layerName === 'max-front') return 7;   // topmost overhead canopy/roof tier
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
    // Cave pack — only on cave screens (the Frost Cavern); without these the
    // cave map's tilesets are filtered out by buildTilesets() and render blank.
    if (CAVE_SCREENS.has(this.screenId)) {
      for (const [key, path] of CAVE_TILESETS) {
        if (!this.textures.exists(key)) this.load.image(key, path);
      }
    }
    this.loadCommonAssets();
    // Load the current screen's map, keyed by its id (mirrors ForestScene).
    this.load.tilemapTiledJSON(
      this.mapKeyForScreen(this.screenId),
      `assets/maps/snow/${this.screenId}.json`,
    );
  }

  /** Multi-screen Snow region: walking off an edge transitions to the neighbour
   *  declared in SNOW_SCREENS. The south biome_exit object on snow_entry still
   *  drives the Forest return (handled separately from screenDef edge exits). */
  protected edgeTransitionsEnabled(): boolean {
    return true;
  }

  protected detectionRadius(): number {
    if (this.screenId === 'snow_frost_cavern') return FROST_CAVERN_DETECTION_RADIUS;
    if (this.screenId === 'snow_glacier_upper') return GLACIER_DETECTION_RADIUS;
    return SNOW_DETECTION_RADIUS;
  }

  /**
   * Sealed-door fusion shrines (GDD §10-snow). Like the Forest Thornado shrine,
   * the maps carry no altar object, so we synthesize a 32px altar zone at the
   * clearing centre. ShrineZone owns the sealed/open state + ring-key unseal
   * flow and fetches GET /api/shrines/:id; onShrineOpen opens the Fusion modal
   * pre-filtered to the fused element. (Snow shrine server records + the Storm/
   * Dust Guardians are server-side NpcSpawns work, #440 A3.)
   */
  onEnterScreen(): void {
    if (this.screenId === 'snow_storm_shrine') {
      this.buildSnowShrine('snow_storm_shrine', ElementEnum.STORM, 296, 152);
    } else if (this.screenId === 'snow_dust_shrine') {
      this.buildSnowShrine('snow_dust_shrine', ElementEnum.DUST, 264, 200);
    }
  }

  private buildSnowShrine(screenId: string, element: number, cx: number, cy: number): void {
    const ALTAR_PX = 32;
    const altarObj: Phaser.Types.Tilemaps.TiledObject = {
      id: -440,
      name: 'shrine',
      type: 'shrine',
      x: cx - ALTAR_PX / 2,
      y: cy - ALTAR_PX / 2,
      width: ALTAR_PX,
      height: ALTAR_PX,
    };
    this.shrineZone = new ShrineZone(
      this,
      altarObj,
      screenId,
      element,
      () => void this.openShrineFusion(element),
    );
    this.registerInteractionZone(
      this.shrineZone.interactionZone,
      this.shrineZone.altarObjects,
    );
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
