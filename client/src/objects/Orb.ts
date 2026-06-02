import Phaser from 'phaser';
import { ELEMENT_COLORS, TELEGRAPH_MS, BLOCK_WINDOW_MS } from '../Constants';

/**
 * A handle to one in-flight orb telegraph (the 1–2 component circles fired by a
 * single `Orb.launch`). Returned so the caller can react to the orb mid-flight —
 * notably the EPIC #264 parry-disperse, where orb 2 is scattered instead of
 * impacting when orb 1 is parried.
 */
export interface OrbHandle {
  /**
   * EPIC #264 / #267 — disperse this orb in flight (the returning rally counter
   * intercepts it): cancel its travel tween, then scatter + fade its circles so
   * it visibly dissipates instead of landing an impact. Idempotent.
   */
  disperse(): void;
}

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
  ): OrbHandle {
    window.__orbLaunchCount = (window.__orbLaunchCount ?? 0) + 1;
    // Track this launch's circles + travel tweens so the orb can be dispersed
    // mid-flight (parry-disperse). Once an orb impacts, its entry is cleared.
    const circles: Phaser.GameObjects.Arc[] = [];
    const travelTweens: Phaser.Tweens.Tween[] = [];
    let dispersed = false;

    elements.forEach((el, idx) => {
      const offset = (idx - (elements.length - 1) / 2) * 18;
      const orb = scene.add.circle(from.x, from.y + offset, 10, ELEMENT_COLORS[el]);
      circles.push(orb);
      const tween = scene.tweens.add({
        targets: orb,
        x: to.x,
        y: to.y + offset,
        duration: TELEGRAPH_MS,
        ease: 'Linear',
        onComplete: () => {
          orb.destroy();
          const i = circles.indexOf(orb);
          if (i >= 0) circles.splice(i, 1);
          // Skip the impact pulse if the orb was dispersed (it no longer lands).
          if (dispersed) return;
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
      travelTweens.push(tween);
    });

    return {
      disperse(): void {
        if (dispersed) return;
        dispersed = true;
        travelTweens.forEach((t) => t.remove());
        circles.forEach((orb) => {
          // Scatter the circle outward + fade, then destroy. The random spread
          // reads as the orb being knocked apart by the returning counter.
          const dx = Phaser.Math.Between(-50, 50);
          const dy = Phaser.Math.Between(-50, 50);
          scene.tweens.add({
            targets: orb,
            x: orb.x + dx,
            y: orb.y + dy,
            scaleX: 0,
            scaleY: 0,
            alpha: 0,
            duration: 260,
            ease: 'Quad.easeOut',
            onComplete: () => orb.destroy(),
          });
        });
        circles.length = 0;
      },
    };
  }
}
