import type { AIPersonality } from '../../../shared/types';

/**
 * Phase 8C.3 (#83) — static per-biome NPC spawn table. Each entry pins a stable
 * id, the biome it lives in, the AI personality driving its `battle-ai` duel
 * (GDD §10.5), a tile coordinate, and a respawn cadence:
 *   respawnDays = 0 → permanent: once beaten it never returns.
 *   respawnDays = N → daily/periodic: returns after N game-days have elapsed
 *                     since the recorded defeat day.
 *
 * Tile → world pixel: world px = tx * 32 + 16 (tile center, matching the 32px
 * tile grid used by the overworld maps).
 */
export interface NpcSpawnDef {
  id: string;
  biome: string;
  personality: AIPersonality;
  tx: number;
  ty: number;
  respawnDays: number;
}

// NOTE: the issue contract listed `swamp_npc_2` as personality 'BALANCED', but
// the shared AIPersonality union has no BALANCED member ('AGGRESSIVE' |
// 'DEFENSIVE' | 'STATUS_HUNTER' | 'RESILIENT'). Per the issue's substitution
// instruction, we use the closest existing value: STATUS_HUNTER (a measured,
// gauge-building style that contrasts with the AGGRESSIVE swamp_npc_1).
export const NPC_SPAWNS: NpcSpawnDef[] = [
  { id: 'forest_npc_1', biome: 'forest', personality: 'AGGRESSIVE', tx: 15, ty: 12, respawnDays: 1 },
  { id: 'forest_npc_2', biome: 'forest', personality: 'DEFENSIVE', tx: 30, ty: 8, respawnDays: 1 },
  { id: 'forest_npc_3', biome: 'forest', personality: 'RESILIENT', tx: 8, ty: 22, respawnDays: 0 },
  // Swamp NPCs (since 8C.2 is complete):
  { id: 'swamp_npc_1', biome: 'swamp', personality: 'AGGRESSIVE', tx: 10, ty: 10, respawnDays: 1 },
  { id: 'swamp_npc_2', biome: 'swamp', personality: 'STATUS_HUNTER', tx: 20, ty: 15, respawnDays: 1 },
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
