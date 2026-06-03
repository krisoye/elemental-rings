// Snow region screen manifest (GDD §10.15, Phase 8E). Single entry screen;
// anchorage ids must exist in shared/waystones.ts.

import type { ScreenDef } from './forest';

export const SNOW_SCREENS: ScreenDef[] = [
  {
    id: 'snow_entry',
    name: 'Snow Fields',
    size: [32, 24],
    exits: { south: 'forest_snow_gate' },
    danger: 2,
    anchorage: 'snow_anchor_1',
    biomeExit: { dir: 'south', target: 'ForestScene' },
  },
];

/** Look up a Snow screen definition by id, or undefined if unknown. */
export function getSnowScreen(id: string): ScreenDef | undefined {
  return SNOW_SCREENS.find((s) => s.id === id);
}
