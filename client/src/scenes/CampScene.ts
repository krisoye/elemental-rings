import Phaser from 'phaser';
import { CANVAS_W } from '../Constants';
import { InventoryGrid, type RingData } from '../objects/InventoryGrid';
import { LoadoutPanel, type LoadoutSlot } from '../objects/LoadoutPanel';
import { StakePanel } from '../objects/StakePanel';
import { FusionPanel } from '../objects/FusionPanel';
import { ELEMENT_NAMES } from '../Constants';

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
  private fusionPanel!: FusionPanel;
  private ringMap: Map<string, RingData> = new Map();

  // Cached snapshot of the last /api/me load, used by the carry buttons to
  // compute the new carried set without a refetch.
  private rings: RingData[] = [];
  private loadout: Record<string, string | null> = {};
  private carryCap = 10;

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
    this.add
      .text(460, 435, '[Fuse Rings]', { fontSize: '14px', color: '#cc88ff' })
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.openFusionPanel());

    // ── Fusion panel (modal overlay, opened on demand) ──────────────────────
    this.fusionPanel = new FusionPanel(
      this,
      (ringId1, ringId2) => this.doFuse(ringId1, ringId2),
      () => {
        /* closed — no extra cleanup needed */
      },
    );

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
    window.__campOpenFusion = (): void => this.openFusionPanel();
    window.__campFuse = (ringId1: string, ringId2: string): Promise<string | null> =>
      this.doFuse(ringId1, ringId2);

    this.events.once('shutdown', () => {
      window.__campGoEncounter = undefined;
      window.__campSleep = undefined;
      window.__campRecharge = undefined;
      window.__campRechargeAll = undefined;
      window.__campAddToLoadout = undefined;
      window.__campLeaveAtSanctum = undefined;
      window.__campOpenFusion = undefined;
      window.__campFuse = undefined;
      window.__campState = undefined;
      window.__fusionState = undefined;
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
  }

  /** Split rings into the three pools and repopulate the UI from current state. */
  private refreshPools(player: any): void {
    this.statLineText.setText(
      `Day: ${player.game_day ?? 0} | Gold: ${player.gold ?? 0} | ` +
        `Food: ${player.food_units ?? 0} | ` +
        `Spirit: ${player.spirit_current ?? 0}/${player.spirit_max ?? 0} | ` +
        `XP: ${player.aggregate_xp ?? 0}`,
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
      aggregate_xp: player.aggregate_xp ?? 0,
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

  // ── Fusion (#47) ─────────────────────────────────────────────────────────

  /** Open the fusion modal with the current ring inventory snapshot. */
  private openFusionPanel(): void {
    this.fusionPanel.open(this.rings);
  }

  /**
   * POST /api/fusion/combine with the chosen parent ring ids. On success,
   * reloads /api/me and reopens the fusion panel so the new ring is reflected
   * and the consumed parents disappear. Returns null on success or the server's
   * error message on a 400 (surfaced inline by the panel).
   */
  private async doFuse(ringId1: string, ringId2: string): Promise<string | null> {
    const token = localStorage.getItem('er_token');
    if (!token) {
      this.scene.start('LoginScene');
      return 'Not authenticated';
    }
    try {
      const res = await fetch(`${API_BASE}/api/fusion/combine`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId1, ringId2 }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return body?.error ?? `Fusion failed (${res.status})`;
      }
      const { ring } = (await res.json()) as { ring: RingData };
      this.setStatus(`Fusion complete! ${ELEMENT_NAMES[ring.element] ?? 'New'} ring added`);
      // Reload inventory, then reopen the panel (if still open) with fresh data.
      const wasOpen = this.fusionPanel.isOpen();
      await this.loadData();
      if (wasOpen) this.fusionPanel.open(this.rings);
      return null;
    } catch {
      return 'Network error during fusion';
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
