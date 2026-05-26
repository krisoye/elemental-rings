import Phaser from 'phaser';
import { CANVAS_W, ELEMENT_NAMES } from '../Constants';
import { InventoryGrid, type RingData } from '../objects/InventoryGrid';
import { LoadoutPanel, type LoadoutSlot } from '../objects/LoadoutPanel';
import { StakePanel } from '../objects/StakePanel';

declare const __SERVER_URL__: string;

const WS = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = WS.replace(/^ws/, 'http');

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;

/**
 * Camp / Sanctum screen — three carry pools (At Sanctum / Loadout / Battle Hand),
 * sleep & spirit recharge, and the post-battle won-ring prompt.
 *
 * Architecture: purely presentational. Every game rule (carry cap, spirit cost,
 * ownership) is enforced by the server. The scene GETs /api/me on load and after
 * every mutation, and PUTs /api/carry / /api/loadout / POSTs spirit routes.
 *
 * Pools (issue #40):
 *   - At Sanctum  = in_carry === 0
 *   - Loadout     = in_carry === 1 and NOT in a battle slot
 *   - Battle Hand = the 5 named slots (thumb/a1/a2/d1/d2), a subset of carry
 */
export class CampScene extends Phaser.Scene {
  private statusText!: Phaser.GameObjects.Text;
  private statLineText!: Phaser.GameObjects.Text;
  private loadoutHeaderText!: Phaser.GameObjects.Text;
  private sanctumGrid!: InventoryGrid;
  private loadoutGrid!: InventoryGrid;
  private loadoutPanel!: LoadoutPanel;
  private stakePanel!: StakePanel;
  private ringMap: Map<string, RingData> = new Map();

  // Cached snapshot of the last /api/me load, used by the carry buttons and
  // won-ring resolution to compute the new carried set without a refetch.
  private rings: RingData[] = [];
  private loadout: Record<string, string | null> = {};
  private carryCap = 10;

