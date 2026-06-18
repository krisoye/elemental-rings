// E2E_FAST (set by the Playwright webServer SERVER env) shortens the pure
// "wind-up" dead time before impact so the suite runs far faster. ONLY
// TELEGRAPH_MS is shortened: it is dead time between the attack and the moment
// the defend window's impact lands — no classification depends on its absolute
// length, only on the press offset RELATIVE to impact. The catch bands
// (BLOCK_WINDOW_MS / PARRY_WINDOW_MS) are LEFT UNCHANGED so PARRY/BLOCK/WEAK
// classification is identical to production (the unit + integration suites pin
// those bands and run WITHOUT E2E_FAST, so they are unaffected). With FAST,
// DEFEND_WINDOW_MS = 150 + 200 = 350ms, still > the 250ms (now 80ms) E2E
// auto-driver poll interval, so AI-driver defenses reliably arrive in-window.
import type { BossTier } from '../../../shared/types';
import {
  TELEGRAPH_MS as TELEGRAPH_MS_PROD,
  BLOCK_WINDOW_MS,
  MIN_COMBO_GAP_MS,
  MAX_COMBO_GAP_MS,
  STATUS_THRESHOLD,
} from '../../../shared/timing';
import {
  CHARGE_THRESHOLD_MS as CHARGE_THRESHOLD_MS_SHARED,
  MAX_CHARGE_MS as MAX_CHARGE_MS_SHARED,
  CHARGE_TELEGRAPH_MIN_MS_PROD,
  SWEEP_RANGE_DEG as SWEEP_RANGE_DEG_SHARED,
  HIT_CONE_DEG as HIT_CONE_DEG_SHARED,
  BASE_SWEEP_MS as BASE_SWEEP_MS_SHARED,
  SWEEP_SPEEDUP as SWEEP_SPEEDUP_SHARED,
  MAX_SWEEPS as MAX_SWEEPS_SHARED,
  CHARGE_ARM_MS as CHARGE_ARM_MS_SHARED,
} from '../../../shared/chargeConstants';

// Re-export the shared timing constants so existing server imports of
// `../constants` keep resolving from one place (the shared module is the single
// source of truth — EPIC #292). PARRY_WINDOW_MS stays server-only: the client
// never references it.
export { BLOCK_WINDOW_MS, MIN_COMBO_GAP_MS, MAX_COMBO_GAP_MS, STATUS_THRESHOLD };

// Re-export shared charge constants for server-side imports.
export {
  CHARGE_THRESHOLD_MS_SHARED as CHARGE_THRESHOLD_MS,
  MAX_CHARGE_MS_SHARED as MAX_CHARGE_MS,
  SWEEP_RANGE_DEG_SHARED as SWEEP_RANGE_DEG,
  HIT_CONE_DEG_SHARED as HIT_CONE_DEG,
  BASE_SWEEP_MS_SHARED as BASE_SWEEP_MS,
  SWEEP_SPEEDUP_SHARED as SWEEP_SPEEDUP,
  MAX_SWEEPS_SHARED as MAX_SWEEPS,
  CHARGE_ARM_MS_SHARED as CHARGE_ARM_MS,
};

const E2E_FAST = process.env.E2E_FAST === '1';
// Server applies the E2E_FAST telegraph shortening locally; production length
// comes from the shared module. Only TELEGRAPH_MS is shortened (dead wind-up
// time) — the catch bands stay at their production widths so classification is
// identical with or without E2E_FAST.
export const TELEGRAPH_MS = E2E_FAST ? 150 : TELEGRAPH_MS_PROD;
export const PARRY_WINDOW_MS = 175;
export const STARTING_HEARTS = 3;
export const STARTING_USES = 3;
export const DEFEND_WINDOW_MS = TELEGRAPH_MS + BLOCK_WINDOW_MS; // 1100 (350 under E2E_FAST)

// ── Charge attack constants (#491, GDD §6.3) ────────────────────────────────
// CHARGE_THRESHOLD_MS, MAX_CHARGE_MS, SWEEP_RANGE_DEG, HIT_CONE_DEG,
// BASE_SWEEP_MS, SWEEP_SPEEDUP, and MAX_SWEEPS are sourced from
// shared/chargeConstants.ts and re-exported above. Only the E2E_FAST-dependent
// value lives here.

/** Telegraph window at maximum charge (fastest projectile, tightest parry).
 *  Shortened under E2E_FAST to keep the E2E suite fast. */
export const CHARGE_TELEGRAPH_MIN_MS = E2E_FAST ? 80 : CHARGE_TELEGRAPH_MIN_MS_PROD;
/** Parry window compression at full charge (0 = no compression, 1 = fully closed). */
export const CHARGE_PARRY_COMPRESSION = 0.35;

