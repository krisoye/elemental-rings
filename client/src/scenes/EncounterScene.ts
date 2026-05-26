import Phaser from 'phaser';
import { connectToRoom } from '../net/Connection';
import type { AIPersonality } from '../../../shared/types';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES } from '../Constants';
import type { RingData } from '../objects/InventoryGrid';

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
type BattleSlot = (typeof BATTLE_SLOTS)[number];

declare const __SERVER_URL__: string;
const _WS_ENC = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = _WS_ENC.replace(/^ws/, 'http');

type Choice = AIPersonality | 'PVP';

interface MarkerSpec {
  choice: Choice;
  label: string;
  fallbackColor: number;
}

const MARKERS: MarkerSpec[] = [
  { choice: 'AGGRESSIVE',    label: 'Aggressive',    fallbackColor: 0xff4400 },
  { choice: 'DEFENSIVE',     label: 'Defensive',     fallbackColor: 0x0088ff },
  { choice: 'STATUS_HUNTER', label: 'Status-hunter', fallbackColor: 0x44bb00 },
  { choice: 'RESILIENT',     label: 'Resilient',     fallbackColor: 0x886600 },
  { choice: 'PVP',           label: 'PvP',           fallbackColor: 0x999999 },
];

/**
 * Static overworld hub (§10.3 approach → agree → duel → return). Fetches
 * /api/encounter/preview on create to color each AI marker by their randomized
 * staked ring element. Selecting a marker connects to the appropriate room.
 *
 * E2E hook: window.__encounterSelect(choice) is the same code path as a click.
 */
export class EncounterScene extends Phaser.Scene {
  private busy = false;
  private statusText!: Phaser.GameObjects.Text;
  // Battle-hand management modal state (#40). Holds the carried rings, the
  // current loadout, and the open modal container.
  private manageModal: Phaser.GameObjects.Container | null = null;
  private manageSelectedRingId: string | null = null;
  private manageRings: RingData[] = [];
  private manageLoadout: Record<string, string | null> = {};

  constructor() {
    super({ key: 'EncounterScene' });
  }

  init(): void {
    this.busy = false;
    this.manageModal = null;
    this.manageSelectedRingId = null;
  }

  create(): void {
    this.add
      .text(CANVAS_W / 2, 40, 'ENCOUNTER — choose an opponent', {
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5);

    // Player avatar placeholder (center).
    this.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, 70, 110, 0x335577).setStrokeStyle(2, 0xaaccee);
    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 70, 'YOU', { fontSize: '16px', color: '#aaccee' })
      .setOrigin(0.5);

    // Build markers at fixed positions; fill with fallback colors immediately,
    // then update colors + stake labels once the preview fetch resolves.
    const spacing = CANVAS_W / (MARKERS.length + 1);
    const markerY = 170;

    const rects: Map<Choice, Phaser.GameObjects.Rectangle> = new Map();
    const stakeLabels: Map<Choice, Phaser.GameObjects.Text> = new Map();

    MARKERS.forEach((m, i) => {
      const x = spacing * (i + 1);

      const rect = this.add
        .rectangle(x, markerY, 90, 110, m.fallbackColor, 0.85)
        .setStrokeStyle(2, 0xffffff)
        .setInteractive({ useHandCursor: true });
      rects.set(m.choice, rect);

      // Personality label
      this.add
        .text(x, markerY - 40, m.label, { fontSize: '13px', color: '#ffffff' })
        .setOrigin(0.5);

      // Stake element label (filled in after preview fetch)
      const stakeLabel = this.add
        .text(x, markerY + 30, m.choice === 'PVP' ? '' : '…', {
          fontSize: '11px',
          color: '#ffffffaa',
        })
        .setOrigin(0.5);
      stakeLabels.set(m.choice, stakeLabel);

      rect.on('pointerdown', () => this.select(m.choice));
    });

