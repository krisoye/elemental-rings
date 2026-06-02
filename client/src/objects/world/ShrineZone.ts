import Phaser from 'phaser';
import { WorldInteractable } from './WorldInteractable';
import { ELEMENT_NAMES } from '../../Constants';
import { apiFetch, fetchMe, getToken } from '../../net/api';

/** Minimal slice of a /api/me ring row the shrine needs for the ring-key check. */
interface ShrineRing {
  id: string;
  element: number;
  in_carry: number;
}

/** Altar placeholder colours (no dedicated art yet — see class doc). */
const SEALED_COLOR = 0x5a4a6a; // dim purple-grey: locked
const OPEN_COLOR = 0x9b6bdd; // bright violet: unsealed, interactable
const ALTAR_W = 32;
const ALTAR_H = 32;
const ALTAR_DEPTH = 4; // below in-front canopy (5), above ground/player feet

/**
 * #231 — A Fusion Shrine altar (GDD §4.6). Wraps an {@link InteractionZone} and
 * owns the altar's two states:
 *
 *   sealed  — the doors are locked. Pressing E checks the player's carry for a
 *             matching fusion ring-key (element === `shrineElement`). With a key →
 *             a Y/N confirmation overlay → POST /api/shrines/:id/unlock consumes
 *             the key and permanently unseals the altar. Without a key → a toast
 *             ("A Thornado ring is required.").
 *   open    — unsealed. Pressing E fires `onShrineOpen()` (the scene opens the
 *             Fusion crafting modal pre-filtered to the shrine's element).
 *
 * State is server-authoritative: the constructor fetches GET /api/shrines/:id and
 * re-renders the altar to match; a successful unlock flips it to open in place.
 *
 * #232 — an always-open shrine (the Bloom altar) has no seal: pass
 * `alwaysOpen: true` and the altar renders open immediately, skips the
 * GET /api/shrines/:id fetch entirely, and an E press calls `onShrineOpen()`
 * directly with no ring-key / confirmation flow. It is craftable from the first
 * visit for every player, regardless of any Guardian's defeat status.
 *
 * Art note: no dedicated sealed/open altar sprites exist yet, so the altar renders
 * as a coloured placeholder rectangle (dim = sealed, bright = open). Swapping in a
 * real sprite later is a localized change to `renderAltar()`.
 */
export class ShrineZone extends WorldInteractable {
  private readonly scene: Phaser.Scene;
  private readonly shrineId: string;
  private readonly shrineElement: number;
  private readonly onShrineOpen: () => void;
  private readonly alwaysOpen: boolean;
  private readonly centerX: number;
  private readonly centerY: number;

  private unlocked = false;
  private altar: Phaser.GameObjects.Rectangle;
  /** Open confirmation/feedback overlay container, or null when none is shown. */
  private overlay: Phaser.GameObjects.Container | null = null;

  /**
   * @param scene owning spatial biome scene.
   * @param shrineObj the altar rectangle (a Tiled object, or a synthetic
   *   {@link Phaser.Types.Tilemaps.TiledObject} the scene fabricates when the map
   *   has no altar object).
   * @param shrineId stable shrine id (matches the server `:id` path param).
   * @param shrineElement the fusion element this shrine crafts / its ring-key
   *   element (e.g. ElementEnum.THORNADO).
   * @param onShrineOpen fired on E when the altar is already unsealed — the scene
   *   opens the Fusion modal pre-filtered to `shrineElement`.
   * @param alwaysOpen #232 — when true the altar has no seal: it renders open
   *   immediately, skips the server state fetch, and E presses craft directly with
   *   no ring-key / confirmation flow (the Bloom altar).
   */
  constructor(
    scene: Phaser.Scene,
    shrineObj: Phaser.Types.Tilemaps.TiledObject,
    shrineId: string,
    shrineElement: number,
    onShrineOpen: () => void,
    alwaysOpen = false,
  ) {
    // One zone covering the altar (via the WorldInteractable base); its callback
    // dispatches on the live sealed/open state. The arrow only runs
    // post-construction, so referencing `this` here is safe.
    super(scene, shrineObj, () => this.handleInteract(), 'Examine altar [E]');
    this.scene = scene;
    this.shrineId = shrineId;
    this.shrineElement = shrineElement;
    this.onShrineOpen = onShrineOpen;
    this.alwaysOpen = alwaysOpen;

    const x = shrineObj.x ?? 0;
    const y = shrineObj.y ?? 0;
    const w = shrineObj.width || ALTAR_W;
    const h = shrineObj.height || ALTAR_H;
    this.centerX = x + w / 2;
    this.centerY = y + h / 2;

    // An always-open altar (#232) is unsealed from the start; sealed altars start
    // sealed and load their server state. Placeholder sprite starts sealed and is
    // re-coloured by renderAltar() to match the resolved state.
    this.unlocked = alwaysOpen;
    this.altar = scene.add
      .rectangle(this.centerX, this.centerY, ALTAR_W, ALTAR_H, SEALED_COLOR)
      .setStrokeStyle(2, 0x2a1f3a)
      .setDepth(ALTAR_DEPTH);

    if (alwaysOpen) {
      // No seal: render open immediately and skip the GET /api/shrines/:id fetch.
      this.renderAltar();
    } else {
      void this.loadState();
    }
  }

  /**
   * The altar's own world sprite(s) — the {@link InteractionZone}'s display
   * objects are NOT included here (the owning scene's zone registration handles
   * those). Returned so the scene can route the altar to the world camera only.
   */
  get altarObjects(): Phaser.GameObjects.GameObject[] {
    return [this.altar];
  }

