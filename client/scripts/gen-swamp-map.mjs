// Deterministic generator for the Swamp biome map (#82), 16px/3-layer
// (EPIC #149 / #161).
//
// Writes client/public/assets/maps/swamp/swamp_entry.json (Tiled 1.10 JSON),
// mirroring the Forest generator's 16px/3-layer pipeline (gen-forest-screens.mjs):
// pure, reproducible output so re-running produces no spurious diff. Uses the same
// 6-tileset GID contract (forest-gid-map.mjs) and shared layer builders
// (lib/map-builders.mjs).
//
// Swamp terrain flavouring (a wet biome):
//   - Background fill: T_WATER (mud/water base) — most tiles.
//   - Paths (Bresenham, anchorage/waystone/exit links): T_DIRT (elevated walkways).
//   - Hard-coded reed/elevated clumps: T_CLIFF (rocky outcrops → trunks/canopy).
//   - Anchorage clearings: T_DIRT (raised firm ground).
//
// All Anchorage AND Waystone ids MUST match shared/waystones.ts (a Vitest drift
// test enforces the combined id-set parity across all maps). Positions are owned
// here, not in the catalog.
//
// Run from the client/ directory:  node scripts/gen-swamp-map.mjs
// (or `npm run gen:swamp`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TILE,
  T_DIRT,
  T_WATER,
  T_CLIFF,
  buildGroundLayer,
  buildBehindLayer,
  buildInFrontLayer,
  assembleMap,
} from './lib/map-builders.mjs';

const WIDTH = 35; // tiles (reconciled with SWAMP_SCREENS[0].size in #161)
const HEIGHT = 28; // tiles

// Anchorage placements (home base / teleport destinations). `id` matches
// shared/waystones.ts. Positions preserved from the legacy 32px generator.
const ANCHORAGES = [
  { id: 'swamp_anchor_1', tx: 8, ty: 6 },
  { id: 'swamp_anchor_2', tx: 26, ty: 20 },
];

// Pure Waystone placements (discoverable standing-stone markers).
const WAYSTONES = [
  { id: 'swamp_entry', tx: 12, ty: 8 },
  { id: 'swamp_depths', tx: 22, ty: 18 },
  { id: 'swamp_secret_forest', tx: 28, ty: 24 },
];

// Biome-exit zone back to the Forest, at the NORTH edge midpoint (dir: 'north').
const BIOME_EXIT = { tx: Math.floor(WIDTH / 2), ty: 1, target: 'ForestScene', targetScreen: 'forest_swamp_gate' };

// Reed/elevated clumps (circle centre + radius in tiles) → T_CLIFF rocky outcrops.
// Positions preserved exactly from the legacy generator.
const CLUMPS = [
  { cx: 5, cy: 10, r: 2 },
  { cx: 18, cy: 6, r: 3 },
  { cx: 30, cy: 9, r: 2 },
  { cx: 15, cy: 22, r: 3 },
  { cx: 24, cy: 13, r: 2 },
  { cx: 10, cy: 18, r: 2 },
  { cx: 31, cy: 17, r: 2 },
];

// Key-object tile positions to keep clear of clumps (within CLEAR_R tiles).
const CLEAR_R = 4;
const KEY_TILES = [
  ...ANCHORAGES.map((a) => ({ tx: a.tx, ty: a.ty })),
  ...WAYSTONES.map((w) => ({ tx: w.tx, ty: w.ty })),
  { tx: BIOME_EXIT.tx, ty: BIOME_EXIT.ty },
];

function isClearZone(tx, ty) {
  for (const k of KEY_TILES) {
    const d2 = (tx - k.tx) ** 2 + (ty - k.ty) ** 2;
    if (d2 <= CLEAR_R * CLEAR_R) return true;
  }
  return false;
}

/**
 * Bresenham line painting T_DIRT with a 1-tile cross brush. NEVER overwrites
 * T_CLIFF (rocky outcrops break walkways, not the other way around).
 */
