import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_COLORS, ELEMENT_NAMES, THUMB_PASSIVE_INFO } from '../Constants';
import type { RingData } from './InventoryGrid';

const BATTLE_SLOTS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;
type BattleSlot = (typeof BATTLE_SLOTS)[number];

declare const __SERVER_URL__: string;
const _WS_BHO = __SERVER_URL__ || `ws://${window.location.hostname}:2567`;
const API_BASE = _WS_BHO.replace(/^ws/, 'http');

/**
 * Manage Battle-Hand overlay (#87 Part D — extracted from EncounterScene #40/#85).
 *
 * A standalone, self-contained overlay for reassigning carried rings to battle
 * slots, recharging rings with spirit, discarding rings, and resolving a pending
 * won ring. It owns its own data (fetches /api/me), its own modal container, and
 * all server round-trips — so it works identically from EncounterScene (where it
 * was previously inlined) AND from OverworldScene (where no encounter state
 * exists), opened by Tab.
 *
 * Server stays authoritative: every mutation (PUT /api/loadout, PUT /api/carry,
 * POST /api/spirit/recharge*, DELETE /api/rings/:id) round-trips and the overlay
 * re-renders from the fresh /api/me response. Purely presentation/input here.
 *
 * The #85 layout fixes (uncapped passive strip, shifted carried-rings + recharge
 * rows) are preserved verbatim from the original EncounterScene implementation.
 */
export class BattleHandOverlay {
  private readonly scene: Phaser.Scene;
  /** Optional sink for status messages that belong outside the modal (errors). */
  private readonly onStatus?: (msg: string) => void;
  /**
   * #137 — optional hook fired after each (re)render builds the modal container,
   * passing it so a dual-camera host (BaseBiomeScene under 2× zoom) can
   * `cameras.main.ignore(container)` and render the overlay at 1:1 through its UI
   * camera. The modal is rebuilt on every render, so this fires per render.
   */
  private readonly onModalRender?: (container: Phaser.GameObjects.Container) => void;
  /** Fired after the overlay closes (host scene re-enables movement, etc.). */
  private onCloseCb?: () => void;

  private manageModal: Phaser.GameObjects.Container | null = null;
  private spareScrollRow = 0;
  private spareWheelHandler: ((p: unknown, g: unknown, dx: number, dy: number) => void) | null = null;
  private manageSelectedRingId: string | null = null;
  /** Slot the selected ring came from, or null when selection is from the spare row. */
  private manageSelectedFromSlot: BattleSlot | null = null;
  private manageRings: RingData[] = [];
  private manageLoadout: Record<string, string | null> = {};
  /** Full /api/me ring list (carried or not) — needed to show a pending won ring. */
  private allRings: RingData[] = [];
  private managePlayer: { game_day?: number; gold?: number; food_units?: number; spirit_current?: number; spirit_max?: number; aggregate_xp?: number; carry_cap?: number; spareCapacity?: number } | null = null;
  private manageStatusText: Phaser.GameObjects.Text | null = null;

  /**
   * @param scene the host spatial/encounter scene
   * @param onStatus optional callback for errors that should surface outside the
   *   modal (e.g. EncounterScene's bottom status text); defaults to a no-op
   * @param onModalRender optional hook (#137) fired with the modal container after
   *   each render, so a zoomed dual-camera host can route it to its UI camera
   */
  constructor(
    scene: Phaser.Scene,
    onStatus?: (msg: string) => void,
    onModalRender?: (container: Phaser.GameObjects.Container) => void,
  ) {
    this.scene = scene;
    this.onStatus = onStatus;
    this.onModalRender = onModalRender;
  }

  /** True while the modal is on screen (host scene reads this to halt movement). */
  isOpen(): boolean {
    return this.manageModal !== null;
  }

  private status(msg: string): void {
    this.onStatus?.(msg);
  }