// GAUGE_SOFT_CAP (2× STATUS_THRESHOLD) caps the broadcast gauge value so HUD
// numbers stay readable.
export const GAUGE_SOFT_CAP = 8;
// Shadow gauge hard cap (#134, GDD §7.1). The shadow gauge clamps at 5 on
// increment; the triangle gauges use the separate GAUGE_SOFT_CAP.
export const SHADOW_GAUGE_CAP = 5;

export const GOLD_PER_WIN = 50;
export const STARTER_GOLD = 200;
// GDD §6.3 — forfeiting a duel costs the staked ring AND a flat gold penalty
// (floored at 0 so a balance never goes negative).
export const GOLD_FORFEIT_PENALTY = 25;

// Outcome-based ring XP. Rings earn XP from exchange results, not per use.
// (EPIC #279 — XP no longer feeds spirit_max; it drives ring tiers only.)
// Attack ring XP by outcome.
export const XP_ATK_HIT = 5; // attack lands (defender loses a heart)
export const XP_ATK_BLOCK = 2; // attack is blocked
export const XP_ATK_COUNTER = 1; // attack is countered/parried (PARRY+STRONG)
// Defense ring XP by outcome (only when the defender actually pressed a key).
export const XP_DEF_COUNTER = 5; // successful parry/counter (PARRY+STRONG)
export const XP_DEF_BLOCK = 2; // clean block (no heart lost)
export const XP_DEF_WEAK = 1; // defense failed (heart lost, ring was pressed)

// #41 — Spirit / food economy. Sleeping consumes food and fully restores the
// spirit gauge; ring recharging spends spirit (1 unit per use restored).
export const FOOD_PER_SLEEP = 25;
export const SPIRIT_PER_RING_USE = 1;
export const MERCHANT_FOOD_MARKUP = 2;

// EPIC #279 — carry-cap composition. The carry cap is a flat constant for every
// player: CORE_SLOTS (the five named battle-hand slots: thumb + a1 + a2 + d1 + d2)
// plus SPARE_SLOTS (the fixed spare pouch). carry_cap = CORE_SLOTS + SPARE_SLOTS =
// 14. This replaces the former XP-driven ceil(log_2(aggregate_xp)) curve
// (SPARE_LOG_BASE) — every player, new or veteran, now carries the same 14 rings.
// Combined with the 9-slot Reliquary cap, total rings at any time is bounded at 23.
export const CORE_SLOTS = 5;
export const SPARE_SLOTS = 9;

// #229/#230 — boss-gate food drops (GDD §10.5/§10.17). A permanent boss NPC
// (respawnDays === 0) drops a one-time food cache the first time the player beats
// it. Tuned relative to the food economy (FOOD_PER_SLEEP = 25): a mini-boss drops
// just under a night's sleep; a major boss drops two nights' worth.
export const MINI_BOSS_FOOD_DROP = 20; // Bogwood Warden (mid-tier boss gate)
export const BOSS_FOOD_DROP = 50; // Thornwood Warden (major boss gate)

// #87 Part C — ambush first-strike premium (GDD §10.3/§10.9). Double-clicking an
// overworld NPC blinks into the duel and buys the opening attack for this flat
// spirit cost. The server spends it in BattleRoom.onJoin when the firstStrike
// option is set and the player can afford it; otherwise the flag is ignored.
export const AMBUSH_SPIRIT_COST = 5;

// #127 — Foraging system (GDD §10.10). Each node interaction yields this many
// food units. After FORAGE_RESPAWN_DAYS game-days the node is harvestable again
// (per-player tracking — two players can forage the same node independently).
export const FORAGE_YIELD = 1;
export const FORAGE_RESPAWN_DAYS = 1;

// #127/#130 — Merchant food prices (GDD §10.10/§10.11). Merchants buy food from
// the player at the base forage value and sell it at a 2× markup (the emergency-
// supply premium described in the GDD). Downstream: merchant endpoints (#130)
// import these constants so prices are defined in one place.
export const FOOD_SELL_PRICE = 1; // GP per food unit (merchant buys at this price)
export const FOOD_BUY_PRICE = 2;  // GP per food unit (merchant sells at this price)