function bresenhamDirt(grid, x0, y0, x1, y1) {
  const at = (tx, ty) => ty * WIDTH + tx;
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
      if (px > 0 && py > 0 && px < WIDTH - 1 && py < HEIGHT - 1) {
        if (grid[at(px, py)] !== T_CLIFF) grid[at(px, py)] = T_DIRT;
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

/** Pass 1: per-tile terrain grid. Swamp background = T_WATER. */
function buildTerrainGrid() {
  const at = (tx, ty) => ty * WIDTH + tx;
  const grid = new Uint8Array(WIDTH * HEIGHT).fill(T_WATER);

  // Perimeter → T_CLIFF (blocks edges).
  for (let x = 0; x < WIDTH; x++) {
    grid[at(x, 0)] = T_CLIFF;
    grid[at(x, HEIGHT - 1)] = T_CLIFF;
  }
  for (let y = 0; y < HEIGHT; y++) {
    grid[at(0, y)] = T_CLIFF;
    grid[at(WIDTH - 1, y)] = T_CLIFF;
  }

  // Reed/elevated clumps → T_CLIFF, skipping clear zones around key objects.
  for (const c of CLUMPS) {
    for (let dy = -c.r; dy <= c.r; dy++) {
      for (let dx = -c.r; dx <= c.r; dx++) {
        if (dx * dx + dy * dy > c.r * c.r) continue;
        const tx = c.cx + dx;
        const ty = c.cy + dy;
        if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
        if (isClearZone(tx, ty)) continue;
        grid[at(tx, ty)] = T_CLIFF;
      }
    }
  }

  // North biome-exit gap: open a 5-tile T_DIRT gap in the north perimeter.
  for (let dx = -2; dx <= 2; dx++) {
    const tx = BIOME_EXIT.tx + dx;
    if (tx <= 0 || tx >= WIDTH - 1) continue;
    grid[at(tx, 0)] = T_DIRT; // open the perimeter gap
    grid[at(tx, 1)] = T_DIRT;
  }

  // Dirt walkways linking exit + key objects (preserved from the legacy layout).
  bresenhamDirt(grid, BIOME_EXIT.tx, 1, 12, 8); // exit → swamp_entry
  bresenhamDirt(grid, 12, 8, 8, 6); // swamp_entry → swamp_anchor_1
  bresenhamDirt(grid, 12, 8, 22, 18); // swamp_entry → swamp_depths
  bresenhamDirt(grid, 22, 18, 26, 20); // swamp_depths → swamp_anchor_2
  bresenhamDirt(grid, 22, 18, 28, 24); // swamp_depths → swamp_secret_forest

  // Anchorage clearings: 5×5 T_DIRT (raised firm ground) around each anchorage.
  for (const a of ANCHORAGES) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const tx = a.tx + dx;
        const ty = a.ty + dy;
        if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
        grid[at(tx, ty)] = T_DIRT;
      }
    }
  }

  // Firm-ground tile beneath each pure waystone so the marker is walkable.
  for (const w of WAYSTONES) {
    grid[at(w.tx, w.ty)] = T_DIRT;
  }

  return grid;
}

/** Build the `objects` layer: anchorages, waystones, biome_exit. */
function buildObjects() {
  const objects = [];
  let nextId = 1;

  // Spawn point: just inside the north biome-exit gap.
  objects.push({
    id: nextId++,
    name: 'spawn',
    x: BIOME_EXIT.tx * TILE + TILE / 2,
    y: 2 * TILE + TILE / 2,
    width: 0,
    height: 0,
    point: true,
    rotation: 0,
    visible: true,
  });

  for (const a of ANCHORAGES) {
    objects.push({
      id: nextId++,
      name: 'anchorage',
      x: a.tx * TILE,
      y: a.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: a.id }],
    });
  }

  for (const w of WAYSTONES) {
    objects.push({
      id: nextId++,
      name: 'waystone',
      x: w.tx * TILE,
      y: w.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: w.id }],
    });
  }

  objects.push({
    id: nextId++,
    name: 'biome_exit',
    x: BIOME_EXIT.tx * TILE,
    y: BIOME_EXIT.ty * TILE,
    width: TILE,
    height: TILE,
    rotation: 0,
    visible: true,
    point: false,
    properties: [
      { name: 'target', type: 'string', value: BIOME_EXIT.target },
      { name: 'targetScreen', type: 'string', value: BIOME_EXIT.targetScreen },
      { name: 'spawnEdge', type: 'string', value: 'south' },
    ],
  });

  return objects;
}

function buildMap() {
  const grid = buildTerrainGrid();
  const ground = buildGroundLayer(WIDTH, HEIGHT, grid, T_WATER); // swamp bg = water
  const behind = buildBehindLayer(WIDTH, HEIGHT, grid);
  const inFront = buildInFrontLayer(WIDTH, HEIGHT, grid);
  return assembleMap(WIDTH, HEIGHT, ground, behind, inFront, buildObjects());
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '..', 'public', 'assets', 'maps', 'swamp');
mkdirSync(outDir, { recursive: true });
const outPath = resolve(outDir, 'swamp_entry.json');
writeFileSync(outPath, JSON.stringify(buildMap(), null, 2) + '\n');
console.log(`Wrote ${WIDTH}x${HEIGHT} Swamp map → ${outPath}`);
