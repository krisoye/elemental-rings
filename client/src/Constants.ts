// Client-only rendering constants. Game logic lives entirely on the Colyseus
// server (see server/src/game/constants.ts) — these values are used purely for
// visual layout and orb-travel timing of the telegraph animation.

// Base element colors (indices 0-4). Fusion rings (5-14) reuse their component
// colors for the orb telegraph (componentsOf yields the two parents), so the
// table only needs the five base colors plus a fallback blended color per fusion.
export const ELEMENT_COLORS: number[] = [
  0xff4400, // FIRE     (0)  — orange-red
  0x0088ff, // WATER    (1)  — blue
  0x886600, // EARTH    (2)  — brown
  0x88ffaa, // WIND     (3)  — pale green
  0x44bb00, // WOOD     (4)  — green
  0xcc88ff, // STEAM    (5)  — Fire+Water
  0xff8800, // WILDFIRE (6)  — Fire+Wood
  0xff5577, // INFERNO  (7)  — Fire+Wind
  0xaa3300, // MAGMA    (8)  — Fire+Earth
  0x33cc88, // TIDAL    (9)  — Water+Wood
  0x5599dd, // STORM    (10) — Water+Wind
  0x556699, // MUD      (11) — Water+Earth
  0x66cc66, // THORNADO (12) — Wood+Wind
  0x668822, // BLOOM    (13) — Wood+Earth
  0xaab488, // DUST     (14) — Wind+Earth
];

export const ELEMENT_NAMES: string[] = [
  'FIRE',
  'WATER',
  'EARTH',
  'WIND',
  'WOOD',
  'STEAM',
  'WILDFIRE',
  'INFERNO',
  'MAGMA',
  'TIDAL',
  'STORM',
  'MUD',
  'THORNADO',
  'BLOOM',
  'DUST',
];

// #47 — The 10 Tier 2 fusion recipes (GDD §5.2), one per distinct base-element
// pair. Display-only: the server (fusionOf / POST /api/fusion/combine) is the
// sole authority on what fuses into what. Parents/result are element indices;
// resolve labels through ELEMENT_NAMES. Order matches ElementEnum (5-14).
export interface FusionRecipe {
  parents: [number, number]; // two base element indices
  result: number; // fusion element index
}
export const FUSION_RECIPES: ReadonlyArray<FusionRecipe> = [
  { parents: [0, 1], result: 5 }, // FIRE + WATER → STEAM
  { parents: [0, 4], result: 6 }, // FIRE + WOOD  → WILDFIRE
  { parents: [0, 3], result: 7 }, // FIRE + WIND  → INFERNO
  { parents: [0, 2], result: 8 }, // FIRE + EARTH → MAGMA
  { parents: [1, 4], result: 9 }, // WATER + WOOD → TIDAL
  { parents: [1, 3], result: 10 }, // WATER + WIND → STORM
  { parents: [1, 2], result: 11 }, // WATER + EARTH → MUD
  { parents: [4, 3], result: 12 }, // WOOD + WIND → THORNADO
  { parents: [4, 2], result: 13 }, // WOOD + EARTH → BLOOM
  { parents: [3, 2], result: 14 }, // WIND + EARTH → DUST
];

// #47 — XP a Tier 1 ring must reach before it can be a fusion parent (mirrors
// server TIER1_XP_CAP). Display-only: the server enforces the real gate.
export const TIER1_XP_CAP = 100;

// Triangle element indices for the 3-gauge HUD (FIRE/WATER/WOOD).
export const GAUGE_ELEMENTS = [0, 1, 4];
export const GAUGE_KEYS = ['fireGauge', 'waterGauge', 'woodGauge'];

/**
 * Component elements for telegraph coloring. Reads the ring's broadcast
 * fusionParents (does NOT reimplement fusion logic — the server owns it). A base
 * ring yields its single element; a fusion yields its two component colors.
 */
export function ringComponents(ring: { element: number; isFusion?: boolean; fusionParents?: ArrayLike<number> }): number[] {
  if (ring?.isFusion && ring.fusionParents && ring.fusionParents.length >= 2) {
    return [ring.fusionParents[0], ring.fusionParents[1]];
  }
  return [ring?.element ?? 0];
}

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

// Named loadout slots (GDD §6.1). thumb is passive (never pressed); a1/a2 fire
// during ATTACK_SELECT, d1/d2 during DEFEND_WINDOW. Keyboard: a1='1', a2='2',
// d1='3', d2='4'. Rendered left→right: Thumb, A1, A2, D1, D2.
export const SLOT_KEYS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
export type SlotKey = (typeof SLOT_KEYS)[number];
export const SLOT_LABELS: Record<SlotKey, string> = {
  thumb: 'THUMB',
  a1: 'A1',
  a2: 'A2',
  d1: 'D1',
  d2: 'D2',
};

// Hand slot centers (y=510, 5 slots)
export const HAND_Y = 510;
export const HAND_SLOT_X = [580, 648, 716, 784, 852];
export const HAND_SLOT_SPACING = 68;
