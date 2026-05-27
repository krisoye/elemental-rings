import Phaser from 'phaser';

/**
 * Declarative spec for one decoration sprite placed over a scene's ground layer.
 */
export interface DecorationSpec {
  /** Phaser texture key for the atlas/image PNG. */
  atlasKey: string;
  /** Frame within the atlas (atlas JSON), or undefined to use the whole image. */
  frame?: string | number;
  /** World x position (sprite center). */
  x: number;
  /** World y position (sprite center). */
  y: number;
  /** When true, the sprite is added to a static physics group for collision. */
  solid: boolean;
  /** Optional: shrink the physics body by this many px on each side (trunk sizing). */
  bodyInset?: number;
  /** Render depth (default: player depth - 1 = 4). */
  depth?: number;
}

/** Handle for cleaning up a placed decoration batch on scene shutdown. */
export interface DecorationHandle {
  destroy(): void;
}

/**
 * Scene-agnostic decoration placement helper. Places sprites from atlases over
 * the ground layer and registers solid ones into an Arcade static physics group
 * for collision. Purely presentational — no game logic; the server stays the
 * source of truth for the world layout (decorations are client-only flavor).
 *
 * @param scene owning spatial scene
 * @param group a static physics group the solid sprites are added to
 * @param specs the decorations to place
 * @returns a handle whose destroy() removes all placed sprites + bodies
 */
export function placeDecoration(
  scene: Phaser.Scene,
  group: Phaser.Physics.Arcade.StaticGroup,
  specs: DecorationSpec[],
): DecorationHandle {
  const sprites: Phaser.GameObjects.Image[] = [];

  for (const spec of specs) {
    const sprite =
      spec.frame !== undefined
        ? scene.add.image(spec.x, spec.y, spec.atlasKey, spec.frame)
        : scene.add.image(spec.x, spec.y, spec.atlasKey);
    sprite.setDepth(spec.depth ?? 4);

    if (spec.solid) {
      group.add(sprite, true); // add to the static group + refresh the body
      const body = sprite.body as Phaser.Physics.Arcade.StaticBody;
      if (spec.bodyInset) {
        const inset = spec.bodyInset;
        body.setSize(sprite.width - inset * 2, sprite.height - inset * 2);
        body.setOffset(inset, inset);
      }
    }
    sprites.push(sprite);
  }

  return {
    destroy() {
      for (const s of sprites) {
        group.remove(s, true, true);
        s.destroy();
      }
    },
  };
}
