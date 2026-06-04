import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../Constants';
import { ElementEnum } from '../../../shared/types';
import { isFusion, componentsOf, isFusionEligibleParent, MIN_FUSION_PARENT_XP } from '../../../shared/fusions';
import type { RingData } from './InventoryGrid';
import { createOverlay } from './ui/ModalShell';
import { crispCanvasText } from './ui/DomLabel';

/** A single previewable fusion: its two base-element parents and its result. */
interface FusionRecipe {
  parents: [number, number]; // two base element indices
  result: number; // fusion element index
}

// The 10 Tier 2 fusion recipes (GDD §5.2), derived from the shared fusion model
// (isFusion / componentsOf) rather than a duplicated table. Every element index
// 0..SHADOW that isFusion() reports is one of the 10 cross-element fusions; its
// componentsOf() pair is the [first, second] parent ordering. Display-only — the
// server (POST /api/fusion/combine) is the sole authority on what fuses.
const FUSION_RECIPES: ReadonlyArray<FusionRecipe> = Array.from(
  { length: ElementEnum.SHADOW + 1 },
  (_, el) => el,
)
  .filter((el) => isFusion(el))
  .map((el) => {
    const [a, b] = componentsOf(el);
    return { parents: [a, b] as [number, number], result: el };
  });

/**
 * A pair of fusion-eligible parent rings chosen for a recipe slot, paired with
 * whether the recipe can currently be fused: both parents owned, each independently
 * ≥ 500 XP (Tier 1), and neither a fusion ring (#390 dropped the same-tier rule).
 * The server is the authority; this is a display-only preview.
 */
interface RecipeAvailability {
  recipe: FusionRecipe;
  parentA: RingData | null; // a ≥ 500-XP, non-fusion ring of parents[0], if owned
  parentB: RingData | null; // a ≥ 500-XP, non-fusion ring of parents[1], if owned
  ready: boolean; // both parents present and each ≥ 500 XP
}

/**
 * Modal overlay listing all 10 fusion recipes (GDD §4.6 / §5.2). For each it
 * shows which eligible parent rings (each ≥ 500 XP / Tier 1, #390 — no same-tier
 * requirement) the player owns; when both are available a [Fuse] button POSTs the
 * pair via the supplied callback. The server is the authority — this panel only
 * previews availability.
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

    // Shared modal scaffold (backdrop + panel + title + canonical ✕). The fusion
    // panel is re-parented to uiCam by CampScene (routeToUi), so it keeps its
    // depth-3000 ordering rather than the shell default.
    const { container } = createOverlay(this.scene, {
      width: 720,
      height: 520,
      title: 'FUSE RINGS',
      onClose: () => this.close(),
      depth: 3000,
      panelColor: 0x1d1d2e,
      strokeColor: 0xcc88ff,
    });
    // #382 — Container child → crispCanvasText.
    const subtitle = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, 76, `Each ring must reach Tier 1 (${MIN_FUSION_PARENT_XP} XP)`, {
          fontSize: '12px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5),
    );

    container.add([subtitle]);

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
    // #382 — Container child → crispCanvasText.
    const status = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, CANVAS_H / 2 + 230, '', { fontSize: '13px', color: '#ff8888' })
        .setOrigin(0.5)
        .setName('fusion-status'),
    );
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
   * #390 — for each recipe, pick one fusion-eligible parent ring of each parent
   * element. A ring is eligible when it is NOT itself a fusion and independently
   * clears the Tier-1 floor (xp ≥ 500). The same-tier requirement was dropped, so
   * the two chosen parents may sit at different tiers. Among a parent element's
   * eligible rings the highest-XP one is preferred (a stable, sensible default).
   * Mirrors the server gate; the server (POST /api/fusion/combine) is authoritative.
   */
  private computeAvailability(rings: RingData[]): RecipeAvailability[] {
    // Eligible non-fusion rings grouped by base element, highest XP first so each
    // recipe picks the most-leveled candidate of each parent element.
    const byElement = new Map<number, RingData[]>();
    for (const r of rings) {
      // #390 — shared per-parent gate: ≥ MIN_FUSION_PARENT_XP and not itself a fusion.
      if (!isFusionEligibleParent(r.element, r.xp)) continue;
      const list = byElement.get(r.element) ?? [];
      list.push(r);
      byElement.set(r.element, list);
    }
    for (const list of byElement.values()) list.sort((a, b) => b.xp - a.xp);
    return FUSION_RECIPES.map((recipe) => {
      const [ea, eb] = recipe.parents;
      const parentA = byElement.get(ea)?.[0] ?? null;
      const parentB = byElement.get(eb)?.[0] ?? null;
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
    // #382 — all recipe-row labels are Container children → crispCanvasText.
    const label = `${ELEMENT_NAMES[ea]}+${ELEMENT_NAMES[eb]} → ${ELEMENT_NAMES[avail.recipe.result]}`;
    const labelColor = avail.ready ? '#ffffff' : '#888888';
    const labelText = crispCanvasText(
      this.scene.add.text(x, y, label, { fontSize: '13px', color: labelColor }),
    );
    container.add(labelText);

    if (avail.ready && avail.parentA && avail.parentB) {
      const a = avail.parentA;
      const b = avail.parentB;
      const fuseBtn = crispCanvasText(
        this.scene.add
          .text(x + 250, y, '[Fuse]', { fontSize: '13px', color: '#aaffaa' })
          .setName(`fuse-btn-${avail.recipe.result}`)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => void this.handleFuse(a.id, b.id)),
      );
      container.add(fuseBtn);
    } else {
      // Show which parent(s) are missing / not maxed.
      const missing: string[] = [];
      if (!avail.parentA) missing.push(ELEMENT_NAMES[ea]);
      if (!avail.parentB) missing.push(ELEMENT_NAMES[eb]);
      const hint = crispCanvasText(
        this.scene.add.text(x + 250, y, `need ${missing.join(' & ')}`, {
          fontSize: '11px',
          color: '#aa6666',
        }),
      );
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
