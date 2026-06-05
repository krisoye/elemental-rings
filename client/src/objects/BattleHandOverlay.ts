import Phaser from 'phaser';
import { CANVAS_W, CANVAS_H, ELEMENT_NAMES, THUMB_PASSIVE_INFO } from '../Constants';
import type { SlotKey } from '../Constants';
import { type RingData } from './InventoryGrid';
import { apiFetch, fetchMe, getToken } from '../net/api';
import { RingManagementOverlay } from './ui/RingManagementOverlayClass';
import type { RingManagementOverlayOpts, OverlayData } from './ui/RingManagementOverlayClass';
import { clearRingMgmtState } from './ui/RingManagementOverlay';
import type { SwapSlot } from './ui/SlotSwapManager';

/**
 * #395 — Field ring-management adapter (≤200 lines). Wraps `RingManagementOverlay`
 * in `'field'` mode. All render/swap logic lives in the overlay class; this adapter
 * fetches /api/me, publishes E2E hooks, owns the discard-confirm flow, and relays
 * `open()` / `close()` / `isOpen()` so call sites are unchanged.
 */

type BattleSlot = SlotKey;
type HeartCardState =
  | { equipped: true; element: number; currentUses: number; maxUses: number }
  | { equipped: false };
const setHCS = (s: HeartCardState | undefined): void => {
  (window as any).__heartCardState = s;
};

export class BattleHandOverlay {
  private readonly scene: Phaser.Scene;
  private readonly onStatus?: (msg: string) => void;
  private readonly onModalRender?: (c: Phaser.GameObjects.Container) => void;
  private onCloseCb?: () => void;
  private overlay: RingManagementOverlay | null = null;
  private discardConfirm_: Phaser.GameObjects.Container | null = null;
  private discardKeyHandlers: (() => void) | null = null;
  // Cached for discard confirm label + routing.
  private allRings: RingData[] = [];
  private heartRing: RingData | null = null;
  private loadout: Record<string, string | null> = {};
  private pendingRingId_: string | null = null; private spareRingMax_: number | undefined;

  constructor(
    scene: Phaser.Scene,
    onStatus?: (msg: string) => void,
    onModalRender?: (c: Phaser.GameObjects.Container) => void,
  ) {
    this.scene = scene;
    this.onStatus = onStatus;
    this.onModalRender = onModalRender;
  }

  isOpen(): boolean { return this.overlay?.isOpen() ?? false; }
  // ── E2E bridge ──────────────────────────────────────────────────────────────
  get manageModal() { return this.overlay?.getContainer() ?? null; }
  get spareGrid()   { return this.overlay?.getSpareGrid() ?? null; }
  get swap()        { return this.overlay?.getSwap(); }
  get pendingRingId(): string | null { return this.pendingRingId_; }
  get discardConfirm(): Phaser.GameObjects.Container | null { return this.discardConfirm_; }
  async refreshManageData(): Promise<void> { if (this.overlay) await this.refresh(this.overlay); }
  renderManageModal(): void {
    if (!this.overlay?.isOpen()) return;
    this.overlay.refresh({ player: { heart_ring: this.heartRing ?? null, pending_ring_id: this.pendingRingId_, spare_ring_max: this.spareRingMax_ }, rings: this.allRings, loadout: this.loadout });
  }

  async open(onClose?: () => void): Promise<void> {
    if (this.overlay?.isOpen()) return;
    if (onClose) this.onCloseCb = onClose;
    if (!getToken()) return;
    let data: OverlayData;
    try { data = await fetchMe<OverlayData>(); } catch { return; }
    if (this.overlay?.isOpen()) return;
    this.cache(data);
    this.overlay = new RingManagementOverlay(this.scene, 'field', this.makeOpts());
    window.__battleHandOpen = true;
    this.overlay.open(data, () => {
      window.__battleHandOpen = false; setHCS(undefined); clearRingMgmtState();
      delete window.__encounterDiscardRing;
      const cb = this.onCloseCb; this.onCloseCb = undefined; cb?.();
    });
    const h = data.player?.heart_ring ?? null;
    setHCS(h ? { equipped: true, element: h.element, currentUses: h.current_uses, maxUses: h.max_uses } : { equipped: false });
    window.__encounterDiscardRing = (id: string): void => void this.deleteRing(id);
  }

  close(): void { this.dismissConfirm(); this.overlay?.close(); this.overlay = null; }
  destroy(): void { this.close(); }

  private cache(d: OverlayData): void {
    this.allRings = d.rings; this.heartRing = d.player?.heart_ring ?? null;
    this.loadout = d.loadout ?? {}; this.pendingRingId_ = d.player?.pending_ring_id ?? null;
    this.spareRingMax_ = d.player?.spare_ring_max;
  }

