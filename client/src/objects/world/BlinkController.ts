import Phaser from 'phaser';
import type { Player } from './Player';
import type { InteractionZone } from './InteractionZone';
import { DOUBLE_CLICK_MS, BLINK_MAX_RANGE } from '../../Constants';
import { apiFetch, getToken } from '../../net/api';

/**
 * Short-range blink (#87 Part A, GDD §12). Double-clicking an interaction zone
 * within BLINK_MAX_RANGE spends spirit (server-computed, cost ∝ distance) to snap
 * the player onto that zone, flash, and fire the zone's interact() in the same
 * gesture. Works in both CampScene (Sanctum interior) and OverworldScene.
 *
 * Targets discrete InteractionZone objects only — not arbitrary map points. A
 * single click, an out-of-range double-click, or a double-click while a modal
 * overlay is open is a no-op (the getModalOpen lambda gates the gesture).
 *
 * The server (POST /api/spirit/blink) is the authoritative spirit guard: this
 * controller posts the travelled distance and only moves the player on a 200.
 */
export class BlinkController {
  private readonly scene: Phaser.Scene;
  private readonly player: Player;
  private readonly getModalOpen: () => boolean;
  /** #112 — optional callback fired after a successful blink (spirit changed), so
   * the host scene can refresh any spirit-dependent HUD. Undefined → no-op. */
  private readonly onBlink?: () => void;
  /** Last pointerdown time (ms) per zone name, for double-click detection. */
  private readonly lastClick = new Map<string, number>();
  private zones: InteractionZone[] = [];
  private pointerHandler: ((p: Phaser.Input.Pointer) => void) | null = null;

  /**
   * @param scene the host spatial scene (CampScene / OverworldScene)
   * @param player the top-down player avatar to snap on a successful blink
   * @param getModalOpen returns true while a modal overlay is open (blink is then
   *   suppressed); shared with Part D's Tab-overlay suppression flag
   * @param onBlink #112 — optional callback fired after a successful blink so the
   *   host scene can refresh spirit-dependent HUD; omit to disable.
   */
  constructor(
    scene: Phaser.Scene,
    player: Player,
    getModalOpen: () => boolean,
    onBlink?: () => void,
  ) {
    this.scene = scene;
    this.player = player;
    this.getModalOpen = getModalOpen;
    this.onBlink = onBlink;
  }

  /**
   * Attach the double-click listener for the given zones. A scene-level pointerdown
   * converts the pointer to world coordinates, finds the containing zone, and
   * tracks per-zone click times: two clicks on the same zone within DOUBLE_CLICK_MS
   * trigger a blink attempt. Also registers the deterministic window.__blink hook.
   */
  register(zones: InteractionZone[]): void {
    this.zones = zones;
    this.pointerHandler = (pointer: Phaser.Input.Pointer): void => {
      if (this.getModalOpen()) return;
      const zone = this.zoneAt(pointer.worldX, pointer.worldY);
      if (!zone) return;
      const now = this.scene.time.now;
      const prev = this.lastClick.get(zone.name) ?? -Infinity;
      this.lastClick.set(zone.name, now);
      if (now - prev <= DOUBLE_CLICK_MS) {
        this.lastClick.delete(zone.name); // consume the gesture
        void this.attemptBlink(zone);
      }
    };
    this.scene.input.on('pointerdown', this.pointerHandler);

    // Deterministic E2E hook — same code path as a double-click on `zoneName`.
    window.__blink = (zoneName: string): Promise<boolean> => {
      if (this.getModalOpen()) return Promise.resolve(false);
      const zone = this.zones.find((z) => z.name === zoneName);
      if (!zone) return Promise.resolve(false);
      return this.attemptBlink(zone);
    };
  }

  /** Find the zone whose rectangle contains the world point, or undefined. */
  private zoneAt(wx: number, wy: number): InteractionZone | undefined {
    return this.zones.find((z) => z.contains(wx, wy));
  }

  /**
   * Attempt a blink onto `zone`: no-op if it is beyond BLINK_MAX_RANGE; otherwise
   * POST /api/spirit/blink with the travelled distance. On 200 snap the player onto
   * the zone center, flash the camera, and fire zone.interact(). On 400 show a
   * "not enough spirit" feedback toast. Returns true only when the blink moved the
   * player.
   */
  private async attemptBlink(zone: InteractionZone): Promise<boolean> {
    const distance = Phaser.Math.Distance.Between(
      this.player.x,
      this.player.y,
      zone.centerX,
      zone.centerY,
    );
    if (distance > BLINK_MAX_RANGE) return false; // out of range — no POST, no move

    if (!getToken()) return false;
    let res: Response;
    try {
      res = await apiFetch('/api/spirit/blink', {
        method: 'POST',
        json: { distance },
      });
    } catch {
      this.showFeedback('Network error during blink');
      return false;
    }

    if (!res.ok) {
      this.showFeedback('Not enough spirit');
      return false;
    }

    // 200 — snap onto the zone, flash, and fire the interaction in one gesture.
    this.player.setPosition(zone.centerX, zone.centerY);
    this.player.halt();
    this.scene.cameras.main.flash(150, 180, 220, 255);
    zone.interact();
    // #112 — spirit was just spent; let the host scene refresh its HUD.
    this.onBlink?.();
    return true;
  }

  /** Brief camera-pinned feedback toast (matches the overlay feedback style). */
  private showFeedback(message: string): void {
    const txt = this.scene.add
      .text(this.scene.cameras.main.width / 2, 110, message, {
        fontSize: '14px',
        color: '#ff8888',
        backgroundColor: '#000000aa',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(1500)
      .setName('blink-feedback');
    this.scene.time.delayedCall(2000, () => {
      if (txt.active) txt.destroy();
    });
  }

  /** Remove listeners and the window hook (host scene shutdown). */
  destroy(): void {
    if (this.pointerHandler) {
      this.scene.input.off('pointerdown', this.pointerHandler);
      this.pointerHandler = null;
    }
    this.lastClick.clear();
    this.zones = [];
    window.__blink = undefined;
  }
}
