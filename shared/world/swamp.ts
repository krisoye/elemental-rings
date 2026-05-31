// Swamp region screen manifest (GDD §10.17, Phase 8E.4). Single entry screen;
// anchorage ids must exist in shared/waystones.ts.

import type { ScreenDef } from './forest';

export const SWAMP_SCREENS: ScreenDef[] = [
  {
    id: 'swamp_entry',
    size: [35, 28],
    exits: { north: 'forest_swamp_gate' },
    danger: 2,
    anchorage: 'swamp_anchor_1',
    biomeExit: { dir: 'north', target: 'ForestScene' },
  },
];

/** Look up a Swamp screen definition by id, or undefined if unknown. */
export function getSwampScreen(id: string): ScreenDef | undefined {
  return SWAMP_SCREENS.find((s) => s.id === id);
}