    this.add
      .text(20, 20, '◀ Camp', { fontSize: '16px', color: '#aaffaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.scene.start('CampScene'));

    // Manage Battle Hand — reassign carried rings to battle slots without
    // returning to camp. Modal has NO Sleep/Recharge actions (#40).
    this.add
      .text(CANVAS_W - 200, 20, '⚔ Manage Battle Hand', { fontSize: '14px', color: '#ffcc88' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.openManageBattleHand());

    this.statusText = this.add
      .text(CANVAS_W / 2, CANVAS_H - 40, '', { fontSize: '16px', color: '#ffff88' })
      .setOrigin(0.5);

    // Deterministic E2E hook — identical code path to a marker click.
    window.__encounterSelect = (choice: Choice): void => {
      this.select(choice);
    };
    // Same path, plus AI-strength overrides so a test can force the outcome
    // (aiHearts:1 → guaranteed win; aiHearts:99 → guaranteed loss).
    window.__encounterSelectWithOverrides = (
      choice: Choice,
      aiOverrides?: { aiHearts?: number; aiUses?: number },
    ): void => {
      this.select(choice, aiOverrides);
    };
    window.__encounterManageBattleHand = (): void => void this.openManageBattleHand();
    this.events.once('shutdown', () => {
      window.__encounterSelect = undefined;
      window.__encounterSelectWithOverrides = undefined;
      window.__encounterManageBattleHand = undefined;
    });

    // Fetch stake preview and update marker colors + labels.
    void this.loadPreview(rects, stakeLabels);
  }

  /** Fetch /api/encounter/preview and recolor AI markers by stake element. */
  private async loadPreview(
    rects: Map<Choice, Phaser.GameObjects.Rectangle>,
    stakeLabels: Map<Choice, Phaser.GameObjects.Text>,
  ): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/api/encounter/preview`);
      if (!res.ok) return;
      const preview: Record<string, number> = await res.json();

      for (const [personality, element] of Object.entries(preview)) {
        const rect = rects.get(personality as Choice);
        const label = stakeLabels.get(personality as Choice);
        if (!rect || !label) continue;
        const color = ELEMENT_COLORS[element] ?? 0x888888;
        rect.setFillStyle(color, 0.85);
        label.setText(`Stakes: ${ELEMENT_NAMES[element] ?? '?'}`);
      }
    } catch {
      // Non-fatal — markers keep their fallback colors.
    }
  }

  /** Single entry point for both real marker clicks and the E2E hook. */
  private select(choice: Choice, aiOverrides?: { aiHearts?: number; aiUses?: number }): void {
    if (this.busy) return;
    this.busy = true;

    if (choice === 'PVP') {
      this.scene.start('LobbyScene');
      return;
    }

    this.statusText.setText(`Approaching ${choice}...`);
    void this.startAIDuel(choice, aiOverrides);
  }

  /**
   * Connect to a fresh vsAI room, then hand off to the BattleScene. `aiOverrides`
   * (deterministic E2E only — see BattleRoomOptions) forces the duel's outcome by
   * weakening or hardening the AI; production marker clicks never pass them.
   */
  private async startAIDuel(
    personality: AIPersonality,
    aiOverrides?: { aiHearts?: number; aiUses?: number },
  ): Promise<void> {
    const token = localStorage.getItem('er_token') ?? '';
    try {
      await fetch(`${API_BASE}/api/stake/lock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch { /* non-fatal */ }
    const room = await connectToRoom('battle-ai', {
      vsAI: true,
      personality,
      token,
      ...aiOverrides,
    });

    let transitioned = false;
    const onState = (state: any): void => {
      // Hand off to BattleScene once the duel is live (ATTACK_SELECT) — or if it
      // already ENDED before we saw ATTACK_SELECT (e.g. an instant forfeit by a
      // depleted AI), so BattleScene can still show the result and return to camp.
      if ((state.phase === 'ATTACK_SELECT' || state.phase === 'ENDED') && !transitioned) {
        transitioned = true;
        room.onStateChange.remove(onState);
        this.scene.start('BattleScene');
      }
    };
    room.onStateChange(onState);
  }

  // ── Manage Battle Hand modal (#40) ─────────────────────────────────────────

  /**
   * Fetch /api/me and open the battle-hand reassignment modal. Only carried
   * rings (in_carry = 1) are offered; selecting one then clicking a slot PUTs
   * /api/loadout. No Sleep/Recharge here — purely loadout-slot editing.
   */
  private async openManageBattleHand(): Promise<void> {
    if (this.manageModal) return;
    const token = localStorage.getItem('er_token');
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: { rings: RingData[]; loadout: Record<string, string | null> } =
        await res.json();
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.manageLoadout = data.loadout ?? {};
    } catch {
      return;
    }
    this.renderManageModal();
  }

