import Phaser from 'phaser';
import { ELEMENT_COLORS, TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../Constants';

/**
 * Visual-only orb telegraph. Launches one or more colored orbs from `from` to
 * `to` over TELEGRAPH_MS, then flashes an impact pulse over BLOCK_WINDOW_MS. The
 * timing mirrors the server's authoritative window purely so the animation lines
 * up — the server, not this animation, decides the block outcome.
 */
export class Orb {
  static launch(
    scene: Phaser.Scene,
    elements: number[],
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): void {
    elements.forEach((el, idx) => {
      const offset = (idx - (elements.length - 1) / 2) * 18;
      const orb = scene.add.circle(from.x, from.y + offset, 10, ELEMENT_COLORS[el]);
      scene.tweens.add({
        targets: orb,
        x: to.x,
        y: to.y + offset,
        duration: TELEGRAPH_MS,
        ease: 'Linear',
        onComplete: () => {
          orb.destroy();
          const pulse = scene.add.circle(to.x, to.y, 20, ELEMENT_COLORS[el], 0.7);
          scene.tweens.add({
            targets: pulse,
            scaleX: 2.5,
            scaleY: 2.5,
            alpha: 0,
            duration: BLOCK_WINDOW_MS,
            ease: 'Quad.easeOut',
            onComplete: () => pulse.destroy(),
          });
        },
      });
    });
  }
}
