// Deterministic generator for the Phase 8C Swamp biome map (#82).
//
// Writes client/public/assets/maps/swamp.json (Tiled 1.10 JSON format), mirroring
// gen-overworld-map.mjs: pure, reproducible output so re-running produces no
// spurious diff. Uses the dedicated swamp tileset (mud=2 GID, reed/water=3 GID,
// dirt=4 GID) produced by gen-swamp-tiles.mjs (client/public/assets/tiles/swamp.png).
//
// Layout (35×28 tiles, 1120×896 px) — boggy Swamp terrain:
//   - Mud floor everywhere, ringed by a 1-tile perimeter wall (reed/water).
//   - Reed/water clumps (circle-fill) scattered for organic structure, cleared
//     around key objects so they never block waystones / the biome exit.
//   - Mud clearings carved around each Anchorage.
//   - Dirt paths connecting the biome exit → entry → depths → secret rune, and
//     the two Anchorages.
//   - An accent (dirt) tile beneath each Anchorage + discovery Waystone marker.
//   - An `objects` layer with 2 Anchorages (name `anchorage`, `waystoneId`), 3
//     discovery Waystones (name `waystone`, `waystoneId`), and a `biome_exit`
//     rectangle at the NW edge that transitions back to the Forest (ForestScene).
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

const TILE = 32;
const WIDTH = 35; // tiles
const HEIGHT = 28; // tiles

// Tiled GIDs into the swamp tileset (firstgid = 1):
//   GID 2 = mud floor, GID 3 = reed/water (collides: true), GID 4 = dirt path.
const GID_FLOOR = 2;
const GID_WALL = 3;
const GID_ACCENT = 4;

// Anchorage placements (home base / teleport destinations: campfire + ground
// ring). `id` matches shared/waystones.ts.
const ANCHORAGES = [
  { id: 'swamp_anchor_1', tx: 8, ty: 6 },
  { id: 'swamp_anchor_2', tx: 26, ty: 20 },
];

// Pure Waystone placements (discoverable standing-stone markers). `swamp_entry`
// is where the player arrives near the Forest exit; `swamp_secret_forest`
// (Ironbark Rune) reveals the hidden Forest alcove (forest_hidden_anchor).
const WAYSTONES = [
  { id: 'swamp_entry', tx: 12, ty: 8 },
  { id: 'swamp_depths', tx: 22, ty: 18 },
  { id: 'swamp_secret_forest', tx: 28, ty: 24 },
];

// Biome-exit zone back to the Forest. Placed near the NW edge on a navigable
// (cleared) mud tile so the player can physically reach it.
const BIOME_EXIT = { tx: 2, ty: 14, target: 'ForestScene' };

// Reed/water clumps (circle centre + radius in tiles) for organic structure.
// Auto-cleared near key objects via isClearZone().
const CLUMPS = [
  { cx: 5, cy: 10, r: 2 },
  { cx: 18, cy: 6, r: 3 },
  { cx: 30, cy: 9, r: 2 },
  { cx: 15, cy: 22, r: 3 },
  { cx: 24, cy: 13, r: 2 },
  { cx: 10, cy: 18, r: 2 },
  { cx: 31, cy: 17, r: 2 },
];

// Key-object tile positions to keep clear of reeds (within CLEAR_R tiles).
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

  // 3. Reed/water clumps (circle-fill), skipping clear zones around key objects.
  for (const c of CLUMPS) {
    for (let dy = -c.r; dy <= c.r; dy++) {
      for (let dx = -c.r; dx <= c.r; dx++) {
        if (dx * dx + dy * dy > c.r * c.r) continue;
        const tx = c.cx + dx,
          ty = c.cy + dy;
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

  // 5. Biome-exit clearing — 2-tile-radius floor circle so the exit is reachable.
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dy * dy > 4) continue;
      const tx = BIOME_EXIT.tx + dx,
        ty = BIOME_EXIT.ty + dy;
      if (tx <= 0 || ty <= 0 || tx >= WIDTH - 1 || ty >= HEIGHT - 1) continue;
      data[at(tx, ty)] = GID_FLOOR;
    }
  }

  // 6. Dirt paths connecting the exit + key objects.
  bresenhamPath(data, 2, 14, 12, 8); // biome exit → swamp_entry
  bresenhamPath(data, 12, 8, 8, 6); // swamp_entry → swamp_anchor_1
  bresenhamPath(data, 12, 8, 22, 18); // swamp_entry → swamp_depths
  bresenhamPath(data, 22, 18, 26, 20); // swamp_depths → swamp_anchor_2
  bresenhamPath(data, 22, 18, 28, 24); // swamp_depths → swamp_secret_forest

  // 7. Accent tile beneath each Anchorage (walkable highlight under the marker).
  for (const a of ANCHORAGES) {
    data[at(a.tx, a.ty)] = GID_ACCENT;
  }

  // 8. Accent tile beneath each pure Waystone (standing-stone marker).
  for (const w of WAYSTONES) {
    data[at(w.tx, w.ty)] = GID_ACCENT;
  }

  return data;
}

/**
 * Build the `objects` layer: 2 Anchorages (campfire + ground ring destinations,
 * name `anchorage`, with `waystoneId`), 3 discovery Waystones (standing-stone
 * markers, name `waystone`, each with a `waystoneId`), and a `biome_exit`
 * rectangle (target=OverworldScene) at the NW edge.
 */
function buildObjects() {
  const objects = [];
  let nextId = 1;

  // Anchorage objects: a small rectangle centred on the accent tile, so the
  // InteractionZone overlap box sits where the campfire is drawn.
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

  // Pure Waystone objects: discoverable standing-stone markers.
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

  // Biome-exit rectangle back to the Forest. Carries a `target` scene-key
  // property so the scene's biome_exit handler knows where to transition.
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
    properties: [{ name: 'target', type: 'string', value: BIOME_EXIT.target }],
  });

  return objects;
}

const objectsLayer = buildObjects();

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
  nextobjectid: objectsLayer.length + 1,
  tilesets: [
    {
      firstgid: 1,
      name: 'swamp',
      image: '../tiles/swamp.png',
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
      objects: objectsLayer,
    },
  ],
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'maps', 'swamp.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
console.log(`Wrote ${WIDTH}x${HEIGHT} Swamp map → ${outPath}`);