  // Active modal container (won-ring prompt). Tracked so we can tear it down.
  private modal: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: 'CampScene' });
  }

  create(): void {
    window.__scene = this;

    // ── Title & navigation ────────────────────────────────────────────────
    this.add.text(10, 18, 'SANCTUM', { fontSize: '22px', color: '#ffffff' });

    this.add
      .text(CANVAS_W - 120, 18, 'Set Out →', { fontSize: '16px', color: '#aaffaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.goToEncounter());

    this.statLineText = this.add.text(10, 44, 'Day: — | Gold: — | Food: — | Spirit: —/—', {
      fontSize: '14px',
      color: '#ffdd66',
    });

    // ── Column headers ────────────────────────────────────────────────────
    this.add.rectangle(CANVAS_W / 2, 66, CANVAS_W, 2, 0x444444);
    this.add.text(10, 74, 'At Sanctum', { fontSize: '14px', color: '#cccccc' });
    this.loadoutHeaderText = this.add.text(360, 74, 'Loadout (0/10)', {
      fontSize: '14px',
      color: '#cccccc',
    });
    this.add.text(710, 74, 'Battle Hand', { fontSize: '14px', color: '#cccccc' });

    // ── Left: At Sanctum (in_carry = 0) ──────────────────────────────────
    this.sanctumGrid = new InventoryGrid(this, 10, 100, () => {
      // Selecting here clears the loadout-grid selection (single active source).
      this.loadoutGrid.clearSelection();
    });

    // ── Center: Loadout (carried, not in a battle slot) ──────────────────
    this.loadoutGrid = new InventoryGrid(this, 360, 100, () => {
      this.sanctumGrid.clearSelection();
    });

    // ── Right: Battle Hand (thumb + A/D slots) ───────────────────────────
    this.stakePanel = new StakePanel(this, 710, 100, () => this.assignSlot('thumb'));
    this.loadoutPanel = new LoadoutPanel(this, 800, 100, (slot: LoadoutSlot) =>
      this.assignSlot(slot),
    );

    // ── Carry move buttons ────────────────────────────────────────────────
    this.add
      .text(10, 380, '[Add to Loadout]', { fontSize: '14px', color: '#aaffaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.addSelectedToLoadout());
    this.add
      .text(360, 380, '[Leave at Sanctum]', { fontSize: '14px', color: '#ffaaaa' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.leaveSelectedAtSanctum());

    // ── Sleep / recharge buttons ──────────────────────────────────────────
    this.add
      .text(10, 435, '[Sleep (25 food)]', { fontSize: '16px', color: '#88ccff' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doSleep());
    this.add
      .text(200, 435, '[Recharge]', { fontSize: '14px', color: '#ffcc44' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doRechargeSelected());
    this.add
      .text(320, 435, '[Recharge All]', { fontSize: '14px', color: '#ffcc44' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doRechargeAll());

    // ── Status text ───────────────────────────────────────────────────────
    this.statusText = this.add.text(10, 480, '', { fontSize: '13px', color: '#ff8888' });

    // ── E2E hooks ─────────────────────────────────────────────────────────
    window.__campGoEncounter = (): void => this.goToEncounter();
    window.__campSleep = (): void => void this.doSleep();
    window.__campRecharge = (ringId: string): Promise<void> => this.doRechargeById(ringId);
    window.__campRechargeAll = (): Promise<void> => this.doRechargeAll();
    window.__campAddToLoadout = (ringId: string): Promise<void> => this.moveToCarry(ringId, true);
    window.__campLeaveAtSanctum = (ringId: string): Promise<void> =>
      this.moveToCarry(ringId, false);
    window.__campResolveWonRing = (choice, displaceRingId): Promise<void> =>
      this.resolveWonRing(choice, displaceRingId);

    this.events.once('shutdown', () => {
      window.__campGoEncounter = undefined;
      window.__campSleep = undefined;
      window.__campRecharge = undefined;
      window.__campRechargeAll = undefined;
      window.__campAddToLoadout = undefined;
      window.__campLeaveAtSanctum = undefined;
      window.__campResolveWonRing = undefined;
      window.__campState = undefined;
      window.__scene = null;
    });

    // ── Initial data load ─────────────────────────────────────────────────
    void this.loadData();
  }

  // ── Data loading ──────────────────────────────────────────────────────────

  /** Fetch /api/me and repopulate all three pools. */
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
    this.rings = rings;
    this.loadout = loadout ?? {};
    this.carryCap = player.carry_cap ?? 10;
    this.ringMap = new Map(rings.map((r) => [r.id, r]));

    this.refreshPools(player);

    // Resolve any pending won ring from the just-finished battle.
    const pending = localStorage.getItem('er_pending_ring');
    if (pending && !this.modal) this.showWonRingModal(pending);
  }

  /** Split rings into the three pools and repopulate the UI from current state. */
  private refreshPools(player: any): void {
    this.statLineText.setText(
      `Day: ${player.game_day ?? 0} | Gold: ${player.gold ?? 0} | ` +
        `Food: ${player.food_units ?? 0} | ` +
        `Spirit: ${player.spirit_current ?? 0}/${player.spirit_max ?? 0}`,
    );

    const battleHandIds = new Set(
      BATTLE_SLOTS.map((s) => this.loadout[s]).filter(Boolean) as string[],
    );
    const atSanctum = this.rings.filter((r) => r.in_carry === 0);
    const loadoutPool = this.rings.filter((r) => r.in_carry === 1 && !battleHandIds.has(r.id));
    const carriedCount = this.rings.filter((r) => r.in_carry === 1).length;

    this.sanctumGrid.populate(atSanctum);
    this.loadoutGrid.populate(loadoutPool);
    this.loadoutPanel.updateFromLoadout(this.loadout, this.ringMap);
    this.stakePanel.updateFromLoadout(this.loadout.thumb ?? null, this.ringMap);

    this.loadoutHeaderText.setText(`Loadout (${carriedCount}/${this.carryCap})`);

    window.__campState = {
      player,
      rings: this.rings,
      loadout: this.loadout,
      atSanctum,
      loadout_pool: loadoutPool,
      battleHand: BATTLE_SLOTS.map((s) => this.loadout[s])
        .filter(Boolean)
        .map((id) => this.ringMap.get(id as string))
        .filter(Boolean) as RingData[],
      carry_cap: this.carryCap,
      spirit_current: player.spirit_current ?? 0,
      spirit_max: player.spirit_max ?? 0,
      food_units: player.food_units ?? 0,
      pendingWonRing: window.__campState?.pendingWonRing ?? null,
    };
  }

  // ── Carry moves (#40) ───────────────────────────────────────────────────

  /** Add the selected At-Sanctum ring to the loadout (carry), if there's room. */
  private async addSelectedToLoadout(): Promise<void> {
    const ring = this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring at the Sanctum first');
      return;
    }
    await this.moveToCarry(ring.id, true);
  }

  /** Leave the selected loadout ring at the Sanctum (clear in_carry). */
  private async leaveSelectedAtSanctum(): Promise<void> {
    const ring = this.loadoutGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a loadout ring first');
      return;
    }
    await this.moveToCarry(ring.id, false);
  }

  /**
   * Set a ring's carried state via PUT /api/carry. Computes the new carried set
   * from the cached snapshot and lets the server enforce the cap & ownership.
   */
  private async moveToCarry(ringId: string, inCarry: boolean): Promise<void> {
    const carried = new Set(this.rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    if (inCarry) {
      if (carried.size >= this.carryCap) {
        this.setStatus('Loadout is full — leave a ring at the Sanctum first');
        return;
      }
      carried.add(ringId);
    } else {
      carried.delete(ringId);
    }
    await this.putCarry(Array.from(carried));
  }

  /** PUT /api/carry with the full carried set, then reload. */
  private async putCarry(ringIds: string[]): Promise<boolean> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return false;
    }
    try {
      const res = await fetch(`${API_BASE}/api/carry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringIds }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        this.setStatus(body?.error ?? `Carry update failed (${res.status})`);
        return false;
      }
    } catch {
      this.setStatus('Network error during carry update');
      return false;
    }
    this.sanctumGrid.clearSelection();
    this.loadoutGrid.clearSelection();
    await this.loadData();
    return true;
  }

  // ── Battle-slot assignment ─────────────────────────────────────────────────

  /**
   * Assign the currently selected ring to a battle slot. Battle slots only
   * accept carried (in_carry = 1) rings; selecting an At-Sanctum ring is
   * rejected with a hint.
   */
  private async assignSlot(slot: 'thumb' | LoadoutSlot): Promise<void> {
    const ring = this.loadoutGrid.getSelected() ?? this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a carried ring first');
      return;
    }
    if (ring.escrowed) {
      this.setStatus('Ring is locked in a duel');
      return;
    }
    if (ring.in_carry !== 1) {
      this.setStatus('Add the ring to your loadout before assigning a battle slot');
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
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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

    this.sanctumGrid.clearSelection();
    this.loadoutGrid.clearSelection();
    await this.loadData();
  }

  // ── Sleep ─────────────────────────────────────────────────────────────────

  /** POST /api/camp/sleep — spend food, restore spirit, advance the day. */
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
    await this.loadData();
  }

  // ── Recharge (#41 spirit) ───────────────────────────────────────────────────

  /** Recharge the currently selected ring (from either grid). */
  private async doRechargeSelected(): Promise<void> {
    const ring = this.loadoutGrid.getSelected() ?? this.sanctumGrid.getSelected();
    if (!ring) {
      this.setStatus('Select a ring to recharge');
      return;
    }
    await this.doRechargeById(ring.id);
  }

  /** POST /api/spirit/recharge for a specific ring id (full top-off). */
  async doRechargeById(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
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
    await this.loadData();
  }

  /** POST /api/spirit/recharge-all — fill carried rings in priority order. */
  async doRechargeAll(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.setStatus(`Recharge-all failed (${res.status})`);
        return;
      }
    } catch {
      this.setStatus('Network error during recharge-all');
      return;
    }
    await this.loadData();
  }

  // ── Post-battle won-ring prompt (#40) ───────────────────────────────────────

  /** Render the won-ring modal for the given ring id (from er_pending_ring). */
  private showWonRingModal(ringId: string): void {
    const ring = this.ringMap.get(ringId);
    if (!ring) {
      // Ring not in our inventory (shouldn't happen) — clear and bail.
      localStorage.removeItem('er_pending_ring');
      return;
    }

    const carriedCount = this.rings.filter((r) => r.in_carry === 1).length;
    const hasRoom = carriedCount < this.carryCap;
    const elementName = ELEMENT_NAMES[ring.element] ?? '?';

    const container = this.add.container(0, 0).setDepth(2000);
    const overlay = this.add
      .rectangle(CANVAS_W / 2, 288, CANVAS_W, 576, 0x000000, 0.7)
      .setInteractive();
    const panel = this.add.rectangle(CANVAS_W / 2, 288, 460, 240, 0x222233).setStrokeStyle(2, 0xffcc44);
    const title = this.add
      .text(CANVAS_W / 2, 210, `You won a ${elementName} ring!`, {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5);
    container.add([overlay, panel, title]);

    if (hasRoom) {
      container.add(
        this.modalButton(CANVAS_W / 2, 270, '[Add to Loadout]', '#aaffaa', () =>
          void this.resolveWonRing('add'),
        ),
      );
      container.add(
        this.modalButton(CANVAS_W / 2, 305, '[Leave at Sanctum]', '#cccccc', () =>
          void this.resolveWonRing('leave'),
        ),
      );
      container.add(
        this.modalButton(CANVAS_W / 2, 340, '[Discard]', '#ff8888', () =>
          void this.resolveWonRing('discard'),
        ),
      );
    } else {
      // Carry full: a Swap displaces a carried ring (returns to Sanctum, not lost).
      const carriedRings = this.rings.filter((r) => r.in_carry === 1);
      container.add(
        this.add
          .text(CANVAS_W / 2, 250, 'Loadout full — Swap (click a carried ring to displace):', {
            fontSize: '11px',
            color: '#ffdd66',
          })
          .setOrigin(0.5),
      );
      carriedRings.forEach((cr, i) => {
        const col = i % 5;
        const row = Math.floor(i / 5);
        const bx = CANVAS_W / 2 - 160 + col * 80;
        const by = 280 + row * 24;
        container.add(
          this.modalButton(bx, by, `${ELEMENT_NAMES[cr.element] ?? '?'}`, '#ffaa66', () =>
            void this.resolveWonRing('add', cr.id),
          ),
        );
      });
      container.add(
        this.modalButton(CANVAS_W / 2 - 90, 345, '[Leave at Sanctum]', '#cccccc', () =>
          void this.resolveWonRing('leave'),
        ),
      );
      container.add(
        this.modalButton(CANVAS_W / 2 + 90, 345, '[Discard]', '#ff8888', () =>
          void this.resolveWonRing('discard'),
        ),
      );
    }

    this.modal = container;
    if (window.__campState) window.__campState.pendingWonRing = { ringId, element: ring.element };
  }

  private modalButton(
    x: number,
    y: number,
    label: string,
    color: string,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, label, { fontSize: '14px', color })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
  }

  /**
   * Resolve the won-ring prompt. Always clears er_pending_ring afterward.
   *   - add (room):   carry the won ring.
   *   - add (full):   carry the won ring and displace `displaceRingId` → Sanctum.
   *   - leave:        keep the won ring in inventory, uncarried.
   *   - discard:      permanently delete the won ring.
   */
  private async resolveWonRing(
    choice: 'add' | 'leave' | 'discard',
    displaceRingId?: string,
  ): Promise<void> {
    const ringId = localStorage.getItem('er_pending_ring');
    if (!ringId) {
      this.dismissModal();
      return;
    }

    if (choice === 'discard') {
      await this.discardRing(ringId);
    } else if (choice === 'add') {
      const carried = new Set(this.rings.filter((r) => r.in_carry === 1).map((r) => r.id));
      if (displaceRingId) carried.delete(displaceRingId); // displaced → Sanctum
      carried.add(ringId);
      await this.putCarry(Array.from(carried));
    }
    // 'leave' is a no-op server-side: the won ring is already uncarried.

    localStorage.removeItem('er_pending_ring');
    if (window.__campState) window.__campState.pendingWonRing = null;
    this.dismissModal();
    await this.loadData();
  }

  /** DELETE /api/rings/:id — permanently discard a won ring. */
  private async discardRing(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      await fetch(`${API_BASE}/api/rings/${ringId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.setStatus('Network error during discard');
    }
  }

  private dismissModal(): void {
    if (this.modal) {
      this.modal.destroy(true);
      this.modal = null;
    }
  }

  // ── Navigation / helpers ────────────────────────────────────────────────────

  private goToEncounter(): void {
    this.scene.start('EncounterScene');
  }

  private setStatus(msg: string): void {
    if (this.statusText) this.statusText.setText(msg);
  }
}
