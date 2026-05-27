// Waystone catalog (GDD §10.7) — the single source of truth for waystone
// METADATA: id, display name, biome, and the aggregate-XP teleport threshold
// (8B.3 gate). Positions live in the Tiled map (overworld.json), NOT here; the
// catalog and the map share only the `id` strings. A Vitest drift test asserts
// the two id-sets stay in parity.
//
// This module is server-consumed (imported by routes.ts) and is the authority
// for the teleport gate. The client never imports it at runtime — everything it
// needs is delivered by GET /api/waystones.

/** Static metadata for one waystone. */
export interface WaystoneDef {
  /** Stable identifier; must match a `waystoneId` object property in the map. */
  id: string;
  /** Display name shown in the teleport list / overworld marker. */
  name: string;
  /** Biome this waystone belongs to (single 'forest' biome for 8B). */
  biome: string;
  /** Aggregate ring XP required before teleport to this waystone is allowed. */
  xpThreshold: number;
}

/** The canonical waystone catalog (Forest biome — 8B). */
export const WAYSTONES: WaystoneDef[] = [
  { id: 'forest_entry', name: 'Forest Waystone', biome: 'forest', xpThreshold: 0 },
  { id: 'forest_glade', name: 'Glade Waystone', biome: 'forest', xpThreshold: 100 },
  { id: 'forest_depths', name: 'Deepwood Waystone', biome: 'forest', xpThreshold: 300 },
  { id: 'forest_north_stone', name: 'Frost-Worn Stone', biome: 'forest', xpThreshold: 150 },
  { id: 'forest_sw_stone', name: 'Bogwood Sentinel', biome: 'forest', xpThreshold: 250 },
];

/** Look up a waystone definition by id, or undefined if the id is unknown. */
export function getWaystone(id: string): WaystoneDef | undefined {
  return WAYSTONES.find((w) => w.id === id);
}

/**
 * Pure teleport-gate predicate (8B.3): true when the player's aggregate ring XP
 * meets or exceeds the waystone's threshold. An unknown id is never teleportable.
 */
export function canTeleport(aggregateXp: number, id: string): boolean {
  const def = getWaystone(id);
  if (!def) return false;
  return aggregateXp >= def.xpThreshold;
}
