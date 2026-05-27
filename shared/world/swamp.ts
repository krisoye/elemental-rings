// Swamp region screen manifest (GDD §10.17, Phase 8E.4). The Swamp is migrated to
// the BaseBiomeScene abstraction alongside the Forest; for now it ships a single
// entry screen reusing the existing swamp.json map. The ScreenDef shape is shared
// with the Forest manifest so both biomes drive the same edge-transition and
// per-screen lookup machinery.
//
// The lone exit is the biome transition back to the Forest (its SW swamp gate).
// Anchorage / waystone ids must exist in shared/waystones.ts (the Swamp map ships
// additional catalog objects — swamp_anchor_2, swamp_depths, swamp_secret_forest —
// directly in swamp.json; the manifest only needs the entry screen's primary ids).

import type { ScreenDef } from './forest';

export const SWAMP_SCREENS: ScreenDef[] = [
  {
    id: 'swamp_entry',
    size: [28, 30],
    exits: { north: 'forest_swamp_gate' },
    danger: 2,
    waystone: 'swamp_entry',
    anchorage: 'swamp_anchor_1',
    biomeExit: { dir: 'north', target: 'ForestScene', gate: undefined },
  },
];

/** Look up a Swamp screen definition by id, or undefined if unknown. */
export function getSwampScreen(id: string): ScreenDef | undefined {
  return SWAMP_SCREENS.find((s) => s.id === id);
}