// #130 — Merchant ring prices (GDD §10.11). Triangle-element rings (Fire/Water/
// Wood) command a premium over the neutral elements (Wind/Earth). Sell prices are
// the player's proceeds when trading a ring back to the merchant.
export const MERCHANT_RING_BUY_PRICE_T1 = 30;       // GP to buy a Tier 1 triangle ring
export const MERCHANT_RING_BUY_PRICE_NEUTRAL = 25;   // GP to buy a Tier 1 Wind/Earth ring
export const MERCHANT_RING_SELL_PRICE_T1 = 10;       // GP when player sells Tier 1 triangle ring
export const MERCHANT_RING_SELL_PRICE_NEUTRAL = 8;   // GP when player sells Tier 1 Wind/Earth ring

// #182 — Reliquary capacity cap. Resting rings (in_carry=0 AND escrowed=0) consume
// Reliquary slots. Players start with RELIQUARY_BASE_CAP slots.
//
// #240 — Reliquary is held at a FIXED 9 slots; Shard-based expansion is paused
// (dormant). RELIQUARY_SHARD_INCREMENT stays defined so the Shard plumbing
// (grantShard / addReliquaryShardToReliquary / POST /api/sanctum/expand-reliquary)
// continues to compile and is ready to re-enable, but no in-game path reaches it.
export const RELIQUARY_BASE_CAP = 9;
export const RELIQUARY_SHARD_INCREMENT = 10;

// ── Boss combat difficulty bundle (EPIC #256, #258) ─────────────────────────
/**
 * Per-tier boss difficulty modifiers (#258). These STACK on top of the existing
 * personality XP scaling (PERSONALITY_MULTIPLIER) — they do not replace it. Each
 * boss vsAI room reads NPC_SPAWNS[npcId].boss.tier and applies these to the AI
 * seat + its combat profile so a boss is sharper/tougher than a roamer of the
 * same personality (GDD §10.5).
 *
 *   bonusHearts — added to STARTING_HEARTS for the AI seat (tankier boss).
 *   sigmaMult   — multiplies the profile's timingSigmaMs (tighter timing).
 *   noBlockMult — multiplies the profile's noBlockProb (blocks more often).
 *   bonusUses   — added to every combat ring's maxUses (deeper loadout).
 *   thinkMult   — multiplies the attacker think-delay (faster decisions when <1).
 *
 * Enrage (#259, phase-2). A boss whose hearts drop to ≤ enrageThreshold switches
 * to an enraged profile: a further σ-tighten, a further think-speedup, and (for
 * the major boss) a shift of attack targeting toward AGGRESSIVE (chase counters).
 *   enrageThreshold       — hearts at/below which enrage fires; 0 = disabled.
 *   enrageSigmaMult       — multiplies the (already modified) σ while enraged.
 *   enrageThinkMult       — multiplies the (already modified) think-delay enraged.
 *   enrageAggressive      — when true the enraged boss attacks like AGGRESSIVE
 *                           (chases unparryable / counter-poking throws).
 *
 * Status-gauge pressure (#260). gaugeFillMult multiplies the gauge credited to the
 * DEFENDER on an uncontested boss hit (per orb — a double attack applies it
 * twice). Bosses with a triangle-bearing attack thus build the player's status
 * gauge faster, putting a clock on the fight. 1.0 = no pressure.
 *   gaugeFillMult — multiplier on the defender's per-orb gauge credit from a boss
 *                   hit. Sub-bosses press hardest (×1.5); major/gate lighter.
 */
export interface BossModifier {
  bonusHearts: number;
  sigmaMult: number;
  noBlockMult: number;
  bonusUses: number;
  thinkMult: number;
  enrageThreshold: number;
  enrageSigmaMult: number;
  enrageThinkMult: number;
  enrageAggressive: boolean;
  gaugeFillMult: number;
  /** NPC spirit pool = floor(playerSpiritMax × spiritMult). Overrides personality mult. */
  spiritMult: number;
}

export const BOSS_MODIFIERS: Record<BossTier, BossModifier> = {
  // Major boss (Thornwood Warden): much tankier, far sharper, deeper loadout, and
  // quicker to act. Enrages at ≤ 2 hearts — a real phase-2 beat (sharper still and
  // aggressive targeting). The flagship Forest fight.
  major: {
    bonusHearts: 2,
    sigmaMult: 0.5,
    noBlockMult: 0.25,
    bonusUses: 2,
    thinkMult: 0.8,
    enrageThreshold: 2,
    enrageSigmaMult: 0.6,
    enrageThinkMult: 0.6,
    enrageAggressive: true,
    gaugeFillMult: 1.0,
    spiritMult: 1.0,
  },
  // Gate boss (Bogwood Warden): a solid step above a roamer; standard pacing. No
  // enrage (threshold 0).
  gate: {
    bonusHearts: 1,
    sigmaMult: 0.7,
    noBlockMult: 0.5,
    bonusUses: 1,
    thinkMult: 1.0,
    enrageThreshold: 0,
    enrageSigmaMult: 1.0,
    enrageThinkMult: 1.0,
    enrageAggressive: false,
    gaugeFillMult: 1.0,
    spiritMult: 0.75,
  },
  // Sub-boss (fusion-shrine guardians): same toughness bump as a gate boss; their
  // distinct threat is status-gauge pressure (#260) — ×1.5 gauge fill — not raw
  // stats. No enrage.
  sub: {
    bonusHearts: 1,
    sigmaMult: 0.7,
    noBlockMult: 0.5,
    bonusUses: 1,
    thinkMult: 1.0,
    enrageThreshold: 0,
    enrageSigmaMult: 1.0,
    enrageThinkMult: 1.0,
    enrageAggressive: false,
    gaugeFillMult: 1.5,
    spiritMult: 0.60,
  },
};

