import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../Constants';

declare const __SERVER_URL__: string;
const _WS_MM = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE_MM = _WS_MM.replace(/^ws/, 'http');

type Tab = 'buy' | 'sell';

interface CatalogEntry {
  element: string;
  elementIndex: number;
  tier: number;
  buyPrice: number;
  sellPrice: number;
}

interface Catalog {
  food: { buyPrice: number; sellPrice: number };
  rings: CatalogEntry[];
}

interface RingRecord {
  id: string;
  element: number;
  tier: number;
  current_uses: number;
  max_uses: number;
}

/**
 * Shop modal opened when the player interacts with a MerchantNpc (GDD §10.11).
 *
 * Two-tab panel styled after the CampScene overlays:
 *   - **Buy tab:** food (qty selector) + Tier-1 rings per element
 *   - **Sell tab:** food (qty selector) + carried rings not in battle slots
 *
 * Prices come from GET /api/merchant/catalog (no hardcoded values). Every
 * transaction round-trips to the authoritative server. The modal updates the
 * host's gold + food HUD via the `onHudRefresh` callback after each success.
 * Errors show a brief red toast inside the modal header.
 *
 * Follows the CampScene beginOverlay / closeOverlay architecture: a single
 * Phaser Container at depth 4000 + scrollFactor 0 swallows all input while open.
 */
export class MerchantModal {
  private readonly scene: Phaser.Scene;
  /** Fired after a transaction updates gold/food so the host scene can refresh the HUD. */
  private readonly onHudRefresh: () => void;
  /** Fired when the modal closes (host re-enables movement). */
  private readonly onClose: () => void;

  private container: Phaser.GameObjects.Container | null = null;
  private activeTab: Tab = 'buy';
  private catalog: Catalog | null = null;
  private allRings: RingRecord[] = [];
  private loadout: Record<string, string | null> = {};
  private gold = 0;
  private food = 0;
  private foodQty = 1; // buy/sell qty for food
  private goldText: Phaser.GameObjects.Text | null = null;
  private statusText: Phaser.GameObjects.Text | null = null;

  constructor(scene: Phaser.Scene, onHudRefresh: () => void, onClose: () => void) {
    this.scene = scene;
    this.onHudRefresh = onHudRefresh;
    this.onClose = onClose;
  }

  /** True while the modal is visible. */
  isOpen(): boolean {
    return this.container !== null;
  }

  /** Open the modal; fetch the catalog + player state, then render. */
  async open(): Promise<void> {
    if (this.isOpen()) return;
    window.__merchantModalOpen = true;
    await this.fetchData();
    this.render();
  }

  /** Close the modal and destroy all game objects. */
  close(): void {
    if (!this.container) return;
    this.container.destroy(true);
    this.container = null;
    this.goldText = null;
    this.statusText = null;
    window.__merchantModalOpen = false;
    this.onClose();
  }

  private async fetchData(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const [catRes, meRes] = await Promise.all([
        fetch(`${API_BASE_MM}/api/merchant/catalog`),
        fetch(`${API_BASE_MM}/api/me`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (catRes.ok) this.catalog = (await catRes.json()) as Catalog;
      if (meRes.ok) {
        const meData = (await meRes.json()) as {
          player: { gold: number; food_units: number };
          rings: RingRecord[];
          loadout: Record<string, string | null> | null;
        };
        this.gold = meData.player.gold;
        this.food = meData.player.food_units;
        this.allRings = meData.rings;
        this.loadout = meData.loadout ?? {};
      }
    } catch {
      // Keep defaults.
    }
  }

  private render(): void {
    if (this.container) this.container.destroy(true);

    const c = this.scene.add.container(0, 0).setDepth(4000).setScrollFactor(0);

    // Dark backdrop (swallows clicks behind the panel).
    const backdrop = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.78)
      .setScrollFactor(0)
      .setInteractive();
    // Panel background.
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 700, 430, 0x161622)
      .setStrokeStyle(2, 0x6082aa)
      .setScrollFactor(0);

    // Header: "MERCHANT" + current gold + close button.
    const title = this.scene.add
      .text(CANVAS_W / 2 - 200, 60, 'MERCHANT', { fontSize: '20px', color: '#ffffff' })
      .setScrollFactor(0);
    this.goldText = this.scene.add
      .text(CANVAS_W / 2 + 60, 60, `Gold: ${this.gold}`, { fontSize: '16px', color: '#f5e070' })
      .setScrollFactor(0);
    const closeBtn = this.scene.add
      .text(CANVAS_W / 2 + 320, 60, '[×]', { fontSize: '16px', color: '#ff8888' })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());

