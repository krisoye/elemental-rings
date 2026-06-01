// Forest region screen manifest (GDD §10.15/§10.17, Phase 8E). The single source
// of truth for the Forest biome's multi-screen layout: each ScreenDef declares a
// screen's tile size, its cardinal exits to neighbouring screens, optional
// safe/danger tagging, the anchorage catalog id it carries, and any biome-exit
// transition to an adjacent biome.
//
// This module is shared by:
//   - ForestScene (client) — drives edge transitions + per-screen lookup,
//   - the map generator (gen-forest-screens.mjs inlines a copy of the data),
//   - the Vitest drift test (reciprocal exits + catalog parity).
//
// Anchorage ids MUST exist in shared/waystones.ts (catalog parity is asserted
// by the drift test). Exits MUST be reciprocal (a north exit to X means X has
// a south exit back). Biome exits are ungated; bosses physically block paths.

/** One Forest screen: its tile dimensions, exits, and catalog wiring. */
export interface ScreenDef {
  /** Stable screen id; also the Phaser map cache key suffix and spawn target. */
  id: string;
  /** Human-readable area name shown in the HUD label (e.g. "The Glade"). */
  name: string;
  /** [widthTiles, heightTiles] of this screen's tilemap. */
  size: [number, number];
  /** Cardinal exits → the neighbouring screen id. Reciprocal across screens. */
  exits: Partial<Record<'north' | 'south' | 'east' | 'west', string>>;
  /** A safe screen — no danger / no hostile spawns (the hub anchorage). */
  safe?: true;
  /** Danger tier (1–3) — drives ambient threat; presentation only. */
  danger?: 1 | 2 | 3;
  /** Anchorage id placed on this screen — must exist in shared/waystones.ts. */
  anchorage?: string;
  /** A transition to an adjacent biome (e.g. the Swamp) at a screen edge. */
  biomeExit?: {
    dir: 'north' | 'south' | 'east' | 'west';
    target: string;
  };
}

