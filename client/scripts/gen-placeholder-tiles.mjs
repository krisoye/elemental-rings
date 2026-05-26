// Reproducible placeholder tilesheet generator for the Phase 8A spatial engine.
//
// Produces a 4-tile horizontal strip of 32x32 tiles → client/public/assets/tiles/placeholder.png
// Tile indices (0-based column → Tiled GID = index + firstgid):
//   0  void          (transparent — never placed in the ground layer)
//   1  floor         (walkable dark slate)
//   2  wall          (collidable stone; carries Tiled property `collides: true`)
//   3  accent-floor  (zone marker highlight — walkable)
//
// Run from the client/ directory:  node scripts/gen-placeholder-tiles.mjs
// The committed PNG is byte-stable across runs (pngjs writes deterministic output
// for identical pixel data), so regeneration produces no spurious diff.
//
// ── Kenney CC0 swap path ─────────────────────────────────────────────────────
// To replace these placeholders with real art (e.g. Kenney's "Tiny Town" or
// "RPG Urban" CC0 packs from https://kenney.nl/assets):
//   1. Drop the new tilesheet PNG at client/public/assets/tiles/placeholder.png
//      (or add it under a new name and update the `load.image('tiles', ...)` key).
//   2. Open client/public/assets/maps/*.json in Tiled, point the embedded tileset
//      at the new image, and re-index the tiles so floor/wall/accent map to the
//      art you want. Keep the `collides: true` tile property on wall tiles.
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
  { r: 42, g: 46, b: 58, a: 255 }, // 1 floor — dark slate
  { r: 92, g: 84, b: 70, a: 255 }, // 2 wall — stone brown
  { r: 60, g: 78, b: 96, a: 255 }, // 3 accent-floor — muted teal
];

// Edge/inset colors give each tile a subtle 1px border so the grid reads clearly.
const BORDER = [
  null, // void: no border
  { r: 32, g: 35, b: 46, a: 255 }, // floor border
  { r: 130, g: 120, b: 100, a: 255 }, // wall border (lighter — reads as raised)
  { r: 96, g: 130, b: 150, a: 255 }, // accent border
];

const png = new PNG({ width: TILE * TILE_COUNT, height: TILE, filterType: -1 });

for (let t = 0; t < TILE_COUNT; t++) {
  const fill = PALETTE[t];
  const border = BORDER[t];
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const px = t * TILE + x;
      const idx = (png.width * y + px) << 2;
      const onEdge = x === 0 || y === 0 || x === TILE - 1 || y === TILE - 1;
      const c = onEdge && border ? border : fill;
      png.data[idx] = c.r;
      png.data[idx + 1] = c.g;
      png.data[idx + 2] = c.b;
      png.data[idx + 3] = c.a;
    }
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'tiles', 'placeholder.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(png));
console.log(`Wrote ${png.width}x${png.height} placeholder tilesheet → ${outPath}`);
