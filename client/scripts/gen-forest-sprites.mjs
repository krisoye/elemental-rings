// Forest decoration sprite-atlas generator (8D.4, updated).
//
// Draws from two source packs (Wild Plains + GreenForest) to produce a richer
// 12-frame horizontal strip of 32×32 sprites →
// client/public/assets/sprites/forest-decoration.png.
//
// All source tiles are 16px native; each is 2× nearest-neighbour upscaled to 32×32.
// Partial alpha is preserved so each sprite reads as an object on grass.
//
// Atlas layout (left → right, frame index → description):
//   0  Wild Plains (1,0)   green round tree
//   1  Wild Plains (4,0)   autumn/gold tree
//   2  Wild Plains (6,0)   dark conifer
//   3  Wild Plains (8,0)   cave entrance (deepwood)
//   4  Wild Plains (9,0)   red flower cluster
//   5  Wild Plains (10,0)  yellow flower cluster
//   6  Wild Plains (12,6)  large grey boulder
//   7  GreenForest (9,2)   round pinkish rock
//   8  GreenForest (13,0)  low green bush
//   9  GreenForest (11,2)  grass tuft
//  10  GreenForest (18,0)  wide foliage blob
//  11  Wild Plains (12,0)  purple butterfly
//
// Output is byte-stable (deterministic crop, no RNG).
//
// Run from the client/ directory:  node scripts/gen-forest-sprites.mjs
// (or `npm run gen:forest-sprites`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { GREENFOREST_TILESET, WILD_PLAINS_TILESET } from './asset-sources.mjs';
import { cropTile, nearestScale, buildStrip } from './lib/tile-utils.mjs';

const TILE = 32; // output sprite size (2× upscale of 16px source)

const wp16 = PNG.sync.read(readFileSync(WILD_PLAINS_TILESET));
const gf16 = PNG.sync.read(readFileSync(GREENFOREST_TILESET));
const wp = nearestScale(wp16, 2);
const gf = nearestScale(gf16, 2);

// [source, tx, ty] — tile-grid coordinates in the 16px source (upscale happens above).
const SPRITE_TILES = [
  [wp, 1,  0],  //  0 green round tree
  [wp, 4,  0],  //  1 autumn tree
  [wp, 6,  0],  //  2 dark conifer
  [wp, 8,  0],  //  3 cave entrance
  [wp, 9,  0],  //  4 red flower
  [wp, 10, 0],  //  5 yellow flower
  [wp, 12, 6],  //  6 grey boulder
  [gf, 9,  2],  //  7 round rock
  [gf, 13, 0],  //  8 low bush
  [gf, 11, 2],  //  9 grass tuft
  [gf, 18, 0],  // 10 wide foliage
  [wp, 12, 0],  // 11 purple butterfly
];

const sprites = SPRITE_TILES.map(([src, tx, ty]) => cropTile(src, tx, ty, TILE));
const strip = buildStrip(sprites, TILE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'forest-decoration.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} forest decoration atlas (${sprites.length} frames) → ${outPath}`);