  /**
   * The world-space display objects owned by this shrine — the altar sprite plus
   * the wrapped {@link InteractionZone}'s objects — satisfying the
   * {@link WorldInteractable} contract. (Scenes currently route the altar via
   * {@link altarObjects} and register the zone's display separately, so this is
   * an additive convenience.)
   */
  get displayObjects(): Phaser.GameObjects.GameObject[] {
    return [this.altar, ...this._zone.displayObjects];
  }

  /** True once the shrine has been unsealed (for E2E assertions). */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** Fetch GET /api/shrines/:id and reflect the sealed/open state on the altar. */
  private async loadState(): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch(`/api/shrines/${this.shrineId}`);
      if (!res.ok) return;
      const body = (await res.json()) as { unlocked: boolean };
      this.unlocked = body.unlocked;
      this.renderAltar();
    } catch {
      // Leave the altar in its sealed default on a network/auth failure.
    }
  }

  /** Re-colour the altar placeholder to match the current sealed/open state. */
  private renderAltar(): void {
    this.altar.setFillStyle(this.unlocked ? OPEN_COLOR : SEALED_COLOR);
    window.__shrineState = { id: this.shrineId, unlocked: this.unlocked };
  }

  /** E-press dispatcher: open shrines craft; sealed shrines attempt an unseal. */
  private handleInteract(): void {
    if (this.overlay) return; // a confirmation is already up
    if (this.unlocked) {
      this.onShrineOpen();
      return;
    }
    void this.attemptUnseal();
  }

  /**
   * Sealed-altar E press: fetch the player's rings, look for a carried ring-key
   * of the shrine's element, and either prompt for confirmation (have key) or
   * surface the "required" hint (no key).
   */
  private async attemptUnseal(): Promise<void> {
    const key = await this.findRingKey();
    const elementName = ELEMENT_NAMES[this.shrineElement] ?? 'matching';
    if (!key) {
      this.showOverlay(
        `The altar doors are sealed.\nA ${elementName} ring is required.`,
        null,
      );
      return;
    }
    this.showOverlay(
      `Consume your ${elementName} ring to unseal the altar?\n[Y] Confirm    [N] Cancel`,
      key.id,
    );
  }

  /**
   * Return a carried ring whose element matches the shrine (the seal key), or
   * null when the player carries none. Reads /api/me (the canonical ring source).
   */
  private async findRingKey(): Promise<ShrineRing | null> {
    if (!getToken()) return null;
    try {
      const body = await fetchMe<{ rings: ShrineRing[] }>();
      return (
        body.rings.find(
          (r) => r.element === this.shrineElement && r.in_carry === 1,
        ) ?? null
      );
    } catch {
      return null;
    }
  }

  /**
   * Show a centred text overlay. When `ringId` is non-null the overlay is a Y/N
   * confirmation: Y consumes the ring and unseals; N (or any other key) cancels.
   * When `ringId` is null it is a dismissible hint (any key / pointer closes it).
   */
  private showOverlay(text: string, ringId: string | null): void {
    this.closeOverlay();
    const cx = this.scene.scale.width / 2;
    const cy = this.scene.scale.height / 2;
    const container = this.scene.add.container(0, 0).setDepth(3000).setScrollFactor(0);
    const dim = this.scene.add
      .rectangle(cx, cy, this.scene.scale.width, this.scene.scale.height, 0x000000, 0.72)
      .setInteractive();
    const panel = this.scene.add
      .rectangle(cx, cy, 460, 150, 0x1d1d2e)
      .setStrokeStyle(2, 0xcc88ff);
    const label = this.scene.add
      .text(cx, cy, text, {
        fontSize: '15px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: 420 },
      })
      .setOrigin(0.5);
    container.add([dim, panel, label]);
    this.overlay = container;
    // The shrine overlay renders through the UI camera at 1:1 (it lives at the
    // scene root for E2E traversal; the world camera ignores it).
    (this.scene.cameras.main as Phaser.Cameras.Scene2D.Camera).ignore(container);

    const onKey = (e: KeyboardEvent): void => {
      const k = e.key.toLowerCase();
      if (ringId && k === 'y') {
        this.scene.input.keyboard?.off('keydown', onKey);
        void this.confirmUnseal(ringId);
        return;
      }
      // N, Escape, or any key on a hint overlay dismisses it.
      this.scene.input.keyboard?.off('keydown', onKey);
      this.closeOverlay();
    };
    this.scene.input.keyboard?.on('keydown', onKey);
    dim.once('pointerdown', () => {
      this.scene.input.keyboard?.off('keydown', onKey);
      this.closeOverlay();
    });
    window.__shrinePrompt = { id: this.shrineId, confirm: ringId !== null, text };
  }

  /** Destroy the open overlay, if any. */
  private closeOverlay(): void {
    if (this.overlay) {
      this.overlay.destroy(true);
      this.overlay = null;
    }
    window.__shrinePrompt = undefined;
  }

  /**
   * POST /api/shrines/:id/unlock with the chosen ring-key. On success flip the
   * altar to open in place; on failure surface the server's message as a hint.
   */
  private async confirmUnseal(ringId: string): Promise<void> {
    this.closeOverlay();
    if (!getToken()) return;
    try {
      const res = await apiFetch(`/api/shrines/${this.shrineId}/unlock`, {
        method: 'POST',
        json: { ringId },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.showOverlay((body as { error?: string }).error ?? 'Unseal failed.', null);
        return;
      }
      this.unlocked = true;
      this.renderAltar();
      this.showOverlay('The altar doors grind open.\nPress E to craft.', null);
    } catch {
      this.showOverlay('Unseal failed (network error).', null);
    }
  }

  /** Tear down owned game objects on scene shutdown. */
  destroy(): void {
    this.closeOverlay();
    this.altar.destroy();
    this._zone.destroy();
  }
}
