import type { AIPersonality, BossTier } from '../../../shared/types';
import { ElementEnum } from '../../../shared/types';
import { MINI_BOSS_FOOD_DROP, BOSS_FOOD_DROP } from '../game/constants';

/**
 * Boss combat identity descriptor (EPIC #256, owned by #257). Present only on the
 * 4 implemented Forest bosses; absent on roamers and non-boss permanents. The
 * `tier` keys BOSS_MODIFIERS (#258) / enrage thresholds (#259) / gauge pressure
 * (#260) / passives (#261); `name` is the display label surfaced in the encounter
 * preview; `fusedThumb` is the thematic FUSION element the boss stakes on its thumb
 * (threaded into BattleRoomOptions.thumbElement so generateAILoadout fields a
 * coherent fused-thumb loadout instead of a base template).
 */
export interface BossDescriptor {
  tier: BossTier;
  name: string;
  fusedThumb: ElementEnum;
}

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
  /**
   * EPIC #256 — boss combat identity. Present only on the 4 implemented Forest
   * bosses; absent on every roamer / non-boss permanent. Drives the fused-thumb
   * loadout (#257), the BOSS_MODIFIERS difficulty bundle (#258), enrage (#259),
   * gauge pressure (#260), and unique passives (#261).
   */
  boss?: BossDescriptor;
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

  // ── Forest: boss gates (#229/#230, GDD §10.17; EPIC #256) ───────────────────
  // Permanent (respawnDays: 0) boss NPCs that physically block a biome/zone exit
  // until defeated; each drops a one-time food cache (foodDrop) on first defeat.
  // EPIC #256 gives each a `boss` descriptor: the boss now stakes its THEMATIC
  // FUSION on the thumb (threaded into generateAILoadout as a fused-thumb
  // loadout), not a base element. `element` stays the fusion's TRIANGLE component
  // (drives the overworld sprite frame / approach-warning colour — the atlas has
  // no fusion frame):
  //   Bogwood  — Mud (Water+Earth), gate tier, DEFENSIVE. element=WATER (Mud's
  //              triangle component) drives the sprite; the thumb stakes MUD.
  //   Thornwood— Thornado (Wood+Wind), major tier, RESILIENT. element=WOOD
  //              (Thornado's triangle component) drives the sprite; thumb = THORNADO.
  { id: 'forest_bogwood_warden',   biome: 'forest', screen: 'forest_swamp_gate',   personality: 'DEFENSIVE', type: 'monster', element: WATER, spriteFrame: 1, tx: 14, ty: 13, respawnDays: 0, foodDrop: MINI_BOSS_FOOD_DROP, boss: { tier: 'gate', name: 'Bogwood Warden', fusedThumb: ElementEnum.MUD } },
  { id: 'forest_thornwood_warden', biome: 'forest', screen: 'forest_boss_clearing', personality: 'RESILIENT', type: 'monster', element: WOOD,  spriteFrame: 4, tx: 14, ty: 19, respawnDays: 0, foodDrop: BOSS_FOOD_DROP, boss: { tier: 'major', name: 'Thornwood Warden', fusedThumb: ElementEnum.THORNADO } },

  // ── Forest: Thornado Fusion Shrine sub-boss (#231, GDD §4.6; EPIC #256) ──────
  // The Shrine Guardian is a permanent (respawnDays: 0) roaming sub-boss in the
  // forest_thornado_shrine clearing. It does NOT block an exit — the player fights
  // it to win the Thornado ring-key that unseals the altar. EPIC #256 gives it a
  // `boss` descriptor (sub tier, AGGRESSIVE) so it stakes the THORNADO fusion on
  // its thumb. `element=WOOD` (Thornado's triangle component) drives the overworld
  // sprite. Defeating it grants the player a THORNADO ring via the standard §9.1
  // won-ring path (the staked fused thumb transfers to the winner), which doubles
  // as the altar seal-key; the won ring lands in the reliquary, so the player must
  // carry it (via the post-duel carry prompt) before presenting it to the altar.
  // No foodDrop — shrine guardians reward a ring, not a food cache.
  { id: 'forest_thornado_shrine_guardian', biome: 'forest', screen: 'forest_thornado_shrine', personality: 'AGGRESSIVE', type: 'duelist', element: WOOD, spriteFrame: 4, tx: 20, ty: 15, respawnDays: 0, boss: { tier: 'sub', name: 'Thornado Guardian', fusedThumb: ElementEnum.THORNADO } },

  // ── Forest: Bloom Fusion Shrine sub-boss (#232, GDD §4.6; EPIC #256) ─────────
  // The Bloom altar is ALWAYS open (no seal), so this Guardian does NOT gate the
  // altar — it is a permanent (respawnDays: 0) roaming sub-boss in the
  // forest_bloom_hollow clearing. It is a combat challenge fought for XP; the
  // altar remains craftable whether or not the Guardian is defeated. EPIC #256
  // gives it a `boss` descriptor (sub tier, DEFENSIVE) so it stakes the BLOOM
  // fusion on its thumb. `element=WOOD` (Bloom's triangle component) drives the
  // overworld sprite. No foodDrop — defeating it grants the player a BLOOM ring
  // via the standard §9.1 won-ring path (the staked fused thumb transfers to the
  // winner). The Hollow's altar is always open, so this is a combat reward, not a
  // seal-key.
  { id: 'forest_bloom_shrine_guardian', biome: 'forest', screen: 'forest_bloom_hollow', personality: 'DEFENSIVE', type: 'duelist', element: WOOD, spriteFrame: 4, tx: 20, ty: 15, respawnDays: 0, foodDrop: 0, boss: { tier: 'sub', name: 'Bloom Guardian', fusedThumb: ElementEnum.BLOOM } },

  // ── Forest: Frost Sentinel gate warden (#335, GDD §10.15) ───────────────────
  // The Frost Sentinel is the gate WARDEN for forest_snow_gate, physically blocking
  // the northern passage into the Snow Fields biome until defeated. Promoted from
  // mini-boss to a gate-tier boss with a `boss` descriptor so BaseBiomeScene renders
  // it with the gate-warden collar + displayName. AILoadout supports only BASE-element
  // thumbs; AGGRESSIVE supports WIND, matching the frost theme (cold northern wind).
  // spriteFrame 3 = WIND monster. BOSS_WARDENS maps forest_snow_gate → this entry.
  { id: 'forest_frost_sentinel', biome: 'forest', screen: 'forest_snow_gate', personality: 'AGGRESSIVE', type: 'monster', element: WIND, spriteFrame: 3, tx: 16, ty: 8, respawnDays: 0, foodDrop: MINI_BOSS_FOOD_DROP, boss: { tier: 'gate', name: 'Frost Sentinel', fusedThumb: ElementEnum.WIND } },

  // ── Snow ──────────────────────────────────────────────────────────────────────
  // Two mid-tier roamers for the single Snow Fields screen. AGGRESSIVE Wind monster
  // (spriteFrame 3) and RESILIENT Water monster (spriteFrame 1) — thematic cold-air
  // and icy-water flavour. respawnDays:1 matches danger-2 roamer convention.
  { id: 'snow_npc_1', biome: 'snow', screen: 'snow_entry', personality: 'AGGRESSIVE',  type: 'monster', element: WIND,  spriteFrame: 3, tx: 8,  ty: 6,  respawnDays: 1 },
  { id: 'snow_npc_2', biome: 'snow', screen: 'snow_entry', personality: 'RESILIENT',   type: 'monster', element: WATER, spriteFrame: 1, tx: 22, ty: 14, respawnDays: 1 },

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
