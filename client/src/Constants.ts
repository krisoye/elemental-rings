// Client-only rendering constants. Game logic lives entirely on the Colyseus
// server (see server/src/game/constants.ts) — these values are used purely for
// visual layout and orb-travel timing of the telegraph animation.
//
// Cross-tier constants (element names, slot keys, combat timing) are NOT defined
// here — they are hoisted into shared/ (EPIC #292) and re-exported below so every
// existing `../Constants` import site keeps resolving from one source of truth.
export { ELEMENT_NAMES, SLOT_KEYS, type SlotKey } from '../../shared/elements';
export {
  TELEGRAPH_MS,
  BLOCK_WINDOW_MS,
  MIN_COMBO_GAP_MS,
  MAX_COMBO_GAP_MS,
  STATUS_THRESHOLD,
} from '../../shared/timing';
import { STATUS_THRESHOLD as STATUS_THRESHOLD_SHARED } from '../../shared/timing';
import type { SlotKey } from '../../shared/elements';

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
  0x2a1a3a, // SHADOW   (15) — dark purple/black (rare overworld drop, §3.5)
];

// #47 — XP a Tier 1 ring must reach before it can be a fusion parent (mirrors
// server TIER1_XP_CAP). Display-only: the server enforces the real gate.
export const TIER1_XP_CAP = 100;

// #78 ④ — Staked-ring (Thumb) passive reminder. The five base elements grant a
// named passive when staked as the Thumb ring; fusions (element 5–14) grant no
// passive, signalled by the absence of an entry. Display-only — the server owns
// the real passive resolution at duel start (see staking.spec.ts coverage).
export const THUMB_PASSIVE_INFO: Record<number, { name: string; effect: string }> = {
  0: { name: 'Kindling', effect: 'All Fire rings in your battle hand gain +1 use at duel start' },
  1: {
    name: 'Torrent',
    effect:
      'At duel start, spends all thumb uses distributing +1 to matching Water rings, round-robin highest XP first',
  },
  2: {
    name: 'Precision Parry',
    effect: "On any PARRY-timed defense, refunds the defending ring's use (Thumb pays 1 use)",
  },
  3: { name: 'Tailwind', effect: 'Each attack thrown is refunded its use (Thumb pays)' },
  4: {
    name: 'Overgrowth',
    effect:
      'At duel start, spends all thumb uses distributing +1 to matching Wood rings, round-robin highest XP first',
  },
};

// #85 Fix 1 — width (px) of the Thumb staked-passive reminder strip in the Ring
// Storage overlay (CampScene) and Manage Battle Hand modal. Wider than the 70px
// Thumb stake card (STAKE_CARD_WIDTH) so the longest base passive effect — the
// all-in setup distributors (Water's Torrent / Wood's Overgrowth) — wraps to a
// readable number of lines instead of one word per line clipped at maxLines.
export const PASSIVE_STRIP_WIDTH = 88;

// #263 — orientation of the two-tone fused ring card. 'vertical' splits the card
// into a top half (component 0) and a bottom half (component 1); 'horizontal'
// splits left (0) / right (1). One global constant so every fused card flips
// together (RingSlot, InventoryGrid, RingCard, OpponentDuelist).
export const FUSED_CARD_SPLIT: 'horizontal' | 'vertical' = 'vertical';

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
// status effect activates. Aliased to the shared STATUS_THRESHOLD (server-
// authoritative) so the HUD's active-status indicator and the server agree by
// construction; display only.
export const GAUGE_THRESHOLD = STATUS_THRESHOLD_SHARED;

// #62 — Phase 8B.2 Compass HUD (GDD §10.7). The compass is a camera-pinned
// arrow that pulls toward the nearest UNATTUNED waystone within COMPASS_RANGE,
// brightening/growing as the player approaches. Pure presentation — the
// waystone catalog/positions and attunement state come from the server
// (window.__waystones) and the map; the compass only renders the pull.
export const COMPASS_RANGE = 400; // px — sensing radius; outside this, hidden
export const COMPASS_ARROW_COLOR = 0xffd700; // gold — distinct from waystone hues
export const COMPASS_ARROW_SIZE = 24; // px — half-length of the arrow triangle

