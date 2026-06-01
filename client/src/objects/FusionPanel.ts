import Phaser from 'phaser';
import {
  CANVAS_W,
  CANVAS_H,
  ELEMENT_NAMES,
  FUSION_RECIPES,
  type FusionRecipe,
} from '../Constants';
import type { RingData } from './InventoryGrid';

/**
 * A pair of fusion-eligible parent rings chosen for a recipe slot, paired with
 * whether the recipe can currently be fused (both parents owned, at least Tier 2,
 * and sharing the same tier per GDD §4.6). The server is the authority; this is a
 * display-only preview.
 */
interface RecipeAvailability {
  recipe: FusionRecipe;
  parentA: RingData | null; // a Tier ≥ 2 ring of parents[0], if owned
  parentB: RingData | null; // a same-tier ring of parents[1], if owned
  ready: boolean; // both parents present and same tier
}

/**
 * Modal overlay listing all 10 fusion recipes (GDD §4.6 / §5.2). For each it
 * shows which eligible parent rings (same tier, Tier 2 or higher) the player
 * owns; when both are available a [Fuse] button POSTs the pair via the supplied
 * callback. The server is the authority — this panel only previews availability.
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

  /**
   * Open (or re-render) the panel for the given ring inventory.
   *
   * @param rings the player's full ring inventory (display-only preview).
   * @param filterElement #231 — when provided, only the recipe whose RESULT
   *   element equals this value is shown (all others are hidden). Used by the
   *   Fusion Shrine to pre-filter the modal to the shrine's element (e.g. Thornado
   *   = Wood+Wind). Omitted → the full 10-recipe grid (the CampScene workshop).
   */
  open(rings: RingData[], filterElement?: number): void {
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
      .text(CANVAS_W / 2, 76, 'Both rings must be the same tier and reach Tier 2', {
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

    // #231 — when a filterElement is supplied, restrict the grid to the single
    // recipe whose RESULT element matches (the Fusion Shrine pre-filter). The
    // server remains the authority; this only narrows what the panel previews.
    const availability = this.computeAvailability(rings).filter(
      (a) => filterElement === undefined || a.recipe.result === filterElement,
    );

    // Two columns of five recipe rows (or one row when shrine-filtered).
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
   * For each recipe, pick a pair of fusion-eligible (Tier ≥ 2) parent rings — one
   * of each parent element — that share the SAME tier (GDD §4.6). Eligible rings
   * are grouped by element; for a recipe we pick the lowest shared tier for which
   * both parent elements have an owned ring. The two parents are always distinct
   * instances (all recipes are cross-element). The server is the authority; this
   * only previews availability.
   */
  private computeAvailability(rings: RingData[]): RecipeAvailability[] {
    // Eligible rings grouped by element, then by tier, so a recipe can pick a
    // same-tier pair across its two parent elements.
    const byElement = new Map<number, Map<number, RingData[]>>();
    for (const r of rings) {
      if (r.tier < 2) continue;
      const byTier = byElement.get(r.element) ?? new Map<number, RingData[]>();
      const list = byTier.get(r.tier) ?? [];
      list.push(r);
      byTier.set(r.tier, list);
      byElement.set(r.element, byTier);
    }
    return FUSION_RECIPES.map((recipe) => {
      const [ea, eb] = recipe.parents;
      const tiersA = byElement.get(ea);
      const tiersB = byElement.get(eb);
      let parentA: RingData | null = null;
      let parentB: RingData | null = null;
      if (tiersA && tiersB) {
        // Pick the lowest tier both parent elements share an eligible ring at.
        const sharedTiers = [...tiersA.keys()]
          .filter((t) => tiersB.has(t))
          .sort((x, y) => x - y);
        const tier = sharedTiers[0];
        if (tier !== undefined) {
          parentA = tiersA.get(tier)![0];
          parentB = tiersB.get(tier)![0];
        }
      }
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
