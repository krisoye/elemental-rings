// Waystone catalog (GDD §10.7) — the single source of truth for waystone
// METADATA: id, display name, biome, the aggregate-XP attune threshold, and the
// per-destination spirit teleport cost (§10.8, #87 Part B). Positions live in the
// Tiled map (overworld.json), NOT here; the catalog and the map share only the
// `id` strings. A Vitest drift test asserts the two id-sets stay in parity.
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
  /** Biome this waystone belongs to ('forest' or 'swamp' as of 8C). */
  biome: string;
  /** Aggregate ring XP required before teleport to this waystone is allowed. */
  xpThreshold: number;
  /**
   * Spirit spent to TELEPORT to this waystone (GDD §10.8, #87 Part B). Nearby /
   * familiar destinations are cheap; distant or freshly-discovered ones cost more.
   * This replaces the old aggregate-XP teleport gate: the player must hold at
   * least `spiritCost` spirit, and on teleport that spirit is spent. Attunement
   * (xpThreshold) still gates whether a destination is reachable at all.
   */
  spiritCost: number;
  /**
   * Waystone ids this one REVEALS on attune (GDD §10.7 — waystones are revelation
   * objects). Attuning a revelation waystone server-side also attunes the revealed
   * targets, unlocking otherwise-unreachable destinations. The Swamp's Ironbark
   * Rune reveals the hidden Forest alcove Anchorage (8C.2, #82), which has no
   * walking path and is reachable only by teleporting after the reveal.
   */
  reveals?: string[];
}

/** The canonical waystone catalog (Forest + Swamp biomes — 8B/8C). */
export const WAYSTONES: WaystoneDef[] = [
  // Forest biome (8B). The home Anchorage is free to return to; nearby glades are
  // cheap; the deep forest costs a little more.
  { id: 'forest_entry', name: 'Forest Waystone', biome: 'forest', xpThreshold: 0, spiritCost: 0 },
  { id: 'forest_glade', name: 'Glade Waystone', biome: 'forest', xpThreshold: 100, spiritCost: 3 },
  { id: 'forest_depths', name: 'Deepwood Waystone', biome: 'forest', xpThreshold: 300, spiritCost: 6 },
  { id: 'forest_north_stone', name: 'Frost-Worn Stone', biome: 'forest', xpThreshold: 150, spiritCost: 4 },
  { id: 'forest_sw_stone', name: 'Bogwood Sentinel', biome: 'forest', xpThreshold: 250, spiritCost: 5 },
  // Swamp biome (8C.2, #82) — reached from the Forest SW edge once forest_sw_stone
  // is attuned. The Ironbark Rune (swamp_secret_forest) reveals the hidden Forest
  // alcove Anchorage (forest_hidden_anchor), closing the discovery loop. Distant
  // biome — higher spirit cost.
  { id: 'swamp_anchor_1', name: 'Mire Anchorage', biome: 'swamp', xpThreshold: 400, spiritCost: 8 },
  { id: 'swamp_anchor_2', name: 'Deepmuck Anchorage', biome: 'swamp', xpThreshold: 600, spiritCost: 10 },
  { id: 'swamp_entry', name: 'Swamp Entry Stone', biome: 'swamp', xpThreshold: 400, spiritCost: 8 },
  { id: 'swamp_depths', name: 'Murk-Deep Stone', biome: 'swamp', xpThreshold: 600, spiritCost: 10 },
  {
    id: 'swamp_secret_forest',
    name: 'Ironbark Rune',
    biome: 'swamp',
    xpThreshold: 800,
    spiritCost: 12,
    // Revelation: attuning the Ironbark Rune unlocks the hidden Forest alcove
    // Anchorage (no walking path; teleport-only), closing the discovery loop.
    reveals: ['forest_hidden_anchor'],
  },
  // Hidden Forest alcove (8C.2, #82) — only reachable by teleporting to
  // forest_hidden_anchor after attuning the Ironbark Rune. Newly discovered,
  // far-flung destinations — the most expensive.
  { id: 'forest_hidden_anchor', name: 'Hidden Anchorage', biome: 'forest', xpThreshold: 800, spiritCost: 15 },
  { id: 'forest_hidden_glade', name: 'Hidden Glade Waystone', biome: 'forest', xpThreshold: 800, spiritCost: 15 },
];

/** Look up a waystone definition by id, or undefined if the id is unknown. */
export function getWaystone(id: string): WaystoneDef | undefined {
  return WAYSTONES.find((w) => w.id === id);
}

/**
 * Pure teleport-gate predicate (§10.8, #87 Part B): true when the player holds at
 * least the destination's spirit cost. This replaces the old aggregate-XP gate —
 * teleporting now SPENDS spirit (the caller deducts spiritCost on success). An
 * unknown id is never teleportable.
 */
export function canTeleport(spiritCurrent: number, id: string): boolean {
  const def = getWaystone(id);
  if (!def) return false;
  return spiritCurrent >= def.spiritCost;
}
