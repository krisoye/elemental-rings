import type { AIPersonality } from '../../../shared/types';

/**
 * Phase 8C.3 (#83) — static per-biome NPC spawn table. Each entry pins a stable
 * id, the biome it lives in, the SCREEN within that biome (8E.3, GDD §10.15), the
 * AI personality driving its `battle-ai` duel (GDD §10.5), a tile coordinate, and
 * a respawn cadence:
 *   respawnDays = 0 → permanent: once beaten it never returns.
 *   respawnDays = N → daily/periodic: returns after N game-days have elapsed
 *                     since the recorded defeat day.
 *
 * Tile → world pixel: world px = tx * 32 + 16 (tile center, matching the 32px
 * tile grid used by the overworld maps).
 *
 * 8E.3 (#99) — `screen` ties each NPC to a Forest-region screen so the multi-
 * screen overworld (GDD §10.15) can request only the NPCs that belong on the
 * screen the player is currently viewing. Population per screen follows the
 * danger-tier guidance in §10.15 (safe 0–1, danger-1 1–2, danger-2 2–3,
 * danger-3 3–4). The personality field uses the existing AIPersonality union
 * ('AGGRESSIVE' | 'DEFENSIVE' | 'STATUS_HUNTER' | 'RESILIENT'); the manifest's
 * flavor names map onto it (Passive Villager → DEFENSIVE, Duelist → AGGRESSIVE,
 * Status-Hunter → STATUS_HUNTER, Resilient → RESILIENT, Aggressive → AGGRESSIVE).
 */
export interface NpcSpawnDef {
  id: string;
  biome: string;
  /** Forest-region screen id (GDD §10.15), or the biome entry screen for swamp. */
  screen: string;
  personality: AIPersonality;
  tx: number;
  ty: number;
  respawnDays: number;
}

