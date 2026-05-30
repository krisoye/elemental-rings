// Forest-screen generated map GID contract (EPIC #149 / #157).
//
// Single source of truth for the multi-tileset firstgid layout used by every
// GENERATED (non-hub) Forest and Swamp map. Consumed by:
//   - gen-forest-screens.mjs / gen-swamp-map.mjs (emit tileset descriptors + GIDs)
//   - ForestScene.ts / SwampScene.ts (load the matching textures)
//
// Tileset order is the LOAD ORDER in every generated map JSON; do NOT reorder.
// firstgid = sum of tilecount of all preceding entries + 1.
//
// PURE constants — no fs, no imports, no side effects.

export const GENERATED_TILESETS = [
  { name: 'autotile_grass_16',            image: '../../terrain/autotile_grass_16.png',     imagewidth: 768, imageheight: 16,  columns: 48, tilecount: 48,  firstgid: 1   },
  { name: 'autotile_dirt_16',             image: '../../terrain/autotile_dirt_16.png',      imagewidth: 768, imageheight: 16,  columns: 48, tilecount: 48,  firstgid: 49  },
  { name: 'autotile_water_16',            image: '../../terrain/autotile_water_16.png',     imagewidth: 768, imageheight: 16,  columns: 48, tilecount: 48,  firstgid: 97  },
  { name: 'autotile_cliff_16',            image: '../../terrain/autotile_cliff_16.png',     imagewidth: 768, imageheight: 16,  columns: 48, tilecount: 48,  firstgid: 145 },
  { name: 'ModernEra_GreenForest_Tileset', image: '../../terrain/terrain_forest_modern.png', imagewidth: 320, imageheight: 96,  columns: 20, tilecount: 120, firstgid: 193 },
  { name: 'berry_and_trees',              image: '../../flora/flora_berries_trees.png',     imagewidth: 80,  imageheight: 176, columns: 5,  tilecount: 55,  firstgid: 313 },
];

// firstgid arithmetic self-check (runs at import; throws on drift so a bad edit
// to the table above can never ship silently).
(() => {
  let expected = 1;
  for (const ts of GENERATED_TILESETS) {
    if (ts.firstgid !== expected) {
      throw new Error(
        `forest-gid-map: ${ts.name} firstgid ${ts.firstgid} !== expected ${expected}`
      );
    }
    expected += ts.tilecount;
  }
})();

// ── Ground-layer autotile GID bases ────────────────────────────────────────
// The exact GID for a terrain cell is BASE + resolveAutotileVariant(mask) (0–47).
export const GID_GRASS_BASE = 1; // GIDs 1–48    all walkable, no collides
export const GID_DIRT_BASE = 49; // GIDs 49–96   walkable, no collides
export const GID_WATER_BASE = 97; // GIDs 97–144  COLLIDE (all 48 variants)
export const GID_CLIFF_BASE = 145; // GIDs 145–192 COLLIDE (all 48 variants)

// ── ModernEra GreenForest (GIDs 193–312, 20×6 grid at 16px) ─────────────────
// Tiles identified by per-cell pixel analysis of terrain_forest_modern.png
// (local id = row * 20 + col). The tree/rock structures live in cols 4–9, rows 2–5.
export const GID_GREENFOREST_BASE = 193; // base offset; add local id (0-indexed)
// local 46 (6,2) — strong-brown tree-trunk segment (brown ~143/226 px).
export const GID_TREE_TRUNK = 193 + 46; // GID 239
// local 84 (4,4) — pure dense-green canopy crown (green 256/256 px).
export const GID_TREE_CANOPY_A = 193 + 84; // GID 277
// local 86 (6,4) — alternate dense-green canopy crown (green 227/256 px).
export const GID_TREE_CANOPY_B = 193 + 86; // GID 279
// local 49 (9,2) — neutral-grey stone boulder / rock base (grey-dominant cell).
export const GID_ROCK_A = 193 + 49; // GID 242

// ── Berry & trees flora (GIDs 313–367, 5×11 grid at 16px) ───────────────────
// Tiles identified by per-cell pixel analysis of flora_berries_trees.png
// (local id = row * 5 + col).
export const GID_FLORA_BASE = 313;
// local 0 (0,0) — green leafy shrub / bush clump (green 135/157 px).
export const GID_BUSH_A = 313 + 0; // GID 313
// local 10 (0,2) — magenta-pink flowering plant / ground cover (col 170/204 px).
export const GID_FLOWER_A = 313 + 10; // GID 323