export const FOREST_SCREENS: ScreenDef[] = [
  {
    id: 'forest_anchorage',
    name: 'The Anchorage',
    size: [40, 30],
    exits: {
      north: 'forest_north_road',
      east: 'forest_east_path',
      south: 'forest_south_path',
      west: 'forest_mossy_fen',
    },
    safe: true,
    anchorage: 'forest_entry',
  },
  {
    id: 'forest_north_road',
    name: 'North Road',
    size: [16, 32],
    exits: { south: 'forest_anchorage', north: 'forest_snow_gate' },
    danger: 1,
  },
  {
    id: 'forest_snow_gate',
    name: 'Snow Gate',
    size: [32, 20],
    exits: { south: 'forest_north_road' },
    danger: 2,
    // Boss guards the northern exit to Snow Fields; no waystone needed.
  },
  {
    id: 'forest_mossy_fen',
    name: 'Mossy Fen',
    size: [32, 22],
    exits: { east: 'forest_anchorage', west: 'forest_deep_fen' },
    danger: 1,
  },
  {
    id: 'forest_east_path',
    name: 'East Path',
    size: [24, 12],
    exits: { west: 'forest_anchorage', east: 'forest_glade' },
    danger: 1,
  },
  {
    id: 'forest_glade',
    name: 'The Glade',
    size: [36, 28],
    exits: { west: 'forest_east_path', north: 'forest_crossroads', east: 'forest_heath' },
    danger: 1,
    anchorage: 'forest_glade',
  },
  {
    id: 'forest_crossroads',
    name: 'The Crossroads',
    size: [28, 22],
    exits: { south: 'forest_glade', east: 'forest_briar_pass', north: 'forest_ridge' },
    danger: 1,
  },
  {
    id: 'forest_south_path',
    name: 'South Path',
    size: [16, 28],
    exits: { north: 'forest_anchorage', south: 'forest_hollow' },
    danger: 1,
  },
  {
    id: 'forest_hollow',
    name: 'The Hollow',
    size: [36, 24],
    exits: { north: 'forest_south_path', west: 'forest_swamp_gate' },
    danger: 2,
  },
  {
    id: 'forest_swamp_gate',
    name: 'Swamp Gate',
    size: [28, 18],
    exits: { east: 'forest_hollow' },
    danger: 2,
    // Swamp is open once the Bogwood boss is defeated (blocks path physically).
    biomeExit: { dir: 'south', target: 'SwampScene' },
  },
  {
    id: 'forest_briar_pass',
    name: 'Briar Pass',
    size: [40, 16],
    exits: { west: 'forest_crossroads', south: 'forest_boss_clearing' },
    danger: 2,
  },
  {
    id: 'forest_ridge',
    name: 'The Ridge',
    size: [32, 22],
    exits: { south: 'forest_crossroads', east: 'forest_deepwood', north: 'forest_rocky_overlook' },
    danger: 2,
  },
  {
    id: 'forest_deepwood',
    name: 'The Deepwood',
    size: [40, 30],
    exits: { west: 'forest_ridge', east: 'forest_boss_clearing', south: 'forest_root_tangle' },
    danger: 3,
    anchorage: 'forest_depths',
  },
  {
    id: 'forest_boss_clearing',
    name: 'Boss Clearing',
    size: [28, 22],
    exits: { north: 'forest_briar_pass', west: 'forest_deepwood', south: 'forest_verdant_descent' },
    danger: 3,
  },
  {
    id: 'forest_hidden_alcove',
    name: 'Hidden Alcove',
    size: [24, 18],
    exits: {},
    danger: 1,
    anchorage: 'forest_hidden_anchor',
  },
  {
    id: 'forest_heath',
    name: 'The Heath',
    size: [38, 26],
    exits: { west: 'forest_glade', east: 'forest_wind_shelf', north: 'forest_gale_lookout' },
    danger: 2,
  },
  {
    id: 'forest_gale_lookout',
    name: 'Gale Lookout',
    size: [26, 20],
    exits: { south: 'forest_heath' },
    danger: 2,
  },
  {
    id: 'forest_wind_shelf',
    name: 'Wind Shelf',
    size: [28, 28],
    exits: { west: 'forest_heath', east: 'forest_thornado_shrine' },
    danger: 2,
  },
  {
    id: 'forest_thornado_shrine',
    name: 'Thornado Shrine',
    size: [40, 30],
    exits: { west: 'forest_wind_shelf' },
    danger: 2,
  },
  {
    id: 'forest_deep_fen',
    name: 'The Deep Fen',
    size: [34, 28],
    exits: { east: 'forest_mossy_fen', north: 'forest_fen_ridge' },
    danger: 2,
  },
  {
    id: 'forest_fen_ridge',
    name: 'Fen Ridge',
    size: [28, 22],
    exits: { south: 'forest_deep_fen' },
    danger: 2,
  },
  {
    id: 'forest_rocky_overlook',
    name: 'Rocky Overlook',
    size: [28, 18],
    exits: { south: 'forest_ridge' },
    danger: 2,
  },
  {
    id: 'forest_verdant_descent',
    name: 'Verdant Descent',
    size: [18, 32],
    exits: { north: 'forest_boss_clearing', south: 'forest_ancient_grove' },
    danger: 2,
  },
  {
    id: 'forest_ancient_grove',
    name: 'The Ancient Grove',
    size: [44, 34],
    exits: { north: 'forest_verdant_descent', west: 'forest_bloom_hollow', east: 'forest_root_tangle' },
    danger: 3,
  },
  {
    id: 'forest_bloom_hollow',
    name: 'Bloom Hollow',
    size: [38, 30],
    exits: { east: 'forest_ancient_grove' },
    danger: 2,
  },
  {
    id: 'forest_root_tangle',
    name: 'The Root Tangle',
    size: [32, 24],
    exits: { west: 'forest_ancient_grove', north: 'forest_deepwood', east: 'forest_canopy_walk' },
    danger: 3,
  },
  {
    id: 'forest_canopy_walk',
    name: 'Canopy Walk',
    size: [22, 38],
    exits: { west: 'forest_root_tangle', east: 'forest_briar_thicket' },
    danger: 3,
  },
  {
    id: 'forest_briar_thicket',
    name: 'The Briar Thicket',
    size: [30, 22],
    exits: { west: 'forest_canopy_walk' },
    danger: 3,
  },
];

/** Look up a Forest screen definition by id, or undefined if unknown. */
export function getForestScreen(id: string): ScreenDef | undefined {
  return FOREST_SCREENS.find((s) => s.id === id);
}
