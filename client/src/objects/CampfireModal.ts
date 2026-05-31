import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { restAtCamp, summonSanctum } from '../net/campActions';

declare const __SERVER_URL__: string;
const _WS_CFM = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE_CFM = _WS_CFM.replace(/^ws/, 'http');

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
  private statusText: Phaser.GameObjects.Text | null = null;

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
    this.statusText = null;
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
    const c = this.scene.add.container(0, 0).setDepth(4000).setScrollFactor(0);

    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.72)
      .setScrollFactor(0)
      .setInteractive();

    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 420, 280, 0x121218)
      .setStrokeStyle(2, 0x886633)
      .setScrollFactor(0);

    const title = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 110, `🔥 ${anchorageName}`, {
        fontSize: '18px', color: '#ffcc88',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const stats = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 80, `Food: ${food}  |  Spirit: ${spirit}`, {
        fontSize: '13px', color: '#cccccc',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    const closeBtn = this.scene.add
      .text(CANVAS_W / 2 + 185, CANVAS_H / 2 - 120, '[×]', {
        fontSize: '16px', color: '#ff8888',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());

    const restBtn = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 20, '[Rest — 25 food]', {
        fontSize: '15px', color: '#88ddff',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doRest());

    const summonLabel = summonCost === 0
      ? '[Summon Sanctum — free]'
      : `[Summon Sanctum — ${summonCost} spirit]`;
    const summonBtn = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 20, summonLabel, {
        fontSize: '15px', color: '#aaffcc',
      })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doSummon(summonCost));

    this.statusText = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 60, '', {
        fontSize: '13px', color: '#ff8888',
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    c.add([backdrop, panel, title, stats, closeBtn, restBtn, summonBtn, this.statusText]);
    this.container = c;
    this.onRender?.(c);
  }

  private async doRest(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    const result = await restAtCamp(API_BASE_CFM, token);
    if ('error' in result) {
      this.setStatus(result.error, '#ff8888');
      return;
    }
    this.setStatus('Rested! Spirit restored.', '#aaffcc');
    this.onHudRefresh();
  }

  private async doSummon(summonCost: number): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    void summonCost; // cost shown in label; server validates
    const result = await summonSanctum(API_BASE_CFM, token, this.anchorageId);
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
    if (!this.statusText) return;
    this.statusText.setColor(color).setText(msg);
    this.scene.tweens.add({
      targets: this.statusText,
      alpha: { from: 1, to: 0 },
      delay: 2000,
      duration: 600,
      onComplete: () => this.statusText?.setAlpha(1).setText(''),
    });
  }
}
