// Deterministic generator for the Forest region screens (GDD §10.17), 16px/3-layer
// (EPIC #149 / #159).
//
// Reads the Forest screen manifest (FOREST_SCREENS, mirrored inline below from
// shared/world/forest.ts — a Node .mjs cannot import the TS module) and writes one
// Tiled 1.10 JSON map per NON-HUB screen to
// client/public/assets/maps/forest/<id>.json. The hand-authored hub
// (forest_anchorage) is SKIPPED — it ships its own 6-tileset hub config and must
// not be overwritten.
//
// Each generated map is 16px/3-layer (ground / behind / in-front / objects) with
// autotiled terrain (grass / dirt roads / water ponds / cliff groves) resolved by
// the shared blob autotile resolver. Pure & reproducible: re-running produces no
// spurious diff (the only randomness — feature placement on open danger screens —
// is seeded by a hash of the screen id).
//
// Run from the client/ directory:  node scripts/gen-forest-screens.mjs
// (or `npm run gen:forest-screens`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  GENERATED_TILESETS,
  GID_WATER_BASE,
  GID_GRASS_FILL,
  GID_PATH_B,
  GID_TREE_TRUNK,
  GID_TRUNK_B,
  GID_TRUNK_C,
  GID_PLAINS_TRUNK_00,
  GID_PLAINS_TRUNK_01,
  GID_PLAINS_TRUNK_16,
  GID_PLAINS_TRUNK_32,
  GID_PLAINS_CANOPY_A,
  GID_PLAINS_CANOPY_B,
  GID_PLAINS_CANOPY_C,
  GID_PLAINS_CANOPY_D,
  GID_VILLAGE_CANOPY,
  GID_VOID,
} from './lib/forest-gid-map.mjs';
import { resolveAutotileVariant } from './lib/autotile-resolver.mjs';

const TILE = 16; // 16px tiles (was 32)

// Terrain types — determine GID base + autotile variant on the ground layer.
const T_GRASS = 0;
const T_DIRT = 1;
const T_WATER = 2;
const T_CLIFF = 3;

