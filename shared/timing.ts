// Single source of truth for the combat timing constants that the Colyseus
// server (authoritative) and the Phaser client (telegraph animation + gesture
// feedback) both need (EPIC #291 / #292 — DRY remediation). These are the
// PRODUCTION values. The server applies its E2E_FAST shortening to TELEGRAPH_MS
// locally (server/src/game/constants.ts) — the shortened path is server-only and
// is NOT represented here, so the client always sees the production telegraph
// length exactly as before.

// Dead-time wind-up before an attack's impact lands (GDD §6.2). The server, not
// the client, decides BLOCK vs PARRY; the client only uses this to animate the
// orb so the visual impact lines up with the server's window.
export const TELEGRAPH_MS = 900;

// Width of the catch band after impact (GDD §6.2). Classification (PARRY/BLOCK/
// WEAK) is server-owned; the client mirrors this only to time the impact pulse.
export const BLOCK_WINDOW_MS = 200;

// EPIC #264 / #265 — fusion-thumb double-attack orb gap. The two orbs land
// `gapMs` apart; the server clamps the client-supplied gap to this range. The
// floor equals BLOCK_WINDOW_MS so orb 1's parry-determination margin is always
// cleared before orb 2 lands. The CLIENT only mirrors these for feedback — the
// server re-clamps authoritatively.
export const MIN_COMBO_GAP_MS = 200; // = BLOCK_WINDOW_MS
export const MAX_COMBO_GAP_MS = 600;

// GDD §7 — status effects. A triangle gauge (FIRE/WATER/WOOD) at or above
// STATUS_THRESHOLD activates that element's status (Burning/Drowning/Entangled).
export const STATUS_THRESHOLD = 4;
