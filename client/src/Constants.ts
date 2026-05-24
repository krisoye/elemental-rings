// Client-only rendering constants. Game logic lives entirely on the Colyseus
// server (see server/src/game/constants.ts) — these values are used purely for
// visual layout and orb-travel timing of the telegraph animation.

export const ELEMENT_COLORS: number[] = [
  0xff4400, // FIRE   (0) — orange-red
  0x0088ff, // WATER  (1) — blue
  0x886600, // EARTH  (2) — brown
  0x88ffaa, // WIND   (3) — pale green
  0x44bb00, // WOOD   (4) — green
];

export const ELEMENT_NAMES: string[] = ['FIRE', 'WATER', 'EARTH', 'WIND', 'WOOD'];

// GDD §6.1 status threshold — when a gauge reaches this value the element's
// status effect activates. Mirrored from the server for display only.
export const GAUGE_THRESHOLD = 4;

// Telegraph / block-window timings mirrored from server/src/game/constants.ts.
// Used only to animate the orb so the visual impact lines up with the server's
// authoritative window. The server, not the client, decides BLOCK vs PARRY.
export const TELEGRAPH_MS = 900;
export const BLOCK_WINDOW_MS = 200;

// Layout
export const CANVAS_W = 1024;
export const CANVAS_H = 576;
export const PLAYER_X = 768;
export const PLAYER_Y = 260;
export const OPPONENT_X = 256;
export const OPPONENT_Y = 260;

// Hand slot centers (y=510, 5 slots)
export const HAND_Y = 510;
export const HAND_SLOT_X = [580, 648, 716, 784, 852];
export const HAND_SLOT_SPACING = 68;
