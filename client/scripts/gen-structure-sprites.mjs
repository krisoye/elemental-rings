// Structure sprite-atlas generator (8D.4).
//
// Crops standalone structure elements (building walls / roof / wood post / fence)
// from the Starter Village main sheet (32px native) and lays them out as a
// horizontal strip of 32x32 sprites →
// client/public/assets/sprites/structures.png.
//
// The chosen source tiles read as constructed-world pieces (in contrast to the
// natural forest decorations), giving the overworld house/fence/lamp flavor.
//
// Atlas layout (left → right, 32px each):
//   0 house-wall (grey stone wall)
//   1 house-roof (red roof segment)
//   2 fence      (wood plank / fence section)
//   3 post       (grey lamp / fence post)
//
// Output is byte-stable (deterministic crop, no RNG).
//
// Run from the client/ directory:  node scripts/gen-structure-sprites.mjs
// (or `npm run gen:structure-sprites`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { STARTER_VILLAGE_MAIN } from './asset-sources.mjs';
import { cropTile, buildStrip } from './lib/tile-utils.mjs';

const TILE = 32; // Starter Village main is 32px native — no upscale needed.

// Starter Village main 32px-tile grid positions of structure elements:
//   house-wall → (12,10) grey wall   rgb[172,164,176]
//   house-roof → (1,13)  red roof    rgb[208,60,38]
//   fence      → (4,11)  wood plank  rgb[215,169,146]
//   post       → (5,1)   grey post   rgb[112,102,106]
const SPRITE_TILES = [
  { tx: 12, ty: 10 }, // house-wall
  { tx: 1, ty: 13 }, // house-roof
  { tx: 4, ty: 11 }, // fence
  { tx: 5, ty: 1 }, // post
];

const src = PNG.sync.read(readFileSync(STARTER_VILLAGE_MAIN)); // 32px native

const sprites = SPRITE_TILES.map((s) => cropTile(src, s.tx, s.ty, TILE));
const strip = buildStrip(sprites, TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'structures.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} structures atlas → ${outPath}`);
