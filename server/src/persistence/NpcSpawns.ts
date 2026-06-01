import type { AIPersonality } from '../../../shared/types';
import { MINI_BOSS_FOOD_DROP, BOSS_FOOD_DROP } from '../game/constants';

/**
 * Phase 8C.3 (#83) — static per-biome NPC spawn table. Each entry pins a stable
 * id, the biome it lives in, the SCREEN within that biome (8E.3, GDD §10.15), the
 * AI personality driving its `battle-ai` duel (GDD §10.5), a tile coordinate, and
 * a respawn cadence:
 *   respawnDays = 0 → permanent: once beaten it never returns.
 *   respawnDays = N → daily/periodic: returns after N game-days have elapsed
 *                     since the recorded defeat day.
 *
 * Tile → world pixel: world px = tx * 16 + 8 (tile center, matching the 16px tile
 * grid used by the overworld maps after the #149/#159 migration). The tx/ty below
 * were halved (Math.floor(old/2)) from their original 32px-grid values.
 *
 * 8E.3 (#99) — `screen` ties each NPC to a Forest-region screen so the multi-
 * screen overworld (GDD §10.15) can request only the NPCs that belong on the
 * screen the player is currently viewing.
 *
 * `type` separates monsters (always hostile, use creature sprites) from duelists
 * (human challengers, use charset sprites). `element` is the fixed element this
 * NPC always uses — it drives both the overworld sprite frame and the battle-ai
 * seed override. `spriteFrame` is the direct index into the `npc-overworld` atlas:
 *   0 = FIRE monster,  1 = WATER monster, 2 = EARTH monster,
 *   3 = WIND monster,  4 = WOOD monster,
 *   5–11 = duelist human variants (cycled across charset characters).
 */
export interface NpcSpawnDef {
  id: string;
  biome: string;
  /** Forest-region screen id (GDD §10.15), or the biome entry screen for swamp. */
  screen: string;
  personality: AIPersonality;
  /** 'monster' uses creature sprites; 'duelist' uses human charset sprites. */
  type: 'monster' | 'duelist';
  /** Fixed ElementEnum value for this NPC — drives sprite frame + battle-ai seed. */
  element: number;
  /** Direct frame index into the npc-overworld spritesheet atlas (0–11). */
  spriteFrame: number;
  tx: number;
  ty: number;
  respawnDays: number;
  /**
   * #229/#230 — one-time food cache dropped to the winner the FIRST time a
   * permanent boss NPC (respawnDays === 0) is defeated (GDD §10.5/§10.17).
   * Omitted (treated as 0) for roamers and non-boss permanents — they drop no
   * cache. BattleRoom.persistBattleResult reads this on the recordNpcDefeat path.
   */
  foodDrop?: number;
}

// ElementEnum base values (mirrors shared/types.ts):
const FIRE = 0, WATER = 1, EARTH = 2, WIND = 3, WOOD = 4;

// Duelist sprite frames 5–11 cycle through 7 human charset variants.
// Assign by rotating through the range so adjacent duelists look different.
const D = [5, 6, 7, 8, 9, 10, 11] as const;

// ── Valid personality → thumb element combinations ───────────────────────────
// Each NPC's `element` MUST be a valid thumb for its personality's loadout
// templates (AILoadout.ts TEMPLATES). Mismatches cause the battle to fall back
// to a random template, making the overworld element disagree with the duel thumb.
//
//   AGGRESSIVE    → FIRE, WIND only
//   DEFENSIVE     → EARTH, WOOD only
//   STATUS_HUNTER → FIRE, WATER, WOOD only (Wind/Earth never fill gauges — GDD §3.3)
//   RESILIENT     → any base element (5 templates)

