export const TELEGRAPH_MS = 900;
export const BLOCK_WINDOW_MS = 200;
export const PARRY_WINDOW_MS = 175;
export const STARTING_HEARTS = 3;
export const STARTING_USES = 3;
export const DEFEND_WINDOW_MS = TELEGRAPH_MS + BLOCK_WINDOW_MS; // 1100

export const GOLD_PER_WIN = 50;
export const STARTER_GOLD = 200;

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