// ── Inlined copy of shared/world/forest.ts FOREST_SCREENS (kept in sync; a Vitest
// drift test guards the TS manifest's reciprocity + catalog parity). ────────────
const FOREST_SCREENS = [
  {
    id: 'forest_anchorage',
    size: [40, 30],
    exits: { north: 'forest_north_road', east: 'forest_east_path', south: 'forest_south_path', west: 'forest_mossy_fen' },
    coord: { x: 0, y: 0 },
    safe: true,
    anchorage: 'forest_entry',
  },
  { id: 'forest_north_road', size: [16, 32], exits: { south: 'forest_anchorage', north: 'forest_snow_gate' }, coord: { x: 0, y: 1 }, danger: 1 },
  { id: 'forest_snow_gate', size: [32, 20], exits: { south: 'forest_north_road' }, coord: { x: 0, y: 2 }, danger: 2 },
  { id: 'forest_mossy_fen', size: [32, 22], exits: { east: 'forest_anchorage', west: 'forest_deep_fen' }, coord: { x: -1, y: 0 }, danger: 1 },
  { id: 'forest_east_path', size: [24, 12], exits: { west: 'forest_anchorage', east: 'forest_glade' }, coord: { x: 1, y: 0 }, danger: 1 },
  { id: 'forest_glade', size: [36, 28], exits: { west: 'forest_east_path', north: 'forest_crossroads', east: 'forest_heath' }, coord: { x: 2, y: 0 }, danger: 1, anchorage: 'forest_glade' },
  { id: 'forest_crossroads', size: [28, 22], exits: { south: 'forest_glade', north: 'forest_ridge', west: 'forest_briar_pass' }, coord: { x: 2, y: 1 }, danger: 1 },
  { id: 'forest_south_path', size: [16, 28], exits: { north: 'forest_anchorage', south: 'forest_hollow' }, coord: { x: 0, y: -1 }, danger: 1 },
  { id: 'forest_hollow', size: [36, 24], exits: { north: 'forest_south_path', west: 'forest_swamp_gate' }, coord: { x: 0, y: -2 }, danger: 2 },
  {
    id: 'forest_swamp_gate',
    size: [28, 18],
    exits: { east: 'forest_hollow' },
    coord: { x: -1, y: -2 },
    danger: 2,
    biomeExit: { dir: 'south', target: 'SwampScene' },
  },
  { id: 'forest_briar_pass', size: [40, 16], exits: { east: 'forest_crossroads', north: 'forest_deepwood' }, coord: { x: 1, y: 1 }, danger: 2 },
  { id: 'forest_ridge', size: [32, 22], exits: { south: 'forest_crossroads', north: 'forest_rocky_overlook', west: 'forest_deepwood' }, coord: { x: 2, y: 2 }, danger: 2 },
  { id: 'forest_deepwood', size: [40, 30], exits: { south: 'forest_briar_pass', east: 'forest_ridge', north: 'forest_boss_clearing' }, coord: { x: 1, y: 2 }, danger: 3, anchorage: 'forest_depths' },
  { id: 'forest_boss_clearing', size: [28, 22], exits: { south: 'forest_deepwood', north: 'forest_verdant_descent' }, coord: { x: 1, y: 3 }, danger: 3 },
  {
    id: 'forest_hidden_alcove',
    size: [24, 18],
    exits: {},
    danger: 1,
    anchorage: 'forest_hidden_anchor',
  },
  { id: 'forest_heath', size: [38, 26], exits: { west: 'forest_glade', east: 'forest_wind_shelf', north: 'forest_gale_lookout' }, coord: { x: 3, y: 0 }, danger: 2 },
  { id: 'forest_gale_lookout', size: [26, 20], exits: { south: 'forest_heath' }, coord: { x: 3, y: 1 }, danger: 2 },
  { id: 'forest_wind_shelf', size: [28, 28], exits: { west: 'forest_heath', east: 'forest_thornado_shrine' }, coord: { x: 4, y: 0 }, danger: 2 },
  { id: 'forest_thornado_shrine', size: [40, 30], exits: { west: 'forest_wind_shelf' }, coord: { x: 5, y: 0 }, danger: 2 },
  { id: 'forest_deep_fen', size: [34, 28], exits: { east: 'forest_mossy_fen', north: 'forest_fen_ridge' }, coord: { x: -2, y: 0 }, danger: 2 },
  { id: 'forest_fen_ridge', size: [28, 22], exits: { south: 'forest_deep_fen' }, coord: { x: -2, y: 1 }, danger: 2 },
  { id: 'forest_rocky_overlook', size: [28, 18], exits: { south: 'forest_ridge' }, coord: { x: 2, y: 3 }, danger: 2 },
  { id: 'forest_verdant_descent', size: [18, 32], exits: { south: 'forest_boss_clearing', north: 'forest_ancient_grove' }, coord: { x: 1, y: 4 }, danger: 2 },
  { id: 'forest_ancient_grove', size: [44, 34], exits: { south: 'forest_verdant_descent', west: 'forest_bloom_hollow', east: 'forest_root_tangle' }, coord: { x: 1, y: 5 }, danger: 3 },
  { id: 'forest_bloom_hollow', size: [38, 30], exits: { east: 'forest_ancient_grove' }, coord: { x: 0, y: 5 }, danger: 2 },
  { id: 'forest_root_tangle', size: [32, 24], exits: { west: 'forest_ancient_grove', east: 'forest_canopy_walk' }, coord: { x: 2, y: 5 }, danger: 3 },
  { id: 'forest_canopy_walk', size: [22, 38], exits: { west: 'forest_root_tangle', east: 'forest_briar_thicket' }, coord: { x: 3, y: 5 }, danger: 3 },
  { id: 'forest_briar_thicket', size: [30, 22], exits: { west: 'forest_canopy_walk' }, coord: { x: 4, y: 5 }, danger: 3 },
];

/** A short axis (< this many tiles) marks a corridor screen (tree-walled sides). */
const CORRIDOR_THRESHOLD = 20;
/** Half-width (tiles) of the clear gap opened in a perimeter/corridor wall at an
 *  exit. 4 tiles at 16px ≈ the old 2-tile gap at 32px physical width. */
