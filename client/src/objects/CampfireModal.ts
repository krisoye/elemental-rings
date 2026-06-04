import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { restAtCamp, summonSanctum } from '../net/campActions';
import { getToken } from '../net/api';
import { createOverlay } from './ui/ModalShell';
import { crispCanvasText } from './ui/DomLabel';

/**
 * Overworld Anchorage campfire overlay (#191).
 *
 * Two actions: [Rest — 25 food] via POST /api/camp/sleep, and
 * [Summon Sanctum — N spirit] via POST /api/sanctum/summon.
 *
 * Mirrors the {@link MerchantModal} camera-routing pattern: the host scene passes
 * an optional `onRender` callback so a dual-camera host can route the container to
 * its 1:1 UI camera.
 */
export class CampfireModal {
  private readonly scene: Phaser.Scene;
  private readonly anchorageId: string;
  private readonly onHudRefresh: () => void;
  private readonly onClose: () => void;
  private readonly onSummonSuccess: (newAnchor: string) => void;
  private readonly onRender?: (container: Phaser.GameObjects.Container) => void;

  private container: Phaser.GameObjects.Container | null = null;
  private setStatusLine: ((msg: string, color?: string) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    anchorageId: string,
    anchorageName: string,
    food: number,
    spirit: number,
    summonCost: number,
    onHudRefresh: () => void,
    onClose: () => void,
    onSummonSuccess: (newAnchor: string) => void,
    onRender?: (container: Phaser.GameObjects.Container) => void,
  ) {
    this.scene = scene;
    this.anchorageId = anchorageId;
    this.onHudRefresh = onHudRefresh;
    this.onClose = onClose;
    this.onSummonSuccess = onSummonSuccess;
    this.onRender = onRender;
    this.render(anchorageName, food, spirit, summonCost);

    // E2E hooks — expose direct action triggers.
    window.__campfireModal = { anchorageId, summonCost };
    window.__campfireRest = () => void this.doRest();
    window.__campfireSummon = () => void this.doSummon(summonCost);
  }

  isOpen(): boolean {
    return this.container !== null;
  }

  close(): void {
    if (!this.container) return;
    this.container.destroy(true);
    this.container = null;
    this.setStatusLine = null;
    window.__campfireModal = null;
    window.__campfireRest = undefined;
    window.__campfireSummon = undefined;
    this.onClose();
  }

  private render(
    anchorageName: string,
    food: number,
    spirit: number,
    summonCost: number,
  ): void {
    // Shared modal scaffold (backdrop + panel + title + canonical ✕ + status line).
    const shell = createOverlay(this.scene, {
      width: 420,
      height: 280,
      title: `🔥 ${anchorageName}`,
      onClose: () => this.close(),
      backdropAlpha: 0.72,
      panelColor: 0x121218,
      strokeColor: 0x886633,
      titleColor: '#ffcc88',
      titleSize: '18px',
      withStatus: true,
    });
    const c = shell.container;
    this.setStatusLine = shell.setStatus;

    // #382 — all three labels are Container children → crispCanvasText.
    const stats = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, CANVAS_H / 2 - 80, `Food: ${food}  |  Spirit: ${spirit}`, {
          fontSize: '13px', color: '#cccccc',
        })
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    const restBtn = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, CANVAS_H / 2 - 20, '[Rest — 25 food]', {
          fontSize: '15px', color: '#88ddff',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.doRest()),
    );

    const summonLabel = summonCost === 0
      ? '[Summon Sanctum — free]'
      : `[Summon Sanctum — ${summonCost} spirit]`;
    const summonBtn = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, CANVAS_H / 2 + 20, summonLabel, {
          fontSize: '15px', color: '#aaffcc',
        })
        .setOrigin(0.5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.doSummon(summonCost)),
    );

    c.add([stats, restBtn, summonBtn]);
    this.container = c;
    this.onRender?.(c);
  }

  private async doRest(): Promise<void> {
    const token = getToken();
    if (!token) return;
    const result = await restAtCamp(token);
    if ('error' in result) {
      this.setStatus(result.error, '#ff8888');
      return;
    }
    this.setStatus('Rested! Spirit restored.', '#aaffcc');
    this.onHudRefresh();
  }

  private async doSummon(summonCost: number): Promise<void> {
    const token = getToken();
    if (!token) return;
    void summonCost; // cost shown in label; server validates
    const result = await summonSanctum(token, this.anchorageId);
    if ('error' in result) {
      this.setStatus(result.error, '#ff8888');
      return;
    }
    this.setStatus(`Sanctum summoned! (cost: ${result.spiritCost} spirit)`, '#aaffcc');
    if (window.__teleportState) {
      (window.__teleportState as { anchor?: string }).anchor = result.anchor;
    }
    this.onHudRefresh();
    this.onSummonSuccess(result.anchor);
  }

  private setStatus(msg: string, color = '#ff8888'): void {
    this.setStatusLine?.(msg, color);
  }
}
