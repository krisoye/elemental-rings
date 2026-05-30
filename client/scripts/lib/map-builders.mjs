// Shared 16px/3-layer map-building helpers for the generated Forest and Swamp maps
// (EPIC #149 / #159 / #161).
//
// These are the terrain→GID conversion + tileset-descriptor builders used by both
// gen-forest-screens.mjs and gen-swamp-map.mjs. The terrain-type enum and the
// per-cell autotile resolution are identical across biomes; only the terrain *grid*
// (which cells are grass/dirt/water/cliff) differs per biome.
//
// PURE: no fs, no side effects.

import {
  GENERATED_TILESETS,
  GID_GRASS_BASE,
  GID_DIRT_BASE,
  GID_WATER_BASE,
  GID_CLIFF_BASE,
  GID_TREE_TRUNK,
  GID_TREE_CANOPY_A,
} from './forest-gid-map.mjs';
import { resolveAutotileVariant } from './autotile-resolver.mjs';

// Terrain types — determine GID base + autotile variant on the ground layer.
export const T_GRASS = 0;
export const T_DIRT = 1;
export const T_WATER = 2;
export const T_CLIFF = 3;

export const TILE = 16;

/**
 * 8-neighbour same-terrain bitmask for an autotiled cell. Bit order matches the
 * resolver: bit0=N, bit1=NE, bit2=E, bit3=SE, bit4=S, bit5=SW, bit6=W, bit7=NW.
 * Out-of-bounds neighbours count as NOT same-terrain (0).
 */
export function neighborMaskForTerrain(grid, w, h, tx, ty, terrainType) {
  const same = (nx, ny) =>
    nx >= 0 && ny >= 0 && nx < w && ny < h && grid[ny * w + nx] === terrainType ? 1 : 0;
  let mask = 0;
  mask |= same(tx, ty - 1) << 0; // N
  mask |= same(tx + 1, ty - 1) << 1; // NE
  mask |= same(tx + 1, ty) << 2; // E
  mask |= same(tx + 1, ty + 1) << 3; // SE
  mask |= same(tx, ty + 1) << 4; // S
  mask |= same(tx - 1, ty + 1) << 5; // SW
  mask |= same(tx - 1, ty) << 6; // W
  mask |= same(tx - 1, ty - 1) << 7; // NW
  return mask;
}

/**
 * Ground-layer GID array from a terrain grid. The `bgType` (the biome's background
 * fill) is rendered as autotile-interior variant 0 of its base — forest uses
 * T_GRASS, swamp uses T_WATER. Every other terrain type is fully autotiled.
 */
export function buildGroundLayer(w, h, terrainGrid, bgType = T_GRASS) {
  const at = (tx, ty) => ty * w + tx;
  const baseFor = (t) =>
    t === T_GRASS
      ? GID_GRASS_BASE
      : t === T_DIRT
        ? GID_DIRT_BASE
        : t === T_WATER
          ? GID_WATER_BASE
          : GID_CLIFF_BASE;
  const data = new Array(w * h).fill(0);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const t = terrainGrid[at(tx, ty)];
      if (t === bgType) {
        // Background fill: always interior (variant 0) — it surrounds itself.
        data[at(tx, ty)] = baseFor(t) + 0;
      } else {
        const mask = neighborMaskForTerrain(terrainGrid, w, h, tx, ty, t);
        data[at(tx, ty)] = baseFor(t) + resolveAutotileVariant(mask);
      }
    }
  }
  return data;
}

/** Behind layer: T_CLIFF → tree trunk (non-empty collision blocks movement). */
export function buildBehindLayer(w, h, terrainGrid) {
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(0);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (terrainGrid[at(tx, ty)] === T_CLIFF) data[at(tx, ty)] = GID_TREE_TRUNK;
    }
  }
  return data;
}

/** In-front layer: T_CLIFF → tree canopy (no collision; player walks under). */
export function buildInFrontLayer(w, h, terrainGrid) {
  const at = (tx, ty) => ty * w + tx;
  const data = new Array(w * h).fill(0);
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (terrainGrid[at(tx, ty)] === T_CLIFF) data[at(tx, ty)] = GID_TREE_CANOPY_A;
    }
  }
  return data;
}

/** Emit the 6 generated tilesets; water + cliff carry `collides:true` on all 48. */
export function buildTilesetDescriptors() {
  const collideTiles = (count) =>
    Array.from({ length: count }, (_, i) => ({
      id: i,
      properties: [{ name: 'collides', type: 'bool', value: true }],
    }));

  return GENERATED_TILESETS.map((ts) => {
    const base = {
      firstgid: ts.firstgid,
      name: ts.name,
      image: ts.image,
      imagewidth: ts.imagewidth,
      imageheight: ts.imageheight,
      tilewidth: 16,
      tileheight: 16,
      tilecount: ts.tilecount,
      columns: ts.columns,
      margin: 0,
      spacing: 0,
    };
    if (ts.name === 'autotile_water_16' || ts.name === 'autotile_cliff_16') {
      return { ...base, tiles: collideTiles(ts.tilecount) };
    }
    return base;
  });
}

/** Assemble the full Tiled 1.10 map header + 4 layers from prebuilt layer data. */
export function assembleMap(w, h, ground, behind, inFront, objects) {
  return {
    compressionlevel: -1,
    width: w,
    height: h,
    tilewidth: TILE,
    tileheight: TILE,
    infinite: false,
    orientation: 'orthogonal',
    renderorder: 'right-down',
    type: 'map',
    version: '1.10',
    tiledversion: '1.10.2',
    nextlayerid: 5,
    nextobjectid: 99,
    tilesets: buildTilesetDescriptors(),
    layers: [
      { id: 1, name: 'ground', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: ground },
      { id: 2, name: 'behind', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: behind },
      { id: 3, name: 'in-front', type: 'tilelayer', x: 0, y: 0, width: w, height: h, opacity: 1, visible: true, data: inFront },
      { id: 4, name: 'objects', type: 'objectgroup', x: 0, y: 0, opacity: 1, visible: true, draworder: 'topdown', objects },
    ],
  };
}
