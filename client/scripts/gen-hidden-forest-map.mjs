// Deterministic generator for the Phase 8C hidden Forest alcove map (#82).
//
// Writes client/public/assets/maps/forest_hidden.json (Tiled 1.10 JSON format),
// mirroring gen-overworld-map.mjs. Reuses the EXISTING forest placeholder tileset
// (placeholder.png — grass=2 GID, tree=3 GID, dirt=4 GID), the same one the
// overworld uses, since this is a Forest-themed alcove. Pure, reproducible output.
//
// Layout (15×12 tiles, 480×384 px) — a tiny secret Forest clearing reachable
// ONLY by teleporting to `forest_hidden_anchor` (revealed by attuning the Swamp's
// Ironbark Rune). There is intentionally NO walking path from the Forest side —
// the alcove closes the Swamp discovery loop (GDD §10 EPIC 8C).
//   - Grass floor, ringed by a 1-tile perimeter wall (tree).
//   - One Anchorage (`forest_hidden_anchor`, name `anchorage`, `waystoneId`).
//   - One discovery Waystone (`forest_hidden_glade`, name `waystone`, `waystoneId`).
//   - A `return_exit` rectangle (target=OverworldScene) that walks the player back
//     to the Forest (near forest_depths).
//
// Both ids MUST match shared/waystones.ts (the Vitest drift test enforces the
// combined id-set across all maps).
//
// Run from the client/ directory:  node scripts/gen-hidden-forest-map.mjs
// (or `npm run gen:hidden`).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 32;
const WIDTH = 15; // tiles
const HEIGHT = 12; // tiles

// Tiled GIDs into the shared placeholder tileset (firstgid = 1):
//   GID 2 = grass floor, GID 3 = tree wall (collides: true), GID 4 = dirt accent.
const GID_FLOOR = 2;
const GID_WALL = 3;
const GID_ACCENT = 4;

const ANCHORAGE = { id: 'forest_hidden_anchor', tx: 7, ty: 6 };
const WAYSTONE = { id: 'forest_hidden_glade', tx: 10, ty: 8 };
// The return exit sits near the SE so it is clear of the Anchorage spawn point.
const RETURN_EXIT = { tx: 12, ty: 9, target: 'OverworldScene' };

/** Build the flat ground-layer GID array (row-major, top-down). */
function buildGround() {
  const data = new Array(WIDTH * HEIGHT).fill(GID_FLOOR);
  const at = (tx, ty) => ty * WIDTH + tx;

  // Perimeter walls (trees).
  for (let x = 0; x < WIDTH; x++) {
    data[at(x, 0)] = GID_WALL;
    data[at(x, HEIGHT - 1)] = GID_WALL;
  }
  for (let y = 0; y < HEIGHT; y++) {
    data[at(0, y)] = GID_WALL;
    data[at(WIDTH - 1, y)] = GID_WALL;
  }

  // Dirt path linking the Anchorage, Waystone, and return exit.
  const path = (x0, y0, x1, y1) => {
    // Simple L-path (the alcove is small; a Bresenham brush is overkill here).
    const sx = x0 < x1 ? 1 : -1;
    for (let x = x0; x !== x1 + sx; x += sx) data[at(x, y0)] = GID_ACCENT;
    const sy = y0 < y1 ? 1 : -1;
    for (let y = y0; y !== y1 + sy; y += sy) data[at(x1, y)] = GID_ACCENT;
  };
  path(ANCHORAGE.tx, ANCHORAGE.ty, WAYSTONE.tx, WAYSTONE.ty);
  path(WAYSTONE.tx, WAYSTONE.ty, RETURN_EXIT.tx, RETURN_EXIT.ty);

  // Accent tiles beneath the Anchorage + Waystone markers.
  data[at(ANCHORAGE.tx, ANCHORAGE.ty)] = GID_ACCENT;
  data[at(WAYSTONE.tx, WAYSTONE.ty)] = GID_ACCENT;

  return data;
}

/**
 * Build the `objects` layer: the hidden Anchorage, the hidden glade Waystone, and
 * a `return_exit` rectangle (target=OverworldScene).
 */
function buildObjects() {
  return [
    {
      id: 1,
      name: 'anchorage',
      x: ANCHORAGE.tx * TILE,
      y: ANCHORAGE.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: ANCHORAGE.id }],
    },
    {
      id: 2,
      name: 'waystone',
      x: WAYSTONE.tx * TILE,
      y: WAYSTONE.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'waystoneId', type: 'string', value: WAYSTONE.id }],
    },
    {
      id: 3,
      name: 'return_exit',
      x: RETURN_EXIT.tx * TILE,
      y: RETURN_EXIT.ty * TILE,
      width: TILE,
      height: TILE,
      rotation: 0,
      visible: true,
      point: false,
      properties: [{ name: 'target', type: 'string', value: RETURN_EXIT.target }],
    },
  ];
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
      name: 'forest',
      image: '../tiles/forest.png',
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
const outPath = resolve(__dirname, '..', 'public', 'assets', 'maps', 'forest_hidden.json');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(map, null, 2) + '\n');
console.log(`Wrote ${WIDTH}x${HEIGHT} hidden Forest alcove map → ${outPath}`);
