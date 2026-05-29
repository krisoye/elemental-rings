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

// #47 — Fusion crafting (GDD §5). A parent ring must reach its tier's XP cap
// before it can be fused; the resulting fusion ring resets to the new tier's
// full uses and inherits the combined XP of both parents.
export const TIER1_XP_CAP = 100;
export const TIER2_XP_CAP = 300;
export const TIER2_MAX_USES = 5;
export const TIER3_MAX_USES = 7;

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
export const XP_THUMB_BUFF = 1; // per ring buffed (Kindling/Bulwark, per ring)
export const XP_THUMB_MID = 2; // per Tailwind or Wellspring activation
export const XP_THUMB_ABSORB = 1; // per heart absorbed (Deep Roots)

// #41 — Spirit / food economy. Sleeping consumes food and fully restores the
// spirit gauge; ring recharging spends spirit (1 unit per use restored).
export const FOOD_PER_SLEEP = 25;
export const SPIRIT_PER_RING_USE = 1;
export const MERCHANT_FOOD_MARKUP = 2;

// Spirit gauge maximum is XP-derived: spirit_max = SPIRIT_BASE + aggregate ring
// XP. SPIRIT_BASE is the flat floor every player starts with (replaces the old
// flat 30 default).
export const SPIRIT_BASE = 50;

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


