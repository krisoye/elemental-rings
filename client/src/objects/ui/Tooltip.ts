import Phaser from 'phaser';
import { crispCanvasText } from './DomLabel';

/**
 * Lazy hover tooltip (EPIC #291 / WS D). Attaches a pointer-driven tooltip to any
 * interactive game object: on `pointerover` it calls `getText()` fresh (so the
 * text always reflects live state), shows a small camera-pinned label near the
 * pointer, and on `pointerout` hides it. The returned `detach()` removes both
 * listeners and destroys the label.
 *
 * Display-only: the tooltip never mutates game state.
 */

/** Tuning for {@link attachTooltip}. */
export interface TooltipOpts {
  /** Horizontal offset of the label from the pointer, in px (default 12). */
  offsetX?: number;
  /** Vertical offset of the label from the pointer, in px (default -12, above). */
  offsetY?: number;
  /** Wrap width for long tooltip text, in px (default 220). */
  maxWidth?: number;
}

/**
 * Show a hover tooltip over `target`. `getText` is invoked lazily on each
 * `pointerover` (NOT at attach time) so the tooltip tracks live state. The target
 * must already be (or be made) interactive by the caller.
 *
 * @returns a `detach()` function that removes the pointerover/pointerout listeners
 *   and destroys the tooltip text object. Safe to call once.
 */
export function attachTooltip(
  scene: Phaser.Scene,
  target: Phaser.GameObjects.GameObject,
  getText: () => string,
  opts?: TooltipOpts,
): () => void {
  const offsetX = opts?.offsetX ?? 12;
  const offsetY = opts?.offsetY ?? -12;
  const maxWidth = opts?.maxWidth ?? 220;

  let label: Phaser.GameObjects.Text | null = null;

  const onOver = (pointer: Phaser.Input.Pointer): void => {
    const txt = getText();
    if (!txt) return;
    if (!label) {
      // #382 — tooltip tracks the pointer (repositioned each frame) and has
      // setScrollFactor(0), so it is screen-fixed but moves dynamically → DOM
      // repositioning is awkward; crispCanvasText is the safe/correct choice.
      label = crispCanvasText(
        scene.add
          .text(0, 0, txt, {
            fontSize: '11px',
            color: '#ffffff',
            backgroundColor: '#000000cc',
            padding: { x: 6, y: 3 },
            wordWrap: { width: maxWidth },
          })
          .setOrigin(0, 1)
          .setScrollFactor(0)
          .setDepth(5000),
      );
    } else {
      label.setText(txt).setVisible(true);
    }
    label.setPosition(pointer.x + offsetX, pointer.y + offsetY);
  };

  const onOut = (): void => {
    label?.setVisible(false);
  };

  target.on('pointerover', onOver);
  target.on('pointerout', onOut);

  return (): void => {
    target.off('pointerover', onOver);
    target.off('pointerout', onOut);
    label?.destroy();
    label = null;
  };
}