const GAP_HALF = 4;

/** Deterministic 32-bit hash of a string (FNV-1a) → a stable per-screen seed. */
function hashSeed(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A tiny seeded LCG PRNG → reproducible feature placement. */
function makeRng(seed) {
  let state = seed || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
}

/** Clamp a tile index to the interior span [1, dim-2] (never a corner tile). */
function clampTile(t, dim) {
  return Math.max(1, Math.min(dim - 2, t));
}

/** Tile midpoint of a screen edge in the given direction. */
function edgeMidpoint(dir, w, h) {
  switch (dir) {
    case 'north':
      return { tx: (w / 2) | 0, ty: 1 };
    case 'south':
      return { tx: (w / 2) | 0, ty: h - 2 };
    case 'west':
      return { tx: 1, ty: (h / 2) | 0 };
    case 'east':
      return { tx: w - 2, ty: (h / 2) | 0 };
    default:
      return { tx: (w / 2) | 0, ty: (h / 2) | 0 };
  }
}

/**
 * Bresenham line from (x0,y0) to (x1,y1) painting `terrainType` with a 1-tile cross
 * brush (centre + 4 cardinals) so the path reads ~3 tiles wide. NEVER overwrites
 * T_CLIFF/T_WATER (cliffs and ponds break roads, not the other way around).
 */
function bresenhamTerrain(grid, w, h, x0, y0, x1, y1, terrainType) {
  const at = (tx, ty) => ty * w + tx;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0;
  let y = y0;
  while (true) {
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const px = x + ox;
      const py = y + oy;
      if (px > 0 && py > 0 && px < w - 1 && py < h - 1) {
        if (grid[at(px, py)] === T_GRASS) grid[at(px, py)] = terrainType;
      }
    }
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * 8-neighbour same-terrain bitmask for an autotiled cell. Bit order matches the
 * resolver: bit0=N, bit1=NE, bit2=E, bit3=SE, bit4=S, bit5=SW, bit6=W, bit7=NW.
 * Out-of-bounds neighbours count as NOT same-terrain (0).
 */
function neighborMaskForTerrain(grid, w, h, tx, ty, terrainType) {
  const same = (nx, ny) =>
    nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny * w + nx] === terrainType ? 1 : 0;
  let mask = 0;
  mask |= same(tx, ty - 1) << 0; // N
  mask |= same(tx + 1, ty - 1) << 1; // NE
  mask |= same(tx + 1, ty) << 2; // E
  mask |= same(tx + 1, ty + 1) << 3; // SE
  mask |= same(tx, ty + 1) << 4; // S
  mask |= same(tx - 1, ty + 1) << 5; // SW
  mask |= same(tx - 1, ty) << 6; // W
  mask |= same(tx - 1, ty - 1) << 7; // NW
  return mask;
}

/** Carve a GAP_HALF*2-wide T_GRASS gap in the perimeter at `dir`'s edge midpoint. */
function carveExitGap(grid, w, h, dir) {
  const at = (tx, ty) => ty * w + tx;
  const m = edgeMidpoint(dir, w, h);
  for (let d = -GAP_HALF + 1; d <= GAP_HALF; d++) {
    if (dir === 'north') grid[at(clampTile(m.tx + d, w), 0)] = T_GRASS;
    else if (dir === 'south') grid[at(clampTile(m.tx + d, w), h - 1)] = T_GRASS;
    else if (dir === 'west') grid[at(0, clampTile(m.ty + d, h))] = T_GRASS;
    else if (dir === 'east') grid[at(w - 1, clampTile(m.ty + d, h))] = T_GRASS;
  }
}

/**
 * Pass 1: build the per-tile terrain-type grid (T_* values, row-major top-down).
 */
function buildTerrainGrid(screen) {
  const [w, h] = screen.size;
  const at = (tx, ty) => ty * w + tx;
  const grid = new Uint8Array(w * h).fill(T_GRASS);

  // Perimeter → T_CLIFF (blocks edges; exit gaps are re-opened to T_GRASS below).
  for (let x = 0; x < w; x++) {
    grid[at(x, 0)] = T_CLIFF;
    grid[at(x, h - 1)] = T_CLIFF;
  }
  for (let y = 0; y < h; y++) {
    grid[at(0, y)] = T_CLIFF;
    grid[at(w - 1, y)] = T_CLIFF;
  }

  const dirs = Object.keys(screen.exits ?? {});
  const isCorridor = Math.min(w, h) < CORRIDOR_THRESHOLD;

  if (isCorridor) {
    // Corridor: T_CLIFF flanks the long axis, leaving a clear central path.
    if (w < h) {
      for (let y = 1; y < h - 1; y++) {
        for (const tx of [1, 2, 3, w - 4, w - 3, w - 2]) {
          if (tx > 0 && tx < w - 1) grid[at(tx, y)] = T_CLIFF;
        }
      }
    } else {
      for (let x = 1; x < w - 1; x++) {
        for (const ty of [1, 2, 3, h - 4, h - 3, h - 2]) {
          if (ty > 0 && ty < h - 1) grid[at(x, ty)] = T_CLIFF;
        }
      }
    }
    // Clear a channel near each exit (and the biome exit) so the central path is
    // reachable. biomeExit is included here for the same reason it is included in
    // carveExitGap and bresenhamTerrain below: on corridor screens a biome exit
    // in the flanked direction (e.g. south on a wide corridor) gets its channel
    // blocked by the cliff walls unless we explicitly clear it.
    const allExitDirs = [...dirs, ...(screen.biomeExit ? [screen.biomeExit.dir] : [])];
    for (const dir of allExitDirs) {
      const m = edgeMidpoint(dir, w, h);
      for (let d = -GAP_HALF; d <= GAP_HALF; d++) {
        if (dir === 'north' || dir === 'south') {
          for (let y = 1; y < h - 1; y++) {
            const tx = m.tx + d;
            if (tx > 0 && tx < w - 1) grid[at(tx, y)] = T_GRASS;
          }
        } else {
          for (let x = 1; x < w - 1; x++) {
            const ty = m.ty + d;
            if (ty > 0 && ty < h - 1) grid[at(x, ty)] = T_GRASS;
          }
        }
      }
    }
  } else if (!screen.safe) {
    // Open screen: scatter 3–5 deterministic terrain features (radius 2–3). Danger
    // tier 2 → ponds (water); tiers 1/3 → groves (cliff → trunks + canopy). The hub
    // (`safe`) screen is never reached here. Features are kept off the centre so the
    // anchorage clearing / path hub stays clear.
    const rng = makeRng(hashSeed(screen.id));
    const featureCount = 3 + Math.floor(rng() * 3); // 3..5
    for (let i = 0; i < featureCount; i++) {
      const r = 2 + Math.floor(rng() * 2); // 2..3
      const cx = 3 + Math.floor(rng() * Math.max(1, w - 6));
      const cy = 3 + Math.floor(rng() * Math.max(1, h - 6));
      const fType = screen.danger === 2 ? T_WATER : T_CLIFF;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const tx = cx + dx;
          const ty = cy + dy;
          if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1) continue;
          grid[at(tx, ty)] = fType;
        }
      }
    }
  }

  // Re-open perimeter exit gaps to T_GRASS so the player can walk into each edge.
  for (const dir of dirs) carveExitGap(grid, w, h, dir);
  if (screen.biomeExit) carveExitGap(grid, w, h, screen.biomeExit.dir);

  // Dirt paths: from every exit (and the biome exit) edge midpoint to the centre,
  // joining all exits with a walkable T_DIRT road (carved only through T_GRASS).
  const ccx = (w / 2) | 0;
  const ccy = (h / 2) | 0;
  for (const dir of dirs) {
    const m = edgeMidpoint(dir, w, h);
    bresenhamTerrain(grid, w, h, m.tx, m.ty, ccx, ccy, T_DIRT);
  }
  if (screen.biomeExit) {
    const m = edgeMidpoint(screen.biomeExit.dir, w, h);
    bresenhamTerrain(grid, w, h, m.tx, m.ty, ccx, ccy, T_DIRT);
  }

  // Anchorage clearing: a 5×5 T_GRASS area at centre so the seeded NPC roster and
  // the anchorage marker never land on a blocking tile.
  if (screen.anchorage) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = ccx + dx;
        const ty = ccy + dy;
        if (tx <= 0 || ty <= 0 || tx >= w - 1 || ty >= h - 1) continue;
        grid[at(tx, ty)] = T_GRASS;
      }
    }
  }

  return grid;
}

