// Snow region screen manifest (GDD docs/gdd-10-snow.md, EPIC #440). Grows the
// Snow Mountains from the single entry screen toward the 9-screen region.
// Anchorage ids must exist in shared/waystones.ts; intra-biome exits MUST be
// reciprocal (asserted by the world drift test).

import type { ScreenDef } from './forest';

// Grid convention (GDD): N = +y, S = −y; entry at (0, 0). Shrine/boss/detection
// behaviour (Storm + Dust altars, Blizzard King, reduced/doubled detection) is
// handled in SnowScene code, not modelled on ScreenDef.
export const SNOW_SCREENS: ScreenDef[] = [
  {
    id: 'snow_entry',
    name: 'Snow Fields',
    size: [32, 24],
    // North leads up into the haven; the Forest return is the biome_exit (an
    // overlap zone), not a regular exit — edge transitions only target screens
    // this scene can load, so the cross-biome link cannot be a regular exit.
    exits: { north: 'snow_snowhaven' },
    coord: { x: 0, y: 0 },
    danger: 2,
    anchorage: 'snow_anchor_1',
    biomeExit: { dir: 'south', target: 'ForestScene' },
  },
  {
    id: 'snow_snowhaven',
    name: 'Snowhaven',
    size: [38, 30],
    exits: { south: 'snow_entry', west: 'snow_frost_cavern', north: 'snow_wind_pass' },
    coord: { x: 0, y: 1 },
    safe: true,
  },
  {
    id: 'snow_frost_cavern',
    name: 'Frost Cavern',
    size: [30, 24],
    exits: { east: 'snow_snowhaven' },
    coord: { x: -1, y: 1 },
    danger: 2,
  },
  {
    id: 'snow_wind_pass',
    name: 'Wind Pass',
    size: [20, 36],
    exits: { south: 'snow_snowhaven', north: 'snow_frozen_lake' },
    coord: { x: 0, y: 2 },
    danger: 2,
  },
  {
    id: 'snow_frozen_lake',
    name: 'The Frozen Lake',
    size: [40, 32],
    exits: { south: 'snow_wind_pass', north: 'snow_storm_shrine', east: 'snow_glacier_upper' },
    coord: { x: 0, y: 3 },
    danger: 2,
    anchorage: 'snow_anchor_2',
  },
  {
    id: 'snow_glacier_upper',
    name: 'Upper Glacier',
    size: [32, 28],
    exits: { west: 'snow_frozen_lake', north: 'snow_dust_shrine' },
    coord: { x: 1, y: 3 },
    danger: 3,
  },
  {
    id: 'snow_storm_shrine',
    name: 'Storm Shrine',
    size: [38, 30],
    exits: { south: 'snow_frozen_lake', east: 'snow_dust_shrine', north: 'snow_blizzard_peak' },
    coord: { x: 0, y: 4 },
    danger: 2,
  },
  {
    id: 'snow_dust_shrine',
    name: 'Dust Shrine',
    size: [32, 26],
    exits: { west: 'snow_storm_shrine', south: 'snow_glacier_upper' },
    coord: { x: 1, y: 4 },
    danger: 2,
  },
  {
    id: 'snow_blizzard_peak',
    name: 'Blizzard Peak',
    size: [36, 28],
    exits: { south: 'snow_storm_shrine' },
    coord: { x: 0, y: 5 },
    danger: 3,
  },
];

/** Look up a Snow screen definition by id, or undefined if unknown. */
export function getSnowScreen(id: string): ScreenDef | undefined {
  return SNOW_SCREENS.find((s) => s.id === id);
}