  /** Render (or re-render) the manage-battle-hand modal from cached state. */
  private renderManageModal(): void {
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }

    const container = this.add.container(0, 0).setDepth(2000);
    const overlay = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setInteractive();
    const panel = this.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 640, 380, 0x222233)
      .setStrokeStyle(2, 0xffcc88);
    const title = this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 165, 'Manage Battle Hand', {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    const close = this.add
      .text(CANVAS_W / 2 + 290, CANVAS_H / 2 - 170, '✕', { fontSize: '18px', color: '#ff8888' })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.closeManageModal());
    container.add([overlay, panel, title, close]);

    // Battle slots row (top).
    const slotY = CANVAS_H / 2 - 110;
    BATTLE_SLOTS.forEach((slot, i) => {
      const sx = CANVAS_W / 2 - 240 + i * 120;
      const ringId = this.manageLoadout[slot] ?? null;
      const ring = ringId ? this.manageRings.find((r) => r.id === ringId) : null;
      const color = ring ? ELEMENT_COLORS[ring.element] ?? 0x333333 : 0x333333;
      const slotRect = this.add
        .rectangle(sx, slotY, 90, 70, color)
        .setStrokeStyle(2, 0x888888)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void this.assignManageSlot(slot));
      const slotLbl = this.add
        .text(sx, slotY - 42, slot.toUpperCase(), { fontSize: '11px', color: '#cccccc' })
        .setOrigin(0.5);
      const elemLbl = this.add
        .text(sx, slotY, ring ? ELEMENT_NAMES[ring.element] ?? '?' : '—', {
          fontSize: '11px',
          color: ring ? '#000000' : '#888888',
        })
        .setOrigin(0.5);
      container.add([slotRect, slotLbl, elemLbl]);
    });

    // Carried rings row (selectable) — exclude rings already in a battle slot so
    // the player only sees spare carried rings available for assignment.
    const slottedIds = new Set(Object.values(this.manageLoadout).filter(Boolean) as string[]);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    const ringY = CANVAS_H / 2 + 40;
    this.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 30, 'Carried rings (select one, then a slot):', {
        fontSize: '12px',
        color: '#aaccff',
      })
      .setOrigin(0.5);
    availableRings.forEach((ring, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const rx = CANVAS_W / 2 - 250 + col * 90;
      const ry = ringY + row * 70;
      const selected = this.manageSelectedRingId === ring.id;
      const rect = this.add
        .rectangle(rx, ry, 72, 56, ELEMENT_COLORS[ring.element] ?? 0x444444)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0xffff00 : 0x888888)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          this.manageSelectedRingId = selected ? null : ring.id;
          this.renderManageModal();
        });
      const lbl = this.add
        .text(rx, ry, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '10px', color: '#000000' })
        .setOrigin(0.5);
      container.add([rect, lbl]);
    });

    this.manageModal = container;
  }

  /** Assign the selected carried ring to a battle slot via PUT /api/loadout. */
  private async assignManageSlot(slot: BattleSlot): Promise<void> {
    if (!this.manageSelectedRingId) {
      this.statusText.setText('Select a carried ring first');
      return;
    }
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [slot]: this.manageSelectedRingId }),
      });
      if (!res.ok) return;
      // Refresh loadout from the response so the modal re-renders accurately.
      const meRes = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meRes.ok) {
        const data: { rings: RingData[]; loadout: Record<string, string | null> } =
          await meRes.json();
        this.manageRings = data.rings.filter((r) => r.in_carry === 1);
        this.manageLoadout = data.loadout ?? {};
      }
    } catch {
      return;
    }
    this.manageSelectedRingId = null;
    this.renderManageModal();
  }

  private closeManageModal(): void {
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    this.manageSelectedRingId = null;
  }
}
