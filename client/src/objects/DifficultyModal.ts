import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import {
  DIFFICULTY_MULTIPLIERS,
  type DifficultyTier,
} from '../../../shared/types';

/** Display copy for one difficulty tier row (EPIC #279, GDD §15.1). */
interface TierRow {
  tier: DifficultyTier;
  label: string; // capitalised display name
  description: string; // one-line spirit feel
}

/**
 * The three selectable difficulty tiers, ordered easiest → hardest. Multipliers
 * are read from the shared DIFFICULTY_MULTIPLIERS so the "×N" badge never drifts
 * from the server's spirit_max formula.
 */
const TIER_ROWS: readonly TierRow[] = [
  {
    tier: 'wanderer',
    label: 'Wanderer',
    description: 'Spirit is a backdrop — focus on rings and battles',
  },
  {
    tier: 'seeker',
    label: 'Seeker',
    description: 'Meaningful choices — spirit matters but rarely desperate',
  },
  {
    tier: 'ascendant',
    label: 'Ascendant',
    description: 'Spirit is always on your mind',
  },
];

/**
 * Settings → difficulty selector (EPIC #279, #284). A self-contained modal
 * overlay (same lifecycle shape as FusionPanel) listing the three tiers; the
 * player's current tier is highlighted. Selecting a different tier PUTs
 * /api/difficulty, receives the recomputed spirit_max, and reports both back to
 * the owning scene via `onSelected` so it can refresh the live stats displays.
 *
 * The server is the authority — the modal never computes spirit_max itself; it
 * only sends the chosen tier and forwards whatever the server returns. Clicking
 * the current tier, the [×] button, or the dimmed backdrop dismisses without a
 * change.
 */
export class DifficultyModal {
  private readonly scene: Phaser.Scene;
  private readonly apiBase: string;
  private readonly getToken: () => string | null;
  private readonly onSelected: (tier: DifficultyTier, spiritMax: number) => void;
  private readonly onClose: (container: Phaser.GameObjects.Container | null) => void;
  private container: Phaser.GameObjects.Container | null = null;

  /**
   * @param scene owning Phaser scene.
   * @param apiBase REST base URL (e.g. CampScene's API_BASE).
   * @param getToken supplies the current bearer token for the PUT (or null).
   * @param onSelected called after a successful tier change with the new tier
   *   and server-computed spirit_max, BEFORE the modal closes, so the scene can
   *   update its local state and re-render the stats header.
   * @param onClose called when the modal is dismissed, BEFORE the container is
   *   destroyed, with the live container (or null) so the owner can clear a
   *   camera ignore flag (#118) before teardown.
   */
  constructor(
    scene: Phaser.Scene,
    apiBase: string,
    getToken: () => string | null,
    onSelected: (tier: DifficultyTier, spiritMax: number) => void,
    onClose: (container: Phaser.GameObjects.Container | null) => void,
  ) {
    this.scene = scene;
    this.apiBase = apiBase;
    this.getToken = getToken;
    this.onSelected = onSelected;
    this.onClose = onClose;
  }

  /** True while the modal is open. */
  isOpen(): boolean {
    return this.container !== null;
  }

  /**
   * Return the live container, or null when closed. CampScene re-parents it via
   * `cameras.main.ignore()` so it renders through the UI camera at 1:1 zoom.
   */
  getContainer(): Phaser.GameObjects.Container | null {
    return this.container;
  }