    // Tab buttons.
    const buyTabBtn = this.makeTabBtn('Buy', CANVAS_W / 2 - 80, 96, () => this.switchTab('buy'));
    const sellTabBtn = this.makeTabBtn('Sell', CANVAS_W / 2 + 80, 96, () => this.switchTab('sell'));

    // Status text (error / success toasts inside the modal).
    this.statusText = this.scene.add
      .text(CANVAS_W / 2, 130, '', { fontSize: '13px', color: '#ff8888' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0);

    c.add([backdrop, panel, title, this.goldText, closeBtn, buyTabBtn, sellTabBtn, this.statusText]);
    this.container = c;

    this.renderTabContent();
  }

  private switchTab(tab: Tab): void {
    this.activeTab = tab;
    this.renderTabContent();
  }

  private renderTabContent(): void {
    if (!this.container) return;
    // Remove any tab-content objects (above index 7, which is our fixed header group).
    while (this.container.length > 8) {
      const last = this.container.getAt(this.container.length - 1) as Phaser.GameObjects.GameObject;
      this.container.remove(last, true);
    }
    if (this.activeTab === 'buy') {
      this.renderBuyTab();
    } else {
      this.renderSellTab();
    }
  }

  private renderBuyTab(): void {
    if (!this.container || !this.catalog) return;
    const startY = 160;
    const col1 = CANVAS_W / 2 - 280;
    const col2 = CANVAS_W / 2;
    const col3 = CANVAS_W / 2 + 200;

    // Food row.
    const foodLabel = this.scene.add
      .text(col1, startY, `Food  ${this.catalog.food.buyPrice} GP/unit`, {
        fontSize: '14px', color: '#e8e0d0',
      })
      .setScrollFactor(0);
    const foodQtyBtn = this.makeQtyBtn(col2, startY, () => this.cycleQty());
    const buyFoodBtn = this.makeActionBtn('Buy', col3, startY, async () => {
      await this.executeBuyFood(this.foodQty);
    });

    // Ring rows.
    const rows: Phaser.GameObjects.GameObject[] = [foodLabel, foodQtyBtn, buyFoodBtn];
    let yOff = startY + 40;
    for (const entry of this.catalog.rings) {
      const name = ELEMENT_NAMES[entry.elementIndex] ?? entry.element;
      const rowLabel = this.scene.add
        .text(col1, yOff, `${name} Ring T${entry.tier}  ${entry.buyPrice} GP`, {
          fontSize: '14px', color: '#e8e0d0',
        })
        .setScrollFactor(0);
      const buyRingBtn = this.makeActionBtn('Buy', col3, yOff, async () => {
        await this.executeBuyRing(entry.elementIndex);
      });
      rows.push(rowLabel, buyRingBtn);
      yOff += 34;
    }
    this.container.add(rows);
  }

