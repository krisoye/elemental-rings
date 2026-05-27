// Shared pixel helpers for the Phase 8D asset generators — PURE functions.
//
// All take/return pngjs PNG objects (or write into a destination PNG). No fs I/O.
// Used by gen-forest-tiles, gen-swamp-tiles, gen-sanctum-tiles, gen-forest-sprites,
// and gen-structure-sprites so cropping/scaling logic lives in exactly one place.

import { PNG } from 'pngjs';

/**
 * Crop a `size`x`size` tile from `src` at pixel-grid position (tileX, tileY)
 * measured in tiles of `size` px. Returns a new `size`x`size` PNG.
 *
 * @param {PNG} src
 * @param {number} tileX tile column (in `size`-px units)
 * @param {number} tileY tile row (in `size`-px units)
 * @param {number} size  tile size in px
 * @returns {PNG}
 */
export function cropTile(src, tileX, tileY, size) {
  const out = new PNG({ width: size, height: size, filterType: -1 });
  const px0 = tileX * size;
  const py0 = tileY * size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sIdx = ((py0 + y) * src.width + (px0 + x)) << 2;
      const dIdx = (y * size + x) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

/**
 * Crop an arbitrary `w`x`h` region from `src` at pixel offset (px0, py0).
 * Returns a new `w`x`h` PNG.
 *
 * @param {PNG} src
 * @param {number} px0 left pixel
 * @param {number} py0 top pixel
 * @param {number} w   width px
 * @param {number} h   height px
 * @returns {PNG}
 */
export function cropRegion(src, px0, py0, w, h) {
  const out = new PNG({ width: w, height: h, filterType: -1 });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sIdx = ((py0 + y) * src.width + (px0 + x)) << 2;
      const dIdx = (y * w + x) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

/**
 * NEAREST-neighbour integer upscale of an entire PNG by `factor`x.
 *
 * @param {PNG} src
 * @param {number} factor integer scale factor (>= 1)
 * @returns {PNG}
 */
export function nearestScale(src, factor) {
  const out = new PNG({
    width: src.width * factor,
    height: src.height * factor,
    filterType: -1,
  });
  for (let y = 0; y < out.height; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < out.width; x++) {
      const sx = Math.floor(x / factor);
      const sIdx = (sy * src.width + sx) << 2;
      const dIdx = (y * out.width + x) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  return out;
}

/**
 * Composite `tiles` (each an `size`x`size` PNG) into a single horizontal strip
 * PNG of width `tiles.length * size`, height `size`.
 *
 * @param {PNG[]} tiles
 * @param {number} size tile size in px
 * @returns {PNG}
 */
export function buildStrip(tiles, size) {
  const out = new PNG({ width: tiles.length * size, height: size, filterType: -1 });
  tiles.forEach((tile, t) => {
    const destX = t * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const sIdx = (y * size + x) << 2;
        const dIdx = (y * out.width + (destX + x)) << 2;
        out.data[dIdx] = tile.data[sIdx];
        out.data[dIdx + 1] = tile.data[sIdx + 1];
        out.data[dIdx + 2] = tile.data[sIdx + 2];
        out.data[dIdx + 3] = tile.data[sIdx + 3];
      }
    }
  });
  return out;
}

/**
 * Create a fully transparent `size`x`size` PNG (the GID1 "void" tile).
 *
 * @param {number} size
 * @returns {PNG}
 */
export function transparentTile(size) {
  // pngjs zero-fills the buffer, so a fresh PNG is already fully transparent.
  return new PNG({ width: size, height: size, filterType: -1 });
}

/**
 * Alpha-composite `over` (same WxH as `base`) onto `base` (src-over), returning a
 * NEW PNG. Used to flatten a partial-alpha decoration (e.g. a tree-foliage tile)
 * onto an opaque ground tile so the result is fully opaque and reads as a solid
 * collidable tile in the 4-GID strip.
 *
 * @param {PNG} base opaque background (mutated copy is returned, not the input)
 * @param {PNG} over foreground with alpha
 * @returns {PNG}
 */
export function compositeOver(base, over) {
  const out = new PNG({ width: base.width, height: base.height, filterType: -1 });
  for (let i = 0; i < base.data.length; i += 4) {
    const oa = over.data[i + 3] / 255;
    const ia = 1 - oa;
    out.data[i] = Math.round(over.data[i] * oa + base.data[i] * ia);
    out.data[i + 1] = Math.round(over.data[i + 1] * oa + base.data[i + 1] * ia);
    out.data[i + 2] = Math.round(over.data[i + 2] * oa + base.data[i + 2] * ia);
    // Keep the base's alpha (opaque ground → opaque tile).
    out.data[i + 3] = base.data[i + 3];
  }
  return out;
}
