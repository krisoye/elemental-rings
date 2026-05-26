// Deterministic generator for the Phase 8B Forest biome overworld map.
//
// Writes client/public/assets/maps/overworld.json (Tiled 1.10 JSON format),
// mirroring the placeholder-asset generator pattern (gen-placeholder-tiles.mjs):
// pure, reproducible output so re-running produces no spurious diff. Reuses the
// shared placeholder tileset (floor=2 GID, wall=3 GID, accent=4 GID) — the same
// tileset embedded in the 8A map and produced by gen-placeholder-tiles.mjs.
//
// Layout (40×30 tiles, 1280×960 px):
//   - Floor everywhere, ringed by a 1-tile perimeter wall.
//   - A few scattered obstacle clusters so the biome reads as a place, not a box.
//   - An accent tile beneath each waystone marker.
//   - An `objects` layer that PRESERVES 8A's `spawn` point (128,128) and
//     `sanctum_return` rectangle (center 224,224) so overworld-transition.spec.ts
//     stays green, and ADDS three waystone objects (name `waystone`, custom
//     property `waystoneId`) spread across the map.
//
// Waystone ids MUST match shared/waystones.ts (a Vitest drift test enforces the
// id-set parity). Positions are owned here, not in the catalog.
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

// Waystone placements. `id` matches shared/waystones.ts; tile coords are chosen
// to spread the stones across the map, clear of spawn (tile 4,4) and
// sanctum_return (tiles 6-7, 6-7). forest_glade sits within 8B.2's
// COMPASS_RANGE=400px of spawn (~6 tiles away); forest_depths is intentionally
// far (deep south-east) so the compass test for it reads as out-of-range.
const WAYSTONES = [
  { id: 'forest_entry', tx: 10, ty: 6 },
  { id: 'forest_glade', tx: 9, ty: 10 },
  { id: 'forest_depths', tx: 33, ty: 24 },
];

// Scattered obstacle clusters (top-left tile coords + size) so the biome has
// internal structure. Kept clear of spawn, sanctum_return, and the waystones.
const CLUSTERS = [
  { tx: 16, ty: 4, w: 3, h: 2 },
  { tx: 24, ty: 8, w: 2, h: 4 },
  { tx: 6, ty: 18, w: 4, h: 2 },
  { tx: 20, ty: 20, w: 3, h: 3 },
  { tx: 30, ty: 14, w: 2, h: 2 },
  { tx: 14, ty: 24, w: 3, h: 2 },
];

/** Build the flat ground-layer GID array (row-major, top-down). */
function buildGround() {
  const data = new Array(WIDTH * HEIGHT).fill(GID_FLOOR);
  const at = (tx, ty) => ty * WIDTH + tx;

  // Perimeter walls.
  for (let x = 0; x < WIDTH; x++) {
    data[at(x, 0)] = GID_WALL;
    data[at(x, HEIGHT - 1)] = GID_WALL;
  }
  for (let y = 0; y < HEIGHT; y++) {
    data[at(0, y)] = GID_WALL;
    data[at(WIDTH - 1, y)] = GID_WALL;
  }

  // Obstacle clusters.
  for (const c of CLUSTERS) {
    for (let dy = 0; dy < c.h; dy++) {
      for (let dx = 0; dx < c.w; dx++) {
        data[at(c.tx + dx, c.ty + dy)] = GID_WALL;
      }
    }
  }

  // Accent tile beneath each waystone (walkable highlight under the marker).
  for (const w of WAYSTONES) {
    data[at(w.tx, w.ty)] = GID_ACCENT;
  }

  return data;
}

/** Build the `objects` layer: spawn + sanctum_return (8A) + 3 waystones (8B). */
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

  // Waystone objects: a small point-ish rectangle centred on the accent tile, so
  // the InteractionZone overlap box sits where the stone is drawn.
  let nextId = 3;
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
  nextobjectid: 3 + WAYSTONES.length,
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
