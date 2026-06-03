// Forest-screen generated map GID contract (EPIC #149 / #157, curated-palette rework).
//
// Single source of truth for the multi-tileset firstgid layout used by every
// GENERATED (non-hub, non-hand-authored) Forest map. Consumed by:
//   - gen-forest-screens.mjs (emit tileset descriptors + GIDs)
//   - ForestScene.ts (load the matching textures)
//
// Tileset order is the LOAD ORDER in every generated map JSON; do NOT reorder.
// firstgid = sum of tilecount of all preceding entries + 1.
//
// The curated palette mirrors the developer's hand-authored maps: the four
// autotile_{grass,dirt,cliff} strips are dropped in favour of curated tiles from
// ModernEra_GreenForest, terrain_plains_fantasy, tileset_village_main_a and
// terrain_forest_void. Only autotile_water_16 survives (T_WATER ponds still
// autotile). imagewidth/imageheight/tilecount/columns mirror the actual PNGs and
// the firstgid layout baked into the hand-authored maps.
//
// PURE constants — no fs, no imports, no side effects.

export const GENERATED_TILESETS = [
  { name: 'autotile_water_16',             image: '../../terrain/autotile_water_16.png',     imagewidth: 768, imageheight: 16,  columns: 48, tilecount: 48,  firstgid: 1   },
  { name: 'ModernEra_GreenForest_Tileset', image: '../../terrain/terrain_forest_modern.png', imagewidth: 320, imageheight: 96,  columns: 20, tilecount: 120, firstgid: 49  },
  { name: 'berry_and_trees',               image: '../../flora/flora_berries_trees.png',     imagewidth: 80,  imageheight: 176, columns: 5,  tilecount: 55,  firstgid: 169 },
  { name: 'terrain_plains_fantasy',        image: '../../terrain/terrain_plains_fantasy.png', imagewidth: 256, imageheight: 256, columns: 16, tilecount: 256, firstgid: 224 },
  { name: 'tileset_village_main_a',        image: '../../structures/tileset_village_main_a.png', imagewidth: 256, imageheight: 256, columns: 16, tilecount: 256, firstgid: 480 },
  { name: 'terrain_forest_void',           image: '../../terrain/terrain_forest_void.png',   imagewidth: 64,  imageheight: 16,  columns: 4,  tilecount: 4,   firstgid: 736 },
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

// ── autotile_water_16 (firstgid=1) ──────────────────────────────────────────
// The exact GID for a T_WATER cell is GID_WATER_BASE + resolveAutotileVariant(mask).
export const GID_WATER_BASE = 1; // GIDs 1–48  COLLIDE (all 48 variants)

// ── ModernEra GreenForest (firstgid=49, 20 cols) ────────────────────────────
export const GID_GREENFOREST_BASE = 49; // base offset; add local id (0-indexed)
export const GID_TREE_TRUNK = 49 + 46; // = 95  — local (6,2) brown trunk
export const GID_ROCK_A = 49 + 49; // = 98  — local (9,2) boulder
// behind-layer trunk variants (local row 6 cols 7–8):
export const GID_TRUNK_B = 49 + 127; // = 176
export const GID_TRUNK_C = 49 + 128; // = 177

// ── berry_and_trees flora (firstgid=169, 5 cols) ────────────────────────────
export const GID_FLORA_BASE = 169;
export const GID_BUSH_A = 169; // local 0 — green leafy shrub / bush clump
export const GID_FLOWER_A = 169 + 10; // = 179 — flowering ground cover

// ── terrain_plains_fantasy (firstgid=224, 16 cols) ──────────────────────────
export const GID_PLAINS_BASE = 224;
// Behind-layer trunk variants (local rows 0–2, cols 0–3):
export const GID_PLAINS_TRUNK_00 = 224; // local 0
export const GID_PLAINS_TRUNK_01 = 225;
export const GID_PLAINS_TRUNK_02 = 226;
export const GID_PLAINS_TRUNK_03 = 227;
export const GID_PLAINS_TRUNK_16 = 240; // local 16
export const GID_PLAINS_TRUNK_17 = 241;
export const GID_PLAINS_TRUNK_32 = 256; // local 32
export const GID_PLAINS_TRUNK_33 = 257;
// In-front canopy variants (from north_road in-front layer heavy hitters):
export const GID_PLAINS_CANOPY_A = 224 + 199; // = 423 — local (12,7)
export const GID_PLAINS_CANOPY_B = 224 + 200; // = 424
export const GID_PLAINS_CANOPY_C = 224 + 198; // = 422
export const GID_PLAINS_CANOPY_D = 224 + 215; // = 439 — local (13,7)
// Road/dirt path tiles (ground layer, from north_road):
export const GID_PATH_A = 224 + 198; // = 422
export const GID_PATH_B = 224 + 199; // = 423
export const GID_PATH_C = 224 + 200; // = 424
export const GID_PATH_D = 224 + 215; // = 439

// ── tileset_village_main_a (firstgid=480, 16 cols) ──────────────────────────
export const GID_VILLAGE_BASE = 480;
export const GID_GRASS_FILL = 480 + 78; // = 558 — local (4,14) dominant forest floor
export const GID_VILLAGE_FENCE_MID = 480 + 144; // = 624 — local (9,0) vertical fence, middle section

// ── terrain_forest_void (firstgid=736) ──────────────────────────────────────
export const GID_VOID = 736; // local 0 — perimeter frame / void border