// #71 — Phase 8B.4.1 Sanctum exterior + sanctum_return co-location. The Sanctum
// structure (and its re-entry door) is drawn at the anchored waystone rather
// than the map's static sanctum_return rectangle, so the player always spawns
// beside a visible building they can walk back into. Pure presentation — the
// anchor waystone id comes from the server (window.__waystones.anchor).
// Sanctum sprite center sits this many px ABOVE the anchorage center so the
// sprite's bottom edge (half-height = 40 at 0.5× scale on 2× zoom maps) aligns
// flush with the anchorage object's bottom edge (half = 8): 40 − 8 = 32.
export const SANCTUM_Y_ABOVE = 32;
// Player spawns in the tile directly below the anchorage object. In 16px-tile
// maps the tile below starts at anchorage bottom (center + 8) and its center
// is one half-tile further down: 8 + 8 = 16 below the anchorage center.
export const SANCTUM_SPAWN_Y_BELOW = 16;
// Half-height of the sanctum sprite at 0.5× scale (160 / 2 * 0.5 = 40). Adding
// this to the sprite center Y gives the door (bottom edge of the sprite).
export const SANCTUM_SPRITE_HALF_H = 40;
export const SANCTUM_ZONE_HALF = 32; // px — half-width/height of the sanctum_return interaction zone

// #73 — Phase 8B.4.3 Anchorage ground treatment. A soft worn-ground ring beneath
// each waystone stone marking the gathering area. Tunable presentation only.
export const ANCHORAGE_GROUND_RADIUS = 80; // px — tunable gathering-area radius

// #83 — Phase 8C.3 NPC detection (GDD §10.3). The radius within which an overworld
// NPC is "detected": the scene reveals the opponent's element + shows an Approach
// [E] prompt, and E launches the duel. Pure presentation — the NPC roster and its
// stake elements come from the server (GET /api/overworld/npcs).
export const DETECTION_RADIUS = 160; // px — sensing radius for overworld NPCs

// #87 Part A — short-range blink. Double-clicking an interaction zone (two
// pointerdowns on the same zone within DOUBLE_CLICK_MS) within BLINK_MAX_RANGE
// spends spirit (server-computed, cost ∝ distance) to snap the player onto the
// zone and fire its interact(). DOUBLE_CLICK_MS bounds the double-click gesture;
// BLINK_MAX_RANGE caps how far a single blink can reach. Pure input/layout — the
// authoritative cost and spirit guard live on the server (POST /api/spirit/blink).
export const DOUBLE_CLICK_MS = 300; // ms — max gap between the two clicks of a double-click
export const BLINK_MAX_RANGE = 600; // px — farthest a blink may reach; beyond this, no-op

// Layout
export const CANVAS_W = 1024;
export const CANVAS_H = 576;
export const PLAYER_X = 768;
export const PLAYER_Y = 260;
export const OPPONENT_X = 256;
export const OPPONENT_Y = 260;

// Named loadout slots (GDD §6.1): SLOT_KEYS / SlotKey now come from
// shared/elements.ts (re-exported at the top of this file). Keyboard bindings:
// a1='1', a2='2', d1='3', d2='4'. SLOT_LABELS stays client-only (display text).
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

// #490 — RECHARGE slot card in the Hand row (left of Thumb at HAND_SLOT_X[0]=580).
// Center at 580 - HAND_SLOT_SPACING (68) = 512; divider midpoint between 512 and 580.
// Gold styling shared with BenchHealthCombat's RECHARGE slot — imported by both files.
export const RECHARGE_SLOT_X = 512;
export const RECHARGE_DIVIDER_X = 546;
export const RECHARGE_FILL = 0x443300;
export const RECHARGE_ALPHA = 0.6;
export const RECHARGE_STROKE = 0xffcc44;
export const RECHARGE_STROKE_WIDTH = 2;
