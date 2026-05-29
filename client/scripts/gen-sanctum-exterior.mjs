// Sanctum exterior sprite generator.
//
// Crops the blue-roofed house (cols 4–7, rows 7–11) from the 16px Starter Village
// main_B sheet, 2× nearest-neighbour upscales it to match the 32px overworld tile
// grid, and writes it as a single 128×160px image:
//
//   client/public/assets/sprites/sanctum-exterior.png
//
// Placed by BaseBiomeScene at the anchored Anchorage center via placeDecoration().
// The sprite origin is (0.5, 0.5) so cx/cy map to the building center.
//
// Run from the client/ directory:  node scripts/gen-sanctum-exterior.mjs
// (or `npm run gen:sanctum-exterior`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { STARTER_VILLAGE_MAIN_B_16 } from './asset-sources.mjs';
import { nearestScale } from './lib/tile-utils.mjs';

const TILE = 16; // source is 16px native
const SCALE = 2; // upscale to 32px world grid
const COLS = 4;  // building width in tiles (cols 4–7)
const ROWS = 5;  // building height in tiles (rows 7–11)
const SRC_COL = 4;
const SRC_ROW = 7;

const src = PNG.sync.read(readFileSync(STARTER_VILLAGE_MAIN_B_16));

// Crop the building region from the source sheet.
const cropW = COLS * TILE;
const cropH = ROWS * TILE;
const cropped = new PNG({ width: cropW, height: cropH });
for (let y = 0; y < cropH; y++) {
  for (let x = 0; x < cropW; x++) {
    const si = ((SRC_ROW * TILE + y) * src.width + (SRC_COL * TILE + x)) * 4;
    const di = (y * cropW + x) * 4;
    cropped.data[di]     = src.data[si];
    cropped.data[di + 1] = src.data[si + 1];
    cropped.data[di + 2] = src.data[si + 2];
    cropped.data[di + 3] = src.data[si + 3];
  }
}

// 2× nearest-neighbour upscale → 128×160px.
const scaled = nearestScale(cropped, SCALE);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'sanctum-exterior.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(scaled));
console.log(`Wrote ${scaled.width}x${scaled.height} sanctum exterior → ${outPath}`);