  private renderSellTab(): void {
    if (!this.container || !this.catalog) return;
    const startY = 160;
    const col1 = CANVAS_W / 2 - 280;
    const col2 = CANVAS_W / 2;
    const col3 = CANVAS_W / 2 + 200;

    // Food sell row.
    const foodLabel = this.scene.add
      .text(col1, startY, `Food  ${this.catalog.food.sellPrice} GP/unit`, {
        fontSize: '14px', color: '#e8e0d0',
      })
      .setScrollFactor(0);
    const foodQtyBtn = this.makeQtyBtn(col2, startY, () => this.cycleQty());
    const sellFoodBtn = this.makeActionBtn('Sell', col3, startY, async () => {
      await this.executeSellFood(this.foodQty);
    });

    // Carried rings NOT in battle slots.
    const loadoutIds = new Set(Object.values(this.loadout).filter(Boolean) as string[]);
    const sellableRings = this.allRings.filter(
      (r) => r.element <= 4 && !loadoutIds.has(r.id) && r.element !== undefined,
    );

    const rows: Phaser.GameObjects.GameObject[] = [foodLabel, foodQtyBtn, sellFoodBtn];
    let yOff = startY + 40;
    for (const ring of sellableRings) {
      if (yOff > CANVAS_H - 80) break; // prevent overflow
      const sellEntry = this.catalog.rings.find((e) => e.elementIndex === ring.element);
      const price = sellEntry?.sellPrice ?? 0;
      const name = ELEMENT_NAMES[ring.element] ?? `Element ${ring.element}`;
      const ringLabel = this.scene.add
        .text(col1, yOff, `${name} Ring T${ring.tier}  ${price} GP`, {
          fontSize: '14px', color: '#e8e0d0',
        })
        .setScrollFactor(0);
      const sellRingBtn = this.makeActionBtn('Sell', col3, yOff, async () => {
        await this.executeSellRing(ring.id);
      });
      rows.push(ringLabel, sellRingBtn);
      yOff += 34;
    }
    this.container?.add(rows);
    void col2; // referenced above for qty button
  }

  // ── Transaction helpers ────────────────────────────────────────────────────

  private async executeBuyFood(qty: number): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_MM}/api/merchant/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'food', quantity: qty }),
      });
      const body = (await res.json()) as { gold?: number; food_units?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Purchase failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.food = body.food_units ?? this.food;
      this.goldText?.setText(`Gold: ${this.gold}`);
      this.status(`+${qty} food`, '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeBuyRing(elementIndex: number): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    // Map element integer index back to the server's element name string.
    const ELEMENT_MAP: Record<number, string> = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'wind', 4: 'wood' };
    const element = ELEMENT_MAP[elementIndex] ?? 'fire';
    try {
      const res = await fetch(`${API_BASE_MM}/api/merchant/buy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'ring', element, tier: 1 }),
      });
      const body = (await res.json()) as { gold?: number; ring?: RingRecord; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Purchase failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      if (body.ring) this.allRings.push(body.ring);
      this.goldText?.setText(`Gold: ${this.gold}`);
      this.status(`Bought ${ELEMENT_NAMES[elementIndex] ?? element} Ring`, '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeSellFood(qty: number): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_MM}/api/merchant/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'food', quantity: qty }),
      });
      const body = (await res.json()) as { gold?: number; food_units?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Sale failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.food = body.food_units ?? this.food;
      this.goldText?.setText(`Gold: ${this.gold}`);
      this.status(`Sold ${qty} food +${qty} GP`, '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeSellRing(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE_MM}/api/merchant/sell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ item: 'ring', ring_id: ringId }),
      });
      const body = (await res.json()) as { gold?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Sale failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.allRings = this.allRings.filter((r) => r.id !== ringId);
      this.goldText?.setText(`Gold: ${this.gold}`);
      this.status('Ring sold', '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────

  private cycleQty(): void {
    this.foodQty = this.foodQty >= 10 ? 1 : this.foodQty + 1;
    this.renderTabContent();
  }

  private makeQtyBtn(
    x: number,
    y: number,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, `Qty: ${this.foodQty}`, { fontSize: '13px', color: '#aaddff' })
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
  }

  private makeActionBtn(
    label: string,
    x: number,
    y: number,
    onClick: () => Promise<void>,
  ): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, `[${label}]`, { fontSize: '13px', color: '#88ddff' })
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void onClick());
  }

  private makeTabBtn(
    label: string,
    x: number,
    y: number,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    return this.scene.add
      .text(x, y, label, { fontSize: '15px', color: '#ccddff' })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', onClick);
  }

  private status(msg: string, color = '#ff8888'): void {
    if (!this.statusText) return;
    this.statusText.setColor(color).setText(msg);
    this.scene.tweens.add({
      targets: this.statusText,
      alpha: { from: 1, to: 0 },
      delay: 1500,
      duration: 500,
      onComplete: () => this.statusText?.setAlpha(1).setText(''),
    });
  }
}

