export const TELEGRAPH_MS = 900;
export const BLOCK_WINDOW_MS = 200;
export const PARRY_WINDOW_MS = 175;
export const STARTING_HEARTS = 3;
export const STARTING_USES = 3;
export const DEFEND_WINDOW_MS = TELEGRAPH_MS + BLOCK_WINDOW_MS; // 1100

export const XP_PER_USE = 5;
export const GOLD_PER_WIN = 50;
export const STARTER_GOLD = 200;

// #41 — Spirit / food economy. Sleeping consumes food and fully restores the
// spirit gauge; ring recharging spends spirit (1 unit per use restored).
export const FOOD_PER_SLEEP = 25;
export const SPIRIT_PER_RING_USE = 1;
export const MERCHANT_FOOD_MARKUP = 2;

// Spirit gauge maximum is XP-derived: spirit_max = SPIRIT_BASE + aggregate ring
// XP. SPIRIT_BASE is the flat floor every player starts with (replaces the old
// flat 30 default).
export const SPIRIT_BASE = 50;
