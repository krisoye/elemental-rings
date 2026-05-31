// Anchorage catalog — the single source of truth for TELEPORT DESTINATIONS.
// Only Anchorages live here now; standalone discovery waystones (standing
// stones, press-E attune) have been removed. Biome access is gated by bosses
// who physically block passages; defeating them opens the path and the player
// discovers the next Anchorage by walking in.
//
// Fields:
//   id         — stable identifier matching a `waystoneId` map object property
//   name       — display name in the teleport list
//   biome      — biome this anchorage belongs to
//   spiritCost — spirit spent to teleport here (§10.8); 0 = always free

/** Metadata for one anchorage teleport destination. */
export interface WaystoneDef {
  id: string;
  name: string;
  biome: string;
  spiritCost: number;
}

/** The canonical anchorage catalog (Forest + Swamp biomes). */
export const WAYSTONES: WaystoneDef[] = [
  // Forest biome — home is free; others cost a little spirit.
  { id: 'forest_entry',         name: 'Forest Anchorage',  biome: 'forest', spiritCost: 0  },
  { id: 'forest_glade',         name: 'The Glade',          biome: 'forest', spiritCost: 3  },
  { id: 'forest_depths',        name: 'Deepwood',           biome: 'forest', spiritCost: 6  },
  // Hidden Forest alcove — no walking path; teleport-only once discovered.
  { id: 'forest_hidden_anchor', name: 'Hidden Alcove',      biome: 'forest', spiritCost: 15 },
  // Swamp biome — distant, higher cost.
  { id: 'swamp_anchor_1',       name: 'Mire Anchorage',     biome: 'swamp',  spiritCost: 8  },
  { id: 'swamp_anchor_2',       name: 'Deepmuck Anchorage', biome: 'swamp',  spiritCost: 10 },
];

/** Look up an anchorage by id, or undefined if unknown. */
export function getWaystone(id: string): WaystoneDef | undefined {
  return WAYSTONES.find((w) => w.id === id);
}

/**
 * Teleport-gate predicate (§10.8): true when the player holds at least the
 * destination's spirit cost. An unknown id is never teleportable.
 */
export function canTeleport(spiritCurrent: number, id: string): boolean {
  const def = getWaystone(id);
  if (!def) return false;
  return spiritCurrent >= def.spiritCost;
}
