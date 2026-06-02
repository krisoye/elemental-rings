import Phaser from 'phaser';
import { CHARSET_KEY, charsetFrame, type Facing } from './charset';

/** Walk-cycle playback rate (frames/sec) — shared by every charset walker. */
const WALK_FPS = 8;
/** Walk columns per stride: left-foot → idle → right-foot → idle. */
const WALK_COLS = [0, 1, 2, 1];

/**
 * Register the four directional walk animations (down/up/left/right) for one
 * charset character on the game-level anim manager (shared across scenes). The
 * cycle steps left-foot → idle → right-foot → idle so a stationary frame
 * bookends each stride. Idempotent — an anim that already exists is skipped via
 * `scene.anims.exists` so re-entered scenes don't recreate it.
 *
 * Produces anim keys `${keyPrefix}-walk-${dir}` (e.g. `player-walk-down`,
 * `duelist3-walk-left`). Extracted from the identical loops in Player.ts and
 * WanderingNpc.ts (#297).
 *
 * @param scene scene whose anim manager registers the animations
 * @param keyPrefix anim-key prefix (e.g. `'player'` or `` `duelist${char}` ``)
 * @param charIndex charset character (0–7) whose frames the cycle uses;
 *   defaults to 0 (the player character)
 */
export function registerWalkAnims(
  scene: Phaser.Scene,
  keyPrefix: string,
  charIndex = 0,
): void {
  for (const dir of ['down', 'left', 'right', 'up'] as Facing[]) {
    const key = `${keyPrefix}-walk-${dir}`;
    if (scene.anims.exists(key)) continue;
    scene.anims.create({
      key,
      frames: WALK_COLS.map((col) => ({
        key: CHARSET_KEY,
        frame: charsetFrame(charIndex, dir, col),
      })),
      frameRate: WALK_FPS,
      repeat: -1,
    });
  }
}
