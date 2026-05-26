import Phaser from 'phaser';

/** Texture key for the generated placeholder player body. */
const PLAYER_TEXTURE = 'player-body';
const BODY_SIZE = 24;
const PLAYER_COLOR = 0xffcc44;
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
 * Wraps an Arcade-physics sprite using a generated colored-rectangle texture as
 * a placeholder body (swap for real art later by loading a real texture and
 * passing its key to the constructor). The sprite is the source of truth for
 * position; `body.x/y` and world-bounds collision are handled by Arcade Physics.
 *
 * Purely a presentation/input object — no game logic. Every camp action still
 * round-trips to the authoritative server via the owning scene.
 */
export class Player extends Phaser.Physics.Arcade.Sprite {
  constructor(scene: Phaser.Scene, x: number, y: number) {
    Player.ensureTexture(scene);
    super(scene, x, y, PLAYER_TEXTURE);
    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setCollideWorldBounds(true);
    // Shrink the body slightly so the avatar can slip into 2-tile-wide gaps.
    this.body!.setSize(BODY_SIZE - 4, BODY_SIZE - 4, true);
  }

  /**
   * Generate the placeholder body texture once per scene texture cache. A solid
   * rounded square with a darker outline so the avatar reads against the floor.
   */
  private static ensureTexture(scene: Phaser.Scene): void {
    if (scene.textures.exists(PLAYER_TEXTURE)) return;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x222222, 1).fillRect(0, 0, BODY_SIZE, BODY_SIZE);
    g.fillStyle(PLAYER_COLOR, 1).fillRect(2, 2, BODY_SIZE - 4, BODY_SIZE - 4);
    g.generateTexture(PLAYER_TEXTURE, BODY_SIZE, BODY_SIZE);
    g.destroy();
  }

  /**
   * Drive velocity from the current keyboard state. Supports arrow keys and WASD
   * simultaneously; diagonal movement is normalized so it isn't faster than
   * axis-aligned movement (8-directional).
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
    } else {
      this.setVelocity(0, 0);
    }
  }

  /** Zero velocity — used while a modal overlay suppresses movement. */
  halt(): void {
    this.setVelocity(0, 0);
  }
}