/**
 * Ground-layer GID array (curated palette). The terrain grid is unchanged; only
 * the per-cell output GID differs from the old autotile layout:
 *   - T_GRASS / T_CLIFF → flat natural floor fill (cliffs read via behind/in-front)
 *   - T_DIRT            → curated road/path tile (flat, no autotiling)
 *   - T_WATER           → autotiled pond (the only surviving autotile terrain)
 */
function buildGroundLayer(screen, terrainGrid) {
  const [w, h] = screen.size;
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(0);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const t = terrainGrid[at(tx, ty)];
      if (t === T_WATER) {
        const mask = neighborMaskForTerrain(terrainGrid, w, h, tx, ty, T_WATER);
        data[at(tx, ty)] = GID_WATER_BASE + resolveAutotileVariant(mask);
      } else if (t === T_DIRT) {
        data[at(tx, ty)] = GID_PATH_B;
      } else {
        // T_GRASS and T_CLIFF both sit on the natural forest floor fill.
        data[at(tx, ty)] = GID_GRASS_FILL;
      }
    }
  }
  return data;
}

/** Trunk variants for the behind layer (non-empty collision blocks movement). */
const TRUNK_VARIANTS = [
  GID_TREE_TRUNK, // 95  — ModernEra trunk (most common)
  GID_TRUNK_B, // 176 — ModernEra variant
  GID_TRUNK_C, // 177
  GID_PLAINS_TRUNK_00, // 224
  GID_PLAINS_TRUNK_01, // 225
  GID_PLAINS_TRUNK_16, // 240
  GID_PLAINS_TRUNK_32, // 256
];

