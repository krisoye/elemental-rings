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

export const STARTER_VILLAGE_MAIN_B_16 =
  '/var/lib/elemental-rings/pixel_assets/source-art/StarterVillage/16px/asset_alliance_starter_village_main_B_16px.png';

// NPC overworld sprite sources (monster walk-cycles + human charsets).
export const MONSTER_FIRE_OW =
  '/var/lib/elemental-rings/pixel_assets/source-art/Monsters/fire_01_overworld.png';
export const MONSTER_WATER_OW =
  '/var/lib/elemental-rings/pixel_assets/source-art/Monsters/water_grass_19_overworld.png';
export const MONSTER_EARTH_OW =
  '/var/lib/elemental-rings/pixel_assets/source-art/Monsters/water_grass_20_overworld.png';
export const MONSTER_WIND_OW =
  '/var/lib/elemental-rings/pixel_assets/source-art/Monsters/water_fly_11_overworld.png';
export const MONSTER_WOOD_OW =
  '/var/lib/elemental-rings/pixel_assets/source-art/Monsters/electro_ghost_14_overworld.png';
export const CHARSET_A1 =
  '/var/lib/elemental-rings/pixel_assets/source-art/NPCs/charsetA_1.png';

export const WILD_PLAINS_TILESET =
  '/var/lib/elemental-rings/pixel_assets/source-art/WildPlains/wild_plains_pack.png';
