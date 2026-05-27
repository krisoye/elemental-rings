// Deterministic generator for the Phase 8B Forest biome overworld map.
//
// Writes client/public/assets/maps/overworld.json (Tiled 1.10 JSON format),
// mirroring the placeholder-asset generator pattern (gen-placeholder-tiles.mjs):
// pure, reproducible output so re-running produces no spurious diff. Reuses the
// shared placeholder tileset (grass=2 GID, tree=3 GID, dirt=4 GID) — the same
// tileset embedded in the 8A map and produced by gen-placeholder-tiles.mjs.
//
// Layout (40×30 tiles, 1280×960 px) — organic Forest terrain:
//   - Grass floor everywhere, ringed by a 1-tile perimeter wall (tree).
//   - Tree groves (circle-fill) scattered across the map for internal structure,
//     auto-cleared around key objects so they never block spawn/waystones.
//   - Grass clearings carved around each Anchorage and the Sanctum.
//   - Dirt paths connecting spawn → forest_entry → forest_glade → forest_depths.
//   - An accent (dirt) tile beneath each Anchorage + pure Waystone marker.
//   - An `objects` layer that PRESERVES 8A's `spawn` point (128,128) and
//     `sanctum_return` rectangle (center 224,224) so overworld-transition.spec.ts
//     stays green, and ADDS three Anchorage objects (name `anchorage`, custom
//     property `waystoneId`) plus two discovery Waystone markers (name `waystone`,
//     each with a `waystoneId`) spread across the map.
//
// Both Anchorage AND Waystone ids MUST match shared/waystones.ts (a Vitest drift
// test enforces the id-set parity across all 5 ids). Positions are owned here,
// not in the catalog.
//
// Run from the client/ directory:  node scripts/gen-overworld-map.mjs
// (or `npm run gen:maps`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 32;
const WIDTH = 40; // tiles
const HEIGHT = 30; // tiles

// Tiled GIDs into the shared placeholder tileset (firstgid = 1):
//   GID 2 = floor, GID 3 = wall (collides: true), GID 4 = accent-floor.
const GID_FLOOR = 2;
const GID_WALL = 3;
const GID_ACCENT = 4;

// Anchorage placements (home base / teleport destinations: campfire + ground
// ring, NO standing stone). `id` matches shared/waystones.ts; tile coords are
// chosen to spread them across the map, clear of spawn (tile 4,4) and
// sanctum_return (tiles 6-7, 6-7). forest_glade sits within 8B.2's
// COMPASS_RANGE=400px of spawn (~6 tiles away); forest_depths is intentionally
// far (deep south-east) so the compass test for it reads as out-of-range.
const ANCHORAGES = [
  { id: 'forest_entry', tx: 10, ty: 6 },
  { id: 'forest_glade', tx: 9, ty: 10 },
  { id: 'forest_depths', tx: 33, ty: 24 },
];

// Pure Waystone placements (discoverable standing-stone markers scattered in
// the world, NO campfire). These are real discovery waystones that reveal
// adjacent biomes (Snow Fields, Swamps) when attuned — each carries a
// `waystoneId` linking it to the server catalog (shared/waystones.ts). Positions
// are pre-verified clear of the GROVES circles (see the grove-clearance check in
// the dev brief). The drift test enforces id-set parity with the catalog.
const WAYSTONES = [
  { id: 'forest_north_stone', tx: 20, ty: 8 },
  { id: 'forest_sw_stone', tx: 5, ty: 24 },
];

// Tree groves (circle centre + radius in tiles) so the biome has organic
// internal structure rather than rectangular boxes. Pre-verified clear of the
// #71 spawn-on-enter positions; auto-cleared near key objects via isClearZone().
const GROVES = [
  { cx: 17, cy: 5, r: 3 },
  { cx: 25, cy: 9, r: 2 },
  { cx: 7, cy: 19, r: 3 },
  { cx: 22, cy: 21, r: 3 },
  { cx: 31, cy: 15, r: 2 },
  { cx: 15, cy: 25, r: 2 },
  { cx: 28, cy: 4, r: 2 },
];

// Key-object tile positions to keep clear of trees (within CLEAR_R tiles).
const CLEAR_R = 4;
const KEY_TILES = [
  { tx: 4, ty: 4 }, // spawn (128/32=4, 128/32=4)
  { tx: 6, ty: 6 }, // sanctum_return center (192/32=6, 192/32=6)
  { tx: 10, ty: 6 }, // forest_entry (Anchorage)
  { tx: 9, ty: 10 }, // forest_glade (Anchorage)
  { tx: 33, ty: 24 }, // forest_depths (Anchorage)
];

function isClearZone(tx, ty) {
  for (const k of KEY_TILES) {
    const d2 = (tx - k.tx) ** 2 + (ty - k.ty) ** 2;
    if (d2 <= CLEAR_R * CLEAR_R) return true;
  }
  return false;
}

/**
 * Draw a Bresenham line from (x0,y0) to (x1,y1), painting GID_ACCENT (dirt) with
 * a 1-tile cross brush (centre + 4 cardinals) so the path reads ~3 tiles wide.
 */
