import Phaser from 'phaser';
import {
  CHARSET_KEY,
  CHARSET_FRAME_W,
  CHARSET_FRAME_H,
  CHARSET_IDLE_COL,
  charsetFrame,
  preloadCharset,
  type Facing,
} from './charset';

/** Which of the 8 charset characters is the player (0 = top-left, red-haired). */
const PLAYER_CHAR = 0;
/** Walk-cycle playback rate (frames/sec). */
const WALK_FPS = 8;

/** Top-down walk speed in px/s (GDD §10 overworld traversal — feel, not a rule). */
export const PLAYER_SPEED = 160;

/** Cursor key set produced by `createCursorKeys()`. */
type CursorKeys = Phaser.Types.Input.Keyboard.CursorKeys;
/** WASD key set produced by `addKeys('W,A,S,D')`. */
interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

/**
 * Top-down player avatar for the spatial Sanctum / Overworld scenes.
 *
 * An Arcade-physics sprite driven by the shared RPG-Maker character sheet
 * ({@link ./charset}): a 3-frame walk cycle in each of the four facing directions,
 * with the middle column as the idle pose. The sprite is the source of truth for
 * position; `body.x/y` and world-bounds collision are handled by Arcade Physics.
 *
 * Purely a presentation/input object — no game logic. Every camp/overworld action
 * still round-trips to the authoritative server via the owning scene.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  /** Current facing; persists when idle so the avatar faces its last heading. */
  private facing: Facing = 'down';

  constructor(scene: Phaser.Scene, x: number, y: number) {
    Player.ensureAnims(scene);
    super(scene, x, y, CHARSET_KEY, charsetFrame(PLAYER_CHAR, 'down', CHARSET_IDLE_COL));
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
    // The art is 16×32 (head + body). Collide on a small box around the feet so the
    // avatar can slip through tile-width gaps and overlaps read from where it stands.
    this.body!.setSize(12, 12);
    this.body!.setOffset((CHARSET_FRAME_W - 12) / 2, CHARSET_FRAME_H - 14);
  }

  /**
   * Load the player spritesheet. Called from each owning scene's preload() so the
   * texture is present before any Player is constructed. Idempotent across scenes.
   */
  static preload(scene: Phaser.Scene): void {
    preloadCharset(scene);
  }

  /**
   * Register the four directional walk animations once on the game-level anim
   * manager (shared across scenes). The cycle steps left-foot → idle → right-foot
   * → idle so a stationary frame bookends each stride.
   */
  private static ensureAnims(scene: Phaser.Scene): void {
    for (const dir of ['down', 'left', 'right', 'up'] as Facing[]) {
      const key = `player-walk-${dir}`;
      if (scene.anims.exists(key)) continue;
      const cols = [0, 1, 2, 1];
      scene.anims.create({
        key,
        frames: cols.map((col) => ({ key: CHARSET_KEY, frame: charsetFrame(PLAYER_CHAR, dir, col) })),
        frameRate: WALK_FPS,
        repeat: -1,
      });
    }
  }

  /** The idle (standing) frame for the current facing. */
  private idleFrame(): number {
    return charsetFrame(PLAYER_CHAR, this.facing, CHARSET_IDLE_COL);
  }

  /**
   * Drive velocity from the current keyboard state and animate accordingly.
   * Supports arrow keys and WASD simultaneously; diagonal movement is normalized
   * so it isn't faster than axis-aligned movement (8-directional). The facing for
   * animation favors the dominant axis (horizontal on a tie), and the avatar holds
   * its last-faced idle pose when stationary.
   *
   * @param cursors arrow-key set from `createCursorKeys()`
   * @param wasd WASD key set from `addKeys('W,A,S,D')`
   */
  update(cursors: CursorKeys, wasd: WasdKeys): void {
    const left = cursors.left.isDown || wasd.A.isDown;
    const right = cursors.right.isDown || wasd.D.isDown;
    const up = cursors.up.isDown || wasd.W.isDown;
    const down = cursors.down.isDown || wasd.S.isDown;

    let vx = 0;
    let vy = 0;
    if (left) vx -= 1;
    if (right) vx += 1;
    if (up) vy -= 1;
    if (down) vy += 1;

    if (vx !== 0 || vy !== 0) {
      const len = Math.hypot(vx, vy);
      this.setVelocity((vx / len) * PLAYER_SPEED, (vy / len) * PLAYER_SPEED);
      this.facing = Math.abs(vx) >= Math.abs(vy) ? (vx < 0 ? 'left' : 'right') : vy < 0 ? 'up' : 'down';
      this.anims.play(`player-walk-${this.facing}`, true);
    } else {
      this.setVelocity(0, 0);
      this.anims.stop();
      this.setFrame(this.idleFrame());
    }
  }

  /** Zero velocity and hold the idle pose — used while a modal overlay suppresses movement. */
  halt(): void {
    this.setVelocity(0, 0);
    this.anims.stop();
    this.setFrame(this.idleFrame());
  }
}