export const NPC_SPAWNS: NpcSpawnDef[] = [
  // ── Forest: hub screen (forest_anchorage) ────────────────────────────────────
  { id: 'forest_npc_1', biome: 'forest', screen: 'forest_anchorage', personality: 'AGGRESSIVE', type: 'monster',  element: WIND,  spriteFrame: 3,    tx: 7, ty: 6, respawnDays: 1 },
  { id: 'forest_npc_2', biome: 'forest', screen: 'forest_anchorage', personality: 'DEFENSIVE',  type: 'duelist', element: WOOD,  spriteFrame: D[0], tx: 15, ty: 4,  respawnDays: 1 },
  { id: 'forest_npc_3', biome: 'forest', screen: 'forest_anchorage', personality: 'RESILIENT',  type: 'monster',  element: WOOD,  spriteFrame: 4,    tx: 4,  ty: 11, respawnDays: 0 },

  // ── Forest: danger-1 screens (1–2 NPCs) ─────────────────────────────────────
  { id: 'forest_north_road_1', biome: 'forest', screen: 'forest_north_road', personality: 'AGGRESSIVE', type: 'monster',  element: WIND,  spriteFrame: 3,    tx: 4,  ty: 3,  respawnDays: 1 },
  { id: 'forest_north_road_2', biome: 'forest', screen: 'forest_north_road', personality: 'DEFENSIVE',  type: 'duelist', element: EARTH, spriteFrame: D[1], tx: 6, ty: 5, respawnDays: 1 },
  { id: 'forest_mossy_fen_1',  biome: 'forest', screen: 'forest_mossy_fen',  personality: 'DEFENSIVE',  type: 'monster',  element: WOOD,  spriteFrame: 4,    tx: 4,  ty: 3,  respawnDays: 1 },
  { id: 'forest_east_path_1',  biome: 'forest', screen: 'forest_east_path',  personality: 'DEFENSIVE',  type: 'duelist', element: WOOD,  spriteFrame: D[2], tx: 5, ty: 4,  respawnDays: 1 },
  { id: 'forest_glade_1',      biome: 'forest', screen: 'forest_glade',      personality: 'AGGRESSIVE', type: 'monster',  element: WIND,  spriteFrame: 3,    tx: 3,  ty: 3,  respawnDays: 1 },
  { id: 'forest_glade_2',      biome: 'forest', screen: 'forest_glade',      personality: 'DEFENSIVE',  type: 'duelist', element: WOOD,  spriteFrame: D[3], tx: 6, ty: 4,  respawnDays: 1 },
  { id: 'forest_crossroads_1', biome: 'forest', screen: 'forest_crossroads', personality: 'RESILIENT',  type: 'monster',  element: EARTH, spriteFrame: 2,    tx: 3,  ty: 3,  respawnDays: 1 },
  { id: 'forest_crossroads_2', biome: 'forest', screen: 'forest_crossroads', personality: 'STATUS_HUNTER', type: 'duelist', element: WOOD, spriteFrame: D[4], tx: 5, ty: 4, respawnDays: 1 },
  { id: 'forest_crossroads_3', biome: 'forest', screen: 'forest_crossroads', personality: 'AGGRESSIVE', type: 'monster',  element: FIRE,  spriteFrame: 0,    tx: 7, ty: 3,  respawnDays: 1 },
  { id: 'forest_south_path_1', biome: 'forest', screen: 'forest_south_path', personality: 'AGGRESSIVE', type: 'monster',  element: WIND,  spriteFrame: 3,    tx: 3,  ty: 4,  respawnDays: 1 },

  // ── Forest: danger-2 screens (2–3 NPCs) ─────────────────────────────────────
  { id: 'forest_hollow_1',    biome: 'forest', screen: 'forest_hollow',    personality: 'RESILIENT',     type: 'monster',  element: EARTH, spriteFrame: 2,    tx: 3,  ty: 3,  respawnDays: 1 },
  { id: 'forest_hollow_2',    biome: 'forest', screen: 'forest_hollow',    personality: 'AGGRESSIVE',    type: 'monster',  element: FIRE,  spriteFrame: 0,    tx: 5, ty: 4,  respawnDays: 1 },
  { id: 'forest_hollow_3',    biome: 'forest', screen: 'forest_hollow',    personality: 'STATUS_HUNTER', type: 'duelist', element: WATER, spriteFrame: D[5], tx: 7, ty: 3,  respawnDays: 1 },
  { id: 'forest_briar_pass_1',biome: 'forest', screen: 'forest_briar_pass',personality: 'AGGRESSIVE',    type: 'monster',  element: FIRE,  spriteFrame: 0,    tx: 4,  ty: 3,  respawnDays: 1 },
  { id: 'forest_briar_pass_2',biome: 'forest', screen: 'forest_briar_pass',personality: 'RESILIENT',     type: 'monster',  element: EARTH, spriteFrame: 2,    tx: 6, ty: 5, respawnDays: 1 },
  { id: 'forest_ridge_1',     biome: 'forest', screen: 'forest_ridge',     personality: 'RESILIENT',     type: 'monster',  element: WIND,  spriteFrame: 3,    tx: 3,  ty: 3,  respawnDays: 1 },
  { id: 'forest_ridge_2',     biome: 'forest', screen: 'forest_ridge',     personality: 'DEFENSIVE',     type: 'duelist', element: EARTH, spriteFrame: D[6], tx: 6, ty: 4,  respawnDays: 1 },

  // ── Forest: danger-3 screen (3 NPCs) ────────────────────────────────────────
  { id: 'forest_deepwood_1', biome: 'forest', screen: 'forest_deepwood', personality: 'AGGRESSIVE', type: 'monster', element: FIRE, spriteFrame: 0, tx: 3,  ty: 3, respawnDays: 1 },
  { id: 'forest_deepwood_2', biome: 'forest', screen: 'forest_deepwood', personality: 'AGGRESSIVE', type: 'monster', element: FIRE, spriteFrame: 0, tx: 6, ty: 4, respawnDays: 1 },
  { id: 'forest_deepwood_3', biome: 'forest', screen: 'forest_deepwood', personality: 'RESILIENT',  type: 'monster', element: WOOD, spriteFrame: 4, tx: 7, ty: 3, respawnDays: 0 },

  // ── Forest: boss gates (#229/#230, GDD §10.17) ──────────────────────────────
  // Permanent (respawnDays: 0) boss NPCs that physically block a biome/zone exit
  // until defeated; each drops a one-time food cache (foodDrop) on first defeat.
  // The AILoadout system only supports BASE-element thumbs (TEMPLATES has no
  // fusion variants), so the wardens' thematic fusion (Mud / Thornado) is
  // represented by the matching base thumb the player wins:
  //   Bogwood  — Mud (Water+Earth): DEFENSIVE + EARTH thumb (Earth-Defender
  //              template stakes Earth, opens with Water — the Mud components).
  //   Thornwood— Thornado (Wood+Wind): RESILIENT + WOOD thumb (Wood-staker
  //              template leads with Wind a1 — the Thornado components, and
  //              RESILIENT is the toughest tier, fitting a major boss).
  { id: 'forest_bogwood_warden',   biome: 'forest', screen: 'forest_swamp_gate',   personality: 'DEFENSIVE', type: 'monster', element: EARTH, spriteFrame: 2, tx: 14, ty: 13, respawnDays: 0, foodDrop: MINI_BOSS_FOOD_DROP },
  { id: 'forest_thornwood_warden', biome: 'forest', screen: 'forest_boss_clearing', personality: 'RESILIENT', type: 'monster', element: WOOD,  spriteFrame: 4, tx: 14, ty: 19, respawnDays: 0, foodDrop: BOSS_FOOD_DROP },

  // ── Forest: Thornado Fusion Shrine sub-boss (#231, GDD §4.6) ────────────────
  // The Shrine Guardian is a permanent (respawnDays: 0) roaming sub-boss in the
  // forest_thornado_shrine clearing. It does NOT block an exit — the player fights
  // it to win the Thornado ring-key that unseals the altar. AILoadout supports only
  // BASE-element thumbs, so the Guardian fields WIND (AGGRESSIVE supports WIND),
  // thematically a component of the Thornado (Wood+Wind) fusion it guards. The
  // actual Thornado ring drop is handled by BattleRoom.persistBattleResult (it
  // detects this id and grants a Thornado ring to carry), not by the thumb stake.
  // No foodDrop — shrine guardians reward a ring, not a food cache.
  { id: 'forest_thornado_shrine_guardian', biome: 'forest', screen: 'forest_thornado_shrine', personality: 'AGGRESSIVE', type: 'duelist', element: WIND, spriteFrame: D[0], tx: 20, ty: 15, respawnDays: 0 },

  // ── Swamp ─────────────────────────────────────────────────────────────────────
  { id: 'swamp_npc_1', biome: 'swamp', screen: 'swamp_entry', personality: 'AGGRESSIVE',    type: 'monster', element: WIND,  spriteFrame: 3, tx: 5, ty: 5, respawnDays: 1 },
  { id: 'swamp_npc_2', biome: 'swamp', screen: 'swamp_entry', personality: 'STATUS_HUNTER', type: 'monster', element: WATER, spriteFrame: 1, tx: 10, ty: 7, respawnDays: 1 },

  // ── Underground / cave (Shadow) ─────────────────────────────────────────────
  // #133 — Shadow (ElementEnum.SHADOW=15) is a rare drop ONLY from dark
  // underground areas (GDD §3.5). The cave/underground biome + its screens and a
  // SHADOW-element monster sprite (the overworld atlas only has frames 0–11, none
  // for Shadow) are not built yet, so no Shadow spawn entry exists here YET.
  // TODO(#132 cave biome): add a `biome: 'cave'` Shadow monster once the
  // underground biome + sprite land — beating it grants a Shadow ring via the
  // existing winner-thumb-grant path (PlayerRepo.grantRing already accepts any
  // element, so Shadow rings flow end-to-end). Until then Shadow is grantable via
  // the test/admin path so Shadow-2 (#134) and Shadow-3 (#135) can be exercised.
];

// #133 — the element a future cave/underground Shadow monster drops. Exported so
// the cave spawn entry (and any admin grant) references one source of truth.
export const SHADOW_DROP_ELEMENT = 15; // ElementEnum.SHADOW

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
