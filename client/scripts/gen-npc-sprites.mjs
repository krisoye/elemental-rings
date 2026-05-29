// NPC overworld sprite atlas generator.
//
// Produces a 12-frame horizontal strip (384×32px, each frame 32×32) used by
// BaseBiomeScene to render NPC overworld markers as real sprites instead of
// colored ellipses. Frames map directly to the `spriteFrame` field in
// NpcSpawnDef (server) and NpcInfo (client API payload).
//
// Atlas layout:
//   0  FIRE  monster  — Fire 01 standing-south (24×24 → 32×32)
//   1  WATER monster  — Water Grass 19 frog standing-south (16×16 → 32×32)
//   2  EARTH monster  — Water Grass 20 frog standing-south (16×16 → 32×32)
//   3  WIND  monster  — Water Fly 11 standing-south (25×~20 → 32×32)
//   4  WOOD  monster  — Electro Ghost 14 standing-south (24×24 → 32×32)
//   5–11  duelist human variants — charsetA_1 characters, standing-south frame
//
// Monsters use the center frame (col 1) of the south-facing row (row 0) in the
// standard 3-col × 4-row walk-cycle layout.
// Charset characters occupy 48×64 blocks (3 frames × 4 dirs, each 16×16);
// standing-south = col 1 frame within the top row of each block.
//
// Run from the client/ directory:  node scripts/gen-npc-sprites.mjs
// (or `npm run gen:npc-sprites`).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import {
  MONSTER_FIRE_OW, MONSTER_WATER_OW, MONSTER_EARTH_OW,
  MONSTER_WIND_OW, MONSTER_WOOD_OW, CHARSET_A1,
} from './asset-sources.mjs';
import { cropTile, nearestScale, buildStrip } from './lib/tile-utils.mjs';

const OUT = 32; // output frame size

function cropAndScale(src, sx, sy, sw, sh) {
  const frame = new PNG({ width: sw, height: sh });
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++) {
      const si = ((sy + y) * src.width + (sx + x)) * 4;
      const di = (y * sw + x) * 4;
      frame.data[di]     = src.data[si];
      frame.data[di + 1] = src.data[si + 1];
      frame.data[di + 2] = src.data[si + 2];
      frame.data[di + 3] = src.data[si + 3];
    }
  // nearest-neighbour scale to OUT×OUT
  const scaled = new PNG({ width: OUT, height: OUT });
  const scaleX = sw / OUT;
  const scaleY = sh / OUT;
  for (let y = 0; y < OUT; y++)
    for (let x = 0; x < OUT; x++) {
      const sx2 = Math.min(Math.floor(x * scaleX), sw - 1);
      const sy2 = Math.min(Math.floor(y * scaleY), sh - 1);
      const si = (sy2 * sw + sx2) * 4;
      const di = (y * OUT + x) * 4;
      scaled.data.set(frame.data.slice(si, si + 4), di);
    }
  return scaled;
}

const sprites = [];

// Frames 0–4: monsters (3-col × 4-row walk-cycle, standing-south = col 1, row 0)
const fire = PNG.sync.read(readFileSync(MONSTER_FIRE_OW));       // 72×96, 24×24 frames
sprites.push(cropAndScale(fire, 24, 0, 24, 24));                 // col1 row0

const waterGrass19 = PNG.sync.read(readFileSync(MONSTER_WATER_OW));  // 48×64, 16×16 frames
sprites.push(cropAndScale(waterGrass19, 16, 0, 16, 16));

const waterGrass20 = PNG.sync.read(readFileSync(MONSTER_EARTH_OW));  // 48×64, 16×16 frames
sprites.push(cropAndScale(waterGrass20, 16, 0, 16, 16));

const waterFly = PNG.sync.read(readFileSync(MONSTER_WIND_OW));   // 100×79, ~25×20 frames
const wfW = Math.floor(waterFly.width / 4);
const wfH = Math.floor(waterFly.height / 4);
sprites.push(cropAndScale(waterFly, wfW, 0, wfW, wfH));         // col1 row0

const ghost = PNG.sync.read(readFileSync(MONSTER_WOOD_OW));      // 72×96, 24×24 frames
sprites.push(cropAndScale(ghost, 24, 0, 24, 24));                // col1 row0

// Frames 5–11: duelist charset chars (48×64 blocks, frame = 16×16 at col1 row0)
const charset = PNG.sync.read(readFileSync(CHARSET_A1));  // 192×256, 4×4 chars
const CHARSET_CHARS = [[0,0],[1,0],[2,0],[3,0],[0,2],[2,2],[3,2]];
for (const [cc, cr] of CHARSET_CHARS) {
  const bx = cc * 48;
  const by = cr * 64;
  sprites.push(cropAndScale(charset, bx + 16, by, 16, 16));  // col1 of top row
}

const strip = buildStrip(sprites, OUT);

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'public', 'assets', 'sprites', 'npc-overworld.png');
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, PNG.sync.write(strip));
console.log(`Wrote ${strip.width}x${strip.height} NPC overworld atlas (${sprites.length} frames) → ${outPath}`);
