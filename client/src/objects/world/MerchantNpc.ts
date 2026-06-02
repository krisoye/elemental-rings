import Phaser from 'phaser';
import { WorldInteractable } from './WorldInteractable';
import { CHARSET_KEY, CHARSET_IDLE_COL, charsetFrame } from './charset';

/** Charset character indices used for merchant NPCs (cycled per merchant on a screen). */
const MERCHANT_CHARS = [4, 6];

/**
 * A merchant NPC in the overworld (GDD §10.11). Draws a character sprite from the
 * shared charset ({@link ./charset}) at the Tiled object position and wraps an
 * {@link InteractionZone} so the player can walk up and press E to open the shop.
 * Pressing E fires the supplied `onInteract` callback, which opens the MerchantModal.
 *
 * Follows the Waystone.ts sprite+InteractionZone pattern. The charset sheet is
 * loaded by the owning scene (via Player.preload in loadCommonAssets).
 */
export class MerchantNpc extends WorldInteractable {
  /** Center of the merchant in world coordinates. */
  readonly center: { x: number; y: number };

  private readonly body: Phaser.GameObjects.Sprite;
  private readonly label: Phaser.GameObjects.Text;

  /**
   * @param scene owning spatial scene
   * @param obj the Tiled `merchant` rectangle object (x/y top-left, in px)
   * @param onInteract fired on E / interact while this merchant is the active zone
   * @param charIndexHint stable index (e.g. the merchant's ordinal on the screen) used
   *   to pick a distinct charset character so multiple merchants don't look identical
   */
  constructor(
    scene: Phaser.Scene,
    obj: Phaser.Types.Tilemaps.TiledObject,
    onInteract: () => void,
    charIndexHint = 0,
  ) {
    const x = obj.x ?? 0;
    const y = obj.y ?? 0;
    const w = obj.width ?? 32;
    const h = obj.height ?? 32;
    // InteractionZone (via the WorldInteractable base): covers the Tiled object
    // rectangle; "Press E" prompt. The zone is named `merchant-${x}-${y}` so it
    // matches the body sprite's name and can show "Trade [E]" via a future
    // prompt override.
    super(scene, { ...obj, name: `merchant-${x}-${y}` }, onInteract);
    this.center = { x: x + w / 2, y: y + h / 2 };

    // Character sprite (idle, facing down) from the shared charset sheet. Origin at
    // bottom-center so the 16×32 figure's feet sit on the object's center point.
    const char = MERCHANT_CHARS[charIndexHint % MERCHANT_CHARS.length];
    this.body = scene.add
      .sprite(this.center.x, this.center.y + h / 2, CHARSET_KEY, charsetFrame(char, 'down', CHARSET_IDLE_COL))
      .setOrigin(0.5, 1)
      .setDepth(6)
      .setName(`merchant-${x}-${y}`);

    // Floating "Merchant" label above the sprite's head.
    this.label = scene.add
      .text(this.center.x, this.center.y - h / 2 - 6, 'Merchant', {
        fontSize: '11px',
        color: '#f5e070',
        backgroundColor: '#000000bb',
        padding: { x: 4, y: 2 },
      })
      .setOrigin(0.5, 1)
      .setDepth(6);
  }

  /**
   * The world-space display objects owned by this merchant (the body rect + name
   * label) plus the wrapped InteractionZone's display objects. Returned so the
   * owning scene can tell the UI camera to ignore them (#137) — the MerchantNpc
   * sprite is a WORLD object (it zooms with the main camera). The MerchantModal
   * shop UI it opens is handled separately via cameras.main.ignore(container).
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.body, this.label, ...this._zone.displayObjects];
  }

  /** Destroy owned game objects + the wrapped zone (on scene shutdown). */
  destroy(): void {
    this._zone.destroy();
    this.body.destroy();
    this.label.destroy();
  }
}