  private makeOpts(): RingManagementOverlayOpts {
    return {
      resolveMove: async (id, from, to, ov) => {
        if (to === 'heart') {
          from === 'spare'
            ? await this.apiPut('/api/heart-slot', { ringId: id, releaseTo: 'spare' })
            : await this.apiPut('/api/heart-slot', { releaseTo: from });
        } else if (from === 'heart') {
          await this.apiPut('/api/heart-slot', { releaseTo: to });
        } else if (from === 'spare') {
          await this.apiPut('/api/loadout', { [to]: id });
        } else {
          await this.apiPut('/api/loadout', { [to]: id, [from]: this.loadout[to] ?? null });
        }
        ov.clearSelection();
        await this.refresh(ov);
      },
      onRecharge: async () => {
        await this.apiPost('/api/spirit/recharge-all', {});
        if (this.overlay) await this.refresh(this.overlay);
      },
      getThumbTooltip: () => {
        const tid = this.loadout.thumb ?? null;
        const t = tid ? this.allRings.find((r) => r.id === tid) : undefined;
        if (!t) return '';
        const info = THUMB_PASSIVE_INFO[t.element];
        return info ? `${info.name}\n${info.effect}` : 'No passive\nFused rings grant no passive';
      },
      onSlotClick: async (slot, ov) => {
        const sel = ov.selection;
        if (sel) { await ov.moveRingTo(slot as SwapSlot); }
        else if (slot === 'heart' && this.heartRing) { ov.selectRing(this.heartRing.id, 'heart'); await this.refresh(ov); }
        else { const rid = this.loadout[slot as BattleSlot] ?? null; if (rid) { ov.selectRing(rid, slot as SwapSlot); await this.refresh(ov); } }
      },
      onDiscardSlotClick: (ov) => {
        const sel = ov.selection;
        if (sel) this.openConfirm(sel.ringId, sel.source);
      },
      onBenchGridSelect: async (ring, ov) => {
        if (!ring) { ov.clearSelection(); await this.refresh(ov); return; }
        const sel = ov.selection;
        if (sel?.source === 'heart') { await this.apiPut('/api/heart-slot', { ringId: ring.id, releaseTo: 'spare' }); ov.clearSelection(); await this.refresh(ov); return; }
        if (sel && sel.source !== 'spare') { await ov.moveRingTo('spare'); return; }
        if (ov.selection?.ringId === ring.id) ov.clearSelection(); else ov.selectRing(ring.id, 'spare');
        await this.refresh(ov);
      },
      onRender: (c) => this.onModalRender?.(c),
      onStatus: (msg) => this.onStatus?.(msg), // P2-B: surface network errors
    };
  }

  private async refresh(ov: RingManagementOverlay): Promise<void> {
    if (!getToken()) return;
    try {
      const d = await fetchMe<OverlayData>();
      this.cache(d); ov.refresh(d);
      const h = d.player?.heart_ring ?? null;
      setHCS(h ? { equipped: true, element: h.element, currentUses: h.current_uses, maxUses: h.max_uses } : { equipped: false });
    } catch { this.onStatus?.('Network error — please retry'); }
  }

  private async apiPut(url: string, body: Record<string, unknown>): Promise<void> {
    if (getToken()) try { await apiFetch(url, { method: 'PUT', json: body }); } catch { this.onStatus?.('Network error — please retry'); }
  }
  private async apiPost(url: string, body: Record<string, unknown>): Promise<void> {
    if (getToken()) try { await apiFetch(url, { method: 'POST', json: body }); } catch { this.onStatus?.('Network error — please retry'); }
  }
  private async deleteRing(id: string): Promise<void> {
    await apiFetch(`/api/rings/${id}`, { method: 'DELETE' });
    if (this.overlay) await this.refresh(this.overlay);
  }

  // ── Discard confirm (#348) ─────────────────────────────────────────────────
  private openConfirm(ringId: string, source: SwapSlot | null): void {
    if (this.discardConfirm_) return;
    const isPending = source === null && ringId === this.pendingRingId_;
    const ring = source === 'heart' ? this.heartRing : this.allRings.find((r) => r.id === ringId) ?? null;
    const en = ring ? (ELEMENT_NAMES[ring.element] ?? '?') : '?';
    const tier = ring ? ring.tier : '?';
    const bg = this.scene.add.rectangle(CANVAS_W / 2, CANVAS_H / 2, 460, 110, 0x000000, 0.9).setScrollFactor(0).setStrokeStyle(2, 0xff4444);
    const txt = this.scene.add.text(CANVAS_W / 2, CANVAS_H / 2 - 20, `Discard ${en} T${tier} ring? Permanent.`, { fontSize: '16px', color: '#ffdddd' }).setScrollFactor(0).setOrigin(0.5);
    const yBtn = this.scene.add.text(CANVAS_W / 2 - 70, CANVAS_H / 2 + 22, '[Discard]', { fontSize: '15px', color: '#ff8888' }).setScrollFactor(0).setOrigin(0.5).setInteractive({ useHandCursor: true }).setName('discard-confirm-yes').on('pointerdown', () => this.doConfirm(ringId, source, isPending));
    const nBtn = this.scene.add.text(CANVAS_W / 2 + 70, CANVAS_H / 2 + 22, '[Cancel]', { fontSize: '15px', color: '#aaccff' }).setScrollFactor(0).setOrigin(0.5).setInteractive({ useHandCursor: true }).setName('discard-confirm-no').on('pointerdown', () => this.dismissConfirm());
    const p = this.scene.add.container(0, 0, [bg, txt, yBtn, nBtn]).setDepth(3000);
    this.onModalRender?.(p);
    this.discardConfirm_ = p; window.__discardConfirmOpen = true;
    const kb = this.scene.input.keyboard;
    if (kb) {
      const KC = Phaser.Input.Keyboard.KeyCodes;
      const yk = kb.addKey(KC.Y); const nk = kb.addKey(KC.N);
      const onY = (): void => this.doConfirm(ringId, source, isPending);
      const onN = (): void => this.dismissConfirm();
      yk.on('down', onY); nk.on('down', onN);
      this.discardKeyHandlers = () => { yk.off('down', onY); nk.off('down', onN); };
    }
  }
  private doConfirm(ringId: string, source: SwapSlot | null, isPending: boolean): void {
    this.dismissConfirm();
    void this.deleteRing(ringId);
    if (window.__encounterState && isPending) window.__encounterState.pendingWonRing = null;
  }
  private dismissConfirm(): void {
    const was = this.discardConfirm_ !== null;
    this.discardKeyHandlers?.(); this.discardKeyHandlers = null;
    this.discardConfirm_?.destroy(true); this.discardConfirm_ = null;
    window.__discardConfirmOpen = false;
    if (was) this.overlay?.clearSelection();
  }
}