/**
 * Behind layer: every T_CLIFF cell → a seeded-random trunk variant. Any non-zero
 * GID on the behind layer collides (the scene uses `non-empty` collision mode), so
 * the variety here is purely visual — collision is unchanged.
 */
function buildBehindLayer(screen, terrainGrid) {
  const [w, h] = screen.size;
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(0);
  const rng = makeRng(hashSeed(screen.id + '_behind'));
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (terrainGrid[at(tx, ty)] !== T_CLIFF) continue;
      const variant = TRUNK_VARIANTS[Math.floor(rng() * TRUNK_VARIANTS.length)];
      data[at(tx, ty)] = variant;
    }
  }
  return data;
}

/** Interior-canopy variants for the in-front layer (no collision). */
const CANOPY_VARIANTS = [
  GID_PLAINS_CANOPY_A, // 423
  GID_PLAINS_CANOPY_B, // 424
  GID_PLAINS_CANOPY_C, // 422
  GID_PLAINS_CANOPY_D, // 439
  GID_VILLAGE_CANOPY, // 624
];

/** Weighted pick: GID_PLAINS_CANOPY_A 40%, the other four 15% each. */
function pickCanopy(rng) {
  const roll = Math.floor(rng() * 100);
  if (roll < 40) return CANOPY_VARIANTS[0];
  if (roll < 55) return CANOPY_VARIANTS[1];
  if (roll < 70) return CANOPY_VARIANTS[2];
  if (roll < 85) return CANOPY_VARIANTS[3];
  return CANOPY_VARIANTS[4];
}

/**
 * In-front layer (no collision; player walks under). Two roles:
 *   - perimeter void frame: edge T_CLIFF cells (not exit gaps) → GID_VOID, a solid
 *     border. Exit gaps are T_GRASS at the perimeter → left empty (walkable).
 *   - interior canopy: non-edge T_CLIFF cells → a seeded weighted canopy variant.
 */
