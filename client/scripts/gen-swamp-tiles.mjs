// Reproducible placeholder tilesheet generator for the Phase 8C Swamp biome.
//
// Mirrors gen-placeholder-tiles.mjs (study that file first for the exact pngjs
// pattern). Produces a 4-tile horizontal strip of 32x32 tiles →
// client/public/assets/tiles/swamp.png
// Tile indices (0-based column → Tiled GID = index + firstgid):
//   0  void          (transparent — never placed in the ground layer)
//   1  mud floor      (walkable olive #4a5a2a, subtle noise dots)
//   2  reed / water   (collidable dark-teal #1a3a3a obstacle; `collides: true`)
//   3  dirt path      (walkable #8a6a3a accent — connecting paths)
//
// Run from the client/ directory:  node scripts/gen-swamp-tiles.mjs
// (or `npm run gen:swamp-tiles`).
// Output is byte-stable across runs (deterministic decoration, no RNG), so
// regeneration produces no spurious diff.

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 32;
const TILE_COUNT = 4;

// RGBA palettes per tile index. Void is fully transparent.
const PALETTE = [
  { r: 0, g: 0, b: 0, a: 0 }, // 0 void
  { r: 74, g: 90, b: 42, a: 255 }, // 1 mud floor — olive #4a5a2a
  { r: 26, g: 58, b: 58, a: 255 }, // 2 reed/water — dark teal #1a3a3a
  { r: 138, g: 106, b: 58, a: 255 }, // 3 dirt path — #8a6a3a
];

// Edge/inset colors give each tile a subtle 1px border so the grid reads clearly.
const BORDER = [
  null, // void: no border
  { r: 58, g: 74, b: 34, a: 255 }, // mud border (darker olive)
  { r: 14, g: 38, b: 38, a: 255 }, // reed border (darkest teal — reads as deep water)
  { r: 122, g: 90, b: 42, a: 255 }, // dirt border
];

// Decoration colors.
const MUD_NOISE = { r: 96, g: 110, b: 58, a: 255 }; // lighter mud speckle
const REED_BLADE = { r: 58, g: 122, b: 90, a: 255 }; // reed stalk (lighter green)
const WATER_GLINT = { r: 90, g: 138, b: 138, a: 255 }; // shimmer on the water

// Deterministic mud noise-dot offsets (within-tile, avoiding the 1px border).
// Hand-coded so output is byte-stable across runs without an RNG.
const MUD_DOTS = [
  [7, 9],
  [12, 22],
  [18, 6],
  [23, 17],
  [10, 27],
  [27, 25],
  [15, 13],
  [21, 29],
];

// Deterministic reed-blade column x positions (drawn from base up to ~half-tile).
const REED_BLADES = [
  { x: 9, top: 8 },
  { x: 16, top: 5 },
  { x: 23, top: 10 },
];

const png = new PNG({ width: TILE * TILE_COUNT, height: TILE, filterType: -1 });

const setPixel = (px, y, c) => {
  if (px < 0 || y < 0 || px >= png.width || y >= png.height) return;
  const idx = (png.width * y + px) << 2;
  png.data[idx] = c.r;
  png.data[idx + 1] = c.g;
  png.data[idx + 2] = c.b;
  png.data[idx + 3] = c.a;
};

for (let t = 0; t < TILE_COUNT; t++) {
  const fill = PALETTE[t];
  const border = BORDER[t];

  // Base fill + 1px border.
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = t * TILE + x;
      const onEdge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      setPixel(px, y, onEdge && border ? border : fill);
    }
  }

  // Tile 1 (mud floor): scatter a few lighter noise dots inside the border.
  if (t === 1) {
    for (const [x, y] of MUD_DOTS) {
      setPixel(t * TILE + x, y, MUD_NOISE);
    }
  }

  // Tile 2 (reed/water obstacle): a few vertical reed blades over the dark water,
  // with a couple of glint pixels suggesting standing water.
  if (t === 2) {
    for (const blade of REED_BLADES) {
      for (let y = blade.top; y < TILE - 2; y++) {
        setPixel(t * TILE + blade.x, y, REED_BLADE);
      }
    }
    setPixel(t * TILE + 6, 24, WATER_GLINT);
    setPixel(t * TILE + 26, 22, WATER_GLINT);
    setPixel(t * TILE + 13, 27, WATER_GLINT);
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'swamp.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(png));
console.log(`Wrote ${png.width}x${png.height} swamp tilesheet → ${outPath}`);