// #492 — Parameterized biome difficulty floor. Replaces the hand-tuned
// BIOME_BOSS_SPIRIT_BONUS table with a formula covering all NPC classes across
// all five biomes. spiritFloor(biome, npcClass) is the minimum spirit an NPC of
// that class can have in that biome regardless of player level. floorTier(biome)
// is the minimum effective tier for loadout scaling.
//
// CLASS_OFFSET.roamer = 0 is LOCKED — keeps forest roamers floor-free (early-game
// accessible). REGION_STEP = 25 matches the old bonus table's per-biome increment.
//
// Verification:
//   spiritFloor('forest','gate')   = 15 + 25*0 = 15  ✓
//   spiritFloor('snow',  'gate')   = 15 + 25*1 = 40  ✓
//   spiritFloor('swamp', 'sub')    = 25 + 25*2 = 75  ✓
//   spiritFloor('desert','major')  = 40 + 25*3 = 115 ✓
//   spiritFloor('volcano','major') = 40 + 25*4 = 140 ✓
//   spiritFloor('forest','roamer') = 0  + 25*0 = 0   ✓ (locked floor-free)
//   spiritFloor('desert','roamer') = 0  + 25*3 = 75  ✓
//   spiritFloor('volcano','roamer')= 0  + 25*4 = 100 ✓

/** NPC classes eligible for spirit floors (roamer = roaming NPC; others are boss tiers). */
export type NpcClass = 'roamer' | BossTier;

/** Spirit-floor addend per class. roamer=0 is LOCKED. */
export const CLASS_OFFSET: Record<NpcClass, number> = {
  roamer: 0,
  gate:   15,
  sub:    25,
  major:  40,
};

/** Biome order from easiest (index 0) to hardest (index 4). */
export const BIOME_ORDER: string[] = ['forest', 'snow', 'swamp', 'desert', 'volcano'];

/** Spirit step added per biome level (matches old table's per-biome increment). */
export const REGION_STEP = 25;

/**
 * Minimum NPC spirit for a given biome and NPC class.
 * formula: CLASS_OFFSET[npcClass] + REGION_STEP * BIOME_ORDER.indexOf(biome)
 * Returns 0 for unrecognised biomes (safe default, same as old ?? 0).
 */
export function spiritFloor(biome: string, npcClass: NpcClass): number {
  const idx = BIOME_ORDER.indexOf(biome);
  if (idx < 0) return 0;
  return CLASS_OFFSET[npcClass] + REGION_STEP * idx;
}

/**
 * Minimum effective tier for NPCs in a given biome.
 * formula: BIOME_ORDER.indexOf(biome) + 1 (1-indexed; forest=1, volcano=5)
 * Returns 1 for unrecognised biomes.
 */
export function floorTier(biome: string): number {
  const idx = BIOME_ORDER.indexOf(biome);
  return idx >= 0 ? idx + 1 : 1;
}

// #492 — Skill distribution bands per NPC class. A normalized scalar s ∈ [0,1]
// is drawn UNIFORM within the class's [lo,hi] band. Bands overlap so the roamer
// upper tail can produce fairly skilled opponents. effectiveTier shifts the
// TRANSFER FUNCTIONS (timing σ, element-mistake) not the band itself — the band
// encodes the class's structural role in encounter design.
//
// Invariant (unit-tested): roamer.lo ≤ gate.lo ≤ sub.lo ≤ major.lo (monotonic).
export const SKILL_BAND: Record<NpcClass, { lo: number; hi: number }> = {
  roamer: { lo: 0.20, hi: 0.70 },
  gate:   { lo: 0.55, hi: 0.80 },
  sub:    { lo: 0.70, hi: 0.90 },
  major:  { lo: 0.90, hi: 1.00 },
};