function buildInFrontLayer(screen, terrainGrid) {
  const [w, h] = screen.size;
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(0);
  const rng = makeRng(hashSeed(screen.id + '_infr'));
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const onEdge = tx === 0 || ty === 0 || tx === w - 1 || ty === h - 1;
      const t = terrainGrid[at(tx, ty)];
      if (onEdge) {
        // Void frame on perimeter cliff cells; exit gaps (carved to T_GRASS) stay open.
        if (t === T_CLIFF) data[at(tx, ty)] = GID_VOID;
      } else if (t === T_CLIFF) {
        data[at(tx, ty)] = pickCanopy(rng);
      }
    }
  }
  return data;
}

/** Build the `objects` layer for one screen. Pixel coords auto-scale via TILE=16. */
function buildObjects(screen, terrainGrid) {
  const [w, h] = screen.size;
  const mapW = w * TILE;
  const mapH = h * TILE;
  const cx = ((w / 2) | 0) * TILE + TILE / 2;
  const cy = ((h / 2) | 0) * TILE + TILE / 2;
  const objects = [];
  let nextId = 1;

  // Spawn point: at one of the exit edge midpoints (prefer south, else first exit).
  const exitDirs = Object.keys(screen.exits);
  const spawnDir = exitDirs.includes('south') ? 'south' : exitDirs[0];
  if (spawnDir) {
    const m = edgeMidpoint(spawnDir, w, h);
    objects.push({
      id: nextId++,
      name: 'spawn',
      x: m.tx * TILE + TILE / 2,
      y: m.ty * TILE + TILE / 2,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
    });
  } else {
    objects.push({
      id: nextId++,
      name: 'spawn',
      x: cx,
      y: cy,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
    });
  }

  // Anchorage object at the clearing centre (+ sanctum_return on the hub).
  if (screen.anchorage) {
    objects.push({
      id: nextId++,
      name: 'anchorage',
      x: cx - TILE / 2,
      y: cy - TILE / 2,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: screen.anchorage }],
    });
    if (screen.id === 'forest_anchorage') {
      objects.push({
        id: nextId++,
        name: 'sanctum_return',
        x: cx - TILE,
        y: cy - TILE,
        width: TILE * 2,
        height: TILE * 2,
        rotation: 0,
        visible: true,
        point: false,
      });
    }
  }

  // Discovery waystone at (mapW*0.6, mapH*0.4).
  if (screen.waystone) {
    objects.push({
      id: nextId++,
      name: 'waystone',
      x: mapW * 0.6 - TILE / 2,
      y: mapH * 0.4 - TILE / 2,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: screen.waystone }],
    });
  }

  // Biome-exit at its edge midpoint. Carries `target` and, when gated, `gate`.
  if (screen.biomeExit) {
    const m = edgeMidpoint(screen.biomeExit.dir, w, h);
    const props = [{ name: 'target', type: 'string', value: screen.biomeExit.target }];
    if (screen.biomeExit.gate) {
      props.push({ name: 'gate', type: 'string', value: screen.biomeExit.gate });
    }
    objects.push({
      id: nextId++,
      name: 'biome_exit',
      x: m.tx * TILE,
      y: m.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: props,
    });
  }

  // Forage nodes (skipped on safe screens — the hub has none of its own). Placed
  // by seeded rejection sampling on walkable interior floor, clear of the centre
  // clearing and the exit corridors.
  if (!screen.safe) {
    const at = (tx, ty) => ty * w + tx;
    const cx = (w / 2) | 0;
    const cy = (h / 2) | 0;
    const exitDirsAll = Object.keys(screen.exits ?? {});
    const exitMids = exitDirsAll.map((dir) => edgeMidpoint(dir, w, h));
    const nodeCount = (screen.danger ?? 0) >= 3 ? 1 : 2;
    const labels = ['bush_1', 'tree_2'];
    const rng = makeRng(hashSeed(screen.id + '_forage'));

    const isValid = (tx, ty) => {
      // Interior only (never the perimeter frame).
      if (!(tx > 0 && tx < w - 1 && ty > 0 && ty < h - 1)) return false;
      const t = terrainGrid[at(tx, ty)];
      if (t === T_CLIFF || t === T_WATER) return false;
      // Keep clear of the centre anchorage/path clearing.
      if (Math.abs(tx - cx) <= 3 && Math.abs(ty - cy) <= 3) return false;
      // Keep clear of each exit corridor midpoint.
      for (const m of exitMids) {
        if (Math.abs(tx - m.tx) <= 2 && Math.abs(ty - m.ty) <= 2) return false;
      }
      return true;
    };

    for (let n = 0; n < nodeCount; n++) {
      for (let attempt = 0; attempt < 20; attempt++) {
        const tx = 1 + Math.floor(rng() * (w - 2));
        const ty = 1 + Math.floor(rng() * (h - 2));
        if (!isValid(tx, ty)) continue;
        const nodeId = `${screen.id}:${labels[n]}`;
        objects.push({
          id: nextId++,
          name: 'forage_node',
          type: 'forage_node',
          x: tx * TILE + 8,
          y: ty * TILE + 8,
          width: 8,
          height: 8,
          point: true,
          rotation: 0,
          visible: true,
          properties: [{ name: 'node_id', type: 'string', value: nodeId }],
        });
        break;
      }
    }
  }

  return objects;
}

