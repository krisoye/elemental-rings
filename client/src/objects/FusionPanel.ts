import Phaser from 'phaser';
import {
  CANVAS_W,
  CANVAS_H,
  ELEMENT_NAMES,
  FUSION_RECIPES,
  TIER1_XP_CAP,
  type FusionRecipe,
} from '../Constants';
import type { RingData } from './InventoryGrid';

/**
 * A maxed Tier-1 parent ring chosen for a recipe slot, paired with whether the
 * recipe can currently be fused (both parents owned & at the XP cap).
 */
interface RecipeAvailability {
  recipe: FusionRecipe;
  parentA: RingData | null; // a maxed ring of parents[0], if owned
  parentB: RingData | null; // a maxed ring of parents[1], if owned
  ready: boolean; // both parents present
}

/**
 * Modal overlay listing all 10 Tier 2 fusion recipes (GDD §5.2). For each it
 * shows which maxed parent rings (Tier 1, xp >= cap) the player owns; when both
 * are available a [Fuse] button POSTs the pair via the supplied callback. The
 * server is the authority — this panel only previews availability.
 *
 * Purely presentational: it never mutates rings itself. `onFuse(ringId1,
 * ringId2)` returns a result message that the panel surfaces inline; the owning
 * scene reloads state and reopens the panel after a successful fusion.
 */
export class FusionPanel {
  private readonly scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container | null = null;
  private readonly onFuse: (ringId1: string, ringId2: string) => Promise<string | null>;
  private readonly onClose: (container: Phaser.GameObjects.Container | null) => void;

  /**
   * @param scene owning Phaser scene.
   * @param onFuse async callback performing the fusion; resolves to an error
   *   message string on failure, or null on success.
   * @param onClose called when the panel is dismissed, BEFORE the container is
   *   destroyed, with the live container (or null if already closed) so the
   *   owner can perform pre-destroy cleanup (e.g. clear a camera ignore flag).
   */
  constructor(
    scene: Phaser.Scene,
    onFuse: (ringId1: string, ringId2: string) => Promise<string | null>,
    onClose: (container: Phaser.GameObjects.Container | null) => void,
  ) {
    this.scene = scene;
    this.onFuse = onFuse;
    this.onClose = onClose;
  }

  /** True while the modal is open. */
  isOpen(): boolean {
    return this.container !== null;
  }

  /**
   * Return the live container, or null when the panel is closed. Used by
   * CampScene to re-parent the container into `uiRoot` after `open()` so it
   * renders through the UI camera at 1:1 zoom rather than the world camera.
   */
  getContainer(): Phaser.GameObjects.Container | null {
    return this.container;
  }

  /** Open (or re-render) the panel for the given ring inventory. */
  open(rings: RingData[]): void {
    this.close();

    const container = this.scene.add.container(0, 0).setDepth(3000);
    const overlay = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setInteractive();
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 720, 520, 0x1d1d2e)
      .setStrokeStyle(2, 0xcc88ff);
    const title = this.scene.add
      .text(CANVAS_W / 2, 50, 'FUSE RINGS', { fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);
    const subtitle = this.scene.add
      .text(CANVAS_W / 2, 76, 'Combine two maxed Tier 1 rings into a Tier 2 fusion', {
        fontSize: '12px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);
    const closeBtn = this.scene.add
      .text(CANVAS_W / 2 + 340, 44, '[×]', { fontSize: '16px', color: '#ff8888' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());

    container.add([overlay, panel, title, subtitle, closeBtn]);

    const availability = this.computeAvailability(rings);

    // Two columns of five recipe rows.
    const startY = 110;
    const rowH = 38;
    availability.forEach((avail, idx) => {
      const col = Math.floor(idx / 5);
      const row = idx % 5;
      const x = CANVAS_W / 2 - 320 + col * 340;
      const y = startY + row * rowH;
      this.renderRecipeRow(container, x, y, avail);
    });

    // Status line for inline error / success feedback.
    const status = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 230, '', { fontSize: '13px', color: '#ff8888' })
      .setOrigin(0.5)
      .setName('fusion-status');
    container.add(status);

    this.container = container;
    this.publishState(availability);
  }

  /** Close and destroy the modal. */
  close(): void {
    // Notify the owner with the live container BEFORE destroying it, so it can
    // run pre-destroy cleanup (e.g. clearing a camera ignore flag, #118).
    this.onClose(this.container);
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
    window.__fusionState = undefined;
  }

  /**
   * For each recipe, pick the first owned maxed (Tier 1, xp >= cap) ring of each
   * parent element. The two parents must be distinct ring instances even when
   * the elements differ (always true here since all recipes are cross-element).
   */
  private computeAvailability(rings: RingData[]): RecipeAvailability[] {
    const maxedByElement = new Map<number, RingData[]>();
    for (const r of rings) {
      if (r.tier === 1 && r.xp >= TIER1_XP_CAP) {
        const list = maxedByElement.get(r.element) ?? [];
        list.push(r);
        maxedByElement.set(r.element, list);
      }
    }
    return FUSION_RECIPES.map((recipe) => {
      const [ea, eb] = recipe.parents;
      const parentA = maxedByElement.get(ea)?.[0] ?? null;
      const parentB = maxedByElement.get(eb)?.[0] ?? null;
      return { recipe, parentA, parentB, ready: parentA !== null && parentB !== null };
    });
  }

  /** Render one recipe row: label, availability, and a Fuse button when ready. */
  private renderRecipeRow(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    avail: RecipeAvailability,
  ): void {
    const [ea, eb] = avail.recipe.parents;
    const label = `${ELEMENT_NAMES[ea]}+${ELEMENT_NAMES[eb]} → ${ELEMENT_NAMES[avail.recipe.result]}`;
    const labelColor = avail.ready ? '#ffffff' : '#888888';
    const labelText = this.scene.add.text(x, y, label, { fontSize: '13px', color: labelColor });
    container.add(labelText);

    if (avail.ready && avail.parentA && avail.parentB) {
      const a = avail.parentA;
      const b = avail.parentB;
      const fuseBtn = this.scene.add
        .text(x + 250, y, '[Fuse]', { fontSize: '13px', color: '#aaffaa' })
        .setName(`fuse-btn-${avail.recipe.result}`)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.handleFuse(a.id, b.id));
      container.add(fuseBtn);
    } else {
      // Show which parent(s) are missing / not maxed.
      const missing: string[] = [];
      if (!avail.parentA) missing.push(ELEMENT_NAMES[ea]);
      if (!avail.parentB) missing.push(ELEMENT_NAMES[eb]);
      const hint = this.scene.add.text(x + 250, y, `need ${missing.join(' & ')}`, {
        fontSize: '11px',
        color: '#aa6666',
      });
      container.add(hint);
    }
  }

  /** Invoke the fuse callback and surface the result inline. */
  private async handleFuse(ringId1: string, ringId2: string): Promise<void> {
    const status = this.container?.getByName('fusion-status') as Phaser.GameObjects.Text | undefined;
    const error = await this.onFuse(ringId1, ringId2);
    if (error) {
      if (status) {
        status.setColor('#ff8888');
        status.setText(error);
      }
      return;
    }
    // Success: the owning scene reloads + reopens with the new inventory.
  }

  /** Expose the recipe availability for deterministic E2E assertions. */
  private publishState(availability: RecipeAvailability[]): void {
    window.__fusionState = {
      recipes: availability.map((a) => ({
        parents: a.recipe.parents,
        result: a.recipe.result,
        ready: a.ready,
        parentAId: a.parentA?.id ?? null,
        parentBId: a.parentB?.id ?? null,
      })),
    };
  }
}