  /**
   * Fetch /api/me and open the battle-hand reassignment modal. Only carried rings
   * (in_carry = 1) are offered; selecting one then clicking a slot PUTs
   * /api/loadout. No Sleep/Recharge-by-day here — purely loadout editing + spirit
   * recharge. `onClose` (optional) fires when the modal closes.
   */
  async open(onClose?: () => void): Promise<void> {
    if (this.manageModal) return;
    this.spareScrollRow = 0;
    if (onClose) this.onCloseCb = onClose;
    const token = localStorage.getItem('er_token');
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: {
        player: BattleHandOverlay['managePlayer'];
        rings: RingData[];
        loadout: Record<string, string | null>;
      } = await res.json();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.manageLoadout = data.loadout ?? {};
    } catch {
      return;
    }
    // Auto-carry the pending won ring if carry has room — avoids showing the
    // "discard a carried ring to keep it" prompt when space is available.
    await this.tryAutoCarryPending();
    if (this.manageModal) return; // closed during async auto-carry
    this.renderManageModal();
  }

  /** Render (or re-render) the manage-battle-hand modal from cached state. */
  private renderManageModal(): void {
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }

    // #212 — host-agnostic open flag (EncounterScene or a biome). E2E reads it to
    // assert which post-duel route opened the overlay.
    window.__battleHandOpen = true;
    const container = this.scene.add.container(0, 0).setDepth(2000);
    const overlay = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, CANVAS_W, CANVAS_H, 0x000000, 0.75)
      .setScrollFactor(0)
      .setInteractive();
    const panel = this.scene.add
      .rectangle(CANVAS_W / 2, CANVAS_H / 2, 640, 520, 0x222233)
      .setScrollFactor(0)
      .setStrokeStyle(2, 0xffcc88);
    const title = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 - 245, 'Manage Battle Hand', {
        fontSize: '18px',
        color: '#ffffff',
      })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const close = this.scene.add
      .text(CANVAS_W / 2 + 290, CANVAS_H / 2 - 245, '✕', { fontSize: '18px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => this.close());
    container.add([overlay, panel, title, close]);

    // Player status line — mirrors the Sanctum screen stat bar.
    const p = this.managePlayer;
    const statLine = this.scene.add
      .text(
        CANVAS_W / 2,
        CANVAS_H / 2 - 228,
        p
          ? `Day: ${p.game_day ?? 0} | Gold: ${p.gold ?? 0} | Food: ${p.food_units ?? 0} | Spirit: ${p.spirit_current ?? 0}/${p.spirit_max ?? 0} | XP: ${p.aggregate_xp ?? 0}`
          : '',
        { fontSize: '12px', color: '#ffdd66' },
      )
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add(statLine);

    // Pending won ring (top section). The won ring is not yet carried, so it lives
    // in allRings (full /api/me list), not manageRings. The player frees a carried
    // slot (discard) to make room; tryAutoCarryPending then carries it.
    const pendingId = localStorage.getItem('er_pending_ring');
    const pendingRing = pendingId ? this.allRings.find((r) => r.id === pendingId) : undefined;
    if (pendingRing) {
      const py = CANVAS_H / 2 - 168;
      const pRect = this.scene.add
        .rectangle(CANVAS_W / 2 - 250, py, 72, 80, ELEMENT_COLORS[pendingRing.element] ?? 0x444444)
        .setScrollFactor(0)
        .setStrokeStyle(3, 0xffcc44);
      container.add(pRect);
      this.addRingInfo(container, CANVAS_W / 2 - 250, py, pendingRing);
      const pLbl = this.scene.add
        .text(
          CANVAS_W / 2 - 200,
          py,
          `WON: ${ELEMENT_NAMES[pendingRing.element] ?? '?'} ring — discard a carried ring to keep it`,
          { fontSize: '11px', color: '#ffdd66' },
        )
        .setScrollFactor(0)
        .setOrigin(0, 0.5);
      const pDiscard = this.scene.add
        .text(CANVAS_W / 2 + 250, py, '[× Discard]', { fontSize: '11px', color: '#ff8888' })
        .setScrollFactor(0)
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          void (async () => {
            await this.discardPendingWonRing();
            this.renderManageModal();
          })();
        });
      container.add([pLbl, pDiscard]);
      if (window.__encounterState) {
        window.__encounterState.pendingWonRing = { ringId: pendingRing.id, element: pendingRing.element };
      }
    }

    // Battle slots row (top). Filled slots show the same 4-line info as the Sanctum
    // and get a small [×] discard button.
    const slotY = CANVAS_H / 2 - 70;
    BATTLE_SLOTS.forEach((slot, i) => {
      const sx = CANVAS_W / 2 - 240 + i * 120;
      const ringId = this.manageLoadout[slot] ?? null;
      const ring = ringId ? this.manageRings.find((r) => r.id === ringId) : null;
      const color = ring ? ELEMENT_COLORS[ring.element] ?? 0x333333 : 0x333333;
      const slotSelected = this.manageSelectedFromSlot === slot;
      const strokeColor = slotSelected ? 0xffff00 : 0x888888;
      const strokeWidth = slotSelected ? 3 : 2;
      const slotRect = this.scene.add
        .rectangle(sx, slotY, 92, 80, color)
        .setScrollFactor(0)
        .setStrokeStyle(strokeWidth, strokeColor)
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => {
          const selId = this.manageSelectedRingId;
          const selSlot = this.manageSelectedFromSlot;
          if (selId !== null && selSlot === null) {
            // Spare ring selected — assign it to this slot (existing path).
            void this.assignManageSlot(slot);
          } else if (selId !== null && selSlot !== null) {
            // Slot ring selected — swap the two slots or deselect.
            if (selSlot === slot) {
              this.manageSelectedRingId = null;
              this.manageSelectedFromSlot = null;
              this.renderManageModal();
            } else {
              void this.swapManageSlots(selSlot, selId, slot, ringId);
            }
          } else if (ringId) {
            // Nothing selected and slot occupied — select this slot's ring.
            this.manageSelectedRingId = ringId;
            this.manageSelectedFromSlot = slot;
            this.renderManageModal();
          }
        });
      const slotLbl = this.scene.add
        .text(sx, slotY - 34, slot.toUpperCase(), { fontSize: '11px', color: '#cccccc' })
        .setScrollFactor(0)
        .setOrigin(0.5);
      container.add([slotRect, slotLbl]);
      if (ring) {
        this.addRingInfo(container, sx, slotY, ring);
        const slotX = this.scene.add
          .text(sx + 38, slotY - 32, '×', { fontSize: '13px', color: '#ff3333' })
          .setScrollFactor(0)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', (_p: unknown, _x: number, _y: number, evt: { stopPropagation?: () => void }) => {
            evt?.stopPropagation?.();
            void this.discardCarriedRing(ring.id);
          });
        container.add(slotX);
      } else {
        const dash = this.scene.add
          .text(sx, slotY, '—', { fontSize: '11px', color: '#888888' })
          .setScrollFactor(0)
          .setOrigin(0.5);
        container.add(dash);
      }
    });

    // #78 ④ — Thumb passive reminder (mirrors the Sanctum ring-storage overlay).
    this.renderManagePassive(container, slotY);

    // Carried rings row (selectable) — exclude rings already in a battle slot so
    // the player only sees spare carried rings available for assignment.
    const slottedIds = new Set(Object.values(this.manageLoadout).filter(Boolean) as string[]);
    const availableRings = this.manageRings.filter((r) => !slottedIds.has(r.id));
    // #171 — spare capacity from the API response (server-computed, no client
    // arithmetic). When full, the spare row is greyed-out and non-interactive;
    // the server enforces the cap with 400 too.
    const spareCapacity = this.managePlayer?.spareCapacity ?? 0;
    const usedSpares = availableRings.length;
    const spareFull = usedSpares >= spareCapacity && spareCapacity >= 0;

    // #85 Fix 3 — push the carried-rings section down 49px so the label + row clear
    // the (now uncapped) Thumb passive strip below the battle slots.
    const ringY = CANVAS_H / 2 + 94;
    const spareLabelText = `Spare rings — select to assign, or click two slots to swap:   Spare: ${usedSpares} / ${spareCapacity}`;
    const spareLabelColor = spareFull ? '#ff8888' : '#aaccff';
    const carriedLbl = this.scene.add
      .text(CANVAS_W / 2, CANVAS_H / 2 + 44, spareLabelText, {
        fontSize: '12px',
        color: spareLabelColor,
      })
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add(carriedLbl);
    if (spareFull) {
      const fullLbl = this.scene.add
        .text(CANVAS_W / 2, CANVAS_H / 2 + 62, 'Spare full — discard a carried ring or move one to a battle slot', {
          fontSize: '11px',
          color: '#ff8888',
        })
        .setScrollFactor(0)
        .setOrigin(0.5);
      container.add(fullLbl);
    }
    // Spare cards sub-container — visibility-windowed (replaces GeometryMask, which
    // is unreliable in nested Container / multi-camera Phaser 4 setups; same fix as
    // InventoryGrid PR #168).
    const SPARE_TOP = 377;
    const SPARE_H = 115;
    const SPARE_ROW_H = 90;
    const totalRows = Math.ceil(availableRings.length / 6);
    // SPARE_H (115px) fits exactly 1 complete row of SPARE_ROW_H (90px); a second
    // row would bleed into the recharge controls, so cap at 1 visible row.
    const VISIBLE_ROWS = 1;

    const spareContainer = this.scene.add.container(0, 0);
    container.add(spareContainer);
    // Per-row group containers toggled visible/hidden by updateSpareVisibility().
    const spareRowGroups: Map<number, Phaser.GameObjects.Container[]> = new Map();

    availableRings.forEach((ring, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const rx = CANVAS_W / 2 - 250 + col * 90;
      const ry = ringY + row * SPARE_ROW_H;
      const selected = this.manageSelectedRingId === ring.id && this.manageSelectedFromSlot === null;
      const cardAlpha = spareFull ? 0.45 : 1;

      const ringGrp = this.scene.add.container(rx, ry);

      const rect = this.scene.add
        .rectangle(0, 0, 72, 80, ELEMENT_COLORS[ring.element] ?? 0x444444)
        .setScrollFactor(0)
        .setStrokeStyle(selected ? 3 : 2, selected ? 0xffff00 : 0x888888)
        .setAlpha(cardAlpha)
        .setInteractive({ useHandCursor: !spareFull })
        .on('pointerdown', () => {
          const selSlot = this.manageSelectedFromSlot;
          const selId = this.manageSelectedRingId;
          if (selSlot !== null && selId !== null) {
            void this.swapSlotWithSpare(selSlot, selId, ring.id);
          } else {
            this.manageSelectedRingId = selected ? null : ring.id;
            this.manageSelectedFromSlot = null;
            this.renderManageModal();
          }
        });
      ringGrp.add(rect);

      const used = ring.max_uses - ring.current_uses;
      const pips = '●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used));
      ringGrp.add([
        this.scene.add.text(0, -22, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' }).setScrollFactor(0).setOrigin(0.5),
        this.scene.add.text(0, -6, pips, { fontSize: '10px', color: '#000000' }).setScrollFactor(0).setOrigin(0.5),
        this.scene.add.text(0, 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' }).setScrollFactor(0).setOrigin(0.5),
        this.scene.add.text(0, 24, `T${ring.tier}`, { fontSize: '9px', color: '#000000' }).setScrollFactor(0).setOrigin(0.5),
        this.scene.add
          .text(30, -32, '×', { fontSize: '13px', color: '#ff3333' })
          .setScrollFactor(0)
          .setOrigin(0.5)
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', (_p: unknown, _x: number, _y: number, evt: { stopPropagation?: () => void }) => {
            evt?.stopPropagation?.();
            void this.discardCarriedRing(ring.id);
          }),
      ]);

      spareContainer.add(ringGrp);
      if (!spareRowGroups.has(row)) spareRowGroups.set(row, []);
      spareRowGroups.get(row)!.push(ringGrp);
    });

    const updateSpareVisibility = (): void => {
      spareRowGroups.forEach((grps, row) => {
        const visible = row >= this.spareScrollRow && row < this.spareScrollRow + VISIBLE_ROWS;
        grps.forEach((g) => g.setVisible(visible));
      });
      spareContainer.y = -this.spareScrollRow * SPARE_ROW_H;
    };
    updateSpareVisibility();

    // Overflow hint + wheel scroll.
    if (totalRows > 1) {
      const hint = this.scene.add
        .text(CANVAS_W / 2, SPARE_TOP + SPARE_H + 3, '▼ scroll', {
          fontSize: '11px', color: '#556677',
        })
        .setScrollFactor(0)
        .setOrigin(0.5, 0);
      container.add(hint);
    }

    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    this.spareWheelHandler = (_p: unknown, _g: unknown, _dx: number, dy: number) => {
      const maxRow = Math.max(0, totalRows - VISIBLE_ROWS);
      this.spareScrollRow = Phaser.Math.Clamp(this.spareScrollRow + (dy > 0 ? 1 : -1), 0, maxRow);
      updateSpareVisibility();
    };
    this.scene.input.on('wheel', this.spareWheelHandler);

    // ── Recharge controls (spirit-powered, mirrors Sanctum) ──────────────────
    // #85 Fix 3 — shifted 35px down (185→220) to follow the lowered carried-rings row.
    const rechargeY = CANVAS_H / 2 + 220;
    const rechargeBtn = this.scene.add
      .text(CANVAS_W / 2 - 100, rechargeY, '[Recharge]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeSelected());
    const rechargeAllBtn = this.scene.add
      .text(CANVAS_W / 2 + 60, rechargeY, '[Recharge All]', { fontSize: '13px', color: '#ffcc44' })
      .setScrollFactor(0)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
      .on('pointerdown', () => void this.doManageRechargeAll());
    this.manageStatusText = this.scene.add
      .text(CANVAS_W / 2, rechargeY + 22, '', { fontSize: '11px', color: '#ff8888' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add([rechargeBtn, rechargeAllBtn, this.manageStatusText]);

    this.manageModal = container;
    // #137 — let a zoomed dual-camera host route this freshly-built container to
    // its UI camera (cameras.main.ignore) so the overlay renders at 1:1, not 2×.
    this.onModalRender?.(container);

    // #87 Part D — re-expose the discard hook the original inlined EncounterScene
    // modal published (tests/e2e/carry.spec.ts calls window.__encounterDiscardRing).
    // The lambda captures `this`, so it routes to this overlay's private discard.
    window.__encounterDiscardRing = (ringId: string): void => void this.discardCarriedRing(ringId);
  }

  /**
   * Render the Thumb passive reminder beneath the Thumb battle slot (#78 ④),
   * matching the Sanctum ring-storage overlay's strip. Reads the staked Thumb ring
   * (loadout.thumb) and resolves its passive via THUMB_PASSIVE_INFO — display-only;
   * the server owns the real passive resolution at duel start. #85 Fix 3 dropped
   * the line cap so the longest base passive renders in full.
   */
  private renderManagePassive(container: Phaser.GameObjects.Container, slotY: number): void {
    const thumbX = CANVAS_W / 2 - 240;
    const thumbRingId = this.manageLoadout.thumb ?? null;
    const thumbRing = thumbRingId ? this.manageRings.find((r) => r.id === thumbRingId) : undefined;
    if (!thumbRing) return; // no Thumb staked → no reminder
    const info = THUMB_PASSIVE_INFO[thumbRing.element];
    const text = info ? `${info.name}\n${info.effect}` : `No passive\nFused rings grant no passive`;
    const strip = this.scene.add
      .text(thumbX, slotY + 46, text, {
        fontSize: '9px',
        color: '#ffcc88',
        align: 'center',
        wordWrap: { width: 100 },
        lineSpacing: 1,
      })
      .setScrollFactor(0)
      .setOrigin(0.5, 0)
      .setName('manage-staked-passive');
    container.add(strip);
  }

  /**
   * Render the 4-line ring info (element name, use pips, XP, tier) centred at
   * (cx, cy) and add the labels to `container`. Mirrors the Sanctum's InventoryGrid
   * tile so stats read identically across screens.
   */
  private addRingInfo(
    container: Phaser.GameObjects.Container,
    cx: number,
    cy: number,
    ring: RingData,
  ): void {
    const used = ring.max_uses - ring.current_uses;
    const pips = '●'.repeat(ring.current_uses) + '○'.repeat(Math.max(0, used));
    const nameLbl = this.scene.add
      .text(cx, cy - 22, ELEMENT_NAMES[ring.element] ?? '?', { fontSize: '9px', color: '#000000' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const pipsLbl = this.scene.add
      .text(cx, cy - 6, pips, { fontSize: '10px', color: '#000000' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const xpLbl = this.scene.add
      .text(cx, cy + 10, `Xp: ${ring.xp}`, { fontSize: '9px', color: '#000000' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    const tierLbl = this.scene.add
      .text(cx, cy + 24, `T${ring.tier}`, { fontSize: '9px', color: '#000000' })
      .setScrollFactor(0)
      .setOrigin(0.5);
    container.add([nameLbl, pipsLbl, xpLbl, tierLbl]);
  }

  /** Assign the selected carried ring to a battle slot via PUT /api/loadout. */
  private async assignManageSlot(slot: BattleSlot): Promise<void> {
    if (!this.manageSelectedRingId) {
      this.status('Select a carried ring first');
      this.setManageStatus('Select a carried ring first');
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
    } catch {
      return;
    }
    this.manageSelectedRingId = null;
    this.manageSelectedFromSlot = null;
    await this.refreshManageData();
  }

  /**
   * Swap two battle slots by PUTting both assignments in one request. If `toBringId`
   * is null the target slot is empty — the selected ring simply moves there and its
   * old slot is cleared.
   */
  private async swapManageSlots(
    fromSlot: BattleSlot,
    fromRingId: string,
    toSlot: BattleSlot,
    toBringId: string | null,
  ): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    const body: Record<string, string | null> = { [toSlot]: fromRingId, [fromSlot]: toBringId };
    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        this.setManageStatus('Swap failed');
        return;
      }
    } catch {
      this.setManageStatus('Network error during swap');
      return;
    }
    this.manageSelectedRingId = null;
    this.manageSelectedFromSlot = null;
    await this.refreshManageData();
  }

  /**
   * Assign `spareRingId` to `fromSlot`, displacing `slotRingId` to spare. The server's
   * one-slot rule automatically clears the old slot when the spare ring is assigned.
   */
  private async swapSlotWithSpare(
    fromSlot: BattleSlot,
    _slotRingId: string,
    spareRingId: string,
  ): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/loadout`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [fromSlot]: spareRingId }),
      });
      if (!res.ok) {
        this.setManageStatus('Swap failed');
        return;
      }
    } catch {
      this.setManageStatus('Network error during swap');
      return;
    }
    this.manageSelectedRingId = null;
    this.manageSelectedFromSlot = null;
    await this.refreshManageData();
  }

  /** Close the modal and fire the close callback (host re-enables movement). */
  close(): void {
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    this.spareScrollRow = 0;
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    this.manageSelectedRingId = null;
    this.manageSelectedFromSlot = null;
    this.manageStatusText = null;
    window.__battleHandOpen = false; // #212
    delete window.__encounterDiscardRing;
    const cb = this.onCloseCb;
    this.onCloseCb = undefined;
    cb?.();
  }

  /** Recharge the currently selected ring using spirit. */
  private async doManageRechargeSelected(): Promise<void> {
    if (!this.manageSelectedRingId) {
      this.setManageStatus('Select a ring to recharge');
      return;
    }
    await this.doManageRechargeById(this.manageSelectedRingId);
  }

  /** POST /api/spirit/recharge for a specific ring id. */
  private async doManageRechargeById(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringId }),
      });
      if (res.status === 400) {
        const body = await res.json().catch(() => ({}));
        this.setManageStatus(body?.error ?? 'Recharge not available');
        return;
      }
      if (!res.ok) {
        this.setManageStatus(`Recharge failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge');
      return;
    }
    await this.refreshManageData();
  }

  /** POST /api/spirit/recharge-all — fill carried rings in priority order. */
  private async doManageRechargeAll(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/spirit/recharge-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        this.setManageStatus(`Recharge-all failed (${res.status})`);
        return;
      }
    } catch {
      this.setManageStatus('Network error during recharge-all');
      return;
    }
    await this.refreshManageData();
  }

  /** Re-fetch /api/me and re-render the manage modal with fresh data. */
  private async refreshManageData(): Promise<void> {
    const token = localStorage.getItem('er_token');
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: {
        player: BattleHandOverlay['managePlayer'];
        rings: RingData[];
        loadout: Record<string, string | null>;
      } = await res.json();
      this.managePlayer = data.player;
      this.allRings = data.rings;
      this.manageRings = data.rings.filter((r) => r.in_carry === 1);
      this.manageLoadout = data.loadout ?? {};
    } catch {
      return;
    }
    this.renderManageModal();
  }

  private setManageStatus(msg: string): void {
    if (this.manageStatusText) this.manageStatusText.setText(msg);
  }

  /**
   * Permanently discard a carried ring (DELETE /api/rings/:id), then reload the
   * modal data. If a won ring is pending, discarding frees a carry slot, so try to
   * auto-carry it afterward.
   */
  private async discardCarriedRing(ringId: string): Promise<void> {
    const token = localStorage.getItem('er_token') ?? '';
    try {
      await fetch(`${API_BASE}/api/rings/${ringId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.status('Network error during discard');
      return;
    }
    await this.refreshManageData();
    await this.tryAutoCarryPending();
  }

  /** DELETE the pending won ring and clear its localStorage flag + window state. */
  private async discardPendingWonRing(): Promise<void> {
    const ringId = localStorage.getItem('er_pending_ring');
    if (!ringId) return;
    const token = localStorage.getItem('er_token') ?? '';
    try {
      await fetch(`${API_BASE}/api/rings/${ringId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      this.status('Network error during discard');
    }
    localStorage.removeItem('er_pending_ring');
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    await this.refreshManageData();
  }

  /**
   * If a won ring is pending and carry now has room, carry it: PUT /api/carry with
   * the current carried set plus the pending ring, clear er_pending_ring, and
   * re-render the modal so the ring shows as carried.
   */
  private async tryAutoCarryPending(): Promise<void> {
    const pendingId = localStorage.getItem('er_pending_ring');
    if (!pendingId) return;
    const token = localStorage.getItem('er_token');
    if (!token) return;

    let rings: RingData[];
    let carryCap: number;
    try {
      const res = await fetch(`${API_BASE}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data: { player: { carry_cap?: number }; rings: RingData[] } = await res.json();
      rings = data.rings;
      carryCap = data.player.carry_cap ?? 10;
    } catch {
      return;
    }

    if (!rings.some((r) => r.id === pendingId)) {
      localStorage.removeItem('er_pending_ring');
      return;
    }

    const carriedCount = rings.filter((r) => r.in_carry === 1).length;
    if (carriedCount >= carryCap) return; // still full — wait for another discard

    const carried = new Set(rings.filter((r) => r.in_carry === 1).map((r) => r.id));
    carried.add(pendingId);
    try {
      await fetch(`${API_BASE}/api/carry`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ringIds: Array.from(carried) }),
      });
    } catch {
      this.status('Network error during carry update');
      return;
    }

    localStorage.removeItem('er_pending_ring');
    if (window.__encounterState) window.__encounterState.pendingWonRing = null;
    await this.refreshManageData();
  }

  /** Destroy the overlay (host scene shutdown). */
  destroy(): void {
    if (this.spareWheelHandler) {
      this.scene.input.off('wheel', this.spareWheelHandler);
      this.spareWheelHandler = null;
    }
    if (this.manageModal) {
      this.manageModal.destroy(true);
      this.manageModal = null;
    }
    this.manageStatusText = null;
    this.onCloseCb = undefined;
    delete window.__encounterDiscardRing;
  }
}
