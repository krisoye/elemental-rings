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

const E2E_FAST = process.env.E2E_FAST === '1';
export const TELEGRAPH_MS = E2E_FAST ? 150 : 900;
export const BLOCK_WINDOW_MS = 200;
export const PARRY_WINDOW_MS = 175;
export const STARTING_HEARTS = 3;
export const STARTING_USES = 3;
export const DEFEND_WINDOW_MS = TELEGRAPH_MS + BLOCK_WINDOW_MS; // 1100 (350 under E2E_FAST)

// GDD §7 — status effects. A triangle gauge (FIRE/WATER/WOOD) at or above
// STATUS_THRESHOLD activates that element's status (Burning/Drowning/Entangled).
// GAUGE_SOFT_CAP (2× threshold) caps the broadcast gauge value so HUD numbers
// stay readable.
export const STATUS_THRESHOLD = 4;
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
// spirit_max = SPIRIT_BASE + floor(aggregate_xp / XP_SCALER).
export const XP_SCALER = 50;
// Attack ring XP by outcome.
export const XP_ATK_HIT = 5; // attack lands (defender loses a heart)
export const XP_ATK_BLOCK = 2; // attack is blocked
export const XP_ATK_COUNTER = 1; // attack is countered/parried (PARRY+STRONG)
// Defense ring XP by outcome (only when the defender actually pressed a key).
export const XP_DEF_COUNTER = 5; // successful parry/counter (PARRY+STRONG)
export const XP_DEF_BLOCK = 2; // clean block (no heart lost)
export const XP_DEF_WEAK = 1; // defense failed (heart lost, ring was pressed)
// Thumb (stake) passive XP.
export const XP_THUMB_BUFF = 1; // per use distributed by the all-in setup passive (Fire/Water/Wood)
export const XP_THUMB_MID = 2; // per Tailwind (Wind) or Precision Parry (Earth) activation

// #41 — Spirit / food economy. Sleeping consumes food and fully restores the
// spirit gauge; ring recharging spends spirit (1 unit per use restored).
export const FOOD_PER_SLEEP = 25;
export const SPIRIT_PER_RING_USE = 1;
export const MERCHANT_FOOD_MARKUP = 2;

// Spirit gauge maximum is XP-derived: spirit_max = SPIRIT_BASE + aggregate ring
// XP. SPIRIT_BASE is the flat floor every player starts with (replaces the old
// flat 30 default).
export const SPIRIT_BASE = 50;

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
  },
};


