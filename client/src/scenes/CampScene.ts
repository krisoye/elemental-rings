import Phaser from 'phaser';
import { CANVAS_W } from '../Constants';
import { InventoryGrid, type RingData } from '../objects/InventoryGrid';
import { LoadoutPanel, type LoadoutSlot } from '../objects/LoadoutPanel';
import { StakePanel } from '../objects/StakePanel';

declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = WS.replace(/^ws/, 'http');

/**
 * Camp screen — ring inventory, loadout management, sleep/recharge, and stake
 * (Thumb slot). This is the hub between auth and the Encounter overworld.
 *
 * Architecture: purely presentational. All persistence lives on the server.
 * The scene GETs /api/me on load and after every mutation, and PUTs /api/loadout
 * for slot assignments.
 */
export class CampScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private goldDayText!: Phaser.GameObjects.Text;
  private inventoryGrid!: InventoryGrid;
  private loadoutPanel!: LoadoutPanel;
  private stakePanel!: StakePanel;
  private ringMap: Map<string, RingData> = new Map();

  constructor() {
    super({ key: 'CampScene' });
  }

  create(): void {
    window.__scene = this;

    // ── Title & navigation ────────────────────────────────────────────────
    this.add.text(10, 24, 'CAMP', { fontSize: '22px', color: '#ffffff' });

    this.add
      .text(CANVAS_W - 124, 20, '▶ Encounter', { fontSize: '16px', color: '#aaffaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToEncounter());

    this.goldDayText = this.add.text(10, 48, 'Day: — | Gold: —', {
      fontSize: '14px',
      color: '#ffdd66',
    });

    // ── Divider line ──────────────────────────────────────────────────────
    this.add.rectangle(CANVAS_W / 2, 62, CANVAS_W, 2, 0x444444);

    // ── Loadout panel (top-left) ──────────────────────────────────────────
    this.loadoutPanel = new LoadoutPanel(this, 10, 70, (slot: LoadoutSlot) =>
      this.assignSlot(slot),
    );

    // ── Stake panel (thumb, next to loadout) ─────────────────────────────
    this.stakePanel = new StakePanel(this, 175, 70, () => this.assignSlot('thumb'));

    // ── Inventory grid (right side) ───────────────────────────────────────
    this.inventoryGrid = new InventoryGrid(this, 340, 70, (_ring) => {
      // Selection handled internally; no extra action needed on select.
    });

    // ── Sleep button ──────────────────────────────────────────────────────
    const sleepBtn = this.add
      .text(10, 435, '[Sleep]', { fontSize: '16px', color: '#88ccff' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doSleep());

    // ── Recharge button ───────────────────────────────────────────────────
    this.add
      .text(200, 435, '[Recharge (10g/use)]', { fontSize: '14px', color: '#ffcc44' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doRechargeSelected());

    // Keep the sleep button ref to allow greying later (future enhancement).
    void sleepBtn;

    // ── Status text ───────────────────────────────────────────────────────
    this.statusText = this.add.text(10, 480, '', { fontSize: '13px', color: '#ff8888' });

    // ── E2E hooks ─────────────────────────────────────────────────────────
    window.__campGoEncounter = (): void => this.goToEncounter();
    window.__campSleep = (): void => void this.doSleep();
    window.__campRecharge = (ringId: string): Promise<void> => this.doRechargeById(ringId);

    this.events.once('shutdown', () => {
      window.__campGoEncounter = undefined;
      window.__campSleep = undefined;
      window.__campRecharge = undefined;
      window.__campState = undefined;
      window.__scene = null;
    });

    // ── Initial data load ─────────────────────────────────────────────────
    void this.loadData();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /** Fetch /api/me and repopulate all UI panels. */
  private async loadData(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    let data: { player: any; rings: RingData[]; loadout: Record<string, string | null> };
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        localStorage.removeItem('er_token');
        this.scene.start('LoginScene');
        return;
      }
      if (!res.ok) {
        this.setStatus(`Failed to load data (${res.status})`);
        return;
      }
      data = await res.json();
    } catch {
      this.setStatus('Network error — could not reach server');
      return;
    }

    this.setStatus('');

    const { player, rings, loadout } = data;

    this.goldDayText.setText(`Day: ${player.game_day ?? 0} | Gold: ${player.gold ?? 0}`);

    this.ringMap = new Map(rings.map((r) => [r.id, r]));

    this.inventoryGrid.populate(rings);
    this.loadoutPanel.updateFromLoadout(loadout, this.ringMap);
    this.stakePanel.updateFromLoadout(loadout.thumb ?? null, this.ringMap);

    window.__campState = { player, rings, loadout };
  }

  // ── Slot assignment ───────────────────────────────────────────────────────

  /** Assign the currently selected ring to the given slot via PUT /api/loadout. */
  private async assignSlot(slot: 'thumb' | LoadoutSlot): Promise<void> {
    const ring = this.inventoryGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring first');
      return;
    }
    if (ring.escrowed) {
      this.setStatus('Ring is locked in a duel');
      return;
    }

    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ [slot]: ring.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Assignment failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during assignment');
      return;
    }

    this.inventoryGrid.clearSelection();
    void this.loadData();
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────

  /** POST /api/camp/sleep — advance game_day and recharge all rings. */
  private async doSleep(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/camp/sleep`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Sleep failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during sleep');
      return;
    }

    void this.loadData();
  }

  // ── Recharge ──────────────────────────────────────────────────────────────

  /** Recharge the currently selected ring. Called by the Recharge button. */
  private async doRechargeSelected(): Promise<void> {
    const ring = this.inventoryGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring to recharge');
      return;
    }
    await this.doRechargeById(ring.id);
  }

  /**
   * POST /api/camp/recharge for a specific ring id. On 200 reloads data.
   * On 400 shows the error message from the server.
   */
  async doRechargeById(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/camp/recharge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ringId }),
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? 'Recharge not available');
        return;
      }
      if (!res.ok) {
        this.setStatus(`Recharge failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during recharge');
      return;
    }

    void this.loadData();
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  private goToEncounter(): void {
    this.scene.start('EncounterScene');
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.setText(msg);
  }
}