  /**
   * Open (or re-render) the modal, highlighting `current` as the active tier.
   * @param current the player's current difficulty tier (from __campState).
   */
  open(current: DifficultyTier): void {
    this.close();

    const container = this.scene.add.container(0, 0).setDepth(3000);
    // Dimmed backdrop: clicking it (outside the panel) dismisses with no change.
    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setName('difficulty-backdrop')
      .setInteractive()
      .on('pointerdown', () => this.close());
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 560, 360, 0x161622)
      .setStrokeStyle(2, 0x6082aa);
    const title = this.scene.add
      .text(CANVAS_W / 2, 90, 'DIFFICULTY', { fontSize: '20px', color: '#ffffff' })
      .setOrigin(0.5);
    const subtitle = this.scene.add
      .text(CANVAS_W / 2, 118, 'Spirit scarcity scales with your chosen tier', {
        fontSize: '12px',
        color: '#aaaaaa',
      })
      .setOrigin(0.5);
    const closeBtn = this.scene.add
      .text(CANVAS_W / 2 + 260, 84, '[×]', { fontSize: '16px', color: '#ff8888' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());

    container.add([backdrop, panel, title, subtitle, closeBtn]);

    const startY = 160;
    const rowH = 84;
    TIER_ROWS.forEach((row, idx) => {
      this.renderTierRow(container, startY + idx * rowH, row, current);
    });

    this.container = container;
    window.__difficultyState = { current, tiers: TIER_ROWS.map((r) => r.tier) };
  }

  /** Close and destroy the modal (no tier change). */
  close(): void {
    // Notify the owner with the live container BEFORE destroying it so it can
    // clear the main-camera ignore flag (#118) ahead of teardown.
    this.onClose(this.container);
    if (this.container) {
      this.container.destroy(true);
      this.container = null;
    }
    window.__difficultyState = undefined;
  }

  /**
   * Render one tier row: a bordered, clickable card with the tier name, the
   * "×N" multiplier, and the spirit-feel description. The current tier is
   * highlighted with a brighter border + tinted fill and is non-actionable
   * (clicking it just dismisses, like clicking [×]).
   */
  private renderTierRow(
    container: Phaser.GameObjects.Container,
    y: number,
    row: TierRow,
    current: DifficultyTier,
  ): void {
    const isCurrent = row.tier === current;
    const cardW = 480;
    const cardH = 72;
    const card = this.scene.add
      .rectangle(CANVAS_W / 2, y + cardH / 2, cardW, cardH, isCurrent ? 0x2a3550 : 0x202030)
      .setStrokeStyle(2, isCurrent ? 0xffdd66 : 0x6082aa)
      .setName(`difficulty-card-${row.tier}`)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.handleSelect(row.tier, isCurrent));
    container.add(card);

    const multiplier = DIFFICULTY_MULTIPLIERS[row.tier];
    const heading = this.scene.add
      .text(
        CANVAS_W / 2 - cardW / 2 + 16,
        y + 12,
        `${row.label}  ×${multiplier}${isCurrent ? '   (current)' : ''}`,
        { fontSize: '16px', color: isCurrent ? '#ffdd66' : '#ffffff' },
      )
      .setName(`difficulty-label-${row.tier}`);
    container.add(heading);

    const desc = this.scene.add
      .text(CANVAS_W / 2 - cardW / 2 + 16, y + 40, row.description, {
        fontSize: '12px',
        color: '#bbbbbb',
        wordWrap: { width: cardW - 32 },
      })
      .setName(`difficulty-desc-${row.tier}`);
    container.add(desc);
  }

  /**
   * Selecting a tier. Clicking the current tier is a no-op dismiss. Otherwise
   * PUT /api/difficulty, forward the server-computed spirit_max to the owner,
   * then close. On a non-200 / network error the modal stays open so the player
   * can retry; the failure is silent (no local mutation — the server is the
   * authority).
   */
  private async handleSelect(tier: DifficultyTier, isCurrent: boolean): Promise<void> {
    if (isCurrent) {
      this.close();
      return;
    }
    const token = this.getToken();
    if (!token) {
      this.close();
      return;
    }
    let spiritMax: number;
    try {
      const res = await fetch(`${this.apiBase}/api/difficulty`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) return; // leave the modal open for a retry
      const body = (await res.json()) as { difficulty: DifficultyTier; spirit_max: number };
      spiritMax = body.spirit_max;
    } catch {
      return; // network error — stay open
    }
    // Notify the owner BEFORE closing so the stats displays refresh with the new
    // tier + spirit_max while __difficultyState is still meaningful.
    this.onSelected(tier, spiritMax);
    this.close();
  }
}
