import Phaser from 'phaser';

/**
 * Shared loader + frame math for the RPG-Maker character sheet (charsetA_1.png).
 *
 * The sheet is 192×256 with 16×32 character frames laid out 12 cols × 8 rows. It
 * holds 8 characters in a 4×2 grid; each character is a 3-frame (columns) ×
 * 4-direction (rows: Down, Left, Right, Up) block, with the middle column the
 * standing/idle pose. Both the player avatar (Player.ts) and overworld merchant
 * NPCs (MerchantNpc.ts) draw from this one sheet — different character indices.
 */
export const CHARSET_KEY = 'charset-a1';
const CHARSET_PATH = 'assets/tiles/npc/charsetA_1.png';

export const CHARSET_FRAME_W = 16;
export const CHARSET_FRAME_H = 32;
/** Frames per sheet row (192 / 16). */
export const CHARSET_COLS = 12;
/** Walk column that holds the standing/idle pose. */
export const CHARSET_IDLE_COL = 1;

/** Facing directions, matching the charset's row order within a character block. */
export type Facing = 'down' | 'left' | 'right' | 'up';
const DIR_ROW: Record<Facing, number> = { down: 0, left: 1, right: 2, up: 3 };

/** Load the character sheet once per texture cache. Idempotent across scenes. */
export function preloadCharset(scene: Phaser.Scene): void {
  if (!scene.textures.exists(CHARSET_KEY)) {
    scene.load.spritesheet(CHARSET_KEY, CHARSET_PATH, {
      frameWidth: CHARSET_FRAME_W,
      frameHeight: CHARSET_FRAME_H,
    });
  }
}

/**
 * Sheet frame index for a character's (direction, walk-column).
 *
 * @param charIndex 0–7 — which of the 8 characters (0 = top-left)
 * @param dir facing direction (row within the character's block)
 * @param col walk column 0–2 (1 = idle)
 */
export function charsetFrame(charIndex: number, dir: Facing, col: number): number {
  const baseCol = (charIndex % 4) * 3;
  const baseRow = Math.floor(charIndex / 4) * 4;
  return (baseRow + DIR_ROW[dir]) * CHARSET_COLS + (baseCol + col);
}
