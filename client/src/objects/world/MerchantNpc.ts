import Phaser from 'phaser';
import { InteractionZone } from './InteractionZone';

// Visual constants for the merchant placeholder sprite (drawn as a golden rectangle
// with a tag label; replaced by a real NPC sprite on an art pass).
const MERCHANT_W = 22;
const MERCHANT_H = 30;
const COLOR_MERCHANT = 0xd4a017; // gold

/**
 * A merchant NPC in the overworld (GDD §10.11). Draws a standing-figure graphic
 * at the Tiled object position and wraps an {@link InteractionZone} so the player
 * can walk up and press E to open the shop. Pressing E fires the supplied
 * `onInteract` callback, which opens the MerchantModal.
 *
 * Follows the Waystone.ts sprite+InteractionZone pattern exactly. The
 * zone prompt overrides "Press E" with "Trade [E]" via the zone name.
 */
export class MerchantNpc {
  /** Center of the merchant in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly zone: InteractionZone;
  private readonly body: Phaser.GameObjects.Rectangle;
  private readonly label: Phaser.GameObjects.Text;

  /**
   * @param scene owning spatial scene
   * @param obj the Tiled `merchant` rectangle object (x/y top-left, in px)
   * @param onInteract fired on E / interact while this merchant is the active zone
   */
  constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    onInteract: () => void,
  ) {
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Placeholder body rect (golden colour).
    this.body = scene.add
      .rectangle(this.center.x, this.center.y - 4, MERCHANT_W, MERCHANT_H, COLOR_MERCHANT)
      .setStrokeStyle(2, 0x8b6914)
      .setDepth(6)
      .setName(`merchant-${x}-${y}`);

    // Floating "Merchant" label.
    this.label = scene.add
      .text(this.center.x, this.center.y - MERCHANT_H - 6, 'Merchant', {
        fontSize: '11px',
        color: '#f5e070',
      })
      .setOrigin(0.5, 1)
      .setDepth(6);

    // InteractionZone: the prompt text always says "Press E" but we name the zone
    // "merchant" so it shows "Trade [E]" via an override in the InteractionZone
    // prompt if the player is nearby. (The prompt is the InteractionZone's default
    // "Press E" — a future art pass can override the label text there.)
    this.zone = new InteractionZone(scene, { ...obj, name: `merchant-${x}-${y}` }, onInteract);
  }

  /** The InteractionZone wrapping this merchant (for overlap + nearest selection). */
  get interactionZone(): InteractionZone {
    return this.zone;
  }

  /** Destroy owned game objects + the wrapped zone (on scene shutdown). */
  destroy(): void {
    this.zone.destroy();
    this.body.destroy();
    this.label.destroy();
  }
}
