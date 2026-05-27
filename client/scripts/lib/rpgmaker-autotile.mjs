// RPG Maker VX/Ace A2 autotile decoder — PURE function (no fs, no side effects).
//
// Takes a pngjs PNG of the Starter Village A2 autotile sheet and returns a new
// pngjs PNG: a flat horizontal strip of the 48 blob-autotile variants, each
// expanded into a full 32x32 tile (so the strip is 48*32 = 1536 px wide, 32 tall).
//
// Each output 32x32 tile is assembled from four 16x16 quarter-tiles
// (top-left, top-right, bottom-left, bottom-right) selected by the standard
// VX/Ace 48-variant lookup. Quarter-tile coordinates in the table below are in
// 16px units, relative to the source block origin (blockX*32, blockY*32).
//
// The A2 source for this pack is 512x384 (32px native → 16 cols x 12 rows of
// 32px tiles, i.e. 32 cols x 24 rows of 16px quarter-tiles). A single autotile
// "block" occupies a 6-wide x 8-tall region of quarter-tiles (3x4 32px tiles).
//
// At 32px native, each 16x16 quarter assembles directly into the 32x32 output
// tile (TL→(0,0), TR→(16,0), BL→(0,16), BR→(16,16)) with no upscale, so output
// is crisp and byte-stable.
//
// NOTE: This tool produces a strip for visual INSPECTION of the autotile material.
// The exact RPG Maker variant geometry is approximated by the table below; the
// load-bearing guarantees are: correct output dimensions (1536x32), variant 0
// (solid interior) sampling the block's solid-fill region, deterministic
// byte-stable output, and a thrown error on a too-small source.

import { PNG } from 'pngjs';

// A quarter-tile is 16x16 at native (32px-tile) source resolution.
const QUARTER = 16;
// Each output variant tile is 32x32 (= 2 quarter-tiles wide/tall after 2x scale).
const OUT_TILE = 32;
const VARIANT_COUNT = 48;

// Standard RPG Maker VX/Ace A2 autotile quarter-tile positions.
// Each entry = [TL_col, TL_row, TR_col, TR_row, BL_col, BL_row, BR_col, BR_row]
// in 16px quarter-tile units within the source block (origin = block top-left).
// The block is 6 quarter-cols x 8 quarter-rows. Variant 0 is the fully-surrounded
// solid interior (samples the block's inner solid-fill quarters).
const AUTOTILE_TABLE = [
  [4, 0, 5, 0, 4, 1, 5, 1], // 0: surrounded (solid interior)
  [2, 4, 3, 4, 4, 1, 5, 1], // 1
  [4, 0, 5, 0, 4, 3, 5, 3], // 2
  [2, 4, 3, 4, 4, 3, 5, 3], // 3
  [4, 2, 5, 2, 4, 1, 5, 1], // 4
  [2, 4, 3, 2, 4, 1, 5, 1], // 5
  [4, 2, 5, 2, 4, 3, 5, 3], // 6
  [2, 4, 3, 2, 4, 3, 5, 3], // 7
  [4, 0, 1, 4, 4, 1, 3, 5], // 8
  [2, 4, 1, 4, 4, 1, 3, 5], // 9
  [4, 0, 1, 4, 4, 3, 3, 5], // 10
  [2, 4, 1, 4, 4, 3, 3, 5], // 11
  [4, 2, 1, 4, 4, 1, 3, 5], // 12
  [2, 2, 3, 4, 4, 1, 5, 1], // 13
  [4, 2, 1, 4, 4, 3, 3, 5], // 14
  [2, 2, 3, 4, 4, 3, 5, 3], // 15
  [0, 4, 1, 4, 0, 5, 1, 5], // 16
  [2, 4, 1, 4, 0, 5, 1, 5], // 17
  [0, 4, 1, 4, 4, 3, 3, 5], // 18
  [2, 4, 1, 4, 4, 3, 3, 5], // 19
  [0, 4, 1, 2, 0, 5, 1, 5], // 20
  [2, 2, 3, 2, 0, 5, 1, 5], // 21
  [0, 4, 1, 2, 4, 3, 3, 5], // 22
  [2, 2, 3, 2, 4, 3, 3, 5], // 23
  [4, 0, 5, 0, 0, 5, 1, 5], // 24
  [2, 4, 3, 4, 0, 5, 1, 5], // 25
  [4, 0, 5, 0, 0, 3, 1, 3], // 26
  [2, 4, 3, 4, 0, 3, 1, 3], // 27
  [4, 2, 5, 2, 0, 5, 1, 5], // 28
  [2, 2, 5, 2, 0, 5, 1, 5], // 29
  [4, 2, 5, 2, 0, 3, 1, 3], // 30
  [2, 2, 5, 2, 0, 3, 1, 3], // 31
  [0, 2, 1, 2, 0, 5, 1, 5], // 32
  [0, 2, 1, 4, 0, 5, 1, 5], // 33
  [0, 2, 1, 2, 4, 3, 3, 5], // 34
  [0, 2, 1, 4, 4, 3, 3, 5], // 35
  [0, 2, 1, 2, 0, 3, 1, 3], // 36
  [0, 2, 1, 4, 0, 3, 1, 3], // 37
  [0, 2, 1, 2, 0, 3, 1, 3], // 38
  [2, 2, 3, 2, 0, 3, 1, 3], // 39
  [4, 0, 5, 2, 4, 1, 5, 1], // 40
  [2, 4, 5, 0, 4, 1, 5, 1], // 41
  [4, 0, 5, 0, 4, 1, 1, 3], // 42
  [4, 0, 5, 0, 0, 1, 5, 1], // 43
  [0, 4, 1, 0, 0, 1, 1, 1], // 44 (open / isolated corners)
  [2, 0, 3, 0, 2, 1, 3, 1], // 45
  [0, 2, 1, 2, 0, 3, 1, 3], // 46 (isolated)
  [2, 2, 3, 2, 2, 3, 3, 3], // 47 (center)
];

