// Reproducible placeholder tilesheet generator for the Phase 8B Forest biome.
//
// Produces a 4-tile horizontal strip of 32x32 tiles → client/public/assets/tiles/placeholder.png
// Tile indices (0-based column → Tiled GID = index + firstgid):
//   0  void   (transparent — never placed in the ground layer)
//   1  grass  (walkable mid-green floor with subtle noise dots)
//   2  tree   (collidable dark-green trunk + lighter crown circle; `collides: true`)
//   3  dirt   (worn-earth path / accent — walkable)
//
// Run from the client/ directory:  node scripts/gen-placeholder-tiles.mjs
// (or `npm run gen:tiles`).
// The committed PNG is byte-stable across runs (pngjs writes deterministic output
// for identical pixel data, and all per-tile decoration is hand-coded/deterministic),
// so regeneration produces no spurious diff.
//
// ── Kenney CC0 swap path ─────────────────────────────────────────────────────
// To replace these placeholders with real art (e.g. Kenney's "Tiny Town" or
// "RPG Urban" CC0 packs from https://kenney.nl/assets):
//   1. Drop the new tilesheet PNG at client/public/assets/tiles/placeholder.png
//      (or add it under a new name and update the `load.image('tiles', ...)` key).
//   2. Open client/public/assets/maps/*.json in Tiled, point the embedded tileset
//      at the new image, and re-index the tiles so grass/tree/dirt map to the
//      art you want. Keep the `collides: true` tile property on the tree tile.
//   3. Delete or keep this script — it only governs the placeholder art.

import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TILE = 32;
const TILE_COUNT = 4;

// RGBA palettes per tile index. Void is fully transparent.
const PALETTE = [
  { r: 0, g: 0, b: 0, a: 0 }, // 0 void
  { r: 74, g: 122, b: 58, a: 255 }, // 1 grass — mid-green floor
  { r: 26, g: 74, b: 26, a: 255 }, // 2 tree — dark-green trunk base
  { r: 138, g: 106, b: 58, a: 255 }, // 3 dirt — worn-earth path/accent
];

// Edge/inset colors give each tile a subtle 1px border so the grid reads clearly.
const BORDER = [
  null, // void: no border
  { r: 58, g: 106, b: 42, a: 255 }, // grass border
  { r: 10, g: 42, b: 10, a: 255 }, // tree border (darkest — reads as canopy edge)
  { r: 122, g: 90, b: 42, a: 255 }, // dirt border
];

// Decoration colors.
const GRASS_NOISE = { r: 90, g: 138, b: 74, a: 255 }; // lighter grass speckle
const TREE_CROWN = { r: 42, g: 106, b: 42, a: 255 }; // lighter canopy circle
const TREE_CROWN_RING = { r: 26, g: 58, b: 26, a: 255 }; // 1px darker crown edge
const CROWN_R = 11; // crown radius in px

// Deterministic grass noise-dot offsets (within-tile, avoiding the 1px border).
// Hand-coded so output is byte-stable across runs without an RNG.
const GRASS_DOTS = [
  [6, 8],
  [11, 21],
  [17, 5],
  [22, 16],
  [9, 26],
  [26, 24],
  [14, 12],
  [20, 28],
];

const TILE_CENTER = (TILE - 1) / 2; // 15.5 for a 32px tile

const png = new PNG({ width: TILE * TILE_COUNT, height: TILE, filterType: -1 });

const setPixel = (px, y, c) => {
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

  // Tile 1 (grass): scatter a few lighter noise dots inside the border.
  if (t === 1) {
    for (const [x, y] of GRASS_DOTS) {
      setPixel(t * TILE + x, y, GRASS_NOISE);
    }
  }

  // Tile 2 (tree): overlay a rough crown circle in lighter green, with a
  // 1px darker ring at the circle edge.
  if (t === 2) {
    for (let y = 1; y < TILE - 1; y++) {
      for (let x = 1; x < TILE - 1; x++) {
        const dist = Math.hypot(x - TILE_CENTER, y - TILE_CENTER);
        if (dist <= CROWN_R) {
          setPixel(t * TILE + x, y, dist >= CROWN_R - 1 ? TREE_CROWN_RING : TREE_CROWN);
        }
      }
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'placeholder.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(png));
console.log(`Wrote ${png.width}x${png.height} placeholder tilesheet → ${outPath}`);
