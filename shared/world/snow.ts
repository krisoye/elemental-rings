// Snow region screen manifest (GDD docs/gdd-10-snow.md, EPIC #440). Grows the
// Snow Mountains from the single entry screen toward the 9-screen region.
// Anchorage ids must exist in shared/waystones.ts; intra-biome exits MUST be
// reciprocal (asserted by the world drift test).

import type { ScreenDef } from './forest';

export const SNOW_SCREENS: ScreenDef[] = [
  {
    id: 'snow_entry',
    name: 'Snow Fields',
    size: [32, 24],
    // North now leads up into the haven; the Forest return is the biome_exit
    // (an overlap zone), not a regular exit — edge transitions only target
    // screens this scene can load, so the cross-biome link cannot live here.
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
    // GDD also specifies west → snow_frost_cavern and north → snow_wind_pass.
    // Those exits are added when those screens (and their maps) land — declaring
    // an exit to an unbuilt screen would edge-transition into a missing map and
    // break reciprocity in the drift test. Keep only built neighbours here.
    exits: { south: 'snow_entry' },
    coord: { x: 0, y: 1 },
    safe: true,
  },
];

/** Look up a Snow screen definition by id, or undefined if unknown. */
export function getSnowScreen(id: string): ScreenDef | undefined {
  return SNOW_SCREENS.find((s) => s.id === id);
}
