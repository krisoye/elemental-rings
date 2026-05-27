// Single source of truth for every Phase 8D asset generator's source-art paths.
//
// All generators (gen-forest-tiles, gen-swamp-tiles, gen-sanctum-tiles,
// gen-forest-sprites, gen-structure-sprites, decode-autotile) import the path
// constants from here so the source-art location is defined in exactly one place.
//
// The source art was copied from the OneDrive "asset alliance" packs into a
// dedicated host directory under /var/lib/elemental-rings/pixel_assets/source-art/.
// These are host-bound absolute paths (the art is NOT committed to the repo —
// only the deterministic generated PNGs are).

export const GREENFOREST_TILESET =
  '/var/lib/elemental-rings/pixel_assets/source-art/GreenForest/ModernEra_GreenForest_Tileset.png';

export const STARTER_VILLAGE_A2 =
  '/var/lib/elemental-rings/pixel_assets/source-art/StarterVillage/32x32/asset_alliance_starter_village_RPG_Maker_VX&Upper_autotile_A2_32x32.png';

export const STARTER_VILLAGE_MAIN =
  '/var/lib/elemental-rings/pixel_assets/source-art/StarterVillage/32x32/asset_alliance_starter_village_main_32x32.png';

export const COZY_FLOOR_WALL =
  '/var/lib/elemental-rings/pixel_assets/source-art/CozyIndoor/spr_tile_cozy_indoor_wall_floor.png';

export const COZY_FURNITURE =
  '/var/lib/elemental-rings/pixel_assets/source-art/CozyIndoor/spr_tile_cozy_indoor_furniture.png';

export const COZY_FLOOR_AUTO16 =
  '/var/lib/elemental-rings/pixel_assets/source-art/CozyIndoor/spr_tile_cozy_indoor_floor_auto16.png';

export const COLD_CAVE_TILESET =
  '/var/lib/elemental-rings/pixel_assets/source-art/ColdCave/Tileset.png';
