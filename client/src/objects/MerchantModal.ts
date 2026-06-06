import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES } from '../Constants';
import { API_BASE, apiFetch, fetchMe, getToken } from '../net/api';
import { createOverlay } from './ui/ModalShell';
import { addDomLabel, setDomLabelText, crispCanvasText } from './ui/DomLabel';

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
  in_carry: number;
  xp: number;
  pending: number;
  heart_slot: number;
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
  /**
   * #137 — optional hook fired with the modal container right after it is built,
   * so a dual-camera host (BaseBiomeScene under 2× zoom) can
   * `cameras.main.ignore(container)` and render the shop UI at 1:1 through its UI
   * camera. The container is created once per open (renderTabContent re-uses it),
   * so this fires once per open.
   */
  private readonly onRender?: (container: Phaser.GameObjects.Container) => void;

  private container: Phaser.GameObjects.Container | null = null;
  private activeTab: Tab = 'buy';
  private catalog: Catalog | null = null;
  private allRings: RingRecord[] = [];
  private loadout: Record<string, string | null> = {};
  private gold = 0;
  private food = 0;
  /**
   * #363 — gold readout is a DOM label (crisp HiDPI). DOM elements are NOT
   * children of the modal Container, so they are tracked here and destroyed
   * explicitly in close() to avoid duplicate nodes on reopen.
   */
  private goldText: Phaser.GameObjects.DOMElement | null = null;
  /** #363 — screen-fixed DOM labels (title + gold) tracked for explicit cleanup. */
  private domLabels: Phaser.GameObjects.DOMElement[] = [];
  private statusText: Phaser.GameObjects.Text | null = null;
  private scrollY = 0;
  private wheelHandler: ((p: unknown, g: unknown, dx: number, dy: number) => void) | null = null;

  constructor(
    scene: Phaser.Scene,
    onHudRefresh: () => void,
    onClose: () => void,
    onRender?: (container: Phaser.GameObjects.Container) => void,
  ) {
    this.scene = scene;
    this.onHudRefresh = onHudRefresh;
    this.onClose = onClose;
    this.onRender = onRender;
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
    if (this.wheelHandler) {
      this.scene.input.off('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }
    this.scrollY = 0;
    this.container.destroy(true);
    this.container = null;
    // #363 — DOM labels are not container children; destroy them explicitly so a
    // reopen does not leave a duplicate node behind.
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels = [];
    this.goldText = null;
    this.statusText = null;
    window.__merchantModalOpen = false;
    this.onClose();
  }

  private async fetchData(): Promise<void> {
    if (!getToken()) return;
    try {
      // The catalog endpoint is public (no auth); /api/me is authenticated.
      const [catRes, meData] = await Promise.all([
        fetch(`${API_BASE}/api/merchant/catalog`),
        fetchMe<{
          player: { gold: number; food_units: number };
          rings: RingRecord[];
          loadout: Record<string, string | null> | null;
        }>(),
      ]);
      if (catRes.ok) this.catalog = (await catRes.json()) as Catalog;
      this.gold = meData.player.gold;
      this.food = meData.player.food_units;
      this.allRings = meData.rings;
      this.loadout = meData.loadout ?? {};
    } catch {
      // Keep defaults.
    }
  }

  private render(): void {
    if (this.container) this.container.destroy(true);
    // #363 — clear any prior DOM labels before a rebuild (defensive: render() is
    // called once per open, but this guarantees no node leak if that changes).
    this.domLabels.forEach((l) => l.destroy());
    this.domLabels = [];

    // Shared modal scaffold (backdrop + panel + canonical ✕). The merchant header
    // is custom (left-aligned "MERCHANT" + a centered gold readout), so the shell
    // title is suppressed and the header drawn here.
    const { container: c } = createOverlay(this.scene, {
      width: 700,
      height: 430,
      title: '',
      onClose: () => this.close(),
      panelColor: 0x161622,
      strokeColor: 0x6082aa,
    });

    // Header: "MERCHANT" + current gold (the shell provides the close-X).
    // #363 — these are static, screen-fixed, non-interactive labels → DOM (crisp).
    // DOM labels are NOT container children; they are tracked in this.domLabels and
    // destroyed in close(). align:'left' + origin (0,0) preserves the prior layout.
    const title = addDomLabel(this.scene, CANVAS_W / 2 - 200, 60, 'MERCHANT', {
      fontPx: 20,
      color: '#ffffff',
      align: 'left',
      id: 'merchant-title',
    }).setOrigin(0, 0);
    this.goldText = addDomLabel(this.scene, CANVAS_W / 2 + 60, 60, `Gold: ${this.gold}`, {
      fontPx: 16,
      color: '#f5e070',
      align: 'left',
      id: 'merchant-gold',
    }).setOrigin(0, 0);
    this.domLabels.push(title, this.goldText);

    // Tab buttons (interactive → must stay canvas: DOM labels are pointer-events:none).
    const buyTabBtn = this.makeTabBtn('Buy', CANVAS_W / 2 - 80, 96, () => this.switchTab('buy'));
    const sellTabBtn = this.makeTabBtn('Sell', CANVAS_W / 2 + 80, 96, () => this.switchTab('sell'));

    // Status text (error / success toasts inside the modal). Canvas: it uses
    // setColor + alpha tween. Container child → crispCanvasText.
    this.statusText = crispCanvasText(
      this.scene.add
        .text(CANVAS_W / 2, 130, '', { fontSize: '13px', color: '#ff8888' })
        .setOrigin(0.5, 0)
        .setScrollFactor(0),
    );

    // The shell already added backdrop + panel + (empty) title + close-X (4 fixed
    // children); these three canvas header objects bring the fixed header to 7 —
    // the count renderTabContent() preserves when it strips tab content. (#363: the
    // MERCHANT title + gold readout moved to DOM, dropping the count from 9 to 7.)
    c.add([buyTabBtn, sellTabBtn, this.statusText]);
    this.container = c;
    // #137 — let a zoomed dual-camera host route this container to its UI camera
    // (cameras.main.ignore) so the shop renders at 1:1. Ignoring a container
    // cascades to children added later by renderTabContent.
    this.onRender?.(c);

    this.renderTabContent();
  }

  private switchTab(tab: Tab): void {
    this.scrollY = 0;
    this.activeTab = tab;
    this.renderTabContent();
  }

  private renderTabContent(): void {
    if (!this.container) return;
    // Remove old wheel listener before rebuilding content.
    if (this.wheelHandler) {
      this.scene.input.off('wheel', this.wheelHandler);
      this.wheelHandler = null;
    }
    // Remove any tab-content objects above the 7 fixed header children (shell's
    // backdrop/panel/title/close-X + two tabs/status; MERCHANT title + gold are DOM).
    while (this.container.length > 7) {
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
    const ROW_H = 34;
    const VISIBLE_H = 270;
    const col1 = CANVAS_W / 2 - 280;
    const col2a = CANVAS_W / 2 - 10;
    const col2b = CANVAS_W / 2 + 55;
    const col3 = CANVAS_W / 2 + 200;
    const CONTENT_TOP = 155;

    // Visibility-windowed scroll (replaces GeometryMask — unreliable in nested
    // Container / multi-camera Phaser 4 setups; same fix as BattleHandOverlay).
    const scrollContainer = this.scene.add.container(0, CONTENT_TOP - this.scrollY);
    const rowGroups: Phaser.GameObjects.Container[] = [];

    // Food row at relative y=0.
    // #382 — catalog rows are children of a scrollContainer (a Container) →
    // crispCanvasText is the correct call for all row labels.
    const foodGroup = this.scene.add.container(0, 0);
    foodGroup.add([
      crispCanvasText(
        this.scene.add.text(col1, 0, `Food  ${this.catalog.food.buyPrice} GP/unit  (have: ${this.food})`, {
          fontSize: '14px', color: '#e8e0d0',
        }).setScrollFactor(0),
      ),
      this.makeActionBtn('[×1]', col2a, 0, async () => { await this.executeBuyFood(1); }),
      this.makeActionBtn('[×25]', col2b, 0, async () => { await this.executeBuyFood(25); }),
    ]);
    scrollContainer.add(foodGroup);
    rowGroups.push(foodGroup);

    let yOff = ROW_H + 6;
    for (const entry of this.catalog.rings) {
      const name = ELEMENT_NAMES[entry.elementIndex] ?? entry.element;
      const ownedCount = this.allRings.filter((r) => r.element === entry.elementIndex).length;
      const rowGroup = this.scene.add.container(0, yOff);
      rowGroup.add([
        crispCanvasText(
          this.scene.add.text(col1, 0, `${name} Ring T${entry.tier}  ${entry.buyPrice} GP  (own: ${ownedCount})`, {
            fontSize: '14px', color: '#e8e0d0',
          }).setScrollFactor(0),
        ),
        this.makeActionBtn('Buy', col3, 0, async () => { await this.executeBuyRing(entry.elementIndex); }),
      ]);
      scrollContainer.add(rowGroup);
      rowGroups.push(rowGroup);
      yOff += ROW_H;
    }

    this.container.add(scrollContainer);

    const maxScroll = Math.max(0, yOff - VISIBLE_H);

    const updateVisibility = (): void => {
      rowGroups.forEach((grp) => {
        grp.setVisible(grp.y + ROW_H > this.scrollY && grp.y < this.scrollY + VISIBLE_H);
      });
      scrollContainer.setY(CONTENT_TOP - this.scrollY);
    };
    updateVisibility();

    if (maxScroll > 0) {
      // #382 — container child → crispCanvasText.
      this.container.add(
        crispCanvasText(
          this.scene.add.text(CANVAS_W / 2, CONTENT_TOP + VISIBLE_H + 2, '▼ scroll', {
            fontSize: '11px', color: '#556677',
          }).setScrollFactor(0).setOrigin(0.5, 0),
        ),
      );
    }

    this.wheelHandler = (_p: unknown, _g: unknown, _dx: number, dy: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + dy * 0.5, 0, maxScroll);
      updateVisibility();
    };
    this.scene.input.on('wheel', this.wheelHandler);
  }

  private renderSellTab(): void {
    if (!this.container || !this.catalog) return;
    const ROW_H = 34;
    const VISIBLE_H = 270;
    const col1 = CANVAS_W / 2 - 280;
    const col2a = CANVAS_W / 2 - 10;
    const col2b = CANVAS_W / 2 + 55;
    const col3 = CANVAS_W / 2 + 200;
    const CONTENT_TOP = 155;

    // Visibility-windowed scroll (replaces GeometryMask — unreliable in nested
    // Container / multi-camera Phaser 4 setups; same fix as BattleHandOverlay).
    const scrollContainer = this.scene.add.container(0, CONTENT_TOP - this.scrollY);
    const rowGroups: Phaser.GameObjects.Container[] = [];

    // Food sell row at relative y=0.
    // #382 — catalog rows are children of a scrollContainer (a Container) →
    // crispCanvasText is the correct call for all row labels.
    const foodGroup = this.scene.add.container(0, 0);
    foodGroup.add([
      crispCanvasText(
        this.scene.add.text(col1, 0, `Food  ${this.catalog.food.sellPrice} GP/unit  (have: ${this.food})`, {
          fontSize: '14px', color: '#e8e0d0',
        }).setScrollFactor(0),
      ),
      this.makeActionBtn('[×1]', col2a, 0, async () => { await this.executeSellFood(1); }),
      this.makeActionBtn('[×25]', col2b, 0, async () => { await this.executeSellFood(25); }),
    ]);
    scrollContainer.add(foodGroup);
    rowGroups.push(foodGroup);

    // Only carried rings (in_carry=1) not currently slotted in battle slots.
    const loadoutIds = new Set(Object.values(this.loadout).filter(Boolean) as string[]);
    const sellableRings = this.allRings.filter(
      (r) => r.in_carry === 1 && r.element <= 4 && !loadoutIds.has(r.id),
    );

    let yOff = ROW_H + 6;
    for (const ring of sellableRings) {
      const sellEntry = this.catalog.rings.find((e) => e.elementIndex === ring.element);
      const basePrice = sellEntry?.sellPrice ?? 0;
      const price = basePrice + Math.floor(ring.xp / 100);
      const name = ELEMENT_NAMES[ring.element] ?? `Element ${ring.element}`;
      const rowGroup = this.scene.add.container(0, yOff);
      rowGroup.add([
        crispCanvasText(
          this.scene.add.text(col1, 0, `${name} Ring T${ring.tier}  ${price} GP  (${ring.current_uses}/${ring.max_uses} uses, xp ${ring.xp})`, {
            fontSize: '14px', color: '#e8e0d0',
          }).setScrollFactor(0),
        ),
        this.makeActionBtn('Sell', col3, 0, async () => { await this.executeSellRing(ring.id); }),
      ]);
      scrollContainer.add(rowGroup);
      rowGroups.push(rowGroup);
      yOff += ROW_H;
    }

    this.container.add(scrollContainer);

    const maxScroll = Math.max(0, yOff - VISIBLE_H);

    const updateVisibility = (): void => {
      rowGroups.forEach((grp) => {
        grp.setVisible(grp.y + ROW_H > this.scrollY && grp.y < this.scrollY + VISIBLE_H);
      });
      scrollContainer.setY(CONTENT_TOP - this.scrollY);
    };
    updateVisibility();

    if (maxScroll > 0) {
      // #382 — container child → crispCanvasText.
      this.container.add(
        crispCanvasText(
          this.scene.add.text(CANVAS_W / 2, CONTENT_TOP + VISIBLE_H + 2, '▼ scroll', {
            fontSize: '11px', color: '#556677',
          }).setScrollFactor(0).setOrigin(0.5, 0),
        ),
      );
    }

    this.wheelHandler = (_p: unknown, _g: unknown, _dx: number, dy: number) => {
      this.scrollY = Phaser.Math.Clamp(this.scrollY + dy * 0.5, 0, maxScroll);
      updateVisibility();
    };
    this.scene.input.on('wheel', this.wheelHandler);
  }

  // ── Transaction helpers ────────────────────────────────────────────────────

  private async executeBuyFood(qty: number): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/merchant/buy', {
        method: 'POST',
        json: { item: 'food', quantity: qty },
      });
      const body = (await res.json()) as { gold?: number; food_units?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Purchase failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.food = body.food_units ?? this.food;
      if (this.goldText) setDomLabelText(this.goldText, `Gold: ${this.gold}`);
      this.status(`+${qty} food`, '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeBuyRing(elementIndex: number): Promise<void> {
    if (!getToken()) return;
    // Map element integer index back to the server's element name string.
    const ELEMENT_MAP: Record<number, string> = { 0: 'fire', 1: 'water', 2: 'earth', 3: 'wind', 4: 'wood' };
    const element = ELEMENT_MAP[elementIndex] ?? 'fire';
    try {
      const res = await apiFetch('/api/merchant/buy', {
        method: 'POST',
        json: { item: 'ring', element, tier: 1 },
      });
      const body = (await res.json()) as { gold?: number; ring?: RingRecord; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Purchase failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      if (body.ring) this.allRings.push(body.ring);
      if (this.goldText) setDomLabelText(this.goldText, `Gold: ${this.gold}`);
      // #423 — a purchase with a full bench mints the ring as the pending WON
      // ring (server routes through the grantRing overflow model).
      const wentPending = body.ring?.pending === 1;
      this.status(
        wentPending
          ? 'Ring added to your WON slot — bench is full'
          : `Bought ${ELEMENT_NAMES[elementIndex] ?? element} Ring`,
        '#aaffaa',
      );
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeSellFood(qty: number): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/merchant/sell', {
        method: 'POST',
        json: { item: 'food', quantity: qty },
      });
      const body = (await res.json()) as { gold?: number; food_units?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Sale failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.food = body.food_units ?? this.food;
      if (this.goldText) setDomLabelText(this.goldText, `Gold: ${this.gold}`);
      this.status(`Sold ${qty} food +${qty} GP`, '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  private async executeSellRing(ringId: string): Promise<void> {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/merchant/sell', {
        method: 'POST',
        json: { item: 'ring', ring_id: ringId },
      });
      const body = (await res.json()) as { gold?: number; error?: string };
      if (!res.ok) { this.status(body.error ?? 'Sale failed', '#ff8888'); return; }
      this.gold = body.gold ?? this.gold;
      this.allRings = this.allRings.filter((r) => r.id !== ringId);
      if (this.goldText) setDomLabelText(this.goldText, `Gold: ${this.gold}`);
      this.status('Ring sold', '#aaffaa');
      this.onHudRefresh();
      this.renderTabContent();
    } catch { this.status('Network error', '#ff8888'); }
  }

  // ── UI helpers ──────────────────────────────────────────────────────────────

  private makeActionBtn(
    label: string,
    x: number,
    y: number,
    onClick: () => Promise<void>,
  ): Phaser.GameObjects.Text {
    // #382 — always added to a row Container → crispCanvasText.
    return crispCanvasText(
      this.scene.add
        .text(x, y, `[${label}]`, { fontSize: '13px', color: '#88ddff' })
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => void onClick()),
    );
  }

  private makeTabBtn(
    label: string,
    x: number,
    y: number,
    onClick: () => void,
  ): Phaser.GameObjects.Text {
    // #382 — added to the modal Container → crispCanvasText.
    return crispCanvasText(
      this.scene.add
        .text(x, y, label, { fontSize: '15px', color: '#ccddff' })
        .setOrigin(0.5, 0)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', onClick),
    );
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