/**
 * Copy one 16x16 quarter-tile from the source PNG into the destination PNG at
 * (destX, destY), 1:1 (the source is 32px native, so quarters are already 16px
 * and assemble directly into a 32x32 tile).
 *
 * @param {PNG} src     source pngjs PNG
 * @param {PNG} dst     destination pngjs PNG
 * @param {number} sqx  source quarter-tile column (16px units)
 * @param {number} sqy  source quarter-tile row (16px units)
 * @param {number} destX destination top-left x (px)
 * @param {number} destY destination top-left y (px)
 */
function blitQuarter(src, dst, sqx, sqy, destX, destY) {
  const srcX0 = sqx * QUARTER;
  const srcY0 = sqy * QUARTER;
  for (let qy = 0; qy < QUARTER; qy++) {
    for (let qx = 0; qx < QUARTER; qx++) {
      const sIdx = ((srcY0 + qy) * src.width + (srcX0 + qx)) << 2;
      const dIdx = ((destY + qy) * dst.width + (destX + qx)) << 2;
      dst.data[dIdx] = src.data[sIdx];
      dst.data[dIdx + 1] = src.data[sIdx + 1];
      dst.data[dIdx + 2] = src.data[sIdx + 2];
      dst.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
}

/**
 * Decode an RPG Maker VX/Ace A2 autotile block into a flat 48-variant strip.
 *
 * @param {PNG} sourcePng  pngjs PNG of the A2 autotile sheet.
 * @param {{ blockX?: number, blockY?: number, nativeSize?: number }} blockOpts
 *        blockX/blockY select the autotile block in 32px-tile units (default 0,0).
 *        nativeSize is the native tile size (16 or 32); only 32 is supported here
 *        (the StarterVillage A2 pack is 32px native). Provided for API symmetry.
 * @returns {PNG} a new PNG, 1536x32 (48 tiles x 32px), each tile a decoded variant.
 * @throws {Error} if the source is not a valid PNG or is too small for the block.
 */
export function decodeAutotile(sourcePng, blockOpts = {}) {
  if (!sourcePng || typeof sourcePng.width !== 'number' || !sourcePng.data) {
    throw new Error('decodeAutotile: sourcePng must be a pngjs PNG object');
  }

  const { blockX = 0, blockY = 0, nativeSize = 32 } = blockOpts;
  if (nativeSize !== 32) {
    throw new Error(
      `decodeAutotile: only nativeSize 32 is supported (got ${nativeSize}); ` +
        'the StarterVillage A2 pack is 32px native'
    );
  }

  // Block origin in quarter-tile (16px) units. A 32px tile = 2 quarter-tiles.
  // The block spans 6 quarter-cols x 8 quarter-rows.
  const blockOriginQx = blockX * 2;
  const blockOriginQy = blockY * 2;
  const requiredW = (blockOriginQx + 6) * QUARTER;
  const requiredH = (blockOriginQy + 8) * QUARTER;
  if (sourcePng.width < requiredW || sourcePng.height < requiredH) {
    throw new Error(
      `decodeAutotile: source too small (${sourcePng.width}x${sourcePng.height}); ` +
        `block at (${blockX},${blockY}) needs at least ${requiredW}x${requiredH}`
    );
  }

  const out = new PNG({
    width: VARIANT_COUNT * OUT_TILE,
    height: OUT_TILE,
    filterType: -1,
  });

  for (let v = 0; v < VARIANT_COUNT; v++) {
    const [tlc, tlr, trc, trr, blc, blr, brc, brr] = AUTOTILE_TABLE[v];
    const destX = v * OUT_TILE;
    // Four 16x16 quarters assemble into the 32x32 output tile.
    // TL → (0,0), TR → (16,0), BL → (0,16), BR → (16,16) in output px.
    blitQuarter(sourcePng, out, blockOriginQx + tlc, blockOriginQy + tlr, destX + 0, 0);
    blitQuarter(sourcePng, out, blockOriginQx + trc, blockOriginQy + trr, destX + 16, 0);
    blitQuarter(sourcePng, out, blockOriginQx + blc, blockOriginQy + blr, destX + 0, 16);
    blitQuarter(sourcePng, out, blockOriginQx + brc, blockOriginQy + brr, destX + 16, 16);
  }

  return out;
}