function bresenhamPath(data, x0, y0, x1, y1) {
  const at = (tx, ty) => ty * WIDTH + tx;
  const dx = Math.abs(x1 - x0),
    dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0,
    y = y0;
  while (true) {
    for (const [ox, oy] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const px = x + ox,
        py = y + oy;
      if (px > 0 && py > 0 && px < WIDTH - 1 && py < HEIGHT - 1) {
        data[at(px, py)] = GID_ACCENT;
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

/** Build the flat ground-layer GID array (row-major, top-down). */
function buildGround() {
  const data = new Array(WIDTH * HEIGHT).fill(GID_FLOOR);
  const at = (tx, ty) => ty * WIDTH + tx;

  // 1. Floor everywhere (above) — 2. Perimeter walls.
  for (let x = 0; x < WIDTH; x++) {
    data[at(x, 0)] = GID_WALL;
    data[at(x, HEIGHT - 1)] = GID_WALL;
  }
  for (let y = 0; y < HEIGHT; y++) {
    data[at(0, y)] = GID_WALL;
    data[at(WIDTH - 1, y)] = GID_WALL;
  }

  // 3. Tree groves (circle-fill), skipping clear zones around key objects.
  for (const g of GROVES) {
    for (let dy = -g.r; dy <= g.r; dy++) {
      for (let dx = -g.r; dx <= g.r; dx++) {
        if (dx * dx + dy * dy > g.r * g.r) continue;
        const tx = g.cx + dx,
          ty = g.cy + dy;
        if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
        if (isClearZone(tx, ty)) continue;
        data[at(tx, ty)] = GID_WALL;
      }
    }
  }

  // 4. Anchorage clearings — 3-tile-radius floor circle around each Anchorage.
  for (const a of ANCHORAGES) {
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        if (dx * dx + dy * dy > 9) continue;
        const tx = a.tx + dx,
          ty = a.ty + dy;
        if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
        data[at(tx, ty)] = GID_FLOOR;
      }
    }
  }

  // 5. Sanctum clearing — 4-tile-radius floor circle near spawn/sanctum_return.
  const SC_TX = 6,
    SC_TY = 6,
    SC_R = 4;
  for (let dy = -SC_R; dy <= SC_R; dy++) {
    for (let dx = -SC_R; dx <= SC_R; dx++) {
      if (dx * dx + dy * dy > SC_R * SC_R) continue;
      const tx = SC_TX + dx,
        ty = SC_TY + dy;
      if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
      data[at(tx, ty)] = GID_FLOOR;
    }
  }

  // 6. Dirt paths connecting key objects.
  bresenhamPath(data, 4, 4, 10, 6);
  bresenhamPath(data, 10, 6, 9, 10);
  bresenhamPath(data, 9, 10, 33, 24);

  // 7. Accent tile beneath each Anchorage (walkable highlight under the marker).
  for (const a of ANCHORAGES) {
    data[at(a.tx, a.ty)] = GID_ACCENT;
  }

  // 8. Accent tile beneath each pure Waystone (standing-stone marker). Separate
  // loop since Waystones are a distinct concept from Anchorages.
  for (const w of WAYSTONES) {
    data[at(w.tx, w.ty)] = GID_ACCENT;
  }

  return data;
}

/**
 * Build the `objects` layer: spawn + sanctum_return (8A), 3 Anchorages (campfire
 * + ground ring destinations, name `anchorage`, with `waystoneId`), and 2
 * discovery Waystones (standing-stone markers, name `waystone`, each with a
 * `waystoneId`).
 */
function buildObjects() {
  const objects = [
    {
      id: 1,
      name: 'spawn',
      x: 128,
      y: 128,
      width: 0,
      height: 0,
      point: true,
      rotation: 0,
      visible: true,
    },
    {
      id: 2,
      name: 'sanctum_return',
      x: 192,
      y: 192,
      width: 64,
      height: 64,
      rotation: 0,
      visible: true,
      point: false,
    },
  ];

  // Anchorage objects: a small rectangle centred on the accent tile, so the
  // InteractionZone overlap box sits where the campfire is drawn. Carries the
  // `waystoneId` property linking it to the server attunement record.
  let nextId = 3;
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

  // Pure Waystone objects: discoverable standing-stone markers. Each carries a
  // `waystoneId` property linking it to the server catalog, so the scene renders
  // the stone AND registers an attune zone (revealing adjacent biomes on attune).
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

  return objects;
}

const map = {
  compressionlevel: -1,
  width: WIDTH,
  height: HEIGHT,
  tilewidth: TILE,
  tileheight: TILE,
  infinite: false,
  orientation: 'orthogonal',
  renderorder: 'right-down',
  type: 'map',
  version: '1.10',
  tiledversion: '1.10.2',
  nextlayerid: 3,
  nextobjectid: 3 + ANCHORAGES.length + WAYSTONES.length,
  tilesets: [
    {
      firstgid: 1,
      name: 'placeholder',
      image: '../tiles/placeholder.png',
      imagewidth: 128,
      imageheight: 32,
      tilewidth: 32,
      tileheight: 32,
      tilecount: 4,
      columns: 4,
      margin: 0,
      spacing: 0,
      tiles: [{ id: 2, properties: [{ name: 'collides', type: 'bool', value: true }] }],
    },
  ],
  layers: [
    {
      id: 1,
      name: 'ground',
      type: 'tilelayer',
      x: 0,
      y: 0,
      width: WIDTH,
      height: HEIGHT,
      opacity: 1,
      visible: true,
      data: buildGround(),
    },
    {
      id: 2,
      name: 'objects',
      type: 'objectgroup',
      x: 0,
      y: 0,
      opacity: 1,
      visible: true,
      draworder: 'topdown',
      objects: buildObjects(),
    },
  ],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'maps', 'overworld.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
console.log(`Wrote ${WIDTH}x${HEIGHT} Forest overworld map → ${outPath}`);
