import Phaser from 'phaser';
import { THUMB_PASSIVE_INFO } from '../Constants';
import type { SlotKey } from '../Constants';
import { type RingData } from './InventoryGrid';
import { apiFetch, apiMutate, fetchMe, getToken } from '../net/api';
import { RingManagementOverlay } from './ui/RingManagementOverlayClass';
import type { RingManagementOverlayOpts, OverlayData } from './ui/RingManagementOverlayClass';
import { DiscardConfirm } from './ui/DiscardConfirm';
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
  private readonly onAfterRecharge?: () => void;
  private onCloseCb?: () => void;
  private overlay: RingManagementOverlay | null = null;
  private readonly discard_: DiscardConfirm;
  private allRings: RingData[] = []; private heartRing: RingData | null = null; // cached for discard label + routing
  private loadout: Record<string, string | null> = {};
  private pendingRingId_: string | null = null; private spareRingMax_: number | undefined;

  constructor(scene: Phaser.Scene, onStatus?: (msg: string) => void, onModalRender?: (c: Phaser.GameObjects.Container) => void, onAfterRecharge?: () => void) {
    this.scene = scene; this.onStatus = onStatus; this.onModalRender = onModalRender; this.onAfterRecharge = onAfterRecharge;
    this.discard_ = new DiscardConfirm(scene, onModalRender);
  }

  isOpen(): boolean { return this.overlay?.isOpen() ?? false; }
  // ── E2E bridge ──────────────────────────────────────────────────────────────
  get manageModal() { return this.overlay?.getContainer() ?? null; }
  get spareGrid()   { return this.overlay?.getSpareGrid() ?? null; }
  get swap()        { return this.overlay?.getSwap(); }
  get pendingRingId(): string | null { return this.pendingRingId_; }
  get discardConfirm(): Phaser.GameObjects.Container | null { return this.discard_.container_; }
  async refreshManageData(): Promise<void> { if (this.overlay) await this.refresh(this.overlay); }
  renderManageModal(): void { if (!this.overlay?.isOpen()) return; this.overlay.refresh({ player: { heart_ring: this.heartRing ?? null, pending_ring_id: this.pendingRingId_, spare_ring_max: this.spareRingMax_ }, rings: this.allRings, loadout: this.loadout }); }

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

  close(): void { this.discard_.dismiss(); this.overlay?.close(); this.overlay = null; }
  destroy(): void { this.close(); }

  private cache(d: OverlayData): void {
    this.allRings = d.rings; this.heartRing = d.player?.heart_ring ?? null;
    this.loadout = d.loadout ?? {}; this.pendingRingId_ = d.player?.pending_ring_id ?? null; this.spareRingMax_ = d.player?.spare_ring_max;
  }

  private makeOpts(): RingManagementOverlayOpts {
    return {
      resolveMove: async (id, from, to, ov) => {
        let lastError = '';
        const onErr = (m: string): void => { lastError = m; };
        // #424 — occupied target → swap; empty target → existing insertion route.
        const occ = to === 'heart' ? (this.heartRing?.id ?? null)
          : (to === 'spare' || to === 'reliquary') ? null : (this.loadout[to] ?? null);
        const ok = occ && occ !== id
          ? await this.send('PUT', '/api/rings/swap', { ringId1: id, ringId2: occ }, onErr)
          : await this.send('PUT', to === 'heart' || from === 'heart' ? '/api/heart-slot' : '/api/loadout',
              to === 'heart' ? (from === 'spare' ? { ringId: id, releaseTo: 'spare' } : { releaseTo: from })
              : from === 'heart' ? { releaseTo: to } : from === 'spare' ? { [to]: id }
              : { [to]: id, [from]: this.loadout[to] ?? null }, onErr);
        if (ok) ov.clearSelection();
        await this.refresh(ov);
        if (!ok && lastError) ov.setStatusMessage(lastError);
        return ok;
      },
      onRecharge: async () => {
        await this.send('POST', '/api/spirit/recharge-all', {}); if (this.overlay) await this.refresh(this.overlay);
        this.onAfterRecharge?.(); // #460 — e.g. BaseBiomeScene repaints the overworld spirit HUD
      },
      onRechargeSlotClick: (ringId, ov) => { // #462 — targeted recharge via this.send()
        void this.send('POST', '/api/spirit/recharge', { ringId }).then(() => { if (ov.isOpen()) void this.refresh(ov); });
      },
      getThumbTooltip: () => {
        const t = this.allRings.find((r) => r.id === (this.loadout.thumb ?? ''));
        const info = t && THUMB_PASSIVE_INFO[t.element];
        return !t ? '' : info ? `${info.name}\n${info.effect}` : 'No passive\nFused rings grant no passive';
      },
      onSlotClick: async (slot, ov) => {
        const sel = ov.selection;
        if (sel) { await ov.moveRingTo(slot as SwapSlot); }
        else if (slot === 'heart' && this.heartRing) { ov.selectRing(this.heartRing.id, 'heart'); await this.refresh(ov); }
        else { const rid = this.loadout[slot as BattleSlot] ?? null; if (rid) { ov.selectRing(rid, slot as SwapSlot); await this.refresh(ov); } }
      },
      onDiscardSlotClick: (ov) => {
        const sel = ov.selection;
        if (!sel) return;
        const isPending = sel.ringId === this.pendingRingId_;
        const ring = sel.source === 'heart' ? this.heartRing : this.allRings.find((r) => r.id === sel.ringId) ?? null;
        this.discard_.open(ring, sel.ringId,
          () => this.doConfirm(sel.ringId, sel.source, isPending),
          () => { ov.clearSelection(); },
        );
      },
      onBenchGridSelect: async (ring, ov) => {
        if (!ring) { ov.clearSelection(); await this.refresh(ov); return; }
        const sel = ov.selection;
        // #424: cross-pool selection on an occupied bench card → swap (the WON ring uses
        // source='spare' by BHC convention but sits in the pending pool, so test by id too).
        if (sel && (sel.source !== 'spare' || sel.ringId === this.pendingRingId_)) { let em = ''; const ok = await this.send('PUT', '/api/rings/swap', { ringId1: sel.ringId, ringId2: ring.id }, (m) => { em = m; }); if (ok) ov.clearSelection(); await this.refresh(ov); if (!ok && em) ov.setStatusMessage(em); return; }
        if (ov.selection?.ringId === ring.id) ov.clearSelection(); else ov.selectRing(ring.id, 'spare');
        await this.refresh(ov);
      },
      onBenchGhostClick: async (ov) => {
        const sel = ov.selection;
        if (!sel) return;
        if (sel.ringId === this.pendingRingId_) {
          // WON ring → accept to bench via PUT /api/rings/:id/accept
          let lastError = '';
          const onErr = (m: string): void => { lastError = m; };
          const ok = await this.send('PUT', `/api/rings/${sel.ringId}/accept`, {}, onErr);
          if (ok) { ov.clearSelection(); await this.refresh(ov); }
          else if (lastError) ov.setStatusMessage(lastError);
        } else {
          // Regular ring → move to bench. Routes through ov.moveRingTo → swap.moveTo
          // → resolveMove, which honours the #421 error-surfacing contract
          // (hold selection on failure, re-apply the message after refresh).
          await ov.moveRingTo('spare');
        }
      },
      onRender: (c) => this.onModalRender?.(c),
      onStatus: (msg) => this.onStatus?.(msg),
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

  private async send(method: 'PUT' | 'POST', url: string, body: Record<string, unknown>, onErr?: (m: string) => void): Promise<boolean> {
    const r = await apiMutate(method, url, body);
    if (!r.ok) {
      const m = /spare grid full/i.test(r.error ?? '')
        ? 'Bench is full — discard a ring or move one to a battle slot first'
        : r.error || 'Network error — please retry';
      this.onStatus?.(m); onErr?.(m);
    }
    return r.ok;
  }

  private async deleteRing(id: string): Promise<void> {
    try {
      const res = await apiFetch(`/api/rings/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        this.onStatus?.(body.error ?? 'Could not discard ring');
      }
    } catch {
      this.onStatus?.('Network error — could not discard ring');
    }
    if (this.overlay) await this.refresh(this.overlay);
  }

  private doConfirm(ringId: string, source: SwapSlot | null, isPending: boolean): void {
    void this.deleteRing(ringId);
    this.overlay?.clearSelection(); // mirror old dismissConfirm — never hold a deleted ring
    if (window.__encounterState && isPending) window.__encounterState.pendingWonRing = null;
  }
}
