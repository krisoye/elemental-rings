// client/src/objects/world/forestMeta.ts
//
// Display metadata for Forest screens shown in OverworldMapModal.
// Keyed by screen id. Danger/safe/anchorage fields come from ScreenDef
// directly — this file only holds what ScreenDef doesn't have:
//   - modal label (short display name)
//   - boss tier (for the corner glyph)
//   - isolated flag (teleport-only; no walking exits)
//
// Maintenance note: add a row here when a new Forest screen is added to
// shared/world/forest.ts. The coord, danger, safe, and anchorage fields
// are read from ScreenDef — do NOT duplicate them here.

export type BossTier = 'major' | 'gate' | 'guardian';

export interface ForestScreenMeta {
  label: string;
  boss?: BossTier;
  isolated?: true;
}

export const FOREST_SCREEN_META: Record<string, ForestScreenMeta> = {
  forest_anchorage:       { label: 'Anchorage' },
  forest_north_road:      { label: 'North Road' },
  forest_snow_gate:       { label: 'Snow Gate',       boss: 'gate' },
  forest_mossy_fen:       { label: 'Mossy Fen' },
  forest_deep_fen:        { label: 'Deep Fen' },
  forest_fen_ridge:       { label: 'Fen Ridge' },
  forest_south_path:      { label: 'South Path' },
  forest_hollow:          { label: 'The Hollow' },
  forest_swamp_gate:      { label: 'Swamp Gate',      boss: 'gate' },
  forest_east_path:       { label: 'East Path' },
  forest_glade:           { label: 'The Glade' },
  forest_heath:           { label: 'The Heath' },
  forest_wind_shelf:      { label: 'Wind Shelf' },
  forest_thornado_shrine: { label: 'Thornado\nShrine', boss: 'guardian' },
  forest_gale_lookout:    { label: 'Gale\nLookout' },
  forest_crossroads:      { label: 'Crossroads' },
  forest_briar_pass:      { label: 'Briar Pass' },
  forest_ridge:           { label: 'The Ridge' },
  forest_deepwood:        { label: 'The Deepwood' },
  forest_rocky_overlook:  { label: 'Rocky\nOverlook' },
  forest_boss_clearing:   { label: 'Boss\nClearing',  boss: 'major' },
  forest_verdant_descent: { label: 'Verdant\nDescent' },
  forest_ancient_grove:   { label: 'Ancient\nGrove' },
  forest_bloom_hollow:    { label: 'Bloom\nHollow',   boss: 'guardian' },
  forest_root_tangle:     { label: 'Root Tangle' },
  forest_canopy_walk:     { label: 'Canopy Walk' },
  forest_briar_thicket:   { label: 'Briar\nThicket' },
  forest_hidden_alcove:   { label: 'Hidden\nAlcove',  isolated: true },
};