/**
 * Emit the 6 curated generated tilesets. No `tiles` collision-property arrays are
 * emitted: cliff collision now comes from the `non-empty` behind layer (trunks),
 * and water-pond collision comes from `collides:true` on the autotile_water_16
 * tiles, which the scene's default 'property' ground mode reads. Water is the only
 * tileset that carries collision properties.
 */
function buildTilesetDescriptors() {
  const collideTiles = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      properties: [{ name: 'collides', type: 'bool', value: true }],
    }));

  return GENERATED_TILESETS.map((ts) => {
    const base = {
      firstgid: ts.firstgid,
      name: ts.name,
      image: ts.image,
      imagewidth: ts.imagewidth,
      imageheight: ts.imageheight,
      tilewidth: 16,
      tileheight: 16,
      tilecount: ts.tilecount,
      columns: ts.columns,
      margin: 0,
      spacing: 0,
    };
    if (ts.name === 'autotile_water_16') {
      return { ...base, tiles: collideTiles(ts.tilecount) };
    }
    return base;
  });
}

function buildMap(screen) {
  const [w, h] = screen.size;
  const terrainGrid = buildTerrainGrid(screen);
  return {
    compressionlevel: -1,
    width: w,
    height: h,
    tilewidth: TILE,
    tileheight: TILE,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    nextlayerid: 5,
    nextobjectid: 99,
    tilesets: buildTilesetDescriptors(),
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: buildGroundLayer(screen, terrainGrid) },
      { id: 2, name: 'behind', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: buildBehindLayer(screen, terrainGrid) },
      { id: 3, name: 'in-front', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: buildInFrontLayer(screen, terrainGrid) },
      { id: 4, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects: buildObjects(screen, terrainGrid) },
    ],
  };
}

// Screens the developer authors by hand in Tiled — the generator must NEVER
// overwrite them (the hub forest_anchorage is skipped separately below).
const HAND_AUTHORED_SCREENS = new Set([
  'forest_boss_clearing', 'forest_briar_pass', 'forest_crossroads',
  'forest_deepwood', 'forest_east_path', 'forest_glade',
  'forest_hidden_alcove', 'forest_hollow', 'forest_mossy_fen',
  'forest_north_road', 'forest_ridge', 'forest_snow_gate',
  'forest_south_path', 'forest_swamp_gate',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'assets', 'maps', 'forest');
mkdirSync(outDir, { recursive: true });
let count = 0;
for (const screen of FOREST_SCREENS) {
  if (screen.id === 'forest_anchorage') continue; // hand-authored hub; do NOT overwrite
  if (HAND_AUTHORED_SCREENS.has(screen.id)) {
    console.log(`skipping hand-authored: ${screen.id}`);
    continue;
  }
  const map = buildMap(screen);
  const outPath = resolve(outDir, `${screen.id}.json`);
  writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
  count++;
}
console.log(`Wrote ${count} Forest region screen maps → ${outDir}`);
