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

export const GOLD_PER_WIN = 50;
export const STARTER_GOLD = 200;

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
