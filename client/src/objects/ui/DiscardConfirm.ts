import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../../Constants';
import type { RingData } from '../InventoryGrid';

/**
 * #423 — Shared discard-confirm dialog. Extracted from BattleHandOverlay so sanctum
 * and shrine-fusion modes can also offer a discard path via the DISCARD slot in BHC.
 *
 * Usage:
 *   const dc = new DiscardConfirm(scene);
 *   dc.open(ring, ringId, () => doDelete(), () => cancelFn());
 */
export class DiscardConfirm {
  private container: Phaser.GameObjects.Container | null = null;
  private keyHandlers: (() => void) | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly onModalRender?: (c: Phaser.GameObjects.Container) => void,
  ) {}

  /**
   * Open the confirm dialog for the given ring. onConfirm is called on [Discard]/Y;
   * onCancel is called on [Cancel]/N. No-op if a confirm dialog is already open.
   */
  open(
    ring: RingData | null,
    _ringId: string,
    onConfirm: () => void,
    onCancel: () => void,
  ): void {
    if (this.container) return;
    const en = ring ? (ELEMENT_NAMES[ring.element] ?? '?') : '?';
    const tier = ring ? ring.tier : '?';
    const bg = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 460, 110, 0x000000, 0.9)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xff4444);
    const txt = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 20, `Discard ${en} T${tier} ring? Permanent.`, {
        fontSize: '16px', color: '#ffdddd',
      })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const yBtn = this.scene.add
      .text(CANVAS_W / 2 - 70, CANVAS_H / 2 + 22, '[Discard]', {
        fontSize: '15px', color: '#ff8888',
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setName('discard-confirm-yes')
      .on('pointerdown', () => { this.dismiss(); onConfirm(); });
    const nBtn = this.scene.add
      .text(CANVAS_W / 2 + 70, CANVAS_H / 2 + 22, '[Cancel]', {
        fontSize: '15px', color: '#aaccff',
      })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .setName('discard-confirm-no')
      .on('pointerdown', () => { this.dismiss(); onCancel(); });
    const p = this.scene.add.container(0, 0, [bg, txt, yBtn, nBtn]).setDepth(3000);
    this.onModalRender?.(p);
    this.container = p;
    window.__discardConfirmOpen = true;
    const kb = this.scene.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      const yk = kb.addKey(KC.Y);
      const nk = kb.addKey(KC.N);
      const onY = (): void => { this.dismiss(); onConfirm(); };
      const onN = (): void => { this.dismiss(); onCancel(); };
      yk.on('down', onY);
      nk.on('down', onN);
      this.keyHandlers = () => { yk.off('down', onY); nk.off('down', onN); };
    }
  }

  /** Dismiss and destroy the confirm dialog. */
  dismiss(): void {
    this.keyHandlers?.();
    this.keyHandlers = null;
    this.container?.destroy(true);
    this.container = null;
    window.__discardConfirmOpen = false;
  }

  /** Whether the confirm dialog is currently open. */
  isOpen(): boolean {
    return this.container !== null;
  }

  /** Live confirm container (E2E bridge — tests find the yes/no buttons via getAll()). */
  get container_(): Phaser.GameObjects.Container | null {
    return this.container;
  }
}