// NOTE: the original 8C contract listed `swamp_npc_2` as personality 'BALANCED',
// but the shared AIPersonality union has no BALANCED member. We use the closest
// existing value: STATUS_HUNTER (a measured, gauge-building style that contrasts
// with the AGGRESSIVE swamp_npc_1).
//
// Tile coords are kept within each screen's walkable interior (well inside the
// 1-tile perimeter wall). Per-screen maps land in 8E; until then the route filters
// on `screen` so the data is ready.
export const NPC_SPAWNS: NpcSpawnDef[] = [
  // ── Forest: existing 8C NPCs → the Forest Anchorage hub screen ──────────────
  { id: 'forest_npc_1', biome: 'forest', screen: 'forest_anchorage', personality: 'AGGRESSIVE', tx: 15, ty: 12, respawnDays: 1 },
  { id: 'forest_npc_2', biome: 'forest', screen: 'forest_anchorage', personality: 'DEFENSIVE', tx: 30, ty: 8, respawnDays: 1 },
  { id: 'forest_npc_3', biome: 'forest', screen: 'forest_anchorage', personality: 'RESILIENT', tx: 8, ty: 22, respawnDays: 0 },

  // ── Forest: danger-1 screens (1–2 NPCs) ─────────────────────────────────────
  { id: 'forest_north_road_1', biome: 'forest', screen: 'forest_north_road', personality: 'AGGRESSIVE', tx: 8, ty: 6, respawnDays: 1 },
  { id: 'forest_north_road_2', biome: 'forest', screen: 'forest_north_road', personality: 'DEFENSIVE', tx: 12, ty: 10, respawnDays: 1 },
  { id: 'forest_mossy_fen_1', biome: 'forest', screen: 'forest_mossy_fen', personality: 'DEFENSIVE', tx: 9, ty: 7, respawnDays: 1 },
  { id: 'forest_east_path_1', biome: 'forest', screen: 'forest_east_path', personality: 'DEFENSIVE', tx: 10, ty: 8, respawnDays: 1 },
  { id: 'forest_glade_1', biome: 'forest', screen: 'forest_glade', personality: 'AGGRESSIVE', tx: 7, ty: 6, respawnDays: 1 },
  { id: 'forest_glade_2', biome: 'forest', screen: 'forest_glade', personality: 'DEFENSIVE', tx: 12, ty: 9, respawnDays: 1 },
  { id: 'forest_crossroads_1', biome: 'forest', screen: 'forest_crossroads', personality: 'RESILIENT', tx: 6, ty: 6, respawnDays: 1 },
  { id: 'forest_crossroads_2', biome: 'forest', screen: 'forest_crossroads', personality: 'STATUS_HUNTER', tx: 11, ty: 9, respawnDays: 1 },
  { id: 'forest_crossroads_3', biome: 'forest', screen: 'forest_crossroads', personality: 'AGGRESSIVE', tx: 14, ty: 6, respawnDays: 1 },
  { id: 'forest_south_path_1', biome: 'forest', screen: 'forest_south_path', personality: 'AGGRESSIVE', tx: 7, ty: 9, respawnDays: 1 },

  // ── Forest: danger-2 screens (2–3 NPCs) ─────────────────────────────────────
  { id: 'forest_hollow_1', biome: 'forest', screen: 'forest_hollow', personality: 'RESILIENT', tx: 7, ty: 6, respawnDays: 1 },
  { id: 'forest_hollow_2', biome: 'forest', screen: 'forest_hollow', personality: 'AGGRESSIVE', tx: 11, ty: 9, respawnDays: 1 },
  { id: 'forest_hollow_3', biome: 'forest', screen: 'forest_hollow', personality: 'STATUS_HUNTER', tx: 14, ty: 7, respawnDays: 1 },
  { id: 'forest_briar_pass_1', biome: 'forest', screen: 'forest_briar_pass', personality: 'AGGRESSIVE', tx: 8, ty: 7, respawnDays: 1 },
  { id: 'forest_briar_pass_2', biome: 'forest', screen: 'forest_briar_pass', personality: 'RESILIENT', tx: 12, ty: 10, respawnDays: 1 },
  { id: 'forest_ridge_1', biome: 'forest', screen: 'forest_ridge', personality: 'RESILIENT', tx: 7, ty: 6, respawnDays: 1 },
  { id: 'forest_ridge_2', biome: 'forest', screen: 'forest_ridge', personality: 'DEFENSIVE', tx: 12, ty: 9, respawnDays: 1 },

  // ── Forest: danger-3 screen (3 NPCs) ────────────────────────────────────────
  { id: 'forest_deepwood_1', biome: 'forest', screen: 'forest_deepwood', personality: 'AGGRESSIVE', tx: 7, ty: 6, respawnDays: 1 },
  { id: 'forest_deepwood_2', biome: 'forest', screen: 'forest_deepwood', personality: 'AGGRESSIVE', tx: 12, ty: 9, respawnDays: 1 },
  { id: 'forest_deepwood_3', biome: 'forest', screen: 'forest_deepwood', personality: 'RESILIENT', tx: 15, ty: 6, respawnDays: 0 },

  // ── Swamp: existing 8C NPCs → the Swamp entry screen ────────────────────────
  { id: 'swamp_npc_1', biome: 'swamp', screen: 'swamp_entry', personality: 'AGGRESSIVE', tx: 10, ty: 10, respawnDays: 1 },
  { id: 'swamp_npc_2', biome: 'swamp', screen: 'swamp_entry', personality: 'STATUS_HUNTER', tx: 20, ty: 15, respawnDays: 1 },
];

/**
 * Stable string hash (djb2). Returns a non-negative 32-bit integer so the same
 * NPC id always seeds the same RNG → the same previewed stake element on every
 * request (the overworld must render a consistent opponent element per NPC).
 */
export function hashNpcId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) {
    h = (Math.imul(h, 33) + id.charCodeAt(i)) | 0;
  }
  return h >>> 0;
}
