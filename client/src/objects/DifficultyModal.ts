import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H } from '../Constants';
import { crispCanvasText } from './ui/DomLabel';
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

/** Options for the DifficultyModal constructor (EPIC #279). */
export interface DifficultyModalOpts {
  /**
   * Called when the player taps the [Restart Game] button. The modal closes
   * BEFORE the callback fires so the owner can open the confirm dialog into a
   * clean slate. Optional — omit to hide the button entirely.
   */
  onRestartGame?: () => void;
}

/**
 * The five selectable difficulty tiers, ordered easiest → hardest. Multipliers
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
  {
    tier: 'ascetic',
    label: 'Ascetic',
    description: 'Every spirit point counts — recharge and travel are deliberate acts',
  },
  {
    tier: 'void',
    label: 'Void',
    description: 'Spirit is bone-dry — every ring use and step is a commitment',
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
  private readonly opts: DifficultyModalOpts;
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
   * @param opts optional extended config (e.g. onRestartGame callback — #477).
   */
  constructor(
    scene: Phaser.Scene,
    apiBase: string,
    getToken: () => string | null,
    onSelected: (tier: DifficultyTier, spiritMax: number) => void,
    onClose: (container: Phaser.GameObjects.Container | null) => void,
    opts: DifficultyModalOpts = {},
  ) {
    this.scene = scene;
    this.apiBase = apiBase;
    this.getToken = getToken;
    this.onSelected = onSelected;
    this.onClose = onClose;
    this.opts = opts;
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

    // #477 — expand the panel height when the Restart Game button is shown.
    const hasRestart = typeof this.opts.onRestartGame === 'function';
    const panelH = hasRestart ? 540 : 460;

    const container = this.scene.add.container(0, 0).setDepth(3000);
    // Dimmed backdrop: clicking it (outside the panel) dismisses with no change.
    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setName('difficulty-backdrop')
      .setInteractive()
      .on('pointerdown', () => this.close());
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 560, panelH, 0x161622)
      .setStrokeStyle(2, 0x6082aa);
    // #382 — all these labels are Container children → crispCanvasText.
    const title = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, 72, 'DIFFICULTY', { fontSize: '20px', color: '#ffffff' })
        .setOrigin(0.5),
    );
    const subtitle = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, 96, 'Spirit scarcity scales with your chosen tier', {
          fontSize: '12px',
          color: '#aaaaaa',
        })
        .setOrigin(0.5),
    );
    const closeBtn = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2 + 260, 66, '[×]', { fontSize: '16px', color: '#ff8888' })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.close()),
    );

    container.add([backdrop, panel, title, subtitle, closeBtn]);

    const startY = 118;
    const rowH = 70;
    TIER_ROWS.forEach((row, idx) => {
      this.renderTierRow(container, startY + idx * rowH, row, current);
    });

    // #477 — Danger zone: separator + [Restart Game] button below the tier list.
    if (hasRestart) {
      const dangerSepY = startY + TIER_ROWS.length * rowH + 12;
      const restartBtnY = dangerSepY + 30;

      const dangerSep = crispCanvasText(
        this.scene.add
          .text(CANVAS_W / 2, dangerSepY, '──── Danger ────', {
            fontSize: '12px',
            color: '#884444',
          })
          .setOrigin(0.5)
          .setName('difficulty-danger-sep'),
      );

      const restartBtn = crispCanvasText(
        this.scene.add
          .text(CANVAS_W / 2, restartBtnY, '[Restart Game]', {
            fontSize: '15px',
            color: '#ff4444',
          })
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .setName('difficulty-restart-btn'),
      );
      restartBtn.on('pointerdown', () => {
        this.close();
        this.opts.onRestartGame!();
      });

      container.add([dangerSep, restartBtn]);
    }

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
    const cardH = 62;
    const card = this.scene.add
      .rectangle(CANVAS_W / 2, y + cardH / 2, cardW, cardH, isCurrent ? 0x2a3550 : 0x202030)
      .setStrokeStyle(2, isCurrent ? 0xffdd66 : 0x6082aa)
      .setName(`difficulty-card-${row.tier}`)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.handleSelect(row.tier, isCurrent));
    container.add(card);

    const multiplier = DIFFICULTY_MULTIPLIERS[row.tier];
    // #382 — tier-row labels are Container children → crispCanvasText.
    const heading = crispCanvasText(
      this.scene.add
        .text(
          CANVAS_W / 2 - cardW / 2 + 16,
          y + 10,
          `${row.label}  ×${multiplier}${isCurrent ? '   (current)' : ''}`,
          { fontSize: '16px', color: isCurrent ? '#ffdd66' : '#ffffff' },
        )
        .setName(`difficulty-label-${row.tier}`),
    );
    container.add(heading);

    const desc = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2 - cardW / 2 + 16, y + 36, row.description, {
          fontSize: '12px',
          color: '#bbbbbb',
          wordWrap: { width: cardW - 32 },
        })
        .setName(`difficulty-desc-${row.tier}`),
    );
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
