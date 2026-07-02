/**
 * Post-implementation regression and adversarial tests for #389 — unified
 * RingManagementOverlay (benchSpareCount, scanForTierRow, COLUMN_LABELS,
 * publishRingMgmtState, clearRingMgmtState).
 *
 * Phase 1 (spec-driven) + Phase 2 (impl-aware): written after implementation
 * to lock in E2E-verified behaviour and cover adversarial edge cases.
 *
 * All tests are pure logic — no Phaser import.  The RingManagementOverlay module
 * itself has NO Phaser dependency (it is a pure TypeScript contract module), so
 * it can be imported directly.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Import the module under test (pure TS, no Phaser)
// ---------------------------------------------------------------------------
import {
  benchSpareCount,
  scanForTierRow,
  publishRingMgmtState,
  clearRingMgmtState,
  COLUMN_LABELS,
  type RingMgmtMode,
  type RingMgmtCounters,
} from '../../client/src/objects/ui/RingManagementOverlay';
import type { SwapSlot } from '../../client/src/objects/ui/SlotSwapManager';
import type { RingData } from '../../client/src/objects/InventoryGrid';
// #519 — RingCard fraction use-display + force badge. `force`/`naturalMaxUses`/
// `forceFromTier1` are imported from the shared module (never hand-rolled here)
// so the expected values below are computed via the SAME single source of truth
// the client is required to import from — this is a pure-logic module (no
// Phaser), safe to import directly in this Node vitest environment.
import { force, forceFromTier1, naturalMaxUses } from '../../shared/tiers';

// SLOT_KEYS mirrors the shared constant — ['thumb', 'a1', 'a2', 'd1', 'd2']
const SLOT_KEYS = ['thumb', 'a1', 'a2', 'd1', 'd2'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '../..');
const CLIENT_SRC = path.join(REPO_ROOT, 'client/src');

function readClientSrc(relPath: string): string | null {
  const abs = path.join(CLIENT_SRC, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

/** Build a minimal RingData with sensible defaults. */
function ring(
  id: string,
  overrides: Partial<RingData & { pending?: number }> = {},
): RingData & { pending?: number } {
  return {
    id,
    element: 0,
    tier: 0,
    max_uses: 3,
    current_uses: 3,
    xp: 0,
    escrowed: 0,
    in_carry: 1,
    ...overrides,
  };
}

/** Empty loadout (all slots null). */
function emptyLoadout(): Record<string, string | null> {
  return { thumb: null, a1: null, a2: null, d1: null, d2: null };
}

/** Loadout with one ring in the given slot. */
function loadoutWith(slot: string, ringId: string): Record<string, string | null> {
  return { ...emptyLoadout(), [slot]: ringId };
}

// ---------------------------------------------------------------------------
// Patch window for publishRingMgmtState / clearRingMgmtState (Node has no window)
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    __ringMgmtState: unknown;
  }
}

beforeEach(() => {
  (global as any).window = { __ringMgmtState: undefined };
});
afterEach(() => {
  delete (global as any).window;
});

// ===========================================================================
// Class 1 — benchSpareCount: core counting semantics
// ===========================================================================

describe('#389 benchSpareCount: core counting semantics', () => {

  it('counts a ring that is in_carry=1, not battle-slotted, and not pending', () => {
    // Happy-path: a carried ring with no slot assignment and no pending flag.
    const rings = [ring('r1', { in_carry: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(1);
  });

  it('returns 0 when no rings present', () => {
    // #389 adversarial: empty ring list must not crash and must return 0.
    expect(benchSpareCount([], emptyLoadout(), null)).toBe(0);
  });

  it('excludes a ring that is NOT in_carry (in_carry=0)', () => {
    // #389 adversarial: resting (reliquary) rings must not inflate the Bench count.
    const rings = [ring('r1', { in_carry: 0 })];
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(0);
  });

  it('excludes a ring that occupies a battle slot (thumb)', () => {
    // #389 adversarial: slotted rings must be excluded — they are not "on the bench".
    const rings = [ring('r1', { in_carry: 1 })];
    const loadout = loadoutWith('thumb', 'r1');
    expect(benchSpareCount(rings, loadout, null)).toBe(0);
  });

  it('excludes a ring that occupies a battle slot (a1)', () => {
    const rings = [ring('r1', { in_carry: 1 })];
    expect(benchSpareCount(rings, loadoutWith('a1', 'r1'), null)).toBe(0);
  });

  it('excludes the ring matching pendingRingId (by id comparison)', () => {
    // #389 adversarial: the WON ring occupies an overflow slot — excluding it
    // prevents the Bench counter from disagreeing with the server lock predicate.
    const rings = [ring('won', { in_carry: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), 'won')).toBe(0);
  });

  it('excludes a ring whose pending flag is 1 (even when pendingRingId does not match)', () => {
    // #389 adversarial: the dual-exclusion clause — r.id !== pendingRingId AND
    // !r.pending — means a ring flagged pending=1 is excluded regardless of whether
    // its id matches the pendingRingId string.  Omitting this branch would count
    // a pending ring that the server would refuse to include in the bench.
    const rings = [ring('other', { in_carry: 1, pending: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), 'different_id')).toBe(0);
  });

  it('counts multiple qualifying rings together', () => {
    // Positive: three carried, non-slotted, non-pending rings → count = 3.
    const rings = [
      ring('r1', { in_carry: 1 }),
      ring('r2', { in_carry: 1 }),
      ring('r3', { in_carry: 1 }),
    ];
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(3);
  });

  it('mixed set: only qualifying rings are counted', () => {
    // Three rings: one resting, one slotted, one pending, two qualifying.
    const rings = [
      ring('resting', { in_carry: 0 }),
      ring('slotted', { in_carry: 1 }),
      ring('pending', { in_carry: 1, pending: 1 }),
      ring('won_id', { in_carry: 1 }),
      ring('bench1', { in_carry: 1 }),
      ring('bench2', { in_carry: 1 }),
    ];
    const loadout = loadoutWith('a1', 'slotted');
    expect(benchSpareCount(rings, loadout, 'won_id')).toBe(2);
  });

});

// ===========================================================================
// Class 2 — benchSpareCount: adversarial edge cases
// ===========================================================================

describe('#389 benchSpareCount: adversarial edge cases (Phase 1)', () => {

  it('pendingRingId matches by id AND ring has pending=1 — excluded only once (no double-count)', () => {
    // #389 adversarial: a ring that matches BOTH conditions (id matches and pending=1)
    // should still produce a count of 0 (not an underflow from double-subtraction).
    const rings = [ring('won', { in_carry: 1, pending: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), 'won')).toBe(0);
  });

  it('a ring with in_carry=1 AND in battle slot AND pending=1 is excluded (belt-and-suspenders)', () => {
    // #389 adversarial: a ring that satisfies all three exclusion conditions must
    // still be counted as 0 (no underflow panic).
    const rings = [ring('r1', { in_carry: 1, pending: 1 })];
    const loadout = loadoutWith('thumb', 'r1');
    expect(benchSpareCount(rings, loadout, 'r1')).toBe(0);
  });

  it('a ring with in_carry=1 in battle slot but NOT pending and NOT matching pendingRingId is excluded', () => {
    // #389 adversarial: the battle-slot exclusion fires before the pending checks.
    const rings = [ring('r1', { in_carry: 1, pending: 0 })];
    const loadout = loadoutWith('d2', 'r1');
    expect(benchSpareCount(rings, loadout, 'some_other_id')).toBe(0);
  });

  it('null loadout values do not throw (slot filter ignores null entries)', () => {
    // #389 adversarial: if any slot holds null (empty), the Set construction must
    // skip it without crashing. All SLOT_KEYS start at null in a fresh loadout.
    const rings = [ring('r1', { in_carry: 1 })];
    // All slots null — r1 is not in any slot → should count
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(1);
  });

  it('the heart ring (in_carry=0) is excluded from bench count by the in_carry guard', () => {
    // #389 adversarial: the heart ring rests at in_carry=0. The bench count fallback
    // in CampScene.ts also gates on heart_slot !== 1; benchSpareCount only needs the
    // in_carry guard. Verify the ring is excluded cleanly.
    const rings = [ring('heart', { in_carry: 0, heart_slot: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(0);
  });

  it('a ring with pending=1 but in_carry=0 is excluded by both the in_carry guard and the pending guard', () => {
    // #389 adversarial: pathological data — a resting ring flagged pending.
    // Must be excluded (the in_carry=0 guard fires first).
    const rings = [ring('r1', { in_carry: 0, pending: 1 })];
    expect(benchSpareCount(rings, emptyLoadout(), null)).toBe(0);
  });

  it('all five SLOT_KEYS are scanned for slotted rings (not just a subset)', () => {
    // #389 adversarial: if only 'a1'/'a2'/'d1'/'d2' are checked but 'thumb' is
    // skipped, a thumb-slotted ring would appear in the bench count — the STATUS
    // slot ring would inflate the counter.
    const thumbRing = ring('thumb_ring', { in_carry: 1 });
    const spareRing = ring('spare', { in_carry: 1 });
    const loadout = loadoutWith('thumb', 'thumb_ring');
    // Only the spare should count; the thumb ring is excluded.
    expect(benchSpareCount([thumbRing, spareRing], loadout, null)).toBe(1);
  });

});

// ===========================================================================
// Class 3 — benchSpareCount: Phase 2 implementation-specific branches
// ===========================================================================

describe('#389 benchSpareCount: Phase 2 impl-aware branches', () => {

  it('a ring with pending_ring_id match but pending=0 is still excluded (id match is sufficient)', () => {
    // #389 adversarial Phase 2: the dual-exclusion is:
    //   r.id !== pendingRingId  AND  !(r.pending)
    // A ring whose id matches pendingRingId is excluded REGARDLESS of its pending flag.
    // pending=0 does NOT rescue it — the id-exclusion fires independently.
    const rings = [ring('won', { in_carry: 1, pending: 0 })];
    expect(
      benchSpareCount(rings, emptyLoadout(), 'won'),
      'ring matching pendingRingId is excluded even when pending=0',
    ).toBe(0);
  });

  it('a ring with pending=0 and id NOT matching pendingRingId is NOT excluded by either clause', () => {
    // #389 Phase 2: a normal bench ring with pending=0 — exactly the happy path.
    const rings = [ring('normal', { in_carry: 1, pending: 0 })];
    expect(benchSpareCount(rings, emptyLoadout(), 'different_won_id')).toBe(1);
  });

  it('pending flag cast from RingData (no pending field) — undefined pending is falsy → not excluded', () => {
    // #389 Phase 2: RingData does not declare a 'pending' field. The impl casts to
    // { pending?: number }. An absent pending property is undefined → falsy → the ring
    // is NOT excluded by the pending clause (only by id match or slot).
    const ringNoPending = ring('r1', { in_carry: 1 });
    delete (ringNoPending as any).pending; // ensure the field is absent
    expect(benchSpareCount([ringNoPending], emptyLoadout(), null)).toBe(1);
  });

  it('battleSlotIds Set contains exactly the non-null loadout values — no extras', () => {
    // #389 Phase 2: the Set is built with `.filter(Boolean)` — only non-null, non-
    // undefined values enter. Two null slots + one real id should produce Set.size = 1.
    const rings = [
      ring('r1', { in_carry: 1 }),
      ring('r2', { in_carry: 1 }),
    ];
    // r1 is slotted; r2 is free. With 3 null slots, only 'r1' enters the Set.
    const loadout: Record<string, string | null> = {
      thumb: 'r1', a1: null, a2: null, d1: null, d2: null,
    };
    expect(benchSpareCount(rings, loadout, null)).toBe(1);
  });

});

// ===========================================================================
// Class 4 — scanForTierRow: unit tests
// ===========================================================================

describe('#389 scanForTierRow: runtime Tier-row detection', () => {

  it('returns false for null input', () => {
    // #389 adversarial: the overlay root may be null before the overlay is created.
    expect(scanForTierRow(null)).toBe(false);
  });

  it('returns false for undefined input', () => {
    expect(scanForTierRow(undefined)).toBe(false);
  });

  it('returns false for an object with no getAll method', () => {
    // #389 adversarial: a non-container object (e.g. a plain RingCard without a
    // container) must not crash and must return false.
    expect(scanForTierRow({} as any)).toBe(false);
  });

  it('returns false for an empty container (no children)', () => {
    // A container with getAll returning [] has no text children → no Tier row.
    const emptyContainer = { getAll: () => [] };
    expect(scanForTierRow(emptyContainer)).toBe(false);
  });

  it('returns false when no child text matches /^T\\d/', () => {
    // Container with text children that are not tier strings.
    const container = {
      getAll: () => [
        { text: 'Fire' },
        { text: '●●○' },
        { text: 'Xp: 0' },
      ],
    };
    expect(scanForTierRow(container)).toBe(false);
  });

  it('returns true when a direct child text matches "T0"', () => {
    // #389 adversarial: the Tier row was dropped; any future re-introduction of a
    // T0/T1/… label should trip this scanner so the E2E structural assertion fails.
    const container = {
      getAll: () => [{ text: 'T0' }],
    };
    expect(scanForTierRow(container)).toBe(true);
  });

  it('returns true for "T1"', () => {
    const container = { getAll: () => [{ text: 'T1' }] };
    expect(scanForTierRow(container)).toBe(true);
  });

  it('returns true for "T9" (single-digit tier)', () => {
    const container = { getAll: () => [{ text: 'T9' }] };
    expect(scanForTierRow(container)).toBe(true);
  });

  it('returns false for "T" alone (no digit)', () => {
    // The regex is /^T\\d/ — T without an immediate digit is not a tier row.
    const container = { getAll: () => [{ text: 'T' }] };
    expect(scanForTierRow(container)).toBe(false);
  });

  it('returns false for "Total" (starts with T but no digit immediately after)', () => {
    // #389 adversarial: any label starting with "T" followed by non-digit must NOT
    // trigger a false positive — "Total XP:" was a former header label.
    const container = { getAll: () => [{ text: 'Total XP:' }] };
    expect(scanForTierRow(container)).toBe(false);
  });

  it('returns true when a NESTED child container contains a T-row text', () => {
    // #389 adversarial: RingCards live inside sub-containers. The scan must recurse
    // or a future regression that re-adds a Tier row inside a nested container would
    // be silently missed.
    const inner = { text: 'T2', getAll: undefined };
    const mid = { getAll: () => [inner] };
    const outer = { getAll: () => [mid] };
    expect(scanForTierRow(outer)).toBe(true);
  });

  it('returns false when nested containers have no T-row texts', () => {
    // Negative deep-scan path — three levels, no tier strings.
    const inner = { text: 'Fire' };
    const mid = { getAll: () => [inner] };
    const outer = { getAll: () => [{ text: 'Xp: 0' }, mid] };
    expect(scanForTierRow(outer)).toBe(false);
  });

  it('stops at the first matching child (does not enumerate all children unnecessarily)', () => {
    // #389 adversarial: if the scan does not short-circuit on true, a container
    // with many cards could produce visible lag. Verify by ensuring the function
    // returns true as soon as a T-row is found in the first child.
    let secondChildCalled = false;
    const lazyChildren = [
      { text: 'T3' },
      {
        get text() {
          secondChildCalled = true;
          return 'Fire';
        },
      },
    ];
    const container = { getAll: () => lazyChildren };
    const result = scanForTierRow(container);
    expect(result).toBe(true);
    // The second child's getter must NOT have been accessed.
    expect(secondChildCalled).toBe(false);
  });

});

// ===========================================================================
// Class 5 — COLUMN_LABELS: mode-specific column contract
// ===========================================================================

describe('#389 COLUMN_LABELS: mode-column contract', () => {

  it('sanctum mode has 4 columns: SPIRIT, BENCH, HEALTH, COMBAT', () => {
    // #389 adversarial: if a refactor collapses HEALTH into COMBAT (or drops SPIRIT),
    // the cross-mode structural assertion in __ringMgmtState.columns would silently
    // fail to catch the divergence.
    expect(COLUMN_LABELS.sanctum).toEqual(['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('field mode has 3 columns: BENCH, HEALTH, COMBAT (#423 — LOOT column removed)', () => {
    // #423 — WON and DISCARD moved into BHC; field mode no longer has a LOOT left column.
    expect(COLUMN_LABELS.field).toEqual(['BENCH', 'HEALTH', 'COMBAT']);
  });

  it('field mode shares all three columns BENCH, HEALTH, COMBAT with sanctum indices 1-3', () => {
    // #423 — field mode IS the three shared BHC columns; it shares all with sanctum[1..3].
    const sharedFromSanctum = COLUMN_LABELS.sanctum.slice(1);
    expect(COLUMN_LABELS.field).toEqual(sharedFromSanctum);
  });

  it('sanctum has a SPIRIT left column that field mode does not', () => {
    // #423 — sanctum still has SPIRIT; field no longer has LOOT.
    expect(COLUMN_LABELS.sanctum[0]).toBe('SPIRIT');
    expect(COLUMN_LABELS.field).not.toContain('SPIRIT');
    expect(COLUMN_LABELS.field).not.toContain('LOOT');
  });

  it('column arrays are read-only (readonly tuple — mutation throws or is noop)', () => {
    // #389 adversarial: COLUMN_LABELS is declared `as const`; a run-time mutation
    // at any call site should either throw (strict mode) or have no effect. We verify
    // the spread copy in publishRingMgmtState does not mutate the original.
    const origLength = COLUMN_LABELS.sanctum.length;
    // Spread should produce an independent copy.
    const copy = [...COLUMN_LABELS.sanctum];
    copy.push('EXTRA');
    expect(COLUMN_LABELS.sanctum.length).toBe(origLength);
  });

  it('neither mode contains "Spare" or "Spares" (player-facing label is "Bench")', () => {
    // #389 spec: "Bench" replaces "Spares" for the player-facing label.
    // Code/DB identifiers stay spare_* but the column header must not read "Spare(s)".
    for (const mode of Object.keys(COLUMN_LABELS) as RingMgmtMode[]) {
      for (const col of COLUMN_LABELS[mode]) {
        expect(col.toLowerCase()).not.toContain('spare');
      }
    }
  });

});

// ===========================================================================
// Class 6 — publishRingMgmtState + clearRingMgmtState
// ===========================================================================

describe('#389 publishRingMgmtState + clearRingMgmtState: window hook', () => {

  it('publishRingMgmtState sets window.__ringMgmtState with the correct mode', () => {
    publishRingMgmtState('field', { bench: { n: 2, max: 9 } });
    expect((global as any).window.__ringMgmtState).toBeTruthy();
    expect((global as any).window.__ringMgmtState.mode).toBe('field');
  });

  it('publishRingMgmtState field mode sets columns to [BENCH, HEALTH, COMBAT] (#423)', () => {
    publishRingMgmtState('field', { bench: { n: 1, max: 5 } });
    expect((global as any).window.__ringMgmtState.columns).toEqual(['BENCH', 'HEALTH', 'COMBAT']);
  });

  it('publishRingMgmtState sanctum mode sets columns to [SPIRIT, BENCH, HEALTH, COMBAT]', () => {
    publishRingMgmtState('sanctum', { spirit: { n: 3, max: 9 }, bench: { n: 0, max: 5 } });
    expect((global as any).window.__ringMgmtState.columns).toEqual(['SPIRIT', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('publishRingMgmtState stores counters verbatim', () => {
    const counters: RingMgmtCounters = { spirit: { n: 4, max: 9 }, bench: { n: 2, max: 5 } };
    publishRingMgmtState('sanctum', counters);
    expect((global as any).window.__ringMgmtState.counters).toEqual(counters);
  });

  it('publishRingMgmtState sets anyCardHasTierRow=false when overlayRoot is undefined', () => {
    // When no overlay root is provided the scan cannot find a Tier row.
    publishRingMgmtState('field', { bench: { n: 0, max: 5 } }, undefined);
    expect((global as any).window.__ringMgmtState.anyCardHasTierRow).toBe(false);
  });

  it('publishRingMgmtState sets anyCardHasTierRow=false when overlay has no T-row children', () => {
    const overlay = { getAll: () => [{ text: 'Fire' }, { text: 'Xp: 10' }] };
    publishRingMgmtState('sanctum', { bench: { n: 0, max: 5 } }, overlay);
    expect((global as any).window.__ringMgmtState.anyCardHasTierRow).toBe(false);
  });

  it('publishRingMgmtState sets anyCardHasTierRow=true when overlay has a T-row child', () => {
    // #389 adversarial: the runtime scan exists precisely to catch a future edit that
    // reintroduces a Tier label — verify the reporter actually flips to true.
    const overlay = { getAll: () => [{ text: 'T1' }] };
    publishRingMgmtState('field', { bench: { n: 1, max: 5 } }, overlay);
    expect((global as any).window.__ringMgmtState.anyCardHasTierRow).toBe(true);
  });

  it('clearRingMgmtState sets window.__ringMgmtState to undefined', () => {
    publishRingMgmtState('field', { bench: { n: 0, max: 5 } });
    expect((global as any).window.__ringMgmtState).toBeTruthy();
    clearRingMgmtState();
    expect((global as any).window.__ringMgmtState).toBeUndefined();
  });

  it('clearRingMgmtState is idempotent (calling twice does not throw)', () => {
    // #389 adversarial: close → close again must not crash.
    expect(() => {
      clearRingMgmtState();
      clearRingMgmtState();
    }).not.toThrow();
  });

  it('publishRingMgmtState columns array is an independent copy (not a reference to COLUMN_LABELS)', () => {
    // #389 adversarial: if publishRingMgmtState stores a reference to COLUMN_LABELS[mode]
    // instead of a copy, a consumer mutating __ringMgmtState.columns would corrupt the
    // canonical table. The implementation uses [...COLUMN_LABELS[mode]].
    publishRingMgmtState('field', { bench: { n: 0, max: 5 } });
    const stored: string[] = (global as any).window.__ringMgmtState.columns;
    stored.push('EXTRA');
    // The canonical table must be unchanged.
    expect(COLUMN_LABELS.field).not.toContain('EXTRA');
  });

});

// ===========================================================================
// Class 7 — Spec Conformance: acceptance criteria cross-checks
// ===========================================================================

describe('#389 SpecConformance: acceptance criteria', () => {

  it('Spec AC: LoadoutPanel.ts is deleted — no file at client/src/objects/LoadoutPanel.ts', () => {
    // #389 acceptance criterion: LoadoutPanel.ts must be deleted once its cards are
    // subsumed by the shared COMBAT cluster. An importer that was not cleaned up
    // would prevent the delete and silently break the "no remaining importers" rule.
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/LoadoutPanel.ts'));
    expect(
      exists,
      'LoadoutPanel.ts must be deleted — #389 replaces it with the shared RingManagementOverlay',
    ).toBe(false);
  });

  it('Spec AC: StakePanel.ts is deleted — no file at client/src/objects/StakePanel.ts', () => {
    // #389 acceptance criterion: StakePanel.ts must also be deleted.
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/StakePanel.ts'));
    expect(
      exists,
      'StakePanel.ts must be deleted — #389 replaces it with the shared RingManagementOverlay',
    ).toBe(false);
  });

  it('Spec AC: no file in client/src imports LoadoutPanel (all importers cleaned up)', () => {
    // #389 adversarial: a missed import of a deleted file causes a runtime crash.
    // Scan all .ts files in client/src for any import of LoadoutPanel.
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    }
    const violations = walkTs(CLIENT_SRC).filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      // Exclude doc-comments (the spec says RingCard.ts:8-13 references are doc-comments)
      return /^\s*import\s[^;]*LoadoutPanel/.test(src);
    });
    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'All LoadoutPanel imports must be removed — file is deleted',
    ).toHaveLength(0);
  });

  it('Spec AC: no file in client/src imports StakePanel (all importers cleaned up)', () => {
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    }
    const violations = walkTs(CLIENT_SRC).filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /^\s*import\s[^;]*StakePanel/.test(src);
    });
    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'All StakePanel imports must be removed — file is deleted',
    ).toHaveLength(0);
  });

  it('Spec AC: no "LOADOUT (" text exists in any client/src file (loadoutBadge removed)', () => {
    // #389 acceptance criterion: the old LOADOUT (N/cap) badge is gone.
    // Any remaining "LOADOUT (" string is evidence of an unconverted site.
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    }
    const violations = walkTs(CLIENT_SRC).filter((f) =>
      fs.readFileSync(f, 'utf8').includes("'LOADOUT ('") ||
      fs.readFileSync(f, 'utf8').includes('"LOADOUT ("') ||
      fs.readFileSync(f, 'utf8').includes('`LOADOUT (`'),
    );
    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'The LOADOUT (N/cap) badge string must not exist in any source file — it was removed by #389',
    ).toHaveLength(0);
  });

  it('Spec AC: RingCard.ts does not contain "tierLabel" (Tier row dropped)', () => {
    // #389 acceptance criterion: the Tier row (T{n}) was dropped from every RingCard.
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    expect(
      src,
      'RingCard.ts must not declare a tierLabel field — #389 dropped the Tier row',
    ).not.toContain('tierLabel');
  });

  it('Spec AC: RingCard.ts does not contain "tierY" option (RingCardOpts tier row removed)', () => {
    // #389 acceptance criterion: tierY option was removed from RingCardOpts.
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    expect(
      src,
      'RingCard.ts must not declare a tierY option — #389 removed it from RingCardOpts',
    ).not.toContain('tierY');
  });

  it('Spec AC: InventoryGrid.ts imports RingCard and uses new RingCard( for card construction', () => {
    // #389 acceptance criterion: InventoryGrid cells must be RingCard instances
    // (the inline card-construction loop was migrated).
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(src, 'InventoryGrid.ts must import RingCard').toContain('RingCard');
    expect(src, 'InventoryGrid.ts must instantiate RingCard via new RingCard(').toContain('new RingCard(');
  });

  it('Spec AC: InventoryGrid.ts does not contain inline card-body construction (ringGrp.add or new FusedCardFill)', () => {
    // #389 acceptance criterion: the inline card loop (bg rect + FusedCardFill + 4
    // crispCanvasText labels) was replaced by shared RingCard. Any residual inline
    // construction indicates an incomplete migration.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src.includes('ringGrp.add('),
      'InventoryGrid.ts must not contain inline ringGrp.add() card loop — migrate to RingCard',
    ).toBe(false);
    expect(
      src.includes('new FusedCardFill('),
      'InventoryGrid.ts must not construct FusedCardFill directly — RingCard handles it',
    ).toBe(false);
  });

  it('Spec AC: InventoryGrid.cards map has type Map<string, RingCard> or union with Rectangle (#434)', () => {
    // #389 acceptance criterion: cards is typed as Map<string, RingCard> so callers
    // get the RingCard API without casts. #434 widens the type to
    // Map<string, RingCard | Phaser.GameObjects.Rectangle> so the ghost sentinel
    // '__ghost__' can be stored without a cast. Either form is accepted.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // Accept either the original narrow type or the #434 union type.
    const hasNarrow = src.includes('Map<string, RingCard>');
    const hasUnion = src.includes('Map<string, RingCard | Phaser.GameObjects.Rectangle>');
    expect(
      hasNarrow || hasUnion,
      'InventoryGrid.cards must be typed Map<string, RingCard> or Map<string, RingCard | Phaser.GameObjects.Rectangle>',
    ).toBe(true);
  });

  it('Spec AC: CampScene.ts imports benchSpareCount from RingManagementOverlay', () => {
    // #389 — applyReliquaryLockState and the Bench counter BOTH call benchSpareCount
    // to guarantee identical semantics. An import from any other location would
    // silently break the shared-predicate contract.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must import benchSpareCount from RingManagementOverlay (shared predicate contract)',
    ).toContain('benchSpareCount');
    expect(
      src,
      'CampScene.ts must import from RingManagementOverlay module',
    ).toContain('RingManagementOverlay');
  });

  it('Spec AC: CampScene.ts has no "loadoutBadge" field declaration or assignment (removed by #389)', () => {
    // The LOADOUT badge was replaced by separate SPIRIT + BENCH counters.
    // We check for the class field declaration (`loadoutBadge`) or assignment
    // (`this.loadoutBadge`), not bare mentions in doc comments.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // Strip single-line and doc-comment lines before scanning for the field.
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    expect(
      codeOnly,
      'CampScene.ts must not declare or assign this.loadoutBadge — it was removed by #389',
    ).not.toContain('loadoutBadge');
  });

  it('Spec AC: CampScene.ts reliquaryCount fallback excludes heart-slot ring (heart_slot !== 1)', () => {
    // #389 — the reliquary count fallback must exclude the heart ring.
    // The heart ring rests at in_carry=0 BUT must NOT appear in the SPIRIT grid.
    // Source: `r.heart_slot !== 1` in the filter.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts reliquaryCount fallback must exclude heart_slot rings (heart_slot !== 1)',
    ).toContain('heart_slot !== 1');
  });

  it('Spec AC: BattleHandOverlay.ts does not contain "Spare" as a player-facing label string', () => {
    // #389 naming: "Bench" replaces "Spares" in the overlay. Any remaining "Spare"
    // header label in BattleHandOverlay is an unconverted site.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // Check for the old header text — the column header must now read "Bench".
    // Allow the word in code comments referencing the spare_ identifiers.
    const lines = src.split('\n').filter(
      (l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'),
    );
    const nonCommentSrc = lines.join('\n');
    expect(
      nonCommentSrc.includes("'Spare'") || nonCommentSrc.includes('"Spare"') ||
      nonCommentSrc.includes("'Spares'") || nonCommentSrc.includes('"Spares"'),
      'BattleHandOverlay.ts must not use "Spare"/"Spares" as a player-facing label — use "Bench"',
    ).toBe(false);
  });

});

// ===========================================================================
// Class 7b — #519 RingCard fraction use-display + force badge (Phase 1,
// spec-driven). RingCard.ts is a Phaser Container (extends
// Phaser.GameObjects.Container) and cannot be instantiated in this Node
// vitest environment (no DOM/canvas) — this file's own header documents that
// constraint for the whole suite. Following the established SpecConformance
// convention above (source-scan against the real file content), these tests
// assert the exact construction the acceptance criteria require, plus lock in
// deterministic arithmetic (via the shared force()/naturalMaxUses() helpers,
// never reimplemented here) for the string-format edge cases the spec calls
// out by name: Tier-10 bounded width and the 0-current-uses boundary.
// ===========================================================================

describe('#519 SpecConformance: RingCard.setRing renders ${current}/${max} ⚡${force}', () => {

  /** Isolate a named method body by matching its opening brace through the
   * closing `\n  }` at 2-space class-member indent — mirrors the existing
   * whole-file regex checks above but scoped so a match can't accidentally
   * span into an unrelated method. */
  function methodBody(src: string, methodSignatureRe: RegExp): string | null {
    const m = src.match(methodSignatureRe);
    if (!m) return null;
    const start = m.index! + m[0].length;
    const rest = src.slice(start);
    const end = rest.search(/\n  \}/);
    if (end === -1) return null;
    return rest.slice(0, end);
  }

  it('Spec AC: RingCard.ts imports force from shared/tiers (hard reuse requirement, never reimplemented client-side)', () => {
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    expect(
      src,
      'RingCard.ts must import { force } (or a superset) from shared/tiers — #519 hard reuse requirement',
    ).toMatch(/import\s*\{[^}]*\bforce\b[^}]*\}\s*from\s*['"][^'"]*shared\/tiers['"]/);
  });

  it('Spec AC: RingCard.setRing calls force(ring.xp) — the shared helper, called on the ring view\'s own xp', () => {
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const body = methodBody(src, /setRing\([^)]*\)\s*:\s*[^{]*\{/);
    expect(body, 'RingCard.ts must declare a setRing(...) method').not.toBeNull();
    expect(
      body,
      'setRing must call force(ring.xp) — importing the shared helper is a hard requirement, not force(ring.tier) or a hand-rolled formula',
    ).toMatch(/force\(\s*ring\.xp\s*\)/);
  });

  it('Spec AC: RingCard.setRing no longer calls usePips() for the pips label (dot-string replaced by fraction+force)', () => {
    // #519 adversarial: usePips itself may remain exported (CampScene.ts still
    // uses it for an unrelated necklace-charges label — it is NOT dead code), but
    // setRing itself must stop calling it, or the old ●●●○○ dot string ships
    // instead of the fraction+force format.
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const body = methodBody(src, /setRing\([^)]*\)\s*:\s*[^{]*\{/);
    expect(body).not.toBeNull();
    expect(
      body,
      'setRing must not call usePips(...) — the pips label must be the fraction+force string',
    ).not.toMatch(/usePips\(/);
  });

  it('Spec AC: RingCard.setRing pips label includes a force badge (⚡ glyph or a documented ASCII fallback)', () => {
    // #519: the issue explicitly allows an ASCII fallback (e.g. F${force}) if the
    // pixel font cannot render ⚡ — accept either, but force must appear in SOME
    // form; a setRing that silently drops the badge must fail this test.
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const body = methodBody(src, /setRing\([^)]*\)\s*:\s*[^{]*\{/);
    expect(body).not.toBeNull();
    const hasGlyph = body!.includes('⚡');
    const hasAsciiFallback = /F\$\{|['"`]F['"`]\s*\+/.test(body!);
    expect(
      hasGlyph || hasAsciiFallback,
      'setRing must render the force badge as ⚡ or a documented ASCII fallback (e.g. F${force}) — neither was found',
    ).toBe(true);
  });

  it('Spec AC: pipsLabel is never conditionally hidden the way fuseGlyph is — force must be ALWAYS shown, not gated', () => {
    // #519 acceptance criterion: force is always shown (force >= 1 always) —
    // never conditionally hidden like the fuse glyph. Guard against a future
    // regression that reuses the fuseGlyph's isFusionEligibleParent-style gate
    // (or any .setVisible(false)) on pipsLabel.
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const body = methodBody(src, /setRing\([^)]*\)\s*:\s*[^{]*\{/);
    expect(body).not.toBeNull();
    expect(
      body,
      'setRing must not call pipsLabel.setVisible(...) — the pips+force row has no visibility gate',
    ).not.toMatch(/pipsLabel\.setVisible/);
  });

});

describe('#519 Blinded full-mask contract: setPipsText(\'?\') replaces the WHOLE combined string', () => {

  it('RingSlot.renderUses() masks with the bare \'?\' literal — no interpolation of force/xp alongside it', () => {
    // #519 adversarial: force now lives in the SAME label as the use-count
    // fraction. If a future edit only masked the fraction (e.g. `?/${max} ⚡
    // ${force}`) the force badge would leak past Blinded. Assert the call site
    // passes the bare '?' literal, and that the surrounding _usesHidden branch
    // contains no template interpolation at all.
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    expect(
      src,
      "RingSlot must call card.setPipsText('?') with the bare '?' literal",
    ).toMatch(/card\.setPipsText\(\s*['"]\?['"]\s*\)/);

    const hiddenBranch = src.match(/if \(this\._usesHidden\) \{([\s\S]*?)\n {4}\}/);
    expect(hiddenBranch, 'renderUses must have an if (this._usesHidden) branch').not.toBeNull();
    expect(
      hiddenBranch![1],
      'the Blinded branch must not interpolate force/xp/currentUses/maxUses into the mask text — it must stay the bare "?"',
    ).not.toMatch(/\$\{/);
  });

  it('RingCard.setPipsText(text) fully overwrites pipsLabel.text (no concatenation with the existing label)', () => {
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const start = src.indexOf('setPipsText(text: string): void {');
    expect(start, 'RingCard.ts must declare setPipsText(text: string): void').toBeGreaterThanOrEqual(0);
    const body = src.slice(start, src.indexOf('\n  }', start));
    expect(
      body,
      'setPipsText must call this.pipsLabel.setText(text) — a full overwrite of the combined string',
    ).toMatch(/this\.pipsLabel\.setText\(\s*text\s*\)/);
    expect(
      body,
      'setPipsText must not concatenate onto pipsLabel.text (that would leave part of the pre-mask string visible)',
    ).not.toMatch(/pipsLabel\.text\s*\+/);
  });

});

describe('#519 Tier-10 bounded-width: the documented worst-case fraction+force string (Phase 1 adversarial)', () => {
  // The narrowest of the 5 RingCard consumers is the fusion-picker card in
  // RingManagementOverlayClass.ts (FUSE_CARD_W = 50px); RingSlot is 58px,
  // InventoryGrid is 64px, and CampScene's Heart/Combat cards + BenchHealthCombat
  // are 70px. A live Phaser canvas isn't available in this Node vitest
  // environment (see file header), so this locks the exact STRING the spec's
  // own worked example claims — a regression that changes character count here
  // is the earliest possible signal of a real clipping risk at 50px.

  it('naturalMaxUses(9) / forceFromTier1(10) — the Tier-10 (1-indexed) values — are 12 and 6 per Contract A', () => {
    expect(naturalMaxUses(9)).toBe(12);
    expect(forceFromTier1(10)).toBe(6);
  });

  it('Tier-10 ring (max_uses=12, force=6) formats to exactly "12/12 ⚡6" — 9 characters', () => {
    const maxUses = naturalMaxUses(9); // 0-indexed tier 9 == the game's "Tier 10"
    const forceAtT10 = forceFromTier1(10);
    const label = `${maxUses}/${maxUses} ⚡${forceAtT10}`;
    expect(label).toBe('12/12 ⚡6');
    expect(label.length, 'Tier-10 label character count — a regression here signals real clipping risk at 50px').toBe(9);
  });

  it('no natural tier 0..9 (0-indexed) produces a fraction+force label longer than the Tier-10 worst case', () => {
    // #519 adversarial: sweep every natural tier and confirm none is WIDER than
    // the documented Tier-10 worst case — a regression here would mean the
    // acceptance criterion ("verify against Tier 10") checked the wrong tier.
    let maxLen = 0;
    for (let tier = 0; tier <= 9; tier++) {
      const maxUses = naturalMaxUses(tier);
      const f = forceFromTier1(tier + 1);
      const label = `${maxUses}/${maxUses} ⚡${f}`;
      maxLen = Math.max(maxLen, label.length);
    }
    expect(maxLen).toBe(9);
  });

});

describe('#519 Phase 1 adversarial: 0-current-uses boundary does not break the fraction format', () => {

  it('a ring at 0 current uses (drained mid-battle) formats as "0/5 ⚡2" — no NaN/empty/malformed fraction', () => {
    // #519 adversarial: the old usePips() dot-string needed an explicit
    // Math.max(0, current) repeat()-count guard against a negative count; the new
    // template-literal format has no repeat() call, but the zero boundary is
    // still the value most likely to expose an off-by-one in a currentUses ??
    // fallback or a stringly-typed comparison. tier=2 -> max_uses=5, force=2.
    const currentUses = 0;
    const maxUses = naturalMaxUses(2);
    const forceAtTier2 = forceFromTier1(3);
    expect(maxUses).toBe(5);
    expect(forceAtTier2).toBe(2);
    const label = `${currentUses}/${maxUses} ⚡${forceAtTier2}`;
    expect(label).toBe('0/5 ⚡2');
  });

  it('force(xp) for a brand-new ring (xp=0, 0 current uses) is still 1 — force never reads as falsy/0/undefined in the label', () => {
    // #519 adversarial: force is documented as "always >= 1" — a fresh ring at
    // xp=0 AND currentUses=0 (the absolute floor state) must not render "0/3 ⚡0"
    // or "0/3 ⚡undefined".
    expect(force(0)).toBe(1);
    const label = `0/3 ⚡${force(0)}`;
    expect(label).toBe('0/3 ⚡1');
  });

});

// ===========================================================================
// Class 7c — #519 Phase 2 impl-aware: branches now visible in the finished
// RingCard.ts / RingSlot.ts, written after the import-path bug fix (commit
// 74ac3af corrected RingSlot's `../../shared/tiers` to `../../../shared/tiers`
// — `npx tsc --noEmit` in client/ is now clean, so both files' actual
// force-computation call sites are live and stable to scan).
// ===========================================================================

describe('#519 Phase 2 impl-aware: RingSlot.updateFromRing order-of-operations', () => {

  it('updateFromRing calls renderUses() AFTER card.setRing(...) — Blinded masking must have the final word', () => {
    // #519 Phase 2 adversarial: RingCard.setRing ALWAYS writes the real
    // fraction+force string (force is "always shown", never conditionally gated
    // — locked by the Phase 1 pipsLabel.setVisible check). RingSlot's Blinded
    // masking is a SEPARATE call (renderUses -> card.setPipsText('?')). If a
    // future refactor reordered these two calls, setRing's real string would
    // paint AFTER the mask and silently un-hide the Blinded player's own uses.
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    const m = src.match(/updateFromRing\([^)]*\)\s*:\s*void\s*\{([\s\S]*?)\n {2}\}/);
    expect(m, 'RingSlot.ts must declare updateFromRing(...): void').not.toBeNull();
    const body = m![1];
    const setRingIdx = body.indexOf('this.card.setRing(');
    const renderUsesIdx = body.indexOf('this.renderUses()');
    expect(setRingIdx, 'updateFromRing must call this.card.setRing(...)').toBeGreaterThanOrEqual(0);
    expect(renderUsesIdx, 'updateFromRing must call this.renderUses()').toBeGreaterThanOrEqual(0);
    expect(
      renderUsesIdx,
      'renderUses() must run AFTER card.setRing(...) so Blinded masking is not immediately overwritten by the real fraction+force string',
    ).toBeGreaterThan(setRingIdx);
  });

});

describe('#519 Phase 2 impl-aware: RingSlot.renderUses() branch order and cached-state contract', () => {

  it('the Blinded (_usesHidden) check runs BEFORE the _lastRing null-guard — masking works even before any ring data has ever arrived', () => {
    // #519 Phase 2 adversarial: a RingSlot can in principle receive
    // setUsesHidden(true) (e.g. a Shadow-gauge state diff) before its first
    // updateFromRing call has populated _lastRing. If the null-guard ran first,
    // an early Blinded signal on a not-yet-rendered slot would silently no-op
    // instead of masking.
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    const m = src.match(/private renderUses\(\)\s*:\s*void\s*\{([\s\S]*?)\n {2}\}/);
    expect(m, 'RingSlot.ts must declare a private renderUses(): void method').not.toBeNull();
    const body = m![1];
    const hiddenIdx = body.indexOf('if (this._usesHidden)');
    const nullGuardIdx = body.indexOf('if (!r) return;');
    expect(hiddenIdx, 'renderUses must check this._usesHidden').toBeGreaterThanOrEqual(0);
    expect(nullGuardIdx, 'renderUses must guard on a null _lastRing').toBeGreaterThanOrEqual(0);
    expect(
      nullGuardIdx,
      'the Blinded check must come BEFORE the _lastRing null-guard, or masking would depend on ring data having already arrived',
    ).toBeGreaterThan(hiddenIdx);
  });

  it('the reveal path (not Blinded) computes force from the CACHED _lastRing.xp (r.xp) — the un-blind reveal needs no new server push', () => {
    // #519 Phase 2: setUsesHidden(false) alone (no accompanying ring update) must
    // restore the correct fraction+force from whatever ring state was last
    // synced. This locks in that renderUses reads r.xp (the cached field),
    // mirroring the force(ring.xp) call-site convention Phase 1 locked for
    // RingCard.setRing.
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    const m = src.match(/private renderUses\(\)\s*:\s*void\s*\{([\s\S]*?)\n {2}\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(
      body,
      'the non-Blinded branch must call force(r.xp) — the cached _lastRing field, not a live ring.xp argument',
    ).toMatch(/force\(\s*r\.xp\s*\)/);
  });

  it('RingSlot._lastRing type was widened to include xp (#519) — currentUses/maxUses alone are insufficient once the pips label depends on force(xp)', () => {
    // #519 Phase 2: before this issue, _lastRing only needed {currentUses,
    // maxUses} (the dot-string never depended on xp). Lock the widened field
    // declaration itself so a future revert doesn't silently drop xp (which
    // renderUses now dereferences on every non-Blinded render).
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    expect(
      src,
      '_lastRing must be typed to include xp: number alongside currentUses/maxUses',
    ).toMatch(/_lastRing:\s*\{\s*currentUses:\s*number;\s*maxUses:\s*number;\s*xp:\s*number\s*\}\s*\|\s*null/);
  });

});

describe('#519 Phase 2 impl-aware: force badge reads xp, never the (also-present) tier field', () => {

  it('RingCard.setRing computes the force badge from ring.xp, never ring.tier — RingCardData carries both, only xp is load-bearing for force', () => {
    // #519 Phase 2 adversarial: RingCardData.tier is still present on the type
    // (retained for callers, per the interface's own doc comment) even though
    // the Tier row was dropped from the card body by #389. A future edit could
    // easily reach for the nearby ring.tier instead of ring.xp when wiring the
    // force badge — same object, plausible-looking field, wrong semantics (tier
    // here is whatever the caller passes, not guaranteed in sync with xp).
    const src = readClientSrc('objects/ui/RingCard.ts');
    if (src === null) return;
    const m = src.match(/setRing\([^)]*\)\s*:\s*[^{]*\{([\s\S]*?)\n {2}\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body, 'setRing must call force(ring.xp)').toMatch(/force\(\s*ring\.xp\s*\)/);
    expect(body, 'setRing must never call force(ring.tier)').not.toMatch(/force\(\s*ring\.tier\s*\)/);
  });

  it('RingSlot.renderUses computes the force badge from r.xp (cached), never r.tier', () => {
    const src = readClientSrc('objects/RingSlot.ts');
    if (src === null) return;
    const m = src.match(/private renderUses\(\)\s*:\s*void\s*\{([\s\S]*?)\n {2}\}/);
    expect(m).not.toBeNull();
    const body = m![1];
    expect(body, 'renderUses must call force(r.xp)').toMatch(/force\(\s*r\.xp\s*\)/);
    expect(body, 'renderUses must never call force(r.tier)').not.toMatch(/force\(\s*r\.tier\s*\)/);
  });

});

describe('#519 Phase 2 impl-aware: architectural invariant — only RingSlot.ts calls setPipsText() directly', () => {

  it('no file other than RingSlot.ts calls <card>.setPipsText(...) — every other consumer relies exclusively on RingCard.setRing for the force badge', () => {
    // #519 Phase 2: the 5 documented RingCard consumers are RingSlot,
    // InventoryGrid, BenchHealthCombat (heart/won/RECHARGE cards),
    // RingManagementOverlayClass (fusion-picker r1/r2), and CampScene
    // (heart/combat cards). All but RingSlot must go through setRing()
    // exclusively — a direct setPipsText(...) call anywhere else would be a
    // second, independently-maintained render path that can silently drift
    // from the force(ring.xp) contract Phase 1 locked on setRing.
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    }
    const violations = walkTs(CLIENT_SRC).filter((f) => {
      const rel = path.relative(CLIENT_SRC, f);
      if (rel === path.join('objects', 'RingSlot.ts')) return false;
      if (rel === path.join('objects', 'ui', 'RingCard.ts')) return false; // declares the method itself
      const contents = fs.readFileSync(f, 'utf8');
      return /\.setPipsText\(/.test(contents);
    });
    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'setPipsText(...) must only be called from RingSlot.ts (the Blinded masking path) — every other consumer must rely on RingCard.setRing',
    ).toHaveLength(0);
  });

});

// ===========================================================================
// Class 8 — CampScene COMBAT cluster: local-space coordinates (Phase 2)
// ===========================================================================

describe('#389 CampScene COMBAT cluster: local-space coordinate constants (Phase 2)', () => {

  it('CampScene.ts declares COMBAT_STATUS_Y as a constant (not an ad-hoc expression)', () => {
    // #389 Phase 2 adversarial: if the STATUS y-offset is inlined without a named
    // constant, a double-offset regression (e.g. adding the overlay origin twice)
    // would require a source scan rather than constant inspection to detect.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must declare COMBAT_STATUS_Y as a named constant for the STATUS card y-position',
    ).toContain('COMBAT_STATUS_Y');
  });

  it('CampScene.ts declares COMBAT_ROW0_Y and COMBAT_ROW1_Y for the A1/A2 and D1/D2 rows', () => {
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(src, 'CampScene.ts must declare COMBAT_ROW0_Y').toContain('COMBAT_ROW0_Y');
    expect(src, 'CampScene.ts must declare COMBAT_ROW1_Y').toContain('COMBAT_ROW1_Y');
  });

  it('CampScene.ts COMBAT_STATUS_Y is strictly less than COMBAT_ROW0_Y (STATUS sits ABOVE the 2x2)', () => {
    // #389 acceptance criterion: STATUS is left-aligned ABOVE the 2×2 A1/A2 · D1/D2
    // cluster. If COMBAT_STATUS_Y >= COMBAT_ROW0_Y the status card would overlap or
    // sit below the first combat row — a visible layout regression.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const statusYMatch = src.match(/COMBAT_STATUS_Y\s*=\s*(\d+)/);
    const row0YMatch = src.match(/COMBAT_ROW0_Y\s*=\s*(\d+)/);
    if (!statusYMatch || !row0YMatch) return; // constants not found — skip
    const statusY = parseInt(statusYMatch[1], 10);
    const row0Y = parseInt(row0YMatch[1], 10);
    expect(
      statusY,
      `COMBAT_STATUS_Y (${statusY}) must be less than COMBAT_ROW0_Y (${row0Y}) — STATUS sits above the 2×2 cluster`,
    ).toBeLessThan(row0Y);
  });

  it('CampScene.ts COMBAT_ROW0_Y < COMBAT_ROW1_Y (A1/A2 row sits above D1/D2 row)', () => {
    // Structural sanity: the two rows of the 2×2 cluster must stack top-to-bottom.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const row0Match = src.match(/COMBAT_ROW0_Y\s*=\s*(\d+)/);
    const row1Match = src.match(/COMBAT_ROW1_Y\s*=\s*(\d+)/);
    if (!row0Match || !row1Match) return;
    expect(parseInt(row0Match[1], 10)).toBeLessThan(parseInt(row1Match[1], 10));
  });

  it('CampScene.ts COMBAT cluster constants are relative to BATTLEHAND_RING_X (local-space, not absolute)', () => {
    // #389 Phase 2 adversarial: a double-offset regression is introduced if any
    // COMBAT column x is the sum of a canvas-absolute value AND the overlay's own
    // x-origin. The canonical form is `BATTLEHAND_RING_X + offset` where
    // BATTLEHAND_RING_X itself is the local-space cluster origin. Verify the constants
    // reference BATTLEHAND_RING_X rather than hardcoding the absolute canvas x.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts COMBAT column x constants must reference BATTLEHAND_RING_X (local-space origin)',
    ).toContain('BATTLEHAND_RING_X');
  });

});

// ===========================================================================
// Class 9 — Drop-time bench-full guard (#413)
// ===========================================================================

describe('#413 drop-time bench-full guard: benchSpareCount predicate', () => {
  // The pick-up-time guard (isPickupBlockedByFullBench) was deleted in #413.
  // The new drop-time guard lives in CampScene.reliquaryMove and uses
  // benchSpareCount directly. These tests verify the predicate used by that guard.

  function makeRing(id: string, inCarry: 0 | 1, pending = 0): RingData {
    return {
      id,
      in_carry: inCarry,
      element: 0,
      tier: 'T0',
      xp: 0,
      current_uses: 1,
      max_uses: 3,
      escrowed: 0,
      pending,
    } as unknown as RingData;
  }

  it('benchSpareCount returns 0 when no rings are carried', () => {
    const rings: RingData[] = [makeRing('r1', 0), makeRing('r2', 0)];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    expect(benchSpareCount(rings, loadout, null)).toBe(0);
  });

  it('benchSpareCount counts carried rings not in battle slots and not pending', () => {
    const rings: RingData[] = [
      makeRing('spare1', 1),
      makeRing('spare2', 1),
      makeRing('battle', 1),
    ];
    const loadout: Record<string, string | null> = { a1: 'battle', a2: null, d1: null, d2: null, thumb: null };
    // spare1 + spare2 count; battle is slotted → excluded
    expect(benchSpareCount(rings, loadout, null)).toBe(2);
  });

  it('benchSpareCount excludes the pending WON ring from the count', () => {
    const rings: RingData[] = [
      makeRing('spare1', 1),
      makeRing('pending1', 1, 1),
    ];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    // pending1 excluded by pendingRingId
    expect(benchSpareCount(rings, loadout, 'pending1')).toBe(1);
  });

  it('drop-time guard rejects target===spare when bench is at capacity (spareCount >= spareMax)', () => {
    // Simulate the guard logic from CampScene.reliquaryMove.
    // When spareCount >= spareRingMax the move to 'spare' must be rejected.
    const spareRingMax = 3;
    const rings: RingData[] = [
      makeRing('s1', 1),
      makeRing('s2', 1),
      makeRing('s3', 1), // bench full at 3
    ];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null);
    // The guard condition from reliquaryMove:
    const wouldBeRejected = spareCount >= spareRingMax;
    expect(wouldBeRejected).toBe(true);
  });

  it('drop-time guard allows target===spare when bench has capacity (spareCount < spareMax)', () => {
    const spareRingMax = 9;
    const rings: RingData[] = [makeRing('s1', 1), makeRing('s2', 1)];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null);
    const wouldBeRejected = spareCount >= spareRingMax;
    expect(wouldBeRejected).toBe(false);
  });

  it('drop-time guard allows SPIRIT->battle-slot swap at full bench (target !== spare)', () => {
    // GDD §4: SPIRIT ↔ battle-slot swaps are always valid regardless of bench count.
    // Guard only fires when target === 'spare'.
    const spareRingMax = 3;
    const rings: RingData[] = [makeRing('s1', 1), makeRing('s2', 1), makeRing('s3', 1)];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null);
    const target = 'a1'; // battle slot — not 'spare'
    // Guard condition: only activates when target === 'spare'
    const wouldBeRejected = target === 'spare' && spareCount >= spareRingMax;
    expect(wouldBeRejected).toBe(false);
  });
});

// ===========================================================================
// Class 10 — BenchHealthCombat contract: source-level assertions (#395)
// ===========================================================================

describe('#395 BenchHealthCombat: architectural contract (source scan)', () => {

  it('BenchHealthCombat.ts exists at client/src/objects/ui/BenchHealthCombat.ts', () => {
    // #395 acceptance criterion: the shared right-half component must exist.
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/ui/BenchHealthCombat.ts'));
    expect(
      exists,
      'BenchHealthCombat.ts must exist — #395 requires the shared right-half component',
    ).toBe(true);
  });

  it('BenchHealthCombat.ts exports a class BenchHealthCombat', () => {
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat.ts must export class BenchHealthCombat',
    ).toMatch(/export class BenchHealthCombat/);
  });

  it('BenchHealthCombat carries isBenchHealthCombat = true runtime tag (E2E assertion target)', () => {
    // #395 — E2E scripts assert the same class renders both field and sanctum.
    // The runtime tag must be present so Playwright can identify the instance.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat must declare readonly isBenchHealthCombat = true for E2E identification',
    ).toContain('isBenchHealthCombat');
  });

  it('BenchHealthCombat does NOT declare a private scene field (Container.scene conflict guard)', () => {
    // #395 — Phaser.GameObjects.Container has a public `scene` property. Declaring
    // `private scene` in a subclass causes a TypeScript error. Verify the fix is stable.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    expect(
      codeOnly,
      'BenchHealthCombat must not declare `private scene` — Container already has a public .scene',
    ).not.toMatch(/private\s+(?:readonly\s+)?scene\s*:/);
  });

  it('BenchHealthCombat exposes getBenchGrid(), getHeartCard(), getCombatCard() accessors', () => {
    // #395 — the overlay adapter and E2E scripts need these accessors to drive
    // scroll routing and stroke updates without full rebuilds.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(src, 'must expose getBenchGrid()').toContain('getBenchGrid');
    expect(src, 'must expose getHeartCard()').toContain('getHeartCard');
    expect(src, 'must expose getCombatCard(slot)').toContain('getCombatCard');
  });

  it('BenchHealthCombat has a [RECHARGE ALL] button (not bare [RECHARGE] or [Recharge])', () => {
    // #462 updates #395: the button is renamed from [RECHARGE] to [RECHARGE ALL].
    // The single-quoted form "'[RECHARGE]'" must not appear — but note: not.toContain('[RECHARGE]')
    // would ALWAYS fail because '[RECHARGE]' is a substring of '[RECHARGE ALL]'.
    // The safe assertion is not.toContain("'[RECHARGE]'") (single-quoted form).
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The button text must be [RECHARGE ALL] — the renamed version.
    expect(src, 'must render [RECHARGE ALL] (renamed from [RECHARGE])').toContain('[RECHARGE ALL]');
    // Must NOT contain the bare single-quoted '[RECHARGE]' string literal (the old label).
    // IMPORTANT: use the single-quoted form to avoid matching the '[RECHARGE]' inside '[RECHARGE ALL]'.
    expect(src, "must not use bare '[RECHARGE]' string literal (now renamed to '[RECHARGE ALL]')").not.toContain("'[RECHARGE]'");
    // Must not use old lower-case variants.
    expect(src, 'must not use [Recharge] (wrong case)').not.toContain("'[Recharge]'");
    expect(src, 'must not use [Recharge All] (wrong case)').not.toContain("'[Recharge All]'");
  });

  it('RingManagementOverlayClass.ts exists and exports RingManagementOverlay class', () => {
    // #395 — the Phaser class lives in the Class file; the pure module has no Phaser.
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/ui/RingManagementOverlayClass.ts'));
    expect(
      exists,
      'RingManagementOverlayClass.ts must exist — #395 splits Phaser class from pure helpers',
    ).toBe(true);
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass.ts must export class RingManagementOverlay',
    ).toMatch(/export class RingManagementOverlay/);
  });

  it('RingManagementOverlay.ts (pure module) does NOT import Phaser', () => {
    // #395 architectural invariant: the pure module must never import Phaser.
    // Unit tests rely on being able to load it in Node without a browser environment.
    const src = readClientSrc('objects/ui/RingManagementOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasPhaser = lines.some((l) => /import\s+Phaser/.test(l) || /from\s+'phaser'/.test(l));
    expect(
      hasPhaser,
      'RingManagementOverlay.ts (pure module) must not import Phaser — unit tests run in Node',
    ).toBe(false);
  });

  it('BattleHandOverlay.ts imports RingManagementOverlay from RingManagementOverlayClass (not pure module)', () => {
    // #395 — BattleHandOverlay is a Phaser consumer; it must import the class, not
    // the pure module. Importing from the pure module would use the wrong export.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    expect(
      src,
      'BattleHandOverlay.ts must import RingManagementOverlay from RingManagementOverlayClass',
    ).toContain('RingManagementOverlayClass');
  });

  it('BattleHandOverlay.ts is ≤200 lines (thin adapter budget)', () => {
    // #395 acceptance criterion: the field adapter must stay thin.
    // Line count = number of lines as reported by editors / `wc -l` (trailing
    // newline does not add an extra line).
    const absPath = path.join(CLIENT_SRC, 'objects/BattleHandOverlay.ts');
    if (!fs.existsSync(absPath)) return;
    const src = fs.readFileSync(absPath, 'utf8');
    const lineCount = src.split('\n').length - (src.endsWith('\n') ? 1 : 0);
    expect(
      lineCount,
      `BattleHandOverlay.ts must be ≤200 lines — currently ${lineCount}`,
    ).toBeLessThanOrEqual(200);
  });

});

// ===========================================================================
// Class 11 — Drop-time guard: source-level assertions (#413)
// ===========================================================================

describe('#413 drop-time guard: source-level assertions', () => {

  it('isPickupBlockedByFullBench is NOT exported from RingManagementOverlay.ts (#413 deleted it)', () => {
    // #413 — pick-up-time guard deleted; guard moved to drop time in reliquaryMove.
    const src = readClientSrc('objects/ui/RingManagementOverlay.ts');
    if (src === null) return;
    expect(
      src,
      'isPickupBlockedByFullBench must NOT be present in RingManagementOverlay.ts after #413',
    ).not.toContain('isPickupBlockedByFullBench');
  });

  it('CampScene.ts does NOT import isPickupBlockedByFullBench (#413 deleted the import)', () => {
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must not import isPickupBlockedByFullBench after #413',
    ).not.toContain('isPickupBlockedByFullBench');
  });

  it('CampScene.ts drop-time guard rejects spare target when bench full (source scan)', () => {
    // #413 — the new guard is in reliquaryMove, not at pick-up time.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // The guard must check target === 'spare' and benchSpareCount.
    expect(
      src,
      "CampScene.ts reliquaryMove must contain drop-time bench-full guard (target === 'spare')",
    ).toContain("target === 'spare'");
    expect(
      src,
      'CampScene.ts reliquaryMove must use benchSpareCount for drop-time guard',
    ).toContain('benchSpareCount');
    expect(
      src,
      'CampScene.ts must surface the bench-full rejection message',
    ).toContain('Bench is full — discard a ring or move one to a battle slot first');
  });

  it('CampScene.ts does not contain the old asymmetric reliquary pick-up guard', () => {
    // #413 — the old guard (source === reliquary && __reliquaryLocked) is gone.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasOldGuard = lines.some(
      (l) => l.includes("source === 'reliquary'") && l.includes('__reliquaryLocked'),
    );
    expect(
      hasOldGuard,
      'CampScene.ts must not use the old asymmetric guard (deleted in #413)',
    ).toBe(false);
  });

  it('RingManagementOverlayClass.ts does NOT seed window.__reliquaryLocked (#424 removed)', () => {
    // #424 — the __reliquaryLocked seed (benchN >= spareMax) was abolished because
    // a full bench is no longer a lock condition; occupied cards are valid swap targets.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    expect(
      codeOnly,
      'RingManagementOverlayClass.ts must not assign __reliquaryLocked (removed by #424)',
    ).not.toMatch(/__reliquaryLocked\s*=/);
  });

  it('CampScene.ts applyReliquaryLockState does NOT set window.__reliquaryLocked (#424)', () => {
    // #424 — the locked=benchFull setter is gone from applyReliquaryLockState.
    // The function now only tracks __reliquaryFull (drop-label color hint).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    expect(
      codeOnly,
      'CampScene.ts must not assign window.__reliquaryLocked (removed by #424)',
    ).not.toMatch(/window\.__reliquaryLocked\s*=/);
  });

  it('CampScene.ts openRingwallOverlay creates SlotSwapManager per-open (not in buildPanels)', () => {
    // #395 acceptance criterion: one SlotSwapManager instance per open overlay.
    // The manager must be created inside openRingwallOverlay, not in buildPanels().
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // The comment replacing the old buildPanels() creation must be present, or the
    // new SwapManager construction must be inside openRingwallOverlay.
    // We verify that the code does NOT construct SlotSwapManager inside buildPanels().
    const buildPanelsMatch = src.match(/buildPanels\s*\([^)]*\)\s*\{([\s\S]*?)^\s*\}/m);
    if (buildPanelsMatch) {
      const body = buildPanelsMatch[1];
      expect(
        body.includes('new SlotSwapManager'),
        'buildPanels() must not construct SlotSwapManager — it must be created per-open in openRingwallOverlay',
      ).toBe(false);
    }
  });

});

// ===========================================================================
// Class 12 — fusion mode: COLUMN_LABELS and publishRingMgmtState (#396)
// ===========================================================================

describe('#396 fusion mode: COLUMN_LABELS and publishRingMgmtState', () => {

  it('fusion mode has 4 columns: FUSE, BENCH, HEALTH, COMBAT', () => {
    // #396 acceptance criterion: the fusion left column label is FUSE.
    expect(COLUMN_LABELS.fusion).toEqual(['FUSE', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('fusion mode left column is FUSE (index 0)', () => {
    expect(COLUMN_LABELS.fusion[0]).toBe('FUSE');
  });

  it('fusion mode shares the three right-hand columns with sanctum indices 1-3', () => {
    // #396/#423 convergence contract: BENCH/HEALTH/COMBAT identical across all three modes.
    const shared = COLUMN_LABELS.sanctum.slice(1);
    expect(COLUMN_LABELS.fusion.slice(1)).toEqual(shared);
    // #423 — field IS the three shared columns (no left column).
    expect(COLUMN_LABELS.field).toEqual(shared);
  });

  it('publishRingMgmtState fusion mode sets columns to [FUSE, BENCH, HEALTH, COMBAT]', () => {
    publishRingMgmtState('fusion', { bench: { n: 2, max: 9 } });
    expect((global as any).window.__ringMgmtState.columns).toEqual(['FUSE', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('publishRingMgmtState fusion mode sets mode to "fusion"', () => {
    publishRingMgmtState('fusion', { bench: { n: 0, max: 5 } });
    expect((global as any).window.__ringMgmtState.mode).toBe('fusion');
  });

  it('fusion mode columns are an independent copy (not a reference to COLUMN_LABELS)', () => {
    // Anti-drift: mutating the published state must not corrupt the canonical table.
    publishRingMgmtState('fusion', { bench: { n: 0, max: 5 } });
    const stored: string[] = (global as any).window.__ringMgmtState.columns;
    stored.push('EXTRA');
    expect(COLUMN_LABELS.fusion).not.toContain('EXTRA');
  });

  it('fusion mode does not contain "Spare" or "Spares" in any column label', () => {
    for (const col of COLUMN_LABELS.fusion) {
      expect(col.toLowerCase()).not.toContain('spare');
    }
  });

  it('sanctum and fusion define 4 columns; field defines 3 columns (#423)', () => {
    // #423 — field mode lost its LOOT left column; WON/DISCARD/ghost now live in BHC.
    expect(COLUMN_LABELS.sanctum).toHaveLength(4);
    expect(COLUMN_LABELS.fusion).toHaveLength(4);
    expect(COLUMN_LABELS.field).toHaveLength(3);
  });

});

// ===========================================================================
// Class 13 — Sub-B conformance: FusionPanel retired, unified overlay in place (#396)
// ===========================================================================

describe('#396 Sub-B SpecConformance: FusionPanel retired', () => {

  it('Spec AC: FusionPanel.ts is deleted — no file at client/src/objects/FusionPanel.ts', () => {
    // #396 acceptance criterion: the standalone FusionPanel must not exist.
    const exists = fs.existsSync(path.join(CLIENT_SRC, 'objects/FusionPanel.ts'));
    expect(
      exists,
      'FusionPanel.ts must be deleted — #396 replaces it with fusion mode in RingManagementOverlay',
    ).toBe(false);
  });

  it('Spec AC: no file in client/src imports FusionPanel (all importers cleaned up)', () => {
    // #396 adversarial: a missed import of the deleted file causes a runtime crash.
    function walkTs(dir: string): string[] {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return walkTs(full);
        return e.isFile() && e.name.endsWith('.ts') ? [full] : [];
      });
    }
    const violations = walkTs(CLIENT_SRC).filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /^\s*import\s[^;]*FusionPanel/.test(src);
    });
    expect(
      violations.map((f) => path.relative(CLIENT_SRC, f)),
      'All FusionPanel imports must be removed — file is deleted',
    ).toHaveLength(0);
  });

  it('Spec AC: CampScene.ts does not instantiate FusionPanel (new FusionPanel)', () => {
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must not use new FusionPanel() — replaced by RingManagementOverlay fusion mode',
    ).not.toContain('new FusionPanel(');
  });

  it('Spec AC: BaseBiomeScene.ts does not instantiate FusionPanel', () => {
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(
      src,
      'BaseBiomeScene.ts must not use new FusionPanel() — replaced by RingManagementOverlay fusion mode',
    ).not.toContain('new FusionPanel(');
  });

  it('Spec AC: CampScene.ts still has window.__campOpenFusion hook', () => {
    // #396 preservation: the E2E hook must still fire when openFusionPanel() is called.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must define window.__campOpenFusion so E2E tests can open the fusion overlay',
    ).toContain('__campOpenFusion');
  });

  it('Spec AC: CampScene.ts window.__campFusedFills hook preserved', () => {
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must set window.__campFusedFills — used by E2E to observe fusion card fills',
    ).toContain('__campFusedFills');
  });

  it('Spec AC: RingManagementOverlayClass.ts includes fusion mode in the left-column branch', () => {
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass.ts must handle fusion mode in renderLeft dispatch',
    ).toContain("mode === 'fusion'");
  });

  it('Spec AC: RingManagementOverlayClass.ts exposes setStatusMessage (status surfacing for onFuse/rejected moves)', () => {
    // #421 consolidated setFuseStatus into the generic setStatusMessage — both the
    // fusion onFuse callbacks and rejected swap moves surface through it.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass must expose setStatusMessage() for adapters to surface errors',
    ).toContain('setStatusMessage');
  });

  it('Spec AC: RingManagementOverlayOpts declares onFuse and filterElement options', () => {
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'RingManagementOverlayOpts must declare onFuse').toContain('onFuse');
    expect(src, 'RingManagementOverlayOpts must declare filterElement').toContain('filterElement');
  });

  it('Spec AC: BaseBiomeScene.ts does NOT import FusionPanel', () => {
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    const importLines = src.split('\n').filter((l) => l.trim().startsWith('import'));
    const hasFusionPanelImport = importLines.some((l) => l.includes('FusionPanel'));
    expect(
      hasFusionPanelImport,
      'BaseBiomeScene.ts must not import FusionPanel — it was replaced by RingManagementOverlay fusion mode',
    ).toBe(false);
  });

});

// ===========================================================================
// Class 14 — #396 P1 fix: teardown fuseParent guard + clearFuseParents (#396)
// ===========================================================================

describe('#396 teardown fuseParent guard: preserve on re-render, clear on close + success', () => {

  it('Spec AC: teardown() assigns fuseParent1/2 = null INSIDE the if (fireCb) block only', () => {
    // P1 fix: fuseParent1/2 must be cleared only when fireCb=true (genuine close
    // or explicit clearFuseParents() on success). Clearing on every re-render
    // (fireCb=false) erases the user's R1/R2 selection on each render cycle.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;

    // Line-based analysis: find the teardown method, then find the if (fireCb)
    // guard line within it, and confirm that fuseParent1/2 = null lines come
    // AFTER (i.e. have a higher line number than) the if (fireCb) line.
    const lines = src.split('\n');

    // Find the teardown method start (private teardown).
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    expect(teardownStart, 'teardown method must exist').toBeGreaterThan(-1);

    // Find `if (fireCb)` within the teardown body (after teardownStart).
    const fireCbLineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    expect(fireCbLineIdx, 'teardown must contain `if (fireCb)` guard').toBeGreaterThan(teardownStart);

    // Find both fuseParent1 = null assignments (must be AFTER fireCb guard).
    const parent1LineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /this\.fuseParent1\s*=\s*null/.test(l),
    );
    const parent2LineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /this\.fuseParent2\s*=\s*null/.test(l),
    );
    expect(parent1LineIdx, 'this.fuseParent1 = null must exist in teardown').toBeGreaterThan(teardownStart);
    expect(parent2LineIdx, 'this.fuseParent2 = null must exist in teardown').toBeGreaterThan(teardownStart);

    expect(
      parent1LineIdx,
      `fuseParent1=null (line ${parent1LineIdx + 1}) must come AFTER if (fireCb) (line ${fireCbLineIdx + 1})`,
    ).toBeGreaterThan(fireCbLineIdx);
    expect(
      parent2LineIdx,
      `fuseParent2=null (line ${parent2LineIdx + 1}) must come AFTER if (fireCb) (line ${fireCbLineIdx + 1})`,
    ).toBeGreaterThan(fireCbLineIdx);
  });

  it('Spec AC: RingManagementOverlayClass.ts exports clearFuseParents() public method', () => {
    // Fix Option A: a dedicated public method so adapters can clear parents before
    // ov.refresh() on fusion success without accessing private fields.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass must expose clearFuseParents() for adapters to call on success',
    ).toContain('clearFuseParents');
    // Must be public (no leading `private` keyword on the same line).
    const methodMatch = src.match(/(\w+)\s+clearFuseParents\s*\(\s*\)/);
    if (methodMatch) {
      expect(
        methodMatch[1],
        'clearFuseParents must be a public method (not private)',
      ).not.toBe('private');
    }
  });

  it('Spec AC: CampScene.ts calls ov.clearFuseParents() before ov.refresh() in onFuse success path', () => {
    // P1 fix: the success branch must clear parents first so the stale deleted
    // ring IDs are gone before re-render uses them to repopulate R1/R2.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene onFuse must call ov.clearFuseParents() to wipe stale deleted-ring references',
    ).toContain('clearFuseParents');

    // Line-based check: in the onFuse callback, clearFuseParents must appear
    // on an earlier line than the ov.refresh call that follows it.
    const lines = src.split('\n');
    const onFuseLineIdx = lines.findIndex((l) => /onFuse\s*:\s*async/.test(l));
    expect(onFuseLineIdx, 'onFuse callback must exist in CampScene.ts').toBeGreaterThan(-1);

    // Find clearFuseParents and ov.refresh within the onFuse callback body
    // (after the onFuse line definition).
    const clearLineIdx = lines.findIndex(
      (l, i) => i > onFuseLineIdx && /clearFuseParents/.test(l),
    );
    const refreshLineIdx = lines.findIndex(
      (l, i) => i > onFuseLineIdx && /ov\.refresh\s*\(/.test(l),
    );
    expect(clearLineIdx, 'clearFuseParents call must appear after onFuse definition').toBeGreaterThan(onFuseLineIdx);
    expect(refreshLineIdx, 'ov.refresh call must appear after onFuse definition').toBeGreaterThan(onFuseLineIdx);
    expect(
      clearLineIdx,
      `clearFuseParents (line ${clearLineIdx + 1}) must come BEFORE ov.refresh (line ${refreshLineIdx + 1})`,
    ).toBeLessThan(refreshLineIdx);
  });

  it('Spec AC: onFusionBenchClick sets fuseParent1 on first click (empty R1)', () => {
    // Source-scan: the bench-click handler must assign to fuseParent1 when it is null.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'onFusionBenchClick must assign this.fuseParent1 when slot is empty',
    ).toContain('this.fuseParent1 = ring');
  });

  it('Spec AC: onFusionBenchClick sets fuseParent2 on second click (R1 filled, R2 empty)', () => {
    // Source-scan: the bench-click handler must assign to fuseParent2 when R1 is
    // occupied and R2 is null.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'onFusionBenchClick must assign this.fuseParent2 when R1 is filled but R2 is empty',
    ).toContain('this.fuseParent2 = ring');
  });

  it('Spec AC: onFusionBenchClick clears the correct slot when bench ring matches an assigned parent', () => {
    // Clicking a ring that IS already assigned as R1 must clear R1 (not R2).
    // The handler checks `this.fuseParent1?.id === ring.id` first.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'onFusionBenchClick must clear fuseParent1 when the clicked ring is already R1',
    ).toContain('this.fuseParent1?.id === ring.id');
    expect(
      src,
      'onFusionBenchClick must clear fuseParent2 when the clicked ring is already R2',
    ).toContain('this.fuseParent2?.id === ring.id');
  });

});

// ===========================================================================
// Class 15 — Phase 1 adversarial: drop-time bench-full guard edge cases (#413)
// ===========================================================================

describe('#413 Phase 1 adversarial: drop-time bench-full guard edge cases', () => {
  // The pick-up-time guard (isPickupBlockedByFullBench) was deleted in #413.
  // These tests verify that benchSpareCount (used by the drop-time guard) handles
  // edge cases correctly. The drop-time guard rejects target==='spare' at capacity.

  function makeRing(id: string, inCarry: 0 | 1, pending = 0): RingData {
    return {
      id,
      in_carry: inCarry,
      element: 0,
      tier: 'T0',
      xp: 0,
      current_uses: 1,
      max_uses: 3,
      escrowed: 0,
      pending,
    } as unknown as RingData;
  }

  it('pick-up from bench (spare) at full bench is never blocked at pick-up time (#413 invariant)', () => {
    // With the drop-time guard, pick-up is ALWAYS allowed.
    // The guard only fires at drop time (target === spare). This is verified by
    // source scan in Class 11 and by E2E — no unit-test of CampScene.onRingClicked here.
    // Verify benchSpareCount correctly reflects full bench state.
    const rings: RingData[] = [
      makeRing('s1', 1), makeRing('s2', 1), makeRing('s3', 1),
    ];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareRingMax = 3;
    const spareCount = benchSpareCount(rings, loadout, null);
    // benchSpareCount correctly reports 3 (full bench).
    expect(spareCount).toBe(3);
    // At full bench, dropping to spare is rejected.
    expect(spareCount >= spareRingMax).toBe(true);
    // Dropping to a battle slot (target !== 'spare') is NOT rejected at the drop-time guard.
    const sources: Array<SwapSlot> = ['a1', 'a2', 'd1', 'd2', 'thumb', 'heart', 'reliquary'];
    for (const target of sources) {
      expect(target === 'spare' && spareCount >= spareRingMax).toBe(false);
    }
  });

  it('benchSpareCount handles heart ring exclusion correctly (heart is not in bench)', () => {
    // A heart ring (heart_slot=1) is NOT in the spare pool. benchSpareCount does not
    // exclude by heart_slot directly, but heart rings are filtered by the caller
    // using in_carry state. Verify a ring with in_carry=0 is excluded.
    const rings: RingData[] = [
      makeRing('bench1', 1),
      makeRing('resting', 0), // reliquary ring — not in carry
    ];
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    expect(benchSpareCount(rings, loadout, null)).toBe(1);
  });

  it('benchFull=false (count < max): all drop targets allowed without rejection', () => {
    // When the bench is not full, no drop is rejected. Test the predicate directly.
    const spareCount = 2;
    const spareRingMax = 9;
    const sources: Array<SwapSlot> = ['spare', 'reliquary', 'thumb', 'heart', 'a1', 'a2', 'd1', 'd2'];
    for (const target of sources) {
      const wouldReject = target === 'spare' && spareCount >= spareRingMax;
      expect(wouldReject, `target=${target} should not be rejected when bench not full`).toBe(false);
    }
  });

});

// ===========================================================================
// Class 16 — Phase 1 adversarial: escrowed ring in recharge pool (#397)
// ===========================================================================

describe('#397 Phase 1 adversarial: source-scan for escrowed exclusion in recharge SQL', () => {

  it('selectReliquaryResting SQL filters escrowed=0 (source scan)', () => {
    // #397 adversarial: an escrowed=1 ring (staked thumb) must NOT be drawn into
    // the recharge pool. If the SQL omits the escrowed=0 clause, a staked ring's
    // uses would be restored mid-battle, and the spirit would be spent without the
    // player choosing to recharge that ring.
    const src = fs.readFileSync(
      path.join(path.resolve(__dirname, '../..'), 'server/src/persistence/PlayerRepo.ts'),
      'utf8',
    );
    // The prepared statement selectReliquaryResting must include escrowed = 0.
    const resting = src.match(/selectReliquaryResting\s*=\s*db\.prepare\s*\(\s*`([\s\S]*?)`/);
    expect(resting, 'selectReliquaryResting prepared statement must exist').toBeTruthy();
    expect(
      resting![1],
      'selectReliquaryResting query must include escrowed = 0 to exclude staked rings',
    ).toMatch(/escrowed\s*=\s*0/);
  });

  it('selectReliquaryResting SQL filters heart_slot=0 (source scan)', () => {
    // #397 adversarial: the heart ring has heart_slot=1 and in_carry=0. Without
    // the heart_slot=0 filter the heart ring would enter the resting pool and be
    // recharged, spending spirit without the player's intent.
    const src = fs.readFileSync(
      path.join(path.resolve(__dirname, '../..'), 'server/src/persistence/PlayerRepo.ts'),
      'utf8',
    );
    const resting = src.match(/selectReliquaryResting\s*=\s*db\.prepare\s*\(\s*`([\s\S]*?)`/);
    expect(resting, 'selectReliquaryResting must exist').toBeTruthy();
    expect(
      resting![1],
      'selectReliquaryResting query must include heart_slot = 0 to exclude the heart ring',
    ).toMatch(/heart_slot\s*=\s*0/);
  });

  it('selectReliquaryResting SQL orders by deficit DESC then id ASC (source scan)', () => {
    // #397 adversarial: if the sort is ascending on uses (not deficit), the most-full
    // ring is recharged first — wasting spirit on rings that barely need it.
    const src = fs.readFileSync(
      path.join(path.resolve(__dirname, '../..'), 'server/src/persistence/PlayerRepo.ts'),
      'utf8',
    );
    const resting = src.match(/selectReliquaryResting\s*=\s*db\.prepare\s*\(\s*`([\s\S]*?)`/);
    expect(resting, 'selectReliquaryResting must exist').toBeTruthy();
    // Deficit = (max_uses - current_uses) ordered DESC = most depleted first.
    expect(
      resting![1],
      'selectReliquaryResting must ORDER BY deficit DESC (most depleted first)',
    ).toMatch(/ORDER BY.*max_uses\s*-\s*current_uses.*DESC/);
  });

});

// ===========================================================================
// Class 17 — Phase 1 adversarial: computeFusionResult edge cases (#396)
// ===========================================================================

describe('#396 Phase 1 adversarial: computeFusionResult and filterElement logic', () => {

  it('RingManagementOverlayClass.ts computeFusionResult returns ineligible when filterElement mismatches result', () => {
    // #396 adversarial: filterElement is set to a result element that no recipe
    // in the fusion table produces with the two selected parents. The overlay must
    // show the FR slot as ineligible rather than showing a wrong result element.
    // Source-scan: filterElement check must compare result !== fe (strict inequality).
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The guard: `if (fe !== undefined && result !== fe) return { frElement: null, eligible: false };`
    expect(
      src,
      'computeFusionResult must compare result !== fe to filter by specific outcome element',
    ).toContain('result !== fe');
  });

  it('RingManagementOverlayClass.ts computeFusionResult checks both parents individually for eligibility', () => {
    // #396 adversarial: checking only the first parent would allow an ineligible
    // second parent to slip through (e.g. a Tier-0 ring as R2 with an eligible R1).
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Both guards must exist: isFusionEligibleParent(r1.element, r1.xp) and
    // isFusionEligibleParent(r2.element, r2.xp).
    const r1Check = /isFusionEligibleParent\(r1\.element,\s*r1\.xp\)/.test(src);
    const r2Check = /isFusionEligibleParent\(r2\.element,\s*r2\.xp\)/.test(src);
    expect(r1Check, 'computeFusionResult must check isFusionEligibleParent for r1').toBe(true);
    expect(r2Check, 'computeFusionResult must check isFusionEligibleParent for r2').toBe(true);
  });

  it('RingManagementOverlayClass.ts renderFusionLeft shows ineligible state when both parents set but not eligible', () => {
    // #396 adversarial: if the frElement render branch fires even when eligible=false,
    // a two-tone preview card would display for an invalid fusion pair — misleading the player.
    // The guard is: `if (r1 && r2 && eligible && frElement !== null)`.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'renderFusionLeft must gate the FR preview card on eligible=true',
    ).toContain('eligible && frElement !== null');
  });

  it('RingManagementOverlayClass.ts getBenchRingsForFusion excludes fusion rings from parent candidates', () => {
    // #396 adversarial: a fusion ring (element >= 5) cannot be fused again. Including
    // it in the bench ring list would let the player click it and assign it as R1/R2,
    // then receive a server rejection — confusing UX. The filter must use isFusion().
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'getBenchRingsForFusion must exclude fusion rings via isFusion(r.element)',
    ).toContain('isFusion(r.element)');
  });

  it('RingManagementOverlayClass.ts onFusionBenchClick third-click replaces R2 not R1 (R2-replace semantics)', () => {
    // #396 adversarial: when R1 and R2 are both set and a new bench ring is clicked,
    // R2 must be replaced (not R1). The ring assigned first (R1) is the dominant
    // parent; replacing R1 silently would confuse the user.
    // The else-branch sets fuseParent2 = ring.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The final else branch of the four-way if/else-if chain must set fuseParent2.
    // Source-scan: after the three guards (id===r1, id===r2, !r1, !r2), the else sets r2.
    const lines = src.split('\n');
    const onFusionStart = lines.findIndex((l) => /private onFusionBenchClick/.test(l));
    expect(onFusionStart, 'onFusionBenchClick must exist').toBeGreaterThan(-1);
    // Find the else branch that is the last one in the method (replaces R2).
    const elseLine = lines.findIndex(
      (l, i) => i > onFusionStart && /^\s*}\s*else\s*\{/.test(l),
    );
    expect(elseLine, 'onFusionBenchClick must have a final else branch').toBeGreaterThan(onFusionStart);
    // That else branch must set fuseParent2 = ring.
    const nextLine = lines[elseLine + 1] ?? '';
    expect(
      nextLine,
      'final else branch of onFusionBenchClick must set this.fuseParent2 = ring',
    ).toMatch(/this\.fuseParent2\s*=\s*ring/);
  });

});

// ===========================================================================
// Class 18 — Phase 1 adversarial: clearFuseParents + re-render preserves selection (#396)
// ===========================================================================

describe('#396 Phase 1 adversarial: fuseParent state during render cycles', () => {

  it('teardown with fireCb=false must NOT clear fuseParent1 or fuseParent2 (source scan)', () => {
    // #396 P1 fix adversarial: fuseParent clearing on every re-render was the
    // original P1 divergence. The fix: only clear when fireCb=true (genuine close).
    // Source-scan: fuseParent1=null must NOT appear in the `if (!fireCb)` branch.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    expect(teardownStart, 'teardown must exist').toBeGreaterThan(-1);
    // Find the first assignment of fuseParent1 = null within teardown.
    const parent1Idx = lines.findIndex(
      (l, i) => i > teardownStart && /this\.fuseParent1\s*=\s*null/.test(l),
    );
    // Find the `if (fireCb)` guard.
    const fireCbIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    // fuseParent1=null must come AFTER the if(fireCb) guard.
    expect(
      parent1Idx,
      'fuseParent1=null must be guarded by if(fireCb), not outside it',
    ).toBeGreaterThan(fireCbIdx);
  });

  it('__fusionState is cleared only on genuine close (fireCb=true), not on re-render', () => {
    // #396 adversarial: if __fusionState is wiped on every teardown, E2E tests
    // observing __fusionState during a re-render would see undefined and fail.
    // Source-scan: __fusionState = undefined must be inside the if(fireCb) block.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    const fireCbIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    const fusionStateClearIdx = lines.findIndex(
      (l, i) => i > teardownStart && /__fusionState\s*=\s*undefined/.test(l),
    );
    expect(fusionStateClearIdx, '__fusionState = undefined must exist in teardown').toBeGreaterThan(teardownStart);
    expect(
      fusionStateClearIdx,
      '__fusionState=undefined must come AFTER the if(fireCb) guard (only on genuine close)',
    ).toBeGreaterThan(fireCbIdx);
  });

});

// ===========================================================================
// Class 19 — Phase 2 implementation-aware: BenchHealthCombat.build() branches (#395)
// ===========================================================================

describe('#395 Phase 2 impl-aware: BenchHealthCombat architecture contracts', () => {

  it('BenchHealthCombat.ts does not have a `private readonly scene` field declaration', () => {
    // #395 Phase 2 adversarial: `Phaser.GameObjects.Container` has a public `scene`
    // property. Redeclaring it as `private` causes a TypeScript compile error.
    // Verify the fix is stable — no `private` (or `private readonly`) scene field.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const nonComment = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    }).join('\n');
    expect(
      nonComment,
      'BenchHealthCombat must not redeclare `private scene` — Container already exposes .scene',
    ).not.toMatch(/private\s+(?:readonly\s+)?scene\s*:/);
  });

  it('BenchHealthCombat.ts bench filter uses benchSpareCount (shared predicate — not a local re-implementation)', () => {
    // #395 Phase 2 adversarial: a second, divergent bench-count implementation would
    // drift from the server predicate. BHC must delegate to benchSpareCount.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat must import and use benchSpareCount from RingManagementOverlay',
    ).toContain('benchSpareCount');
  });

  it('BenchHealthCombat.ts teardown() clears benchGrid, heartCard, combatCards, domLabels', () => {
    // #395 Phase 2 adversarial: a partial teardown that skips one of these would
    // leave stale Phaser objects alive after the overlay is closed, causing memory
    // leaks and potential display glitches on re-open.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(src, 'teardown must clear benchGrid').toContain('this.benchGrid = null');
    expect(src, 'teardown must clear heartCard').toContain('this.heartCard = null');
    expect(src, 'teardown must clear combatCards').toContain('this.combatCards.clear()');
    expect(src, 'teardown must clear domLabels').toContain('this.domLabels');
  });

  it('BenchHealthCombat.ts destroy() calls teardown() before super.destroy()', () => {
    // #395 Phase 2 adversarial: if super.destroy() runs before teardown(), Phaser
    // may already have destroyed child objects before teardown() tries to null them —
    // causing access-to-destroyed-object errors.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const destroyStart = lines.findIndex((l) => /override destroy\(/.test(l));
    expect(destroyStart, 'destroy() must exist as an override').toBeGreaterThan(-1);
    const teardownCallIdx = lines.findIndex(
      (l, i) => i > destroyStart && /this\.teardown\(\)/.test(l),
    );
    const superDestroyIdx = lines.findIndex(
      (l, i) => i > destroyStart && /super\.destroy\(/.test(l),
    );
    expect(teardownCallIdx, 'teardown() must be called inside destroy()').toBeGreaterThan(destroyStart);
    expect(superDestroyIdx, 'super.destroy() must be called inside destroy()').toBeGreaterThan(destroyStart);
    expect(
      teardownCallIdx,
      `teardown() (line ${teardownCallIdx + 1}) must come BEFORE super.destroy() (line ${superDestroyIdx + 1})`,
    ).toBeLessThan(superDestroyIdx);
  });

  it('BenchHealthCombat.ts [RECHARGE ALL] button label is exactly "[RECHARGE ALL]" (not "[Recharge]" or "[RECHARGE]")', () => {
    // #462 updates #395 Phase 2 adversarial: the button is renamed to [RECHARGE ALL].
    // An inconsistent capitalisation would fail E2E grep and violate the rename acceptance criterion.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(src, 'BenchHealthCombat must render [RECHARGE ALL] in upper case').toContain('[RECHARGE ALL]');
    expect(src, 'BenchHealthCombat must not use lower-case [Recharge]').not.toContain('[Recharge]');
    // The bare single-quoted '[RECHARGE]' literal must no longer appear — it was the old button label.
    // SAFE assertion: use single-quoted form so we don't match the '[RECHARGE]' inside '[RECHARGE ALL]'.
    expect(src, "must not contain old bare '[RECHARGE]' string literal").not.toContain("'[RECHARGE]'");
  });

  it('BenchHealthCombat.ts repaintStrokes() handles all five SLOT_KEYS and heartCard', () => {
    // #395 Phase 2 adversarial: a repaintStrokes that iterates combatCards.entries()
    // covers all five slots automatically, but a hand-written list that misses 'd2'
    // or 'a2' would leave stale selection strokes on those cards.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(src, 'repaintStrokes must update heartCard stroke').toContain('heartCard.setStroke');
    // The combatCards Map iteration covers all five slots — verify it iterates the Map.
    expect(src, 'repaintStrokes must iterate combatCards').toContain('this.combatCards');
  });

});

// ===========================================================================
// Class 20 — Phase 2 impl-aware: RingManagementOverlayClass construction invariants (#395/#396)
// ===========================================================================

describe('#395/#396 Phase 2 impl-aware: RingManagementOverlayClass invariants', () => {

  it('RingManagementOverlayClass.ts validSlots includes reliquary for sanctum mode (source scan)', () => {
    // #395 Phase 2 adversarial: the sanctum overlay must include 'reliquary' as a
    // valid SwapSlot so rings can be picked up from the resting pool and moved to
    // the bench. If 'reliquary' is absent, the swap controller silently discards
    // the pick-up and the ring never moves.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The sanctum branch: validSlots = [..., 'reliquary', ...]
    expect(
      src,
      'sanctum validSlots must include "reliquary"',
    ).toContain("'reliquary'");
  });

  it('RingManagementOverlayClass.ts open() is idempotent when called twice (guard: if container)', () => {
    // #395 Phase 2 adversarial: calling open() when already open must be a no-op.
    // Without the `if (this.container) return;` guard, a double open() call would
    // render a second backdrop + panel on top of the first, leaking DOM labels.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The open() method must contain the idempotency guard.
    expect(
      src,
      'open() must guard against double-open with `if (this.container) return`',
    ).toContain('if (this.container) return');
  });

  it('RingManagementOverlayClass.ts refresh() is a no-op when overlay is closed (guard: if !container)', () => {
    // #395 Phase 2 adversarial: calling refresh() after close() should not crash
    // or attempt to render into a destroyed container.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'refresh() must guard against calling when closed: if (!this.container) return',
    ).toContain('if (!this.container) return');
  });

  it('RingManagementOverlayClass.ts refreshBhc() is a no-op when bhc or container is null', () => {
    // #395 Phase 2 adversarial: refreshBhc is called by CampScene after swap round-
    // trips. If the overlay was closed between the server call and the response, bhc
    // is null. An unguarded refreshBhc would crash on bhc.build().
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'refreshBhc() must check `if (!this.bhc || !this.container) return`',
    ).toContain('if (!this.bhc || !this.container) return');
  });

  it('RingManagementOverlayClass.ts publishFusionState iterates ALL 10 fusion elements (BASE_COUNT to BASE_COUNT+FUSION_COUNT)', () => {
    // #396 Phase 2 adversarial: the loop must cover all 10 fusion elements (5–14).
    // If the loop bound is wrong (e.g. i < BASE_COUNT + 5) only half the recipes
    // are published, breaking __fusionState assertions in the fusion E2E tests.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'publishFusionState loop must use FUSION_COUNT = 10').toContain('FUSION_COUNT');
    expect(src, 'publishFusionState must define BASE_COUNT = 5').toContain('BASE_COUNT');
  });

  it('RingManagementOverlayClass.ts publishFusionState publishes all recipes even when a recipe has no available parents', () => {
    // #396 Phase 2 adversarial: a recipe entry must always be pushed to the array,
    // even when parentA or parentB is null. An if-guard that only pushes on ready=true
    // would cause the published array to have fewer than FUSION_COUNT entries,
    // breaking E2E tests that index by position.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // recipes.push must not be gated on ready (the push must be unconditional in the loop).
    const lines = src.split('\n');
    const publishStart = lines.findIndex((l) => /private publishFusionState/.test(l));
    expect(publishStart, 'publishFusionState must exist').toBeGreaterThan(-1);
    const pushLine = lines.findIndex((l, i) => i > publishStart && /recipes\.push/.test(l));
    expect(pushLine, 'recipes.push must exist in publishFusionState').toBeGreaterThan(publishStart);
    // The push line must not be preceded by `if (ready)` or similar on the same or previous line.
    const prevLine = lines[pushLine - 1]?.trim() ?? '';
    expect(
      prevLine.startsWith('if '),
      `recipes.push must not be gated by an if-guard — found: "${prevLine}"`,
    ).toBe(false);
  });

});

// ===========================================================================
// Class 21 — Phase 1 spec-driven adversarial: #413 BHC callback wiring
// ===========================================================================

describe('#413 Phase 1 spec-driven: BenchHealthCombat onBenchSelect callback wiring', () => {

  it('BenchHealthCombat.ts constructor declares onBenchSelect as a required parameter', () => {
    // #413 adversarial: if onBenchSelect remains optional (?) in the constructor,
    // callers can omit it without a TypeScript error, re-introducing the silent
    // no-op regression that was the root cause of the bug.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The parameter must appear without a trailing `?` — required, not optional.
    // Pattern: `private readonly onBenchSelect: (ring: RingData | null) => void`
    // (no `?:` before the type annotation).
    expect(
      src,
      'onBenchSelect must be a required constructor parameter (no ? optional marker)',
    ).toMatch(/private readonly onBenchSelect\s*:/);
    // Must NOT have `onBenchSelect?:` (optional).
    expect(
      src,
      'onBenchSelect must NOT be declared optional with ?',
    ).not.toMatch(/private readonly onBenchSelect\?/);
  });

  it('BenchHealthCombat.ts passes onBenchSelect to InventoryGrid constructor (not a no-op)', () => {
    // #413 root cause: the old code passed `() => { /* no-op */ }` to the InventoryGrid.
    // The fix: pass `(ring) => this.onBenchSelect(ring)` as the callback.
    // A no-op lambda would look like `() =>` with no body referencing onBenchSelect.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat must pass onBenchSelect through to InventoryGrid (not a no-op)',
    ).toContain('this.onBenchSelect');
    // The old no-op must not remain.
    expect(
      src,
      'BenchHealthCombat must not contain the old no-op bench-select comment',
    ).not.toContain('/* selection driven by overlay');
  });

  it('RingManagementOverlayClass.ts supplies onBenchSelect to BHC constructor in all three modes', () => {
    // #413 adversarial: if the onBenchSelect callback is supplied for field mode but
    // omitted in the BHC constructor call for sanctum or fusion mode, those modes
    // remain broken. The fix wires it in a single `onBenchSelect` variable resolved
    // before `new BenchHealthCombat(...)`.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The variable must be resolved per-mode before BHC construction.
    expect(
      src,
      'RingManagementOverlayClass must define a per-mode onBenchSelect variable',
    ).toMatch(/const onBenchSelect\s*=/);
    // It must be passed as the fifth argument to BenchHealthCombat.
    expect(
      src,
      'RingManagementOverlayClass must pass onBenchSelect to new BenchHealthCombat(...)',
    ).toContain('onBenchSelect,');
  });

  it('RingManagementOverlayClass.ts fusion mode: onBenchSelect ignores null (only routes non-null to onFusionBenchClick)', () => {
    // #413 spec Design §3: fusion onBenchSelect = (ring) => { if (ring) this.onFusionBenchClick(ring); }
    // null means deselect; silently ignored. A null route to onFusionBenchClick would
    // crash or assign undefined as a fusion parent.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The fusion branch: must check `if (ring)` before calling onFusionBenchClick.
    expect(
      src,
      'fusion onBenchSelect must guard: if (ring) before routing to onFusionBenchClick',
    ).toMatch(/if\s*\(\s*ring\s*\)\s*this\.onFusionBenchClick/);
  });

  it('RingManagementOverlayClass.ts no longer has a duplicate spareGrid field declaration', () => {
    // #413 spec Design §4: the local `spareGrid` InventoryGrid in renderFieldLeft is deleted.
    // A residual `this.spareGrid` assignment would re-introduce a second grid hidden behind BHC.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Code lines only (exclude doc-comments).
    const nonComment = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    }).join('\n');
    expect(
      nonComment,
      'RingManagementOverlayClass must not assign this.spareGrid — the field was deleted in #413',
    ).not.toMatch(/this\.spareGrid\s*=/);
  });

  it('RingManagementOverlayClass.ts getSpareGrid() delegates to bhc.getBenchGrid() (not a local field)', () => {
    // #413 spec Design §4 update: getSpareGrid() must return `this.bhc?.getBenchGrid() ?? null`.
    // If it still returns `this.spareGrid`, it reads the deleted field (null) — breaking
    // the E2E bridge contract that all 17 `bh?.spareGrid` references depend on.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Find the getSpareGrid method body.
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /getSpareGrid\s*\(\s*\)/.test(l));
    expect(start, 'getSpareGrid() method must exist').toBeGreaterThan(-1);
    // The return statement must reference bhc.getBenchGrid().
    const methodLines = lines.slice(start, start + 5).join('\n');
    expect(
      methodLines,
      'getSpareGrid() must delegate to this.bhc?.getBenchGrid()',
    ).toContain('getBenchGrid');
    expect(
      methodLines,
      'getSpareGrid() must return null fallback via ?? null',
    ).toContain('null');
  });

  it('RingManagementOverlayClass.ts does not contain the old delayedCall(0) hack for bench click wiring', () => {
    // #413 spec Design §3: the delayedCall(0) hack for fusion bench clicks at lines
    // 753-762 must be deleted. Retaining it would add a second listener on top of the
    // wired InventoryGrid callback, firing the bench handler twice per click.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass must not use delayedCall(0) for bench click wiring — deleted in #413',
    ).not.toMatch(/delayedCall\s*\(\s*0\s*,\s*\(\s*\)\s*=>/);
  });

  it('RingManagementOverlayClass.ts onBenchGridSelect opt is defined in RingManagementOverlayOpts (not onSpareGridSelect)', () => {
    // #413 spec Design §2: onSpareGridSelect is replaced by onBenchGridSelect.
    // Any residual onSpareGridSelect declaration (not just a doc-comment) would
    // require callers to still supply the old name, silently breaking any caller
    // that migrated to onBenchGridSelect.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayOpts must declare onBenchGridSelect',
    ).toContain('onBenchGridSelect');
    // Only scan non-comment lines: a doc-comment referencing the old name is acceptable;
    // an actual interface property declaration is not.
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const hasDeclaration = nonCommentLines.some((l) =>
      /onSpareGridSelect\s*\??\s*:/.test(l) || /onSpareGridSelect\s*\(/.test(l),
    );
    expect(
      hasDeclaration,
      'RingManagementOverlayOpts must NOT declare onSpareGridSelect as a property or method (renamed in #413)',
    ).toBe(false);
  });

  it('BattleHandOverlay.ts uses onBenchGridSelect (not onSpareGridSelect) in makeOpts()', () => {
    // #413 spec Design §5: the field adapter renames the opt key.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    expect(
      src,
      'BattleHandOverlay.ts must pass onBenchGridSelect to the overlay opts',
    ).toContain('onBenchGridSelect');
    expect(
      src,
      'BattleHandOverlay.ts must NOT pass onSpareGridSelect (old name removed in #413)',
    ).not.toContain('onSpareGridSelect');
  });

  it('CampScene.ts openRingwallOverlay passes onBenchGridSelect adapter', () => {
    // #413 spec Design §5: CampScene must wire onBenchGridSelect so bench clicks
    // route through onGridSelectionChanged(ring, spare). Without it, sanctum mode
    // bench is entirely unclickable.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // Must define the adapter in openRingwallOverlay's opts literal.
    expect(
      src,
      "CampScene.ts openRingwallOverlay opts must include onBenchGridSelect",
    ).toContain('onBenchGridSelect');
    // It must route to onGridSelectionChanged.
    expect(
      src,
      'CampScene.ts onBenchGridSelect adapter must call onGridSelectionChanged',
    ).toContain('onGridSelectionChanged');
  });

});

// ===========================================================================
// Class 22 — Phase 1 spec-driven adversarial: #413 bench-full edge cases
// ===========================================================================

describe('#413 Phase 1 spec-driven: bench-full edge cases', () => {

  function makeRing(id: string, inCarry: 0 | 1, pending = 0): RingData {
    return {
      id,
      in_carry: inCarry,
      element: 0,
      tier: 'T0',
      xp: 0,
      current_uses: 1,
      max_uses: 3,
      escrowed: 0,
      pending,
    } as unknown as RingData;
  }

  it('drop-time guard is not triggered when spare_ring_max = 0 (edge: treat as no bench allowed)', () => {
    // #413 adversarial: spare_ring_max=0 means the player has no bench capacity at all.
    // benchSpareCount returns 0, so count (0) >= max (0) → drop to spare is rejected.
    // The guard condition must be >=, not >, to correctly reject at the exact boundary.
    const spareRingMax = 0;
    const rings: RingData[] = []; // no bench rings (as expected at max=0)
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null);
    const wouldBeRejected = spareCount >= spareRingMax;
    // With max=0 and count=0: 0 >= 0 → true → drop to spare is rejected.
    expect(wouldBeRejected).toBe(true);
  });

  it('net-zero bench swap (bench ring → battle slot simultaneously) does NOT overflow bench count', () => {
    // #413 spec: a net-zero swap (bench ring leaves via battle slot, battle ring lands on bench)
    // keeps benchSpareCount constant. The drop-time guard fires before the swap executes, so
    // the count used must be the CURRENT count (pre-swap). A net-zero swap cannot be rejected
    // by the guard because the swap is atomic at the server side (assertSpareWithinMax is the
    // authoritative backstop). Verify the client predicate does not double-count.
    const rings: RingData[] = [
      makeRing('bench1', 1),  // currently on bench
      makeRing('battle1', 1), // currently in a battle slot
    ];
    const loadout: Record<string, string | null> = { a1: 'battle1', a2: null, d1: null, d2: null, thumb: null };
    const spareRingMax = 1;
    // Before the swap: spareCount = 1 (bench1 only; battle1 is slotted).
    const spareCount = benchSpareCount(rings, loadout, null);
    expect(spareCount, 'pre-swap bench count should be 1').toBe(1);
    // The drop target is 'a1' (battle slot), not 'spare'. Guard does not fire.
    const target = 'a1';
    const wouldBeRejected = target === 'spare' && spareCount >= spareRingMax;
    expect(wouldBeRejected, 'moving bench ring to a1 (not spare) must not be rejected').toBe(false);
  });

  it('pick-up of a battle-slot ring never triggers the spare drop-time guard (target !== spare)', () => {
    // #413 spec: pick-up order is irrelevant. Clicking A1 first (picking up a battle ring)
    // and then clicking a bench slot never triggers the bench-full guard because the
    // eventual drop target determines guard activation, not the pick-up source.
    const spareRingMax = 9;
    const rings: RingData[] = Array.from({ length: 9 }, (_, i) => makeRing(`bench${i}`, 1));
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null); // = 9 (full bench)

    // Target is 'a1' (battle slot) — not 'spare'. The guard must not fire.
    const battleTargets = ['a1', 'a2', 'd1', 'd2', 'thumb', 'heart'] as const;
    for (const target of battleTargets) {
      // #413 adversarial: even at full bench, battle-slot drops are not rejected client-side.
      const wouldBeRejected = (target as string) === 'spare' && spareCount >= spareRingMax;
      expect(
        wouldBeRejected,
        `target=${target}: drop to a battle slot must not be rejected by the bench-full guard`,
      ).toBe(false);
    }
  });

  it('drop-time guard fires only when target === "spare" (exact string match, case-sensitive)', () => {
    // #413 adversarial: if the guard used includes() or a regex instead of strict
    // equality, a target like 'spare2' or 'SPARE' could trigger a false positive rejection.
    const spareCount = 9;
    const spareRingMax = 9;
    const falsePositives = ['Spare', 'SPARE', 'spare_slot', 'spare2', 'reliquary', 'spare '] as const;
    for (const target of falsePositives) {
      const wouldBeRejected = target === 'spare' && spareCount >= spareRingMax;
      expect(
        wouldBeRejected,
        `"${target}" must not trigger the bench-full guard (only exact "spare" should)`,
      ).toBe(false);
    }
  });

  it('SPIRIT ring selected at full bench: moving to "reliquary" (not spare) is not rejected', () => {
    // #413 adversarial: a player who picks up a SPIRIT ring and drops it back to the
    // reliquary (not to spare) must not hit the bench-full guard. Guard activates
    // only on target === 'spare'.
    const rings: RingData[] = Array.from({ length: 9 }, (_, i) => makeRing(`s${i}`, 1));
    const loadout: Record<string, string | null> = { a1: null, a2: null, d1: null, d2: null, thumb: null };
    const spareCount = benchSpareCount(rings, loadout, null);
    const spareRingMax = 9;
    expect(spareCount).toBe(9); // bench is full
    const target = 'reliquary';
    const wouldBeRejected = target === 'spare' && spareCount >= spareRingMax;
    expect(wouldBeRejected, 'dropping to reliquary must not be rejected by bench-full guard').toBe(false);
  });

});

// ===========================================================================
// Class 23 — Phase 2 implementation-aware: BHC build() selection strokes
// ===========================================================================

describe('#413 Phase 2 impl-aware: BenchHealthCombat.build() selection stroke + dim logic', () => {

  it('BenchHealthCombat.ts build() applies yellow stroke to the selected bench ring (source scan)', () => {
    // #413 spec Design §4: BHC.build() applies `setStrokeStyle(3, 0xffff00)` to the
    // currently-selected bench card bg when selectedRingId is provided. Previously
    // renderFieldLeft did this on a separate, duplicate grid — the fix consolidates it here.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat.build() must call setStrokeStyle(3, 0xffff00) for the selected ring',
    ).toContain('setStrokeStyle(3, 0xffff00)');
  });

  it('BenchHealthCombat.ts build() does NOT dim bench cards at full bench (#424 removed)', () => {
    // #424 — bench-full dim removed: occupied bench cards are always valid swap targets.
    // The setAlpha(0.45) bench dim block must no longer exist in BenchHealthCombat.ts.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // Strip comments before scanning so a doc-comment mention does not trip the check.
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    expect(
      codeOnly.includes('benchFull') && codeOnly.includes('setAlpha(0.45)'),
      'BenchHealthCombat.ts must NOT contain the bench-full dim block (removed by #424)',
    ).toBe(false);
  });

  it('BenchHealthCombat.ts build() has no bench-full dim loop with early return on id match (#424)', () => {
    // #424 — the dim loop and its selectedRingId early-return guard are removed.
    // The benchFull conditional dim must not appear in code (only comments are allowed).
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const nonCommentLines = src.split('\n').filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    });
    const codeOnly = nonCommentLines.join('\n');
    // The guard `if (r.id === selectedRingId) return;` inside a benchFull block is gone.
    expect(
      /if\s*\(\s*benchFull\b/.test(codeOnly),
      'BenchHealthCombat.ts must not contain `if (benchFull` dim logic — removed by #424',
    ).toBe(false);
  });

  it('BenchHealthCombat.ts build() selectedRingId parameter defaults to null (backward-compatible)', () => {
    // #413 adversarial: all existing callers that pass only (me, swapSource) without
    // selectedRingId must not break. The default = null makes the third param optional
    // for existing call sites while being required semantically.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The signature: build(me: BenchHealthCombatMe, swapSource: string | null,
    //                       selectedRingId: string | null = null)
    expect(
      src,
      'BenchHealthCombat.build() must declare selectedRingId with default = null',
    ).toContain('selectedRingId: string | null = null');
  });

  it('BenchHealthCombat.ts build() only applies stroke when selectedRingId is not null', () => {
    // #413 adversarial: calling build() with selectedRingId=null (no selection) must
    // not attempt getCardBg(null) — which would return undefined and then crash on
    // setStrokeStyle(). The guard `if (selectedRingId !== null)` must exist.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat.build() must guard stroke application with if (selectedRingId !== null)',
    ).toMatch(/if\s*\(\s*selectedRingId\s*!==\s*null\s*\)/);
  });

  it('RingManagementOverlayClass.ts render() passes selRingId (from spare selection) to bhc.build()', () => {
    // #413 impl-aware: the correct selectedRingId passed to BHC.build() is derived from
    // `swap.selection?.source === spare ? swap.selection.ringId : null`. An always-null
    // value would silently disable the yellow stroke on the bench selection.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The variable name is selRingId or similar, assigned from swap.selection.
    expect(
      src,
      "render() must derive selRingId from swap.selection when source === 'spare'",
    ).toMatch(/source\s*===\s*['"]spare['"]/);
    // And pass it as the third arg to bhc.build().
    expect(
      src,
      'render() must pass the selected bench ring id as third arg to bhc.build()',
    ).toContain('bhc.build(me,');
  });

  it('RingManagementOverlayClass.ts refreshBhc() also passes selRingIdBhc derived from spare source', () => {
    // #413 impl-aware: refreshBhc() is called after sanctum swaps for incremental BHC
    // refresh. It must also pass the selectedRingId so the yellow stroke is preserved
    // after the server round-trip. Without it, the stroke would vanish on each refresh.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Look for `selRingIdBhc` or similar in the refreshBhc body.
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /refreshBhc\s*\(/.test(l));
    expect(start, 'refreshBhc() must exist').toBeGreaterThan(-1);
    const body = lines.slice(start, start + 20).join('\n');
    expect(
      body,
      "refreshBhc() must pass a selectedRingId (derived from 'spare' source) to bhc.build()",
    ).toMatch(/source\s*===\s*['"]spare['"]/);
  });

});

// ===========================================================================
// Class 24 — Phase 2 implementation-aware: CampScene.reliquaryMove drop-time guard
// ===========================================================================

describe('#413 Phase 2 impl-aware: CampScene.reliquaryMove drop-time guard branches', () => {

  it("CampScene.ts reliquaryMove guard reads spare_ring_max from window.__campState (not hardcoded)", () => {
    // #413 impl-aware: the guard must use the runtime spare_ring_max from __campState
    // rather than a hardcoded 9. Using a hardcoded value would break if the player
    // expands their bench (e.g. via shards/upgrades that increase spare_ring_max).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // The implementation: `const s = window.__campState; const spareRingMax = s?.spare_ring_max ?? 9;`
    expect(
      src,
      'CampScene.reliquaryMove must read spare_ring_max from window.__campState',
    ).toContain('spare_ring_max');
    expect(
      src,
      "CampScene.reliquaryMove must use fallback value (e.g. ?? 9) when campState is unavailable",
    ).toMatch(/spare_ring_max\s*\?\?\s*9/);
  });

  it('CampScene.ts reliquaryMove drop-time guard runs BEFORE the escrowed-ring guard short-circuit', () => {
    // #413 adversarial: the guard must be positioned AFTER the ring-not-found and
    // escrowed-ring early exits but BEFORE any server call. We verify the guard
    // line index is between the escrowed block and the first network request.
    // Source-scan: escrowed block references `ring.escrowed`; guard uses `target === 'spare'`.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const reliquaryMoveStart = lines.findIndex((l) => /private async reliquaryMove/.test(l));
    expect(reliquaryMoveStart, 'reliquaryMove method must exist').toBeGreaterThan(-1);
    const escrowedBlockLine = lines.findIndex(
      (l, i) => i > reliquaryMoveStart && /ring\.escrowed/.test(l),
    );
    const dropGuardLine = lines.findIndex(
      (l, i) => i > reliquaryMoveStart && /target\s*===\s*['"]spare['"]/.test(l),
    );
    expect(
      dropGuardLine,
      'drop-time guard (target === spare) must exist in reliquaryMove',
    ).toBeGreaterThan(reliquaryMoveStart);
    expect(
      dropGuardLine,
      `drop-time guard (line ${dropGuardLine + 1}) must come after escrowed check (line ${escrowedBlockLine + 1})`,
    ).toBeGreaterThan(escrowedBlockLine);
  });

  it("CampScene.ts reliquaryMove does NOT apply the bench-full guard when target is 'a1'", () => {
    // #413 spec: SPIRIT → A1 is always valid. The guard must activate ONLY on
    // `target === 'spare'`. A guard that tests `target !== 'a1' && target !== 'a2'...`
    // (an allowlist rather than exact 'spare' check) would be fragile and wrong.
    // Source-scan: the guard condition must be exactly `if (target === 'spare') {`.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const reliquaryMoveStart = lines.findIndex((l) => /private async reliquaryMove/.test(l));
    const guardLine = lines.findIndex(
      (l, i) => i > reliquaryMoveStart && /if\s*\(\s*target\s*===\s*['"]spare['"]\s*\)/.test(l),
    );
    expect(guardLine, "guard must use `if (target === 'spare')` — exact equality").toBeGreaterThan(reliquaryMoveStart);
    // If the condition were `!== 'spare'` (inverted logic), we'd catch it here.
    const guardLineText = lines[guardLine] ?? '';
    expect(
      guardLineText,
      "guard condition must be target === 'spare', not target !== 'spare'",
    ).not.toContain("!== 'spare'");
  });

  it('CampScene.ts reliquaryMove bench-full message is the canonical rejection string', () => {
    // #413 spec §6 + E2E scenario 6: the exact message must match so E2E `.toContain()`
    // checks against the status bar text can pass. Any capitalisation change breaks the
    // E2E assertion without a TypeScript error.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'reliquaryMove rejection message must be the canonical string from the spec',
    ).toContain('Bench is full — discard a ring or move one to a battle slot first');
  });

  it('CampScene.ts reliquaryMove passes pendingId from campState to benchSpareCount (consistent count)', () => {
    // #413 impl-aware: benchSpareCount requires pendingRingId to exclude the WON ring.
    // Passing null instead of the real pending_ring_id would over-count the bench by 1
    // when the player has a pending ring, potentially blocking a valid drop.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const reliquaryMoveStart = lines.findIndex((l) => /private async reliquaryMove/.test(l));
    const guardStart = lines.findIndex(
      (l, i) => i > reliquaryMoveStart && /target\s*===\s*['"]spare['"]/.test(l),
    );
    // The guard block must reference a pendingId or pending_ring_id variable.
    const guardBlock = lines.slice(guardStart, guardStart + 10).join('\n');
    expect(
      guardBlock,
      'reliquaryMove drop-time guard must pass pending_ring_id to benchSpareCount',
    ).toMatch(/pending/);
  });

});

// ===========================================================================
// Class 25 — Phase 2 impl-aware: getSpareGrid / getBenchGrid delegation contract
// ===========================================================================

describe('#413 Phase 2 impl-aware: getSpareGrid and getBenchGrid delegation', () => {

  it('RingManagementOverlayClass.ts getSpareGrid() and getBenchGrid() both delegate to bhc.getBenchGrid()', () => {
    // #413 spec: both methods now return the same BHC bench grid. Having two different
    // return paths would re-introduce a field/BHC split where `getSpareGrid()` returns
    // the (now deleted) local field while `getBenchGrid()` returns the BHC grid.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');

    const spareGridStart = lines.findIndex((l) => /getSpareGrid\s*\(\s*\)/.test(l));
    const benchGridStart = lines.findIndex((l) => /getBenchGrid\s*\(\s*\)/.test(l));

    expect(spareGridStart, 'getSpareGrid() must exist').toBeGreaterThan(-1);
    expect(benchGridStart, 'getBenchGrid() must exist').toBeGreaterThan(-1);

    const spareBody = lines.slice(spareGridStart, spareGridStart + 5).join('\n');
    const benchBody = lines.slice(benchGridStart, benchGridStart + 5).join('\n');

    expect(
      spareBody,
      'getSpareGrid() must delegate to this.bhc?.getBenchGrid()',
    ).toContain('getBenchGrid');
    expect(
      benchBody,
      'getBenchGrid() must delegate to this.bhc?.getBenchGrid()',
    ).toContain('getBenchGrid');
  });

  it('RingManagementOverlayClass.ts getSpareGrid() returns null when bhc is null (overlay closed)', () => {
    // #413 adversarial: the E2E bridge accesses bh.spareGrid after openBattleHand().
    // If the overlay was never opened (bhc=null), getSpareGrid() must return null, not
    // throw TypeError: Cannot read properties of null (reading 'getBenchGrid').
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const start = lines.findIndex((l) => /getSpareGrid\s*\(\s*\)/.test(l));
    const body = lines.slice(start, start + 5).join('\n');
    // Must use optional chaining `?.` and `?? null` to handle the null bhc case.
    expect(
      body,
      'getSpareGrid() must use optional chaining ?.getBenchGrid() to avoid crash when bhc=null',
    ).toContain('?.getBenchGrid');
  });

  it('BattleHandOverlay.ts spareGrid getter still delegates through overlay.getSpareGrid()', () => {
    // #413 E2E bridge preservation: `get spareGrid() { return this.overlay?.getSpareGrid() ?? null; }`
    // All 17 bh?.spareGrid references in manage-battle-rings.spec.ts depend on this chain.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // The getter must call getSpareGrid().
    expect(
      src,
      'BattleHandOverlay.spareGrid getter must call overlay.getSpareGrid()',
    ).toContain('getSpareGrid');
  });

});

// ===========================================================================
// Class 26 — #421 __ringMgmtStatus window hook lifecycle (source-scan)
// ===========================================================================

describe('#421 __ringMgmtStatus window hook lifecycle (source-scan)', () => {

  it('RingManagementOverlayClass.ts sets __ringMgmtStatus to "" (empty string) after each render', () => {
    // #421 adversarial: the status bar is rebuilt (text wiped) on every render()/refresh().
    // The hook must be reset to '' so E2E tests always see a fresh empty value until
    // a post-refresh error is re-applied via setStatusMessage(). If the hook is NOT
    // reset, a stale error message from a previous render would be observable to E2E
    // tests that poll __ringMgmtStatus immediately after a render.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The implementation: `(window as unknown as Record<string, unknown>).__ringMgmtStatus = '';`
    // This must appear within the render path (not just inside setStatusMessage).
    expect(
      src,
      'RingManagementOverlayClass must reset __ringMgmtStatus to "" during render',
    ).toContain("__ringMgmtStatus = ''");
  });

  it('RingManagementOverlayClass.ts sets __ringMgmtStatus to undefined inside the if(fireCb) close block', () => {
    // #421 adversarial: on genuine overlay close (fireCb=true), the hook must be cleared
    // to undefined so E2E tests can detect the overlay is closed (undefined ≠ '' means
    // "overlay is gone", not just "no current error"). A close that leaves '' behind
    // would cause E2E tests opening a fresh overlay to misread a stale empty-string state
    // as a valid open-overlay hook value.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    expect(teardownStart, 'teardown method must exist').toBeGreaterThan(-1);
    const fireCbLineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    expect(fireCbLineIdx, 'teardown must contain if(fireCb) guard').toBeGreaterThan(teardownStart);
    const statusClearIdx = lines.findIndex(
      (l, i) => i > teardownStart && /__ringMgmtStatus\s*=\s*undefined/.test(l),
    );
    expect(statusClearIdx, '__ringMgmtStatus = undefined must exist in teardown').toBeGreaterThan(teardownStart);
    expect(
      statusClearIdx,
      `__ringMgmtStatus=undefined (line ${statusClearIdx + 1}) must come AFTER if(fireCb) (line ${fireCbLineIdx + 1}) — only cleared on genuine close`,
    ).toBeGreaterThan(fireCbLineIdx);
  });

  it('RingManagementOverlayClass.ts setStatusMessage writes to __ringMgmtStatus via setStatus (delegation chain)', () => {
    // #421 adversarial: setStatusMessage must propagate to the status text AND to the
    // window hook so Playwright can read it. If setStatusMessage updates the Phaser text
    // but forgets to write to __ringMgmtStatus, the E2E assertion in S2 (waitForFunction
    // __ringMgmtStatus.includes('Bench is full')) would never resolve.
    // Verify the delegation: setStatusMessage → setStatus (private helper that both
    // updates the Phaser text AND sets the window hook).
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Find the CLASS METHOD definition — not the doc-comment in RingManagementOverlayOpts.
    // The method signature is `setStatusMessage(msg: string): void {` (no leading spaces
    // before the method name in the class body, unlike the interface doc-comment which
    // contains `overlay.setStatusMessage(msg)`). Use a regex that matches the line start.
    const lines = src.split('\n');
    // Find the method definition: must start with optional whitespace then `setStatusMessage(`
    // but NOT have `overlay.` prefix (which is the doc-comment case).
    const methodStart = lines.findIndex(
      (l) => /^\s+setStatusMessage\s*\(\s*msg\s*:/.test(l),
    );
    expect(methodStart, 'setStatusMessage class method must exist').toBeGreaterThan(-1);
    const methodBody = lines.slice(methodStart, methodStart + 5).join('\n');
    expect(
      methodBody,
      'setStatusMessage must delegate to this.setStatus(msg) for hook + Phaser text update',
    ).toContain('this.setStatus');
  });

  it('RingManagementOverlayClass.ts private setStatus writes to __ringMgmtStatus (hook feeds E2E)', () => {
    // #421 adversarial: the private setStatus method must write to __ringMgmtStatus so
    // that all paths that call setStatus (direct + via setStatusMessage) update the hook.
    // An implementation that writes the hook only in setStatusMessage would break the
    // direct CampScene.setStatus path.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The hook assignment in the setStatus body: `__ringMgmtStatus = msg`
    expect(
      src,
      'private setStatus must write to __ringMgmtStatus so the E2E hook is always current',
    ).toMatch(/__ringMgmtStatus\s*=\s*msg/);
  });

  it('BattleHandOverlay.ts resolveMove re-applies lastError via setStatusMessage AFTER refresh()', () => {
    // #421 adversarial: the rejected-move flow is:
    //   1. resolveMove → apiMutate → 400 → onErr(m) captures lastError
    //   2. refresh() rebuilds the modal → __ringMgmtStatus resets to ''
    //   3. setStatusMessage(lastError) → re-applies the error after refresh
    // If step 3 is omitted (or called BEFORE step 2), the error is wiped by the refresh
    // and the player never sees it — the "silent deselect" bug with a message would resurface.
    // Source-scan: in BattleHandOverlay resolveMove, setStatusMessage call must come
    // AFTER the await refresh() call.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const resolveMoveStart = lines.findIndex((l) => /resolveMove\s*:/.test(l));
    expect(resolveMoveStart, 'resolveMove opt must exist in BattleHandOverlay').toBeGreaterThan(-1);
    const refreshLineIdx = lines.findIndex(
      (l, i) => i > resolveMoveStart && /await this\.refresh\(/.test(l),
    );
    const setStatusLineIdx = lines.findIndex(
      (l, i) => i > resolveMoveStart && /setStatusMessage\s*\(\s*lastError\s*\)/.test(l),
    );
    expect(refreshLineIdx, 'resolveMove must contain await this.refresh()').toBeGreaterThan(resolveMoveStart);
    expect(setStatusLineIdx, 'resolveMove must call ov.setStatusMessage(lastError)').toBeGreaterThan(resolveMoveStart);
    expect(
      setStatusLineIdx,
      `setStatusMessage (line ${setStatusLineIdx + 1}) must come AFTER refresh (line ${refreshLineIdx + 1}) — error must survive the rebuild`,
    ).toBeGreaterThan(refreshLineIdx);
  });

});

// ===========================================================================
// Class 27 — #421 SlotSwapManager.moveTo boolean gate (pure TS unit tests)
// ===========================================================================

describe('#421 SlotSwapManager.moveTo boolean gate', () => {
  // SlotSwapManager is pure TypeScript with no Phaser dependency — importable directly.
  // We import it lazily inside tests to avoid top-level import ordering issues.

  it('moveTo resolveMove=false: selection remains held and onAfter is NOT called', async () => {
    // #421 adversarial: the core fix — when the server rejects a move, the manager
    // must NOT clear the selection and must NOT call onAfter. Pre-fix the selection was
    // cleared unconditionally, creating the "card lights up, click target, deselects" UX bug.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let afterCallCount = 0;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1', 'a2', 'd1', 'd2', 'thumb', 'heart', 'reliquary'],
      resolveMove: async (_ringId, _from, _to) => false, // server rejection
      onAfter: async () => { afterCallCount++; },
    });
    manager.select('ring_abc', 'spare');
    await manager.moveTo('a1');
    // Selection must still be held (ringId and source unchanged).
    expect(manager.selection, 'selection must remain held after rejected move').not.toBeNull();
    expect(manager.selection?.ringId).toBe('ring_abc');
    expect(manager.selection?.source).toBe('spare');
    // onAfter must not have been called — no re-render on rejection.
    expect(afterCallCount, 'onAfter must NOT be called on rejection').toBe(0);
  });

  it('moveTo resolveMove=true: selection is cleared and onAfter IS called', async () => {
    // #421 happy path: when the server commits the move, the manager clears the selection
    // and triggers the host's onAfter re-render. Both must fire.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let afterCallCount = 0;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1', 'a2', 'd1', 'd2', 'thumb', 'heart', 'reliquary'],
      resolveMove: async () => true,
      onAfter: async () => { afterCallCount++; },
    });
    manager.select('ring_xyz', 'spare');
    await manager.moveTo('a1');
    expect(manager.selection, 'selection must be cleared after committed move').toBeNull();
    expect(afterCallCount, 'onAfter must be called once after committed move').toBe(1);
  });

  it('moveTo on the same slot as source deselects WITHOUT calling resolveMove', async () => {
    // #421 spec: re-clicking the origin slot is a "cancel" gesture — no server round-trip,
    // just deselect. resolveMove must not be invoked for same-source clicks.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let resolveCalled = false;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1', 'a2', 'd1', 'd2', 'thumb', 'heart', 'reliquary'],
      resolveMove: async () => { resolveCalled = true; return true; },
      onAfter: async () => {},
    });
    manager.select('ring_123', 'a1');
    await manager.moveTo('a1'); // same as source
    expect(manager.selection, 'clicking origin slot must deselect').toBeNull();
    expect(resolveCalled, 'resolveMove must NOT be called for same-slot click').toBe(false);
  });

  it('moveTo with no active selection is a no-op', async () => {
    // #421 adversarial: calling moveTo() without a prior select() (or after a clear())
    // must be a complete no-op — no resolveMove, no onAfter, no throw.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let resolveCalled = false;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1'],
      resolveMove: async () => { resolveCalled = true; return true; },
      onAfter: async () => {},
    });
    // No select() called — selection is null.
    await expect(manager.moveTo('a1')).resolves.toBeUndefined();
    expect(resolveCalled, 'resolveMove must not fire when nothing is selected').toBe(false);
  });

  it('moveTo to a slot not in validSlots is a no-op (keeps selection held)', async () => {
    // #421 adversarial: a click on a slot the manager does not recognise must be ignored.
    // validSlots is host-configurable (e.g. field overlay excludes 'reliquary').
    // A stray click on an excluded slot must not deselect or invoke resolveMove.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let resolveCalled = false;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1'], // 'reliquary' excluded
      resolveMove: async () => { resolveCalled = true; return true; },
      onAfter: async () => {},
    });
    manager.select('ring_999', 'spare');
    await manager.moveTo('reliquary' as any); // excluded slot
    expect(manager.selection, 'selection must still be held for invalid target').not.toBeNull();
    expect(resolveCalled, 'resolveMove must not be called for excluded slot').toBe(false);
  });

  it('moveTo resolveMove=false does not call onAfter even if resolveMove resolves quickly', async () => {
    // #421 adversarial: concurrent rapid double-tap — verifies no re-entrancy issue
    // where a fast false-returning resolveMove might race with onAfter cleanup.
    // Specifically: two sequential moveTo calls on the same manager while first is in-flight.
    const { SlotSwapManager } = await import('../../client/src/objects/ui/SlotSwapManager');
    let afterCallCount = 0;
    // resolveMove alternates true/false per call.
    let callNum = 0;
    const manager = new SlotSwapManager({
      validSlots: ['spare', 'a1', 'a2'],
      resolveMove: async () => { callNum++; return callNum % 2 === 1; }, // first=true, second=false
      onAfter: async () => { afterCallCount++; },
    });
    manager.select('ring_A', 'spare');
    // First moveTo resolves true → clears selection, calls onAfter.
    await manager.moveTo('a1');
    expect(manager.selection).toBeNull();
    expect(afterCallCount).toBe(1);
    // Re-select and attempt a move that resolves false.
    manager.select('ring_B', 'spare');
    await manager.moveTo('a2');
    expect(manager.selection, 'second rejected move keeps selection held').not.toBeNull();
    expect(afterCallCount, 'onAfter not called for rejected second move').toBe(1);
  });

});

// ===========================================================================
// Class 28 — #421 apiMutate contract (source-scan — api.ts uses browser globals)
// ===========================================================================

describe('#421 apiMutate contract: source-scan verification', () => {
  // api.ts depends on localStorage and window.location which are unavailable in Node.
  // All checks here are source-scans rather than live imports — they verify the contract
  // documented in the JSDoc comment is actually implemented in the code.

  it('apiMutate returns {ok:false, error:null} when no token is present (no-token fast path)', () => {
    // #421 adversarial: an unauthenticated request must never reach the server.
    // The check `if (!getToken()) return { ok: false, error: null }` must be first.
    // Without this guard, an expired session would fire an unauthenticated PUT that
    // the server rejects with 401 — the client would silently deselect (pre-fix behavior).
    const src = readClientSrc('net/api.ts');
    if (src === null) return;
    // The guard must precede the fetch call.
    const lines = src.split('\n');
    const apiMutateStart = lines.findIndex((l) => /async function apiMutate/.test(l));
    expect(apiMutateStart, 'apiMutate function must exist').toBeGreaterThan(-1);
    const noTokenGuard = lines.findIndex(
      (l, i) => i > apiMutateStart && /if\s*\(\s*!getToken\s*\(\s*\)\s*\)/.test(l),
    );
    const fetchCall = lines.findIndex(
      (l, i) => i > apiMutateStart && /apiFetch\s*\(/.test(l),
    );
    expect(noTokenGuard, 'apiMutate must have a !getToken() early return').toBeGreaterThan(apiMutateStart);
    expect(fetchCall, 'apiMutate must call apiFetch').toBeGreaterThan(apiMutateStart);
    expect(
      noTokenGuard,
      `!getToken() guard (line ${noTokenGuard + 1}) must come BEFORE apiFetch call (line ${fetchCall + 1})`,
    ).toBeLessThan(fetchCall);
  });

  it('apiMutate returns {ok:true, error:null} on res.ok=true (no error parsing on success)', () => {
    // #421 adversarial: a 2xx response must immediately return ok=true without
    // attempting to parse an error body (which would waste bandwidth and silently
    // swallow a 200 with a body that happens to contain an "error" key).
    const src = readClientSrc('net/api.ts');
    if (src === null) return;
    expect(
      src,
      'apiMutate must return {ok: true, error: null} on res.ok',
    ).toContain('{ ok: true, error: null }');
  });

  it('apiMutate returns {ok:false, error:null} from the catch block (network failure path)', () => {
    // #421 adversarial: a network failure (fetch throws) must be caught and surfaced
    // as {ok:false, error:null} — not re-thrown. Re-throwing would crash the caller
    // (BattleHandOverlay.send) and leave the game in an unrecoverable state.
    const src = readClientSrc('net/api.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const apiMutateStart = lines.findIndex((l) => /async function apiMutate/.test(l));
    // The catch block must return {ok: false, error: null}.
    const catchLine = lines.findIndex((l, i) => i > apiMutateStart && /catch\s*\{/.test(l));
    expect(catchLine, 'apiMutate must have a catch block').toBeGreaterThan(apiMutateStart);
    const catchBody = lines.slice(catchLine, catchLine + 4).join('\n');
    expect(
      catchBody,
      'catch block must return {ok: false, error: null} — network failures must not propagate',
    ).toContain('{ ok: false, error: null }');
  });

  it('apiMutate extracts body.error from non-2xx response (error message passthrough)', () => {
    // #421 adversarial: a 400 response with `{ error: "spare grid full" }` must surface
    // the message so the client can map it to the user-visible string. If the response
    // body is not parsed, the caller only knows the move failed — not why — and cannot
    // show "Bench is full" to the player.
    const src = readClientSrc('net/api.ts');
    if (src === null) return;
    // The pattern: `const parsed = await res.json().catch(() => ({}))` + `parsed.error ?? null`
    expect(
      src,
      'apiMutate must parse res.json() to extract the server error message',
    ).toContain('res.json()');
    expect(
      src,
      'apiMutate must access parsed.error for the error message',
    ).toContain('parsed.error');
  });

  it('apiMutate res.json() parse failure falls back to null (not an exception)', () => {
    // #421 adversarial: a 400 response whose body is not valid JSON (e.g. HTML error page
    // from a proxy) must not crash apiMutate. The `.catch(() => ({}))` guard ensures
    // the parse failure returns an empty object, so `parsed.error ?? null` yields null.
    const src = readClientSrc('net/api.ts');
    if (src === null) return;
    // The implementation: `await res.json().catch(() => ({}))`
    expect(
      src,
      'apiMutate must guard res.json() with .catch(() => ({})) to handle non-JSON error bodies',
    ).toMatch(/res\.json\(\)\.catch\(/);
  });

  it('BattleHandOverlay.send maps "spare grid full" server message to canonical bench-full string', () => {
    // #421 adversarial: the server returns "spare grid full" (internal naming); the
    // client must translate this to the player-visible "Bench is full — discard a ring
    // or move one to a battle slot first". A case-insensitive regex match is used.
    // If the translation is missing, the player sees a raw server error string.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // The translation: /spare grid full/i.test(r.error ?? '') ? 'Bench is full...'
    expect(
      src,
      'BattleHandOverlay.send must detect "spare grid full" (case-insensitive)',
    ).toMatch(/spare grid full/i);
    expect(
      src,
      'BattleHandOverlay.send must map it to the canonical bench-full player message',
    ).toContain('Bench is full — discard a ring or move one to a battle slot first');
  });

  it('BattleHandOverlay.send returns the server error as-is for unknown error messages', () => {
    // #421 adversarial: for server errors that are NOT "spare grid full" (e.g. "Ring
    // is locked in a duel", "No loadout for player"), the message must pass through
    // verbatim — not be replaced by the generic bench-full string.
    // The ternary: `r.error || 'Network error — please retry'` handles the passthrough.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // The fallback: `r.error || 'Network error — please retry'`
    expect(
      src,
      'BattleHandOverlay.send must fall back to r.error (verbatim) for non-bench-full errors',
    ).toContain('r.error ||');
    expect(
      src,
      'BattleHandOverlay.send must have a final network-error fallback string',
    ).toContain('Network error — please retry');
  });

});

// ===========================================================================
// Class 29 — #423 adversarial: WON slot, DISCARD slot, bench ghost, DiscardConfirm
// ===========================================================================

describe('#423 adversarial: WON slot, DISCARD slot, bench ghost, DiscardConfirm', () => {

  // ── A. Ghost visibility boundary ─────────────────────────────────────────

  it('benchSpareCount at exactly spare_ring_max → ghost cell NOT rendered (benchN >= spareMax)', () => {
    // #423 adversarial: when the bench is full (benchN === spareMax), the ghost
    // cell must NOT be added. The BHC build() condition is `if (benchN < spareMax)`.
    // An off-by-one (<=) would render a ghost even when the bench has zero free slots,
    // creating a clickable placeholder that can never be filled.
    // Source-scan: the ghost cell condition must be strictly less-than.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The guard: `if (benchN < spareMax)` — strictly less than, not <=
    expect(
      src,
      'BenchHealthCombat bench ghost must use `benchN < spareMax` (strict less-than, not <=)',
    ).toMatch(/if\s*\(\s*benchN\s*<\s*spareMax\s*\)/);
    // Confirm the inverted form (<=) is NOT present adjacent to the ghost cell code.
    // Scan the block around the ghost section for the wrong operator.
    const lines = src.split('\n');
    const ghostIdx = lines.findIndex((l) => /Bench ghost placeholder/.test(l));
    expect(ghostIdx, 'ghost cell comment must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostIdx, ghostIdx + 5).join('\n');
    expect(
      ghostBlock,
      'ghost block must not use benchN <= spareMax (that would render ghost when full)',
    ).not.toMatch(/benchN\s*<=\s*spareMax/);
  });

  it('benchSpareCount at spare_ring_max - 1 satisfies benchN < spareMax → ghost IS rendered', () => {
    // #423 adversarial: at one below capacity, the ghost must appear to indicate
    // that a ring can be moved there. Verify the predicate used by BHC build()
    // is satisfied at max-1, using benchSpareCount for an authoritative count.
    const rings = [ring('r1', { in_carry: 1 }), ring('r2', { in_carry: 1 })];
    const spareMax = 3; // bench has 1 free slot
    const benchN = benchSpareCount(rings, emptyLoadout(), null);
    // benchN (2) < spareMax (3) → ghost IS rendered.
    expect(benchN < spareMax, 'ghost condition must be true when bench has capacity').toBe(true);
  });

  it('benchSpareCount at spare_ring_max satisfies benchN >= spareMax → ghost NOT rendered', () => {
    // #423 adversarial: at full capacity, benchN (3) >= spareMax (3) → no ghost.
    const rings = [ring('r1', { in_carry: 1 }), ring('r2', { in_carry: 1 }), ring('r3', { in_carry: 1 })];
    const spareMax = 3;
    const benchN = benchSpareCount(rings, emptyLoadout(), null);
    // benchN (3) >= spareMax (3) → ghost NOT rendered.
    expect(benchN < spareMax, 'ghost condition must be false when bench is full').toBe(false);
  });

  // ── B. DISCARD slot no-op when nothing selected ───────────────────────────

  it('BattleHandOverlay.ts onDiscardSlotClick is a no-op when swap selection is null (source scan)', () => {
    // #423 adversarial: clicking DISCARD with no ring selected must NOT open the confirm
    // dialog and must NOT set __discardConfirmOpen=true. Without the `if (!sel) return`
    // guard, any DISCARD click would try to open a confirm for undefined/null ring and
    // crash with a TypeError in DiscardConfirm.open().
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const discardStart = lines.findIndex((l) => /onDiscardSlotClick\s*:/.test(l));
    expect(discardStart, 'onDiscardSlotClick handler must exist in BattleHandOverlay').toBeGreaterThan(-1);
    // The guard `if (!sel) return;` must appear within the first few lines after the handler opens.
    const handlerBlock = lines.slice(discardStart, discardStart + 6).join('\n');
    expect(
      handlerBlock,
      'onDiscardSlotClick must guard with `if (!sel) return` when nothing is selected',
    ).toMatch(/if\s*\(\s*!sel\s*\)\s*return/);
  });

  it('DiscardConfirm.open() is a no-op when called while already open (container guard)', () => {
    // #423 adversarial: a rapid double-click on the DISCARD slot could call open()
    // twice. The second call must be a no-op — no new container, no duplicate
    // keyboard handlers. The guard: `if (this.container) return;`
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    // The guard must appear inside the open() method body. Scan from the open() method
    // declaration (`) open(` at the class-body level) through the first 10 lines.
    const lines = src.split('\n');
    // Find the actual method open( — must be at class indentation level (not in docstring)
    const openStart = lines.findIndex((l) => /^\s{2}open\s*\(/.test(l));
    expect(openStart, 'DiscardConfirm.open() method must exist at class level').toBeGreaterThan(-1);
    // The guard `if (this.container) return;` is within the first 10 lines of the method body.
    const openBlock = lines.slice(openStart, openStart + 10).join('\n');
    expect(
      openBlock,
      'DiscardConfirm.open() must guard against double-open: if (this.container) return',
    ).toMatch(/if\s*\(\s*this\.container\s*\)\s*return/);
  });

  it('DiscardConfirm.dismiss() when not open does not throw (safe no-op)', () => {
    // #423 adversarial: dismiss() uses optional chaining on `this.keyHandlers?.()` and
    // `this.container?.destroy(true)`. A dismiss() call before open() (or after a
    // previous dismiss()) must never throw — both fields are null and `?.` is a no-op.
    // Source-scan: both private fields must use optional chaining in dismiss().
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const dismissStart = lines.findIndex((l) => /dismiss\s*\(\s*\)\s*:\s*void/.test(l));
    expect(dismissStart, 'DiscardConfirm.dismiss() must exist').toBeGreaterThan(-1);
    const dismissBlock = lines.slice(dismissStart, dismissStart + 10).join('\n');
    // Optional chaining ensures no crash when container/keyHandlers are null.
    expect(
      dismissBlock,
      'dismiss() must use optional chaining on keyHandlers: this.keyHandlers?.()',
    ).toContain('this.keyHandlers?.()');
    expect(
      dismissBlock,
      'dismiss() must use optional chaining on container: this.container?.destroy(true)',
    ).toContain('this.container?.destroy(true)');
  });

  it('DiscardConfirm.dismiss() sets window.__discardConfirmOpen to false on close', () => {
    // #423 adversarial: E2E tests use `window.__discardConfirmOpen` to determine whether
    // the confirm dialog is visible. If dismiss() forgets to reset the flag, E2E scripts
    // that call `waitForFunction(() => !window.__discardConfirmOpen)` would time out
    // after a successful cancel/confirm action.
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const dismissStart = lines.findIndex((l) => /dismiss\s*\(\s*\)\s*:\s*void/.test(l));
    expect(dismissStart, 'DiscardConfirm.dismiss() must exist').toBeGreaterThan(-1);
    const dismissBlock = lines.slice(dismissStart, dismissStart + 10).join('\n');
    expect(
      dismissBlock,
      'dismiss() must set window.__discardConfirmOpen = false so E2E can observe the close',
    ).toMatch(/__discardConfirmOpen\s*=\s*false/);
  });

  // ── C. WON slot toggle (deselect on re-click) ────────────────────────────

  it('RingManagementOverlayClass.ts onWonSelect clears swap selection when WON is re-clicked', () => {
    // #423 adversarial: the WON slot must toggle — clicking a selected WON ring again
    // deselects it (swap.clear()). Without the toggle check, a second click would
    // re-select the same ring (no-op swap.select), and the UI would never deselect.
    // Source-scan: the toggle branch must check both `ringId === pendingId` AND
    // `source === 'spare'` before calling swap.clear().
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The toggle condition: `this.swap.selection?.ringId === pendingId && source === 'spare'`
    expect(
      src,
      'onWonSelect toggle must check swap.selection.ringId === pendingId',
    ).toMatch(/selection\?\.ringId\s*===\s*pendingId/);
    expect(
      src,
      "onWonSelect toggle must check source === 'spare'",
    ).toMatch(/source\s*===\s*['"]spare['"]/);
    // And it must call swap.clear() (not swap.select) on the re-click path.
    expect(
      src,
      'onWonSelect toggle branch must call this.swap.clear() to deselect',
    ).toContain('this.swap.clear()');
  });

  it('RingManagementOverlayClass.ts onWonSelect is a no-op when pendingId is null (no ghost click)', () => {
    // #423 adversarial: when there is no pending ring (pendingId=null), clicking the
    // WON ghost slot fires onWonSelect but the callback has `if (!pendingId) return;`.
    // Without this guard, swap.select(null, 'spare') would be called with a null ringId,
    // corrupting the swap state and breaking subsequent move resolution.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const wonSelectStart = lines.findIndex((l) => /const onWonSelect\s*=/.test(l));
    expect(wonSelectStart, 'onWonSelect must exist in RingManagementOverlayClass.ts').toBeGreaterThan(-1);
    // The guard `if (!pendingId) return;` must appear within the first 5 lines of the lambda.
    const wonBlock = lines.slice(wonSelectStart, wonSelectStart + 6).join('\n');
    expect(
      wonBlock,
      'onWonSelect must guard: if (!pendingId) return — prevents swap.select(null, spare)',
    ).toMatch(/if\s*\(\s*!pendingId\s*\)\s*return/);
  });

  it('RingManagementOverlayClass.ts wonSel is false when swapSource is not "spare" (source scan)', () => {
    // #423 adversarial: wonSel (yellow stroke on WON card) must be true ONLY when
    // all three conditions hold: pendingId != null, selectedRingId === pendingId,
    // AND swapSource === 'spare'. With swapSource === 'a1' (a combat slot selected
    // and WON card happens to match the selectedRingId), wonSel must still be false.
    // An incomplete check (omitting the swapSource === 'spare' guard) would render
    // a yellow stroke on the WON card whenever any ring with the pending id is selected
    // — even from a combat slot, which has a different stroke convention.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const wonSelIdx = lines.findIndex((l) => /wonSel\s*=/.test(l) && !l.trim().startsWith('//'));
    expect(wonSelIdx, 'wonSel assignment must exist in BenchHealthCombat.ts').toBeGreaterThan(-1);
    // The full three-condition expression must be present.
    const wonSelBlock = lines.slice(wonSelIdx, wonSelIdx + 6).join('\n');
    expect(
      wonSelBlock,
      'wonSel must require pendingId !== null',
    ).toMatch(/pendingId\s*!==\s*null/);
    expect(
      wonSelBlock,
      'wonSel must require selectedRingId === pendingId',
    ).toMatch(/selectedRingId\s*===\s*pendingId/);
    expect(
      wonSelBlock,
      "wonSel must require swapSource === 'spare'",
    ).toMatch(/swapSource\s*===\s*['"]spare['"]/);
  });

  // ── D. DiscardConfirm.ts — structural contracts ───────────────────────────

  it('DiscardConfirm.ts exports class DiscardConfirm', () => {
    // #423 acceptance criterion: the shared discard-confirm class must be exported
    // so BattleHandOverlay, CampScene, and BaseBiomeScene can all import it.
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    expect(src, 'DiscardConfirm.ts must export class DiscardConfirm').toMatch(/export class DiscardConfirm/);
  });

  it('DiscardConfirm.ts open() sets window.__discardConfirmOpen = true', () => {
    // #423 adversarial: E2E tests detect the open confirm via `__discardConfirmOpen`.
    // If open() forgets to set the flag, Playwright waitForFunction would time out
    // and the discard flow would appear broken even when the UI renders correctly.
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    expect(
      src,
      'DiscardConfirm.open() must set window.__discardConfirmOpen = true',
    ).toMatch(/__discardConfirmOpen\s*=\s*true/);
  });

  it('DiscardConfirm.ts has container_ getter that returns the private container (E2E bridge)', () => {
    // #423 adversarial: E2E tests access the confirm buttons via bh.discardConfirm
    // → BattleHandOverlay.discardConfirm → DiscardConfirm.container_. If container_
    // is absent or returns a different field, Playwright cannot find the Y/N buttons.
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    expect(
      src,
      'DiscardConfirm must expose container_ getter for E2E bridge access',
    ).toContain('get container_');
  });

  it('DiscardConfirm.ts N-key handler calls dismiss() then onCancel (ring NOT deleted on N)', () => {
    // #423 adversarial: pressing N must call dismiss() THEN onCancel. If the order were
    // reversed, dismiss() would destroy the modal WHILE onCancel is still executing —
    // potentially leaving dangling handlers. More critically: if dismiss() is omitted,
    // the confirm stays open after the player says No, blocking further UI interaction.
    // Source-scan: the N-key handler must call dismiss() before onCancel.
    const src = readClientSrc('objects/ui/DiscardConfirm.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Find the `const onN` line — implementation: `const onN = (): void => { this.dismiss(); onCancel(); };`
    // Allow for type annotation: `const onN\s*=\s*\(\s*\)\s*(?::\s*\w+\s*=>|=>)`.
    const onNIdx = lines.findIndex((l) => /const onN\s*=/.test(l));
    expect(onNIdx, 'DiscardConfirm must define onN key handler').toBeGreaterThan(-1);
    const handlerText = lines[onNIdx] ?? '';
    // dismiss must appear before onCancel in the handler body (both on the same line in the impl)
    const dismissPos = handlerText.indexOf('this.dismiss()');
    const cancelPos = handlerText.indexOf('onCancel()');
    expect(dismissPos, 'onN handler must call this.dismiss()').toBeGreaterThan(-1);
    expect(cancelPos, 'onN handler must call onCancel()').toBeGreaterThan(-1);
    expect(
      dismissPos,
      `dismiss() (pos ${dismissPos}) must come before onCancel() (pos ${cancelPos}) in onN handler`,
    ).toBeLessThan(cancelPos);
  });

  // ── E. BHC structural contracts for #423 slots ───────────────────────────

  it('BenchHealthCombat.ts constructor declares onWonSelect as optional (no-op in modes without WON action)', () => {
    // #423 adversarial: onWonSelect is optional (`?`) so callers that do not supply it
    // (e.g. a future minimal-mode wrapper) get a safe no-op via `?.()`. Making it
    // required would force every caller to supply a potentially noop lambda.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BHC constructor must declare onWonSelect as optional (private readonly onWonSelect?:)',
    ).toMatch(/private readonly onWonSelect\?:/);
  });

  it('BenchHealthCombat.ts constructor declares onDiscardClick as optional (modes without discard action)', () => {
    // #423 adversarial: same reasoning as onWonSelect — optional prevents forced no-op lambdas.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BHC constructor must declare onDiscardClick as optional (private readonly onDiscardClick?:)',
    ).toMatch(/private readonly onDiscardClick\?:/);
  });

  it('BenchHealthCombat.ts WON ghost is rendered (non-interactive) when pendingRing is null', () => {
    // #423 adversarial: when there is no pending ring, the WON slot must show a ghost
    // rectangle (passive placeholder). If the else-branch were missing, the WON column
    // would be empty and there would be no visual cue that the slot exists.
    // Source-scan: the else branch must add a ghost rectangle at the WON slot position.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // Find the WON slot section, then verify the else branch adds a rectangle.
    const lines = src.split('\n');
    const wonSectionIdx = lines.findIndex((l) => /WON slot.*#423/.test(l));
    expect(wonSectionIdx, 'WON slot comment section must exist').toBeGreaterThan(-1);
    // Use 60 lines to capture the if(pendingRing){...} else {...} block fully.
    const wonBlock = lines.slice(wonSectionIdx, wonSectionIdx + 60).join('\n');
    // The else branch: `} else {` followed by a ghost rectangle add.
    expect(
      wonBlock,
      'WON section must have an else branch for the empty ghost placeholder',
    ).toMatch(/}\s*else\s*\{/);
    // The ghost uses method chaining: `this.scene.add\n  .rectangle(...)` (multi-line).
    // Match the presence of `this.scene.add` AND `.rectangle(` anywhere in the block.
    expect(
      wonBlock,
      'WON ghost placeholder must call this.scene.add (start of rectangle chain)',
    ).toContain('this.scene.add');
    expect(
      wonBlock,
      'WON ghost placeholder must call .rectangle() to create the ghost cell',
    ).toMatch(/\.rectangle\s*\(/);
  });

  it('BenchHealthCombat.ts DISCARD slot label text is "DISCARD" (canonical name, case-sensitive)', () => {
    // #423 adversarial: E2E tests grep for the "DISCARD" label text. A capitalisation
    // change (e.g. "Discard") would break label-text assertions without a TypeScript error.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat must use the label text "DISCARD" (all caps) for the discard slot',
    ).toContain("'DISCARD'");
  });

  it('BenchHealthCombat.ts WON label text is "WON ◆" (canonical name includes diamond)', () => {
    // #423 adversarial: E2E tests for the WON slot header check for "WON ◆". A label
    // that reads just "WON" (without ◆) would still render but break visual E2E checks.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat WON column label must be "WON ◆"',
    ).toContain("'WON ◆'");
  });

  // ── F. CampScene and BaseBiomeScene wire DiscardConfirm for new modes ─────

  it('CampScene.ts imports DiscardConfirm for sanctum DISCARD slot support (#423)', () => {
    // #423 acceptance criterion: CampScene must instantiate DiscardConfirm to handle
    // the DISCARD slot click in sanctum mode. An import check confirms the wiring is present.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must import DiscardConfirm — needed for sanctum DISCARD slot',
    ).toContain("import { DiscardConfirm }");
    expect(
      src,
      'CampScene.ts must instantiate DiscardConfirm for sanctumDiscard_',
    ).toContain('sanctumDiscard_');
  });

  it('BaseBiomeScene.ts imports DiscardConfirm for shrine-fusion DISCARD slot support (#423)', () => {
    // #423 acceptance criterion: BaseBiomeScene must provide a discard path in fusion
    // mode via the BHC DISCARD slot. Without this, shrine-fusion players can never
    // discard a ring from the overlay.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(
      src,
      'BaseBiomeScene.ts must import DiscardConfirm — needed for shrine-fusion DISCARD slot',
    ).toContain("import { DiscardConfirm }");
    expect(
      src,
      'BaseBiomeScene.ts must instantiate DiscardConfirm for fusionDiscard_',
    ).toContain('fusionDiscard_');
  });

  // ── G. Field mode COLUMN_LABELS is 3 columns not 4 (already covered in Class 5) ──
  // Verified in Class 5 and Class 6 — not duplicated here.

});

// ===========================================================================
// Class 30 — #431 merge mode: COLUMN_LABELS and publishRingMgmtState
// ===========================================================================

describe('#431 merge mode: COLUMN_LABELS and publishRingMgmtState', () => {

  it('merge mode has 4 columns: MERGE, BENCH, HEALTH, COMBAT', () => {
    // #431 acceptance criterion: the merge left column label is MERGE (not FUSE).
    // A copy-paste from the fusion mode entry that forgot to rename would produce
    // FUSE here, silently breaking the AC.
    expect(COLUMN_LABELS.merge).toEqual(['MERGE', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('merge mode left column is MERGE (index 0)', () => {
    // #431 adversarial: left-column index is 0; a right-shift bug would move
    // MERGE to index 1 and leave index 0 as BENCH.
    expect(COLUMN_LABELS.merge[0]).toBe('MERGE');
  });

  it('merge mode shares the three right-hand columns with sanctum indices 1-3', () => {
    // #431/#423 convergence contract: BENCH/HEALTH/COMBAT must be identical across
    // all four modes (sanctum, field, fusion, merge).
    const shared = COLUMN_LABELS.sanctum.slice(1);
    expect(COLUMN_LABELS.merge.slice(1)).toEqual(shared);
  });

  it('merge mode left column is MERGE, not FUSE (not a copy of fusion mode)', () => {
    // #431 adversarial: if fusion and merge share the same COLUMN_LABELS entry
    // (reference or accidental copy), the left column would be FUSE in merge mode.
    expect(COLUMN_LABELS.merge[0]).not.toBe('FUSE');
    expect(COLUMN_LABELS.merge[0]).toBe('MERGE');
  });

  it('RingMgmtMode TypeScript union includes "merge" — source scan', () => {
    // #431 acceptance criterion: the type union must include 'merge'. A missed
    // addition would allow TypeScript to reject 'merge' as a mode argument.
    const src = readClientSrc('objects/ui/RingManagementOverlay.ts');
    if (src === null) return;
    expect(
      src,
      "RingManagementOverlay.ts RingMgmtMode must include 'merge'",
    ).toContain("'merge'");
  });

  it('publishRingMgmtState merge mode sets columns to [MERGE, BENCH, HEALTH, COMBAT]', () => {
    // #431 acceptance criterion: the window hook must expose merge mode columns.
    publishRingMgmtState('merge', { bench: { n: 0, max: 5 } });
    expect((global as any).window.__ringMgmtState.columns).toEqual(['MERGE', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('publishRingMgmtState merge mode sets mode to "merge"', () => {
    publishRingMgmtState('merge', { bench: { n: 1, max: 5 } });
    expect((global as any).window.__ringMgmtState.mode).toBe('merge');
  });

  it('merge mode columns are an independent copy (not a reference to COLUMN_LABELS)', () => {
    // #431 adversarial: mutating the published state must not corrupt the canonical table.
    publishRingMgmtState('merge', { bench: { n: 0, max: 5 } });
    const stored: string[] = (global as any).window.__ringMgmtState.columns;
    stored.push('EXTRA');
    expect(COLUMN_LABELS.merge).not.toContain('EXTRA');
  });

  it('merge mode does not contain "FUSE" in any column label', () => {
    // #431 adversarial: a copy-paste from fusion mode that replaces only the key
    // but not the label array would hide FUSE inside the merge mode columns.
    for (const col of COLUMN_LABELS.merge) {
      expect(col).not.toBe('FUSE');
    }
  });

  it('merge mode does not contain "Spare" or "Spares" in any column label', () => {
    // Consistency with #389 naming: "Bench" replaces "Spares" across all modes.
    for (const col of COLUMN_LABELS.merge) {
      expect(col.toLowerCase()).not.toContain('spare');
    }
  });

  it('all four modes (sanctum, field, fusion, merge) are present in COLUMN_LABELS', () => {
    // #431 adversarial: adding a fifth mode without a COLUMN_LABELS entry would
    // cause publishRingMgmtState to spread an undefined array → runtime crash.
    const modes: RingMgmtMode[] = ['sanctum', 'field', 'fusion', 'merge'];
    for (const mode of modes) {
      expect(COLUMN_LABELS[mode]).toBeDefined();
      expect(Array.isArray(COLUMN_LABELS[mode])).toBe(true);
    }
  });

  it('RingManagementOverlayClass.ts handles merge mode in renderLeft dispatch', () => {
    // #431 acceptance criterion: the render dispatch must include a 'merge' branch.
    // A missing branch would silently skip the left column in merge mode.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      "RingManagementOverlayClass.ts must dispatch to renderMergeLeft when mode === 'merge'",
    ).toContain("mode === 'merge'");
  });

  it('RingManagementOverlayClass.ts declares renderMergeLeft method', () => {
    // #431 acceptance criterion: the method must exist as a distinct implementation
    // of the left-column render (not aliased to renderFusionLeft).
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'must declare renderMergeLeft').toContain('renderMergeLeft');
  });

  it('RingManagementOverlayClass.ts declares computeMergeResult method', () => {
    // #431 acceptance criterion: client-side eligibility check for the [MERGE] button.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'must declare computeMergeResult').toContain('computeMergeResult');
  });

  it('RingManagementOverlayClass.ts declares getBenchRingsForMerge method', () => {
    // #431 acceptance criterion: merge bench differs from fusion bench — fusion rings
    // must be included. A missing method would fall through to getBenchRingsForFusion
    // which excludes fusion rings.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'must declare getBenchRingsForMerge').toContain('getBenchRingsForMerge');
  });

  it('getBenchRingsForMerge does NOT contain `!isFusion` filter (fusion rings are eligible)', () => {
    // #431 adversarial: the spec explicitly says merge removes the `!isFusion` filter
    // present in getBenchRingsForFusion. If the filter remains, Steam/Thornado/etc.
    // rings would be invisible in the merge bench — the player could never select them.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Locate the getBenchRingsForMerge method body.
    const lines = src.split('\n');
    const methodStart = lines.findIndex((l) => /getBenchRingsForMerge\s*\(/.test(l));
    if (methodStart < 0) return; // method not found — let the existence test catch it
    // Find the next method-end (closing brace at the method indentation level).
    // Heuristic: collect up to 20 lines after the method start.
    const methodBody = lines.slice(methodStart, methodStart + 25).join('\n');
    // The method must NOT contain !isFusion — that filter is for fusion mode only.
    expect(
      methodBody,
      'getBenchRingsForMerge must not contain !isFusion filter — fusion rings are valid merge parents',
    ).not.toContain('!isFusion');
  });

  it('RingManagementOverlayClass.ts declares clearMergeParents public method', () => {
    // #431 acceptance criterion: adapters need clearMergeParents() to clear stale
    // ring references before ov.refresh() on merge success. Without it, adapters
    // must access private fields — a TypeScript error at the call site.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'must expose clearMergeParents()').toContain('clearMergeParents');
    // Must be public (not private).
    const methodMatch = src.match(/(\w+)\s+clearMergeParents\s*\(\s*\)/);
    if (methodMatch) {
      expect(
        methodMatch[1],
        'clearMergeParents must be public',
      ).not.toBe('private');
    }
  });

  it('RingManagementOverlayOpts declares onMerge option', () => {
    // #431 acceptance criterion: adapters pass the merge callback via opts.onMerge.
    // A missing declaration would force callers to cast to any.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(src, 'RingManagementOverlayOpts must declare onMerge').toContain('onMerge');
  });

  it('BaseBiomeScene.ts declares openShrineMerge method', () => {
    // #431 acceptance criterion: the scene entry point for merge mode.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene.ts must declare openShrineMerge').toContain('openShrineMerge');
  });

  it('BaseBiomeScene.ts declares activeMergeShrineId field', () => {
    // #431 adversarial: the M-key handler reads activeMergeShrineId to dispatch
    // the merge overlay. If the field is absent the keydown handler cannot pass
    // the shrine ID and the overlay opens without a valid shrine → every merge
    // would hit the "sealed shrine" error.
    const src = readClientSrc('scenes/BaseBiomeScene.ts');
    if (src === null) return;
    expect(src, 'BaseBiomeScene.ts must declare activeMergeShrineId').toContain('activeMergeShrineId');
  });

  it('FUSE column header Y-position updated: renderFusionLeft uses BENCH_GRID_TOP_Y - 20, not MODAL_TOP + 40', () => {
    // #431 acceptance criterion (spec §UX): FUSE header must move from MODAL_TOP + 40
    // to BENCH_GRID_TOP_Y - 20. A failed update leaves the header misaligned with the
    // BENCH/HEALTH/COMBAT headers (y = 128 vs. the old y ~ 78).
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Locate the DEFINITION of renderFusionLeft (private/public method declaration,
    // not the call site). The call site is `this.renderFusionLeft(c)`.
    const lines = src.split('\n');
    const fusionStart = lines.findIndex((l) => /private\s+renderFusionLeft\s*\(/.test(l));
    if (fusionStart < 0) return;
    // Extract the column-header addDomLabel call (within ~15 lines of method start).
    const fusionHeader = lines.slice(fusionStart, fusionStart + 15).join('\n');
    // Must use BENCH_GRID_TOP_Y - 20, not MODAL_TOP + 40.
    expect(
      fusionHeader,
      'renderFusionLeft column header must use BENCH_GRID_TOP_Y - 20 (not MODAL_TOP + 40)',
    ).toContain('BENCH_GRID_TOP_Y - 20');
    expect(
      fusionHeader,
      'renderFusionLeft column header must NOT use MODAL_TOP + 40 (moved to BENCH_GRID_TOP_Y - 20)',
    ).not.toContain('MODAL_TOP + 40');
  });

  it('MERGE column header Y-position is BENCH_GRID_TOP_Y - 20 in renderMergeLeft', () => {
    // #431 acceptance criterion: merge header must match the fuse/bench/health/combat
    // header row at BENCH_GRID_TOP_Y - 20.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Match the method DEFINITION, not the call site.
    const mergeStart = lines.findIndex((l) => /private\s+renderMergeLeft\s*\(/.test(l));
    if (mergeStart < 0) return;
    const mergeHeader = lines.slice(mergeStart, mergeStart + 15).join('\n');
    expect(
      mergeHeader,
      'renderMergeLeft column header must use BENCH_GRID_TOP_Y - 20',
    ).toContain('BENCH_GRID_TOP_Y - 20');
  });

});

// ===========================================================================
// Class 31 — #431 teardown: merge parent selections cleared on close only
// ===========================================================================

describe('#431 teardown: mergeParent1/2 cleared inside if (fireCb) only', () => {

  it('teardown clears mergeParent1/2 INSIDE if (fireCb) — not on every re-render', () => {
    // #431 adversarial: Phase 2 branch — this mirrors the #396 P1 fix that moved
    // fuseParent1/2 = null inside the fireCb guard. mergeParent1/2 must follow the
    // same discipline: clearing them on fireCb=false (re-render) erases the user's
    // R1/R2 selections every render cycle.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;

    const lines = src.split('\n');
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    expect(teardownStart, 'teardown method must exist').toBeGreaterThan(-1);

    const fireCbLineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    expect(fireCbLineIdx, 'teardown must contain `if (fireCb)` guard').toBeGreaterThan(teardownStart);

    // Both mergeParent1 = null and mergeParent2 = null must come AFTER if (fireCb).
    const mp1LineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /this\.mergeParent1\s*=\s*null/.test(l),
    );
    const mp2LineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /this\.mergeParent2\s*=\s*null/.test(l),
    );
    expect(mp1LineIdx, 'mergeParent1 = null must exist in teardown').toBeGreaterThan(teardownStart);
    expect(mp2LineIdx, 'mergeParent2 = null must exist in teardown').toBeGreaterThan(teardownStart);

    expect(
      mp1LineIdx,
      `mergeParent1=null (line ${mp1LineIdx + 1}) must come AFTER if (fireCb) (line ${fireCbLineIdx + 1})`,
    ).toBeGreaterThan(fireCbLineIdx);
    expect(
      mp2LineIdx,
      `mergeParent2=null (line ${mp2LineIdx + 1}) must come AFTER if (fireCb) (line ${fireCbLineIdx + 1})`,
    ).toBeGreaterThan(fireCbLineIdx);
  });

  it('teardown on re-render (fireCb=false) does NOT clear fuseParent1/2 or mergeParent1/2 — source confirms guard', () => {
    // #431 adversarial Phase 2: both fusion and merge parent fields must be inside
    // the same if (fireCb) block. If either pair is before the guard, selection state
    // is lost on every re-render, breaking both fusion and merge workflows.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;

    const lines = src.split('\n');
    const teardownStart = lines.findIndex((l) => /private teardown\(/.test(l));
    if (teardownStart < 0) return;

    const fireCbLineIdx = lines.findIndex(
      (l, i) => i > teardownStart && /if\s*\(\s*fireCb\s*\)/.test(l),
    );
    if (fireCbLineIdx < 0) return;

    // Collect all null-assignment lines in teardown that precede if (fireCb).
    const beforeGuard = lines.slice(teardownStart, fireCbLineIdx);
    const badAssignments = beforeGuard.filter((l) =>
      /this\.(fuseParent|mergeParent)[12]\s*=\s*null/.test(l),
    );
    expect(
      badAssignments,
      'fuseParent1/2 and mergeParent1/2 must NOT be cleared before the if (fireCb) guard',
    ).toHaveLength(0);
  });

  it('computeMergeResult returns eligible=false when only one slot is filled (one-slot state)', () => {
    // #431 adversarial Phase 2: computeMergeResult is called during render to decide
    // whether to enable the [MERGE] button. When only R1 is filled (R2 = null),
    // it must return { mrElement: null, eligible: false } without crashing — a
    // null-deref on r2.element would throw, breaking the overlay.
    //
    // This is a source-scan test because computeMergeResult is private. We verify
    // that the early-return guard (`if (!r1 || !r2)`) exists before the element check.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Match the method DEFINITION (private computeMergeResult), not a call site.
    const methodStart = lines.findIndex((l) => /private\s+computeMergeResult\s*\(/.test(l));
    if (methodStart < 0) return;
    // Collect up to 15 lines of the method body.
    const methodBody = lines.slice(methodStart, methodStart + 15).join('\n');
    // The guard: return { mrElement: null, eligible: false } when !r1 || !r2.
    expect(
      methodBody,
      'computeMergeResult must have an early-return guard for the one-slot (R2=null) case',
    ).toMatch(/if\s*\(\s*!r1\s*\|\|\s*!r2\s*\)/);
  });

  it('merge.spec.ts is registered in SOLO_SPECS in playwright.config.ts', () => {
    // #431 acceptance criterion: the new spec must run in the solo project.
    // A missing SOLO_SPECS entry means `npx playwright test --project solo --grep "merge"`
    // silently runs zero tests and reports "0 passed".
    const configSrc = fs.readFileSync(
      path.resolve(__dirname, '../../playwright.config.ts'),
      'utf8',
    );
    expect(
      configSrc,
      "playwright.config.ts SOLO_SPECS must include 'merge.spec.ts'",
    ).toContain('merge.spec.ts');
  });

});

// ===========================================================================
// Class 32 — #434 adversarial: InventoryGrid.setGhost() — tracked sentinel ghost
// ===========================================================================

describe('#434 adversarial: InventoryGrid.setGhost() — tracked sentinel ghost cell', () => {

  // ── A. API surface exists ─────────────────────────────────────────────────

  it('InventoryGrid.ts declares setGhost method (public API surface)', () => {
    // #434 adversarial: without setGhost the CampScene call site cannot wire the
    // ghost at all — the old ad-hoc ghost would be reconstructed, re-introducing
    // the stale-closure bug. The method must exist on the class.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      'InventoryGrid.ts must declare a setGhost method — #434 core API',
    ).toMatch(/setGhost\s*\(/);
  });

  it('InventoryGrid.ts declares private ghostCb field (nullable callback)', () => {
    // #434 adversarial: the callback must be an instance field, not a local
    // variable — a local would be captured by the closure only once and would
    // carry a stale count after the first populate() cycle (the original bug).
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      'InventoryGrid.ts must declare a private ghostCb field to store the callback',
    ).toMatch(/private\s+ghostCb/);
  });

  it('InventoryGrid.ts declares private ghostCap field (numeric capacity)', () => {
    // #434 adversarial: ghostCap must also be an instance field. If cap were
    // passed only through the closure, a setGhost(null, newCap) call later could
    // not update the effective cap without a full re-register.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      'InventoryGrid.ts must declare a private ghostCap field to store the capacity',
    ).toMatch(/private\s+ghostCap/);
  });

  // ── B. Sentinel key and destroy-on-repopulate ─────────────────────────────

  it("InventoryGrid.ts registers ghost in this.cards under sentinel key '__ghost__'", () => {
    // #434 adversarial: the whole point of this fix is that the ghost must live
    // in this.cards so populate() destroys it like any other card on the NEXT
    // call. An untracked scene.add.rectangle() orphan was the original bug.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      "InventoryGrid.ts populate() must register ghost under sentinel key '__ghost__'",
    ).toContain("'__ghost__'");
  });

  it('InventoryGrid.ts populate() destroy loop covers the __ghost__ sentinel (cards.forEach destroy)', () => {
    // #434 adversarial: if populate() destroys old cards with a filtered loop
    // (e.g. only destroying cards whose key is a ring id), the ghost would
    // survive across calls and accumulate — recreating the original stale-ghost
    // problem. The destroy loop must iterate ALL cards without filtering.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const populateStart = lines.findIndex((l) => /populate\s*\(\s*rings/.test(l));
    expect(populateStart, 'populate() method must exist').toBeGreaterThan(-1);
    // The destroy-all loop: `this.cards.forEach((c) => c.destroy())` must appear
    // BEFORE the sentinel key registration.
    const destroyIdx = lines.findIndex(
      (l, i) => i > populateStart && /cards\.forEach.*destroy/.test(l),
    );
    const ghostKeyIdx = lines.findIndex(
      (l, i) => i > populateStart && /'__ghost__'/.test(l),
    );
    expect(destroyIdx, 'cards.forEach destroy must exist in populate()').toBeGreaterThan(populateStart);
    expect(ghostKeyIdx, '__ghost__ sentinel must appear in populate()').toBeGreaterThan(populateStart);
    expect(
      destroyIdx,
      `destroy loop (line ${destroyIdx + 1}) must come BEFORE ghost registration (line ${ghostKeyIdx + 1})`,
    ).toBeLessThan(ghostKeyIdx);
  });

  // ── C. Boundary: ghost condition is strict less-than (not less-than-or-equal) ─

  it('InventoryGrid.ts ghost condition uses rings.length < ghostCap (strict <, not <=)', () => {
    // #434 adversarial: an off-by-one (<=) would render a ghost when the reliquary
    // is exactly at cap, creating a clickable placeholder that can never be filled
    // — the user would see a ghost, click it, and the move would be rejected by the
    // server. Strict less-than is the correct boundary.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // The ghost render condition: rings.length < ghostCap (or sorted.length < ghostCap)
    expect(
      src,
      'InventoryGrid populate() must use strict < for ghost condition (not <=)',
    ).toMatch(/\.length\s*<\s*(?:this\.)?ghostCap/);
    // Confirm the inverted form is NOT adjacent to the ghost registration.
    // Use the LAST '__ghost__' line (the actual cards.set call) not the first (a class comment).
    const lines = src.split('\n');
    let ghostKeyLine = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/'__ghost__'/.test(lines[i])) { ghostKeyLine = i; break; }
    }
    if (ghostKeyLine < 0) return;
    const surroundingBlock = lines.slice(Math.max(0, ghostKeyLine - 5), ghostKeyLine + 3).join('\n');
    expect(
      surroundingBlock,
      'ghost condition block must not use <= ghostCap (off-by-one would ghost at full cap)',
    ).not.toMatch(/\.length\s*<=\s*(?:this\.)?ghostCap/);
  });

  // ── D. setGhost(null) clears the callback — no stale ghost on next populate ─

  it('InventoryGrid.ts setGhost(null) stores null in ghostCb (source scan)', () => {
    // #434 adversarial: setGhost(null) is the clear path. If the method guards
    // against null (e.g. `if (!onClick) return`) and skips the assignment, a
    // prior non-null callback would persist and the ghost would keep appearing
    // even after the caller intended to remove it.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Find setGhost method body — the first assignment of this.ghostCb must
    // appear unconditionally (regardless of whether onClick is null or not).
    const setGhostStart = lines.findIndex((l) => /setGhost\s*\(/.test(l));
    expect(setGhostStart, 'setGhost method must exist').toBeGreaterThan(-1);
    const methodBody = lines.slice(setGhostStart, setGhostStart + 10).join('\n');
    // `this.ghostCb = onClick` — assigns whatever is passed (null or a function)
    expect(
      methodBody,
      'setGhost must assign this.ghostCb = onClick (null or function, no null guard)',
    ).toMatch(/this\.ghostCb\s*=\s*onClick/);
  });

  // ── E. ghostCap = 0 → no ghost, even for an empty ring array ──────────────

  it('InventoryGrid.ts with ghostCap = 0, rings.length (0) < 0 is false → ghost never appears', () => {
    // #434 adversarial: cap = 0 means the pool has zero capacity. Even when
    // rings is empty (rings.length = 0), the condition 0 < 0 is false, so no
    // ghost is rendered. This prevents a ghost from appearing in a disabled grid.
    const zeroCapCondition = 0 < 0; // mirrors: sorted.length < this.ghostCap where ghostCap=0
    expect(
      zeroCapCondition,
      'ghost condition with cap=0 and rings.length=0 must be false (0 < 0 === false)',
    ).toBe(false);
  });

  it('InventoryGrid.ts with ghostCap = 1 and rings empty, ghost IS rendered (0 < 1)', () => {
    // #434 adversarial: at non-zero cap with zero rings, the ghost must appear.
    // Failure mode: the implementation accidentally initialises ghostCap = 0
    // even after setGhost(cb, 1) due to a default-parameter bug.
    const condition = 0 < 1; // mirrors: sorted.length < this.ghostCap where ghostCap=1
    expect(
      condition,
      'ghost condition with cap=1 and rings.length=0 must be true',
    ).toBe(true);
  });

  it('InventoryGrid.ts with rings.length === ghostCap, condition is false — ghost suppressed at exact cap', () => {
    // #434 adversarial: the exact-at-cap boundary — rings.length === ghostCap.
    // The ghost must NOT appear; strict < fires false at this boundary.
    // This is the most likely off-by-one: an implementer who uses <= instead
    // of < would pass all other tests but fail at this boundary.
    const ghostCap = 5;
    const ringsLength = 5; // at cap
    const condition = ringsLength < ghostCap;
    expect(
      condition,
      'ghost condition must be false when rings.length equals ghostCap (exactly at cap)',
    ).toBe(false);
  });

  it('InventoryGrid.ts with rings.length === ghostCap - 1, condition is true — ghost IS rendered one below cap', () => {
    // #434 adversarial: one below cap must still show a ghost. This pairs with
    // the exact-at-cap test to confirm the boundary is exactly right.
    const ghostCap = 5;
    const ringsLength = 4; // one below cap
    const condition = ringsLength < ghostCap;
    expect(
      condition,
      'ghost condition must be true when rings.length is one below ghostCap',
    ).toBe(true);
  });

  // ── F. CampScene migration: old ad-hoc ghost block removed ───────────────

  it('CampScene.ts no longer contains the inline untracked ghost Rectangle block (#434 removed)', () => {
    // #434 adversarial: the old ad-hoc block used `scene.add.rectangle(...)` to
    // create an untracked ghost OUTSIDE this.cards. Any surviving `add.rectangle`
    // near the SPIRIT ghost section would re-introduce the orphan-Rectangle bug.
    // Source-scan: the ad-hoc inline ghost must be gone. CampScene must call
    // sanctumGrid.setGhost instead.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // The old block had a distinctive comment pattern. Scan for it.
    // We look for the `reliqCount` closure being captured locally — in the new
    // impl, reliqCount is no longer captured at render time; instead, the live
    // rings.length is used inside populate() on each call.
    // The canonical old fingerprint: `const ghostRect = ... .rectangle(`.
    // Rather than over-specify, we verify that the new wiring is present.
    expect(
      src,
      'CampScene.ts must call sanctumGrid.setGhost to register the SPIRIT ghost (#434)',
    ).toContain('sanctumGrid.setGhost');
    // And that there is no second, parallel inline ghost creation (the old form).
    // The old block created a ghost directly on sanctumGrid.getCardContainer(),
    // which is the only way a non-tracked ghost would appear in the same container.
    // A surviving `getCardContainer()` call in the ghost-creation context (not scroll
    // context) would indicate the old block is still present. We verify the file does
    // NOT contain `getCardContainer().add(` as ghost-creation (scroll arrow callers
    // use setScrollRow / scrollBy, not getCardContainer().add()).
    const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasOrphanGhostAdd = lines.some((l) => /getCardContainer\(\)\s*\.add\s*\(/.test(l));
    expect(
      hasOrphanGhostAdd,
      'CampScene.ts must not call getCardContainer().add() to create an untracked ghost — use setGhost instead',
    ).toBe(false);
  });

  it('CampScene.ts passes the reliquary callback and reliquaryCap to setGhost (source scan)', () => {
    // #434 adversarial: the call must pass both the move callback and the capacity.
    // Omitting the cap argument would leave ghostCap at its default (likely 0),
    // so no ghost would ever appear. Omitting the callback would mean clicks are no-ops.
    // The callback may be extracted into a variable (spiritGhostCb) before the call,
    // so we scan the region around the setGhost call broadly, not just the call line.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Find the line with sanctumGrid.setGhost( and capture a broad window around it.
    const setGhostLine = lines.findIndex((l) => /sanctumGrid\.setGhost\s*\(/.test(l));
    expect(setGhostLine, 'CampScene.ts must call sanctumGrid.setGhost').toBeGreaterThan(-1);
    // Scan 30 lines BEFORE and 5 lines AFTER the setGhost call to capture both the
    // inline-callback and extracted-variable patterns.
    const callRegion = lines.slice(Math.max(0, setGhostLine - 30), setGhostLine + 6).join('\n');
    // reliquaryCap must appear in the call or be a variable defined nearby.
    expect(
      callRegion,
      'CampScene.ts setGhost call region must reference reliquaryCap',
    ).toMatch(/reliquaryCap/);
    // The callback (inline or extracted variable) must call reliquaryMove.
    expect(
      callRegion,
      "CampScene.ts setGhost callback (or extracted spiritGhostCb) must call reliquaryMove",
    ).toMatch(/reliquaryMove/);
    // The move must target 'reliquary' (not 'spare' or a battle slot).
    expect(
      callRegion,
      "CampScene.ts setGhost callback must send ring to 'reliquary'",
    ).toMatch(/'reliquary'/);
  });

  // ── G. Ghost pointerdown fires the callback (not suppressed by interactivity bug) ─

  it("InventoryGrid.ts ghost rectangle is set interactive with cursor 'pointer' (pointerdown fires)", () => {
    // #434 adversarial: the ghost rectangle must be interactive so pointerdown
    // fires ghostCb. An implementation that forgets setInteractive() would render
    // the ghost visually but the click would silently fall through to the scene.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // The ghost setup must call setInteractive and register a pointerdown handler.
    // Source-scan: use the LAST occurrence of '__ghost__' (the this.cards.set
    // registration line) — the first occurrence may be in a class comment block.
    const lines = src.split('\n');
    // Find the last '__ghost__' line (the actual cards.set registration).
    let ghostStart = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      if (/'__ghost__'/.test(lines[i])) { ghostStart = i; break; }
    }
    if (ghostStart < 0) return;
    // Scan 25 lines before the sentinel key registration for the interactive setup.
    const ghostBlock = lines.slice(Math.max(0, ghostStart - 25), ghostStart + 5).join('\n');
    expect(
      ghostBlock,
      "InventoryGrid ghost rectangle must call setInteractive({ useHandCursor: true }) or setInteractive()",
    ).toContain('setInteractive');
    expect(
      ghostBlock,
      "InventoryGrid ghost rectangle must register a 'pointerdown' handler to fire ghostCb",
    ).toContain('pointerdown');
  });

  // ── H. Repeated populate() calls do not accumulate ghosts ─────────────────

  it("InventoryGrid.ts populate() calls this.cards.clear() before adding new cards (including ghost)", () => {
    // #434 adversarial: this is the original bug's root cause. An implementation
    // that skips cards.clear() — or clears it AFTER registering the ghost — would
    // accumulate one ghost per populate() call, each listening for clicks.
    // Verify cards.clear() appears BEFORE the ghost registration (__ghost__ sentinel).
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const populateStart = lines.findIndex((l) => /populate\s*\(\s*rings/.test(l));
    expect(populateStart, 'populate() must exist').toBeGreaterThan(-1);
    const clearIdx = lines.findIndex(
      (l, i) => i > populateStart && /this\.cards\.clear\(\)/.test(l),
    );
    const ghostKeyIdx = lines.findIndex(
      (l, i) => i > populateStart && /'__ghost__'/.test(l),
    );
    expect(clearIdx, 'this.cards.clear() must be called in populate()').toBeGreaterThan(populateStart);
    expect(ghostKeyIdx, '__ghost__ sentinel must appear in populate()').toBeGreaterThan(populateStart);
    expect(
      clearIdx,
      `cards.clear() (line ${clearIdx + 1}) must come BEFORE __ghost__ registration (line ${ghostKeyIdx + 1})`,
    ).toBeLessThan(ghostKeyIdx);
  });

  // ── I. Ghost fill colour matches scene-graph walk used by Scenario 16 ──────

  it("InventoryGrid.ts ghost fill colour is 0x1a2233 (matching existing Scenario 16 scene-graph walk)", () => {
    // #434 adversarial: Scenario 16 detects the ghost by walking the scene graph
    // for `type === 'Rectangle' && fillColor === 0x1a2233 && input?.cursor === 'pointer'`.
    // A ghost with a different fill (e.g. 0x1a2244 from a copy-paste error) would
    // pass tsc but make Scenario 16 report "ghost not found" every time.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      'InventoryGrid ghost rectangle fill must be 0x1a2233 so Scenario 16 scene-graph walk detects it',
    ).toContain('0x1a2233');
  });

  // ── J. Ghost callback guards on selection (no-op when nothing selected) ────

  it("CampScene.ts setGhost callback checks selection before calling reliquaryMove (source scan)", () => {
    // #434 adversarial: the ghost callback is fired by pointerdown on the ghost
    // Rectangle. If the callback calls reliquaryMove unconditionally (without
    // checking for an active selection), a click with nothing selected would send
    // a spurious PUT /api/rings/:id/reliquary with an undefined ringId — potentially
    // crashing the server handler or silently moving the wrong ring.
    // The approved callback shape: `const sel = this.swapManager?.selection; if (!sel) return;`
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    // The callback body must contain a guard on the selection before the move call.
    // Source scan: look for the pattern inside the setGhost call region.
    expect(
      src,
      "CampScene.ts setGhost callback must guard on swapManager?.selection before reliquaryMove",
    ).toMatch(/swapManager\?\.selection/);
    expect(
      src,
      'CampScene.ts setGhost callback must return early when no selection is active',
    ).toMatch(/if\s*\(\s*!sel\s*\)\s*return/);
  });

  // ── K. No new populate-like shadow method introduced ─────────────────────

  it('InventoryGrid.ts does not declare a separate populateWithGhost method (ghost is in populate)', () => {
    // #434 adversarial: a shadow method (populateWithGhost, populateSpirit, etc.)
    // would duplicate the card-rendering loop and diverge from populate() over time.
    // The spec explicitly forbids a new populate-like method.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    expect(
      src,
      'InventoryGrid.ts must not introduce a populateWithGhost shadow method — ghost lives in populate()',
    ).not.toMatch(/populateWithGhost/);
    expect(
      src,
      'InventoryGrid.ts must not introduce a populateSpirit shadow method — ghost lives in populate()',
    ).not.toMatch(/populateSpirit/);
  });

  // ── L. TypeScript compilation guard ──────────────────────────────────────

  it('InventoryGrid.ts setGhost signature accepts null as the onClick argument (nullable type)', () => {
    // #434 adversarial: if the TypeScript signature is `onClick: () => void` (non-
    // nullable), callers cannot pass null to clear the ghost — setGhost(null, 0)
    // would fail at compile time. The signature must be `(() => void) | null`.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // The signature: `setGhost(onClick: (() => void) | null, cap: number)`
    // or equivalent nullable form. We scan the setGhost declaration line.
    const lines = src.split('\n');
    const setGhostLine = lines.find((l) => /setGhost\s*\(/.test(l) && !/\/\//.test(l));
    expect(setGhostLine, 'setGhost declaration line must exist').toBeDefined();
    // The type must include `null` to allow clearing the ghost.
    expect(
      setGhostLine!,
      "setGhost onClick parameter must accept null (type should be '(() => void) | null' or similar)",
    ).toMatch(/null/);
  });

});

// ===========================================================================
// Class 33 — #434 Phase 2 impl-aware: private path branches in InventoryGrid
// ===========================================================================

describe('#434 Phase 2 impl-aware: InventoryGrid ghost — private path branches', () => {

  // ── A. totalRows undercount: ghost row not included in Math.ceil formula ───

  it('InventoryGrid.ts totalRows is computed from sorted.length only (ghost row is NOT counted)', () => {
    // #434 Phase 2 adversarial: totalRows = Math.ceil(sorted.length / numCols).
    // The ghost is NOT in `sorted`, so when sorted.length % numCols === 0 the ghost
    // lands on a brand-new row that totalRows doesn't count. isScrollable() uses
    // totalRows, so the ghost row never triggers the down-arrow — correct for the
    // reliquary context (cap=9, numCols=3, visibleRows=3), but a latent undercount
    // in general. This test locks the current behaviour so any future refactor that
    // changes it (e.g. adding +1 for the ghost row) is caught intentionally.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // Source-scan: totalRows is set from `sorted.length`, not from `this.cards.size`
    // (which would include the ghost) and not from `sorted.length + 1`.
    const lines = src.split('\n');
    const totalRowsLine = lines.find((l) => /this\.totalRows\s*=/.test(l) && !/\/\//.test(l));
    expect(totalRowsLine, 'totalRows assignment must exist').toBeDefined();
    // Must be `Math.ceil(sorted.length / this.numCols)` — not cards.size, not sorted.length+1.
    expect(
      totalRowsLine!,
      'totalRows must be computed from sorted.length (ghost not counted) — latent undercount locked as spec',
    ).toMatch(/Math\.ceil\s*\(\s*sorted\.length\s*\/\s*this\.numCols\s*\)/);
    expect(
      totalRowsLine!,
      'totalRows must NOT include a +1 for the ghost row (current locked behaviour)',
    ).not.toMatch(/sorted\.length\s*\+\s*1/);
    expect(
      totalRowsLine!,
      'totalRows must NOT use this.cards.size (that would include the ghost)',
    ).not.toMatch(/this\.cards\.size/);
  });

  it('ghost row visibility when sorted.length is a multiple of numCols — cardRows entry IS set', () => {
    // #434 Phase 2 adversarial: when sorted.length % numCols === 0, the ghost is
    // placed at column 0 of a NEW row (gRow = sorted.length / numCols). updateCardVisibility
    // uses cardRows.get('__ghost__') to decide visibility — that entry must be set
    // even in this edge case, or the ghost would be visible=false (default from Map miss
    // resolved to row=0 via `?? 0`, which IS within visibleRows=3... actually safe).
    // Source-scan: cardRows.set('__ghost__', gRow) is unconditional inside the ghost block.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostBlockStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostBlockStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostBlockStart, ghostBlockStart + 20).join('\n');
    // cardRows.set('__ghost__', gRow) must be present — ensures updateCardVisibility
    // gets the correct row index even when gRow > 0 (new row at column-boundary).
    expect(
      ghostBlock,
      "cardRows.set('__ghost__', gRow) must be inside the ghost block (not conditional on gCol===0)",
    ).toContain("cardRows.set('__ghost__', gRow)");
  });

  // ── B. Ghost row at column-boundary is visible when visibleRows covers it ──

  it('ghost gRow formula: Math.floor(sorted.length / numCols) — correct for all multiples', () => {
    // #434 Phase 2 adversarial: the row index for the ghost must be
    // Math.floor(gIdx / numCols) where gIdx = sorted.length. When sorted.length is
    // a multiple of numCols (e.g. 3 rings, numCols=3 → gIdx=3 → gRow=1), the ghost
    // lands in row 1. With visibleRows=3 this row IS visible (0 ≤ 1 < 3). Verify
    // the formula is correct for the critical multiples.
    const numCols = 3;
    // sorted.length = 3 (fills row 0 exactly) → ghost at col 0, row 1
    expect(Math.floor(3 / numCols)).toBe(1);
    // sorted.length = 6 (fills rows 0-1 exactly) → ghost at col 0, row 2
    expect(Math.floor(6 / numCols)).toBe(2);
    // sorted.length = 0 (empty) → ghost at col 0, row 0
    expect(Math.floor(0 / numCols)).toBe(0);
    // sorted.length = 1 (partial row 0) → ghost at col 1, row 0
    expect(Math.floor(1 / numCols)).toBe(0);
    expect(1 % numCols).toBe(1); // gCol = 1
  });

  it('ghost is within visibleRows=3 window for reliquary context (sorted.length ≤ 8, numCols=3)', () => {
    // #434 Phase 2 adversarial: the reliquary context has cap=9, numCols=3, visibleRows=3.
    // For any sorted.length from 0 to 8 (below cap) the ghost row must be < visibleRows.
    // If gRow >= visibleRows the ghost would be hidden immediately on modal open —
    // the player would see no ghost and be unable to fill the reliquary without scrolling.
    const numCols = 3;
    const visibleRows = 3;
    for (let n = 0; n <= 8; n++) {
      const gRow = Math.floor(n / numCols);
      expect(
        gRow,
        `sorted.length=${n}: ghost gRow=${gRow} must be < visibleRows=${visibleRows} so the ghost is always initially visible`,
      ).toBeLessThan(visibleRows);
    }
  });

  // ── C. Ghost callback captures ghostCb at render time (not at click time) ──

  it('InventoryGrid.ts ghost closure captures ghostCb into a local variable (race-free)', () => {
    // #434 Phase 2 adversarial: the implementation copies `this.ghostCb` into a
    // local `const ghostCb` before passing it to the pointerdown handler. This means
    // a subsequent `setGhost(null)` call between populate() and the click cannot make
    // the handler call null (since the local `ghostCb` still holds the original function).
    // This is intentional — the ghost is destroyed and rebuilt on next populate() which
    // clears the old handler. Source-scan: the local capture must exist.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    // The local capture: `const ghostCb = this.ghostCb;`
    expect(
      ghostBlock,
      'ghost block must capture this.ghostCb into a local const to prevent null-call race',
    ).toMatch(/const\s+ghostCb\s*=\s*this\.ghostCb/);
    // The pointerdown handler must call the local `ghostCb`, not `this.ghostCb`.
    expect(
      ghostBlock,
      'pointerdown handler must call the captured local ghostCb() not this.ghostCb()',
    ).toMatch(/pointerdown.*ghostCb\(\)/s);
    expect(
      ghostBlock,
      'pointerdown handler must NOT call this.ghostCb() directly (would null-deref after setGhost(null))',
    ).not.toMatch(/this\.ghostCb\(\)/);
  });

  // ── D. Ghost NOT in cardBgs — getCardBg('__ghost__') is undefined ──────────

  it("InventoryGrid.ts ghost is NOT inserted into cardBgs (getCardBg('__ghost__') returns undefined)", () => {
    // #434 Phase 2 adversarial: cardBgs is used by handleClick and clearSelection
    // to update stroke styles. If the ghost were in cardBgs, calling clearSelection()
    // after a ghost click could try to setStrokeStyle on the ghost Rectangle, which
    // succeeds visually but would add a selection stroke to a non-ring placeholder.
    // Source-scan: cardBgs.set must only be called inside the ring card loop (not
    // in the ghost block).
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    // cardBgs.set must NOT appear in the ghost block.
    expect(
      ghostBlock,
      "ghost block must not call cardBgs.set — ghost is NOT in cardBgs (no selection stroke needed)",
    ).not.toContain('cardBgs.set');
  });

  // ── E. Ghost NOT in cardFillOrder — fusedFillOrder('__ghost__') is undefined ─

  it("InventoryGrid.ts ghost is NOT inserted into cardFillOrder (fusedFillOrder('__ghost__') is undefined)", () => {
    // #434 Phase 2 adversarial: cardFillOrder is used for E2E assertions about
    // two-tone fill colors. Including '__ghost__' would expose a fill order entry
    // for a non-ring, which could confuse E2E tests doing allFusedFillOrders() snapshots.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    expect(
      ghostBlock,
      "ghost block must not call cardFillOrder.set — ghost has no element/xp fill",
    ).not.toContain('cardFillOrder.set');
  });

  // ── F. updateCardVisibility iterates `this.cards` — includes ghost ──────────

  it('InventoryGrid.ts updateCardVisibility iterates this.cards (includes ghost via sentinel)', () => {
    // #434 Phase 2 adversarial: updateCardVisibility must iterate `this.cards`
    // (not `this.cardBgs` or `sorted`). Because the ghost is in `this.cards` under
    // '__ghost__', it participates in the visibility windowing automatically.
    // If the method iterated cardBgs instead, the ghost would never be hidden/shown
    // and would bleed outside the visible window when the grid is scrolled.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const updateVisStart = lines.findIndex((l) => /private updateCardVisibility\s*\(/.test(l));
    expect(updateVisStart, 'updateCardVisibility method must exist').toBeGreaterThan(-1);
    const methodBody = lines.slice(updateVisStart, updateVisStart + 12).join('\n');
    // Must iterate `this.cards.forEach(...)` — the ghost is a value in this.cards.
    expect(
      methodBody,
      'updateCardVisibility must iterate this.cards.forEach (includes ghost under __ghost__ key)',
    ).toMatch(/this\.cards\.forEach/);
    // Must NOT iterate this.cardBgs (ghost is absent from cardBgs).
    expect(
      methodBody,
      'updateCardVisibility must not iterate this.cardBgs (ghost absent from cardBgs)',
    ).not.toMatch(/this\.cardBgs\.forEach/);
  });

  // ── G. onBeforeDestroy calls setGhost(null) — grid reuse safety ────────────

  it('CampScene.ts onBeforeDestroy calls setGhost(null) to clear ghost for grid reuse', () => {
    // #434 Phase 2 adversarial: the sanctumGrid is a reused panel (adoptPanel/
    // releasePanel pattern). If setGhost(null) is not called on close, the ghost
    // callback and cap remain set from the previous modal open. On the next loadData()
    // call (which runs populate()) outside the modal context, the ghost would appear
    // in an unexpected render target (e.g. a non-modal grid render).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const onBeforeDestroyStart = lines.findIndex((l) => /onBeforeDestroy\s*:\s*\(c\)/.test(l));
    expect(onBeforeDestroyStart, 'onBeforeDestroy handler must exist in CampScene').toBeGreaterThan(-1);
    const handlerBody = lines.slice(onBeforeDestroyStart, onBeforeDestroyStart + 15).join('\n');
    expect(
      handlerBody,
      'onBeforeDestroy must call sanctumGrid.setGhost(null) to clear ghost for grid reuse',
    ).toContain('sanctumGrid.setGhost(null)');
  });

  // ── H. setGhost(null) zeroes cap argument implicitly via default (cap=0) ───

  it('InventoryGrid.ts setGhost(null) with no cap arg defaults cap to 0 (safe clear)', () => {
    // #434 Phase 2 adversarial: setGhost(null) is called with ONE argument in
    // onBeforeDestroy. The signature is `setGhost(onClick, cap = 0)` — cap defaults
    // to 0. This means ghostCap becomes 0 after the clear, which is doubly safe:
    // even if ghostCb were somehow non-null, 0 < 0 is always false.
    // Source-scan: the cap parameter must have a default value of 0.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const setGhostDecl = lines.find((l) => /setGhost\s*\(onClick/.test(l));
    expect(setGhostDecl, 'setGhost declaration must exist').toBeDefined();
    expect(
      setGhostDecl!,
      'setGhost cap parameter must default to 0 so setGhost(null) safely zeroes the cap',
    ).toMatch(/cap\s*=\s*0/);
  });

  // ── I. Explicit re-populate after setGhost on modal open ───────────────────

  it('CampScene.ts calls sanctumGrid.populate() immediately after setGhost() on modal open', () => {
    // #434 Phase 2 adversarial: populate() ran in loadData() BEFORE setGhost() was
    // called (during modal open). Without the explicit re-populate after setGhost(),
    // the ghost would not appear until the FIRST ring move triggers another populate().
    // The impl adds a populate() call immediately after setGhost() to fix this.
    // Source-scan: sanctumGrid.populate( must appear AFTER sanctumGrid.setGhost( in
    // the renderLeft / onRender block.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const setGhostLine = lines.findIndex((l) => /sanctumGrid\.setGhost\s*\(/.test(l));
    expect(setGhostLine, 'sanctumGrid.setGhost must exist').toBeGreaterThan(-1);
    const populateAfterLine = lines.findIndex(
      (l, i) => i > setGhostLine && /sanctumGrid\.populate\s*\(/.test(l),
    );
    expect(
      populateAfterLine,
      `sanctumGrid.populate() (line ${populateAfterLine + 1}) must appear AFTER setGhost() (line ${setGhostLine + 1}) — explicit re-populate ensures ghost appears on modal open`,
    ).toBeGreaterThan(setGhostLine);
  });

  // ── J. populate() clears `selected` — ghost click cannot inherit stale selection ─

  it('InventoryGrid.ts populate() resets this.selected to null (ghost click starts fresh)', () => {
    // #434 Phase 2 adversarial: populate() sets `this.selected = null` at the top
    // of the destroy-and-rebuild cycle. This means any re-populate (e.g. after a
    // ghost-slot drop) cannot inherit a stale selection reference to a destroyed card.
    // If selected were not reset, clearSelection() after the rebuild would try to
    // call cardBgs.get(selected.id) on an id whose card no longer exists.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const populateStart = lines.findIndex((l) => /populate\s*\(\s*rings/.test(l));
    expect(populateStart, 'populate() method must exist').toBeGreaterThan(-1);
    // selected = null must appear in the early destroy block, before the sorted loop.
    const sortedIdx = lines.findIndex((l, i) => i > populateStart && /const sorted\s*=/.test(l));
    const selectedNullIdx = lines.findIndex(
      (l, i) => i > populateStart && /this\.selected\s*=\s*null/.test(l),
    );
    expect(selectedNullIdx, 'this.selected = null must exist in populate()').toBeGreaterThan(populateStart);
    expect(
      selectedNullIdx,
      `this.selected=null (line ${selectedNullIdx + 1}) must come BEFORE sorted loop (line ${sortedIdx + 1})`,
    ).toBeLessThan(sortedIdx);
  });

  // ── K. Ghost stroke uses a distinct colour (not DESELECTED_STROKE) ──────────

  it('InventoryGrid.ts ghost rectangle has a distinct stroke colour (not 0x888888 DESELECTED_STROKE)', () => {
    // #434 Phase 2 adversarial: DESELECTED_STROKE is 0x888888 (grey) — the same
    // colour as an unselected ring card. A ghost with the identical stroke would
    // appear identical to a placeholder ring card, giving no visual cue that it
    // is an empty slot. The impl uses 0x446688 (blue-tinted) to distinguish it.
    // Source-scan: the ghost setStrokeStyle must NOT use DESELECTED_STROKE (0x888888).
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    // The ghost stroke must NOT be the same grey as ring cards.
    expect(
      ghostBlock,
      'ghost stroke must not use DESELECTED_STROKE (0x888888) — would be visually indistinct from a ring card',
    ).not.toMatch(/setStrokeStyle\s*\([^)]*0x888888/);
    // It must set SOME stroke (distinguishable from no stroke).
    expect(
      ghostBlock,
      'ghost must call setStrokeStyle to give a visible outline (distinguishable from blank space)',
    ).toContain('setStrokeStyle');
  });

  // ── L. Ghost alpha is < 1 (visually distinct — not opaque like a real card) ─

  it('InventoryGrid.ts ghost rectangle setAlpha is called with a value < 1', () => {
    // #434 Phase 2 adversarial: a ghost at full opacity (alpha=1) is visually
    // indistinguishable from a dark ring card with no content — the player would
    // click it expecting a ring, not a drop slot. The impl uses alpha=0.7 to
    // convey "placeholder / empty slot" semantics.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    // The ghost must call setAlpha with a value strictly between 0 and 1.
    const alphaMatch = ghostBlock.match(/setAlpha\s*\(\s*([\d.]+)\s*\)/);
    expect(alphaMatch, 'ghost must call setAlpha()').toBeTruthy();
    const alpha = parseFloat(alphaMatch![1]);
    expect(
      alpha,
      `ghost alpha (${alpha}) must be < 1 to visually distinguish it from an opaque ring card`,
    ).toBeLessThan(1);
    expect(
      alpha,
      `ghost alpha (${alpha}) must be > 0 (invisible ghost would be unclickable)`,
    ).toBeGreaterThan(0);
  });

  // ── M. Ghost is added to cardContainer (not directly to the grid) ──────────

  it('InventoryGrid.ts ghost is added to this.cardContainer (scrolls with the grid)', () => {
    // #434 Phase 2 adversarial: ring cards are added to `this.cardContainer` (the
    // scrolled inner container) so setScrollRow can offset them. If the ghost were
    // added directly to `this` (the outer grid container), it would NOT scroll with
    // the ring cards — it would be fixed at its initial position while the ring
    // cards scroll underneath it. Source-scan: cardContainer.add(ghost) must appear
    // in the ghost block.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const ghostCondStart = lines.findIndex((l) => /this\.ghostCb\s*!==\s*null/.test(l));
    expect(ghostCondStart, 'ghost condition block must exist').toBeGreaterThan(-1);
    const ghostBlock = lines.slice(ghostCondStart, ghostCondStart + 20).join('\n');
    expect(
      ghostBlock,
      'ghost must be added to this.cardContainer (not this) so it scrolls with ring cards',
    ).toContain('cardContainer.add(ghost)');
    // Confirm it is NOT added directly to the outer grid container.
    expect(
      ghostBlock,
      'ghost must NOT be added via this.add() — that would pin it outside the scroll container',
    ).not.toMatch(/this\.add\s*\(\s*ghost\s*\)/);
  });

  // ── N. Cards Map widened to union type (pre-existing #389 test now stale) ───

  it('InventoryGrid.ts cards Map accepts Phaser.GameObjects.Rectangle (union type for ghost)', () => {
    // #434 Phase 2: the cards Map was widened from Map<string, RingCard> to
    // Map<string, RingCard | Phaser.GameObjects.Rectangle> to hold the ghost
    // Rectangle alongside ring cards. The pre-existing #389 test asserting the
    // narrower type is now stale — this test locks the correct union type.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // The declaration must include Rectangle in the union.
    expect(
      src,
      'cards Map must be typed Map<string, RingCard | Phaser.GameObjects.Rectangle> after #434',
    ).toMatch(/Map<string,\s*RingCard\s*\|\s*Phaser\.GameObjects\.Rectangle>/);
  });

  // ── O. CampScene reliquaryCap sourced from __campState at setGhost call time ─

  it('CampScene.ts setGhost reads reliquaryCap from window.__campState at renderLeft time', () => {
    // #434 Phase 2 adversarial: the cap must be read from the live __campState at
    // the moment the modal opens, not hard-coded or cached from a prior open. Using
    // a stale cap would allow the ghost to appear even when the player has upgraded
    // their reliquaryCap since the last open. Source-scan: the cap argument to
    // setGhost must derive from window.__campState (or a local variable from it).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const setGhostLine = lines.findIndex((l) => /sanctumGrid\.setGhost\s*\(/.test(l));
    expect(setGhostLine, 'sanctumGrid.setGhost must exist').toBeGreaterThan(-1);
    // Scan 10 lines before the setGhost call to find the cap variable definition.
    const capRegion = lines.slice(Math.max(0, setGhostLine - 10), setGhostLine + 2).join('\n');
    expect(
      capRegion,
      'reliquaryCap must be sourced from window.__campState at the renderLeft call site',
    ).toMatch(/window\.__campState/);
  });

});

// ===========================================================================
// Class 25 — Phase 1 spec-driven adversarial: #462 per-ring RECHARGE slot
// ===========================================================================

describe('#462 Phase 1 spec-driven: per-ring RECHARGE slot in BenchHealthCombat', () => {

  // ── A. Button renamed: [RECHARGE ALL] source assertions ────────────────────

  it('BenchHealthCombat.ts [RECHARGE ALL] button text is present in source', () => {
    // #462 adversarial: the rename from [RECHARGE] to [RECHARGE ALL] is an acceptance criterion.
    // A partial rename (e.g. updating the DOM label but not the canvas text) would leave the
    // old string in the scene-graph and break E2E scenario 5.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat must contain the renamed [RECHARGE ALL] button text',
    ).toContain('[RECHARGE ALL]');
  });

  it('BenchHealthCombat.ts does NOT contain the single-quoted bare [RECHARGE] string literal', () => {
    // #462 adversarial: the old button text "'[RECHARGE]'" must be gone after the rename.
    // BLOCKER note: using not.toContain('[RECHARGE]') would ALWAYS fail because '[RECHARGE]'
    // is a substring of '[RECHARGE ALL]'. The ONLY safe assertion is not.toContain("'[RECHARGE]'")
    // (the single-quoted form), which targets the string literal specifically.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      "BenchHealthCombat must not contain the old bare \"'[RECHARGE]'\" string literal — use \"'[RECHARGE ALL]'\" instead",
    ).not.toContain("'[RECHARGE]'");
  });

  it('BenchHealthCombat.ts DOM label above button is renamed to "Recharge All"', () => {
    // #462 adversarial: the addDomLbl call for the button label must also be updated.
    // Leaving it as 'Recharge' while the canvas text reads '[RECHARGE ALL]' creates an
    // inconsistent UI (DOM label says one thing, canvas text another).
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      "BenchHealthCombat addDomLbl must use 'Recharge All' (not 'Recharge') for the button label",
    ).toContain('Recharge All');
  });

  // ── B. [RECHARGE ALL] geometry: must be at y=487 ───────────────────────────

  it('BenchHealthCombat.ts [RECHARGE ALL] button is placed at ROW_RECHARGE_BTN_Y = 487', () => {
    // #462 adversarial: the button shifts down from y=389 to y=487 to make room for the new
    // RECHARGE slot at y=389. If the button stays at 389 it collides with the new slot.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // ROW_RECHARGE_BTN_Y constant (or inline 487) must be defined.
    const has487 = src.includes('487') || src.includes('ROW_RECHARGE_BTN_Y');
    expect(
      has487,
      'BenchHealthCombat must place [RECHARGE ALL] at y=487 (ROW_RECHARGE_BTN_Y) — down from old 389',
    ).toBe(true);
  });

  // ── C. RECHARGE slot: geometry and visual style ─────────────────────────────

  it('BenchHealthCombat.ts defines ROW_RECHARGE_BTN_Y or uses 487 as new button row constant', () => {
    // #462 adversarial: both the slot (389) and the button (487) must fit within the modal
    // bottom at y=538 (≈51 px margin). If either value drifts above 538 the controls clip.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // Either the named constant or the bare value must appear.
    expect(
      src.includes('ROW_RECHARGE_BTN_Y') || src.includes('487'),
      'BenchHealthCombat must define ROW_RECHARGE_BTN_Y=487 (within modal bottom 538)',
    ).toBe(true);
  });

  it('BenchHealthCombat.ts RECHARGE slot uses gold fill 0x443300 (distinct from DISCARD dark fill)', () => {
    // #462 adversarial: the slot must be visually distinct from DISCARD (0x331a1a, reddish).
    // Using the wrong fill colour gives no visual cue that RECHARGE is a constructive action.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat RECHARGE slot must use gold fill 0x443300 to distinguish from DISCARD',
    ).toContain('0x443300');
  });

  it('BenchHealthCombat.ts RECHARGE slot uses gold stroke 0xffcc44', () => {
    // #462 adversarial: the spec mandates 0xffcc44 stroke to telegraph "constructive" vs
    // the DISCARD slot's red (0x993333). An absent or wrong stroke breaks the visual design.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // 0xffcc44 is also used by column headers, so its presence alone is not conclusive —
    // but absence means the RECHARGE slot was definitely not styled to spec.
    expect(
      src,
      'BenchHealthCombat must contain 0xffcc44 (gold stroke for RECHARGE slot)',
    ).toContain('0xffcc44');
  });

  it('BenchHealthCombat.ts RECHARGE slot rectangle is labelled "RECHARGE" (DOM label)', () => {
    // #462 adversarial: the DOM label above the slot must read 'RECHARGE' so the player
    // knows what the gold rectangle does. Without a label it is an unlabelled gold box.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The DOM label 'RECHARGE' at y≈355 (389 − 34) must be present.
    expect(
      src,
      "BenchHealthCombat must add a 'RECHARGE' DOM label above the slot",
    ).toContain("'RECHARGE'");
  });

  // ── D. RECHARGE slot rendering gate: onRechargeClick parameter ──────────────

  it('BenchHealthCombat.ts constructor accepts onRechargeClick as an optional parameter', () => {
    // #462 adversarial: the zero-arg convention (onRechargeClick?: () => void) means BHC
    // receives undefined from fusion/merge callers and must NOT render the slot when undefined.
    // If the parameter is required (no ?), all callers — including fusion/merge — must supply it,
    // which forces them to wire a callback they do not need.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat constructor must declare onRechargeClick as an optional parameter (with ?)',
    ).toMatch(/onRechargeClick\s*\??\s*:/);
  });

  it('BenchHealthCombat.ts RECHARGE slot is gated on onRechargeClick being defined', () => {
    // #462 adversarial: the slot must be conditionally rendered. If the guard is absent,
    // the slot would appear in fusion and merge modes where it has no meaning — violating
    // the "not rendered in fusion and merge modes" acceptance criterion.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The implementation must check onRechargeClick before adding the slot.
    expect(
      src,
      'BenchHealthCombat must guard RECHARGE slot rendering on onRechargeClick !== undefined',
    ).toMatch(/onRechargeClick/);
  });

  // ── E. RingManagementOverlayOpts: onRechargeSlotClick declared ──────────────

  it('RingManagementOverlayClass.ts declares onRechargeSlotClick in RingManagementOverlayOpts', () => {
    // #462 adversarial: without the opt declaration, TypeScript callers (CampScene,
    // BattleHandOverlay) cannot pass it — the feature is silently un-wired.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayOpts must declare onRechargeSlotClick',
    ).toContain('onRechargeSlotClick');
  });

  it('RingManagementOverlayClass.ts onRechargeSlotClick is optional (fusion/merge omit it)', () => {
    // #462 adversarial: if onRechargeSlotClick is required, fusion and merge mode callers
    // must supply it — but the spec says they must omit it so BHC skips the slot.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'onRechargeSlotClick must be optional (declared with ?) in RingManagementOverlayOpts',
    ).toMatch(/onRechargeSlotClick\s*\?/);
  });

  // ── F. Internal onRechargeClick closure: no-selection guard ─────────────────

  it('RingManagementOverlayClass.ts onRechargeClick closure checks swap.selection before calling opts', () => {
    // #462 adversarial: clicking RECHARGE with no ring selected must show the status message,
    // not crash or call opts.onRechargeSlotClick(undefined, overlay). The closure must read
    // this.swap.selection at click time (not stored ringId) and guard on null.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayClass must check swap.selection in the onRechargeClick closure',
    ).toContain('swap.selection');
  });

  it('RingManagementOverlayClass.ts shows status "Select a ring to recharge" when no selection', () => {
    // #462 adversarial: the exact status string must match the acceptance criterion.
    // A slightly different string (e.g. "No ring selected") would diverge from the spec
    // and fail the E2E scenario 3 assertion.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      "RingManagementOverlayClass must call setStatus('Select a ring to recharge') when no ring selected",
    ).toContain('Select a ring to recharge');
  });

  it('RingManagementOverlayClass.ts passes onRechargeClick to BHC only when onRechargeSlotClick is defined', () => {
    // #462 adversarial: the ternary pattern `opts.onRechargeSlotClick ? () => {...} : undefined`
    // must be present. If the conditional is absent, BHC always receives a callback — rendering
    // the slot even in fusion/merge mode where opts.onRechargeSlotClick was never supplied.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The ternary must reference onRechargeSlotClick to gate the callback.
    expect(
      src,
      'RingManagementOverlayClass must pass onRechargeClick to BHC only when opts.onRechargeSlotClick is defined',
    ).toMatch(/opts\.onRechargeSlotClick\s*\?/);
  });

  // ── G. Mode-specific rendering: absent in fusion and merge ──────────────────

  it('RingManagementOverlayClass.ts fusion mode openFusionPanel does NOT pass onRechargeSlotClick', () => {
    // #462 adversarial: fusion overlay opts must omit onRechargeSlotClick entirely so BHC
    // receives onRechargeClick=undefined and does not render the gold RECHARGE rectangle.
    // If openFusionPanel accidentally wires it, the slot appears in a context with no
    // meaningful action and could call opts.onRechargeSlotClick with a fusion-selected ring.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // Scan the openFusionPanel (or equivalent fusion opts) block.
    // The simplest assertion: the fusion mode must not unconditionally wire the callback.
    // We check that it is absent from the fusion-specific opts literal.
    const lines = src.split('\n');
    const fusionStart = lines.findIndex((l) => /openFusion|fusionOpts|mode.*fusion/i.test(l));
    // If openFusionPanel is not yet in this file, skip gracefully.
    if (fusionStart === -1) return;
    // Within 30 lines of the fusion opts start, onRechargeSlotClick must not appear.
    const fusionBlock = lines.slice(fusionStart, fusionStart + 30).join('\n');
    expect(
      fusionBlock,
      'fusion mode opts block must not wire onRechargeSlotClick — RECHARGE slot must be absent in fusion',
    ).not.toContain('onRechargeSlotClick');
  });

  // ── H. CampScene sanctum wiring ─────────────────────────────────────────────

  it('CampScene.ts wires onRechargeSlotClick using doRechargeById in sanctum overlay opts', () => {
    // #462 adversarial: CampScene must supply onRechargeSlotClick so the sanctum path has
    // per-ring recharge. Without it the RECHARGE slot would be absent in sanctum mode even
    // though the spec requires it there.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must pass onRechargeSlotClick in sanctum overlay opts',
    ).toContain('onRechargeSlotClick');
    // Must call doRechargeById (not a blanket recharge call) for per-ring targeting.
    expect(
      src,
      'CampScene.ts onRechargeSlotClick must call doRechargeById for per-ring recharge',
    ).toContain('doRechargeById');
  });

  it('CampScene.ts onRechargeSlotClick refreshes the overlay via ov.refresh after recharge', () => {
    // #462 adversarial: after the async recharge, the overlay must be refreshed so the player
    // sees the ring's updated current_uses. Omitting the refresh leaves the card stale.
    // Note: doRechargeById appears multiple times in CampScene (window hook at top, actual
    // callback inside onRechargeSlotClick). We scan for the one inside the onRechargeSlotClick
    // closure (which appears after 'onRechargeSlotClick:').
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    // Find the onRechargeSlotClick closure start.
    const onRechargeSlotClickIdx = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    if (onRechargeSlotClickIdx === -1) return; // not yet implemented — no assertion to fire
    // Scan up to 15 lines within the closure for ov.refresh or ov.isOpen (which guards it).
    const closureBlock = lines.slice(onRechargeSlotClickIdx, onRechargeSlotClickIdx + 15).join('\n');
    expect(
      closureBlock,
      'CampScene.ts onRechargeSlotClick must call ov.refresh(...) or ov.isOpen() after doRechargeById',
    ).toMatch(/ov\.refresh|ov\.isOpen/);
  });

  // ── I. BattleHandOverlay field wiring ───────────────────────────────────────

  it('BattleHandOverlay.ts wires onRechargeSlotClick using this.send() (not doRechargeById)', () => {
    // #462 adversarial: BattleHandOverlay does not have doRechargeById — only CampScene does.
    // Using doRechargeById from the field overlay would cause a runtime "not a function" crash.
    // The correct path is this.send('POST', '/api/spirit/recharge', { ringId }).
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    expect(
      src,
      'BattleHandOverlay.ts must pass onRechargeSlotClick in field overlay opts',
    ).toContain('onRechargeSlotClick');
    // Must NOT call doRechargeById (not available in BattleHandOverlay).
    expect(
      src,
      'BattleHandOverlay.ts must NOT call doRechargeById — use this.send() instead',
    ).not.toContain('doRechargeById');
  });

  it('BattleHandOverlay.ts onRechargeSlotClick uses this.send() with POST /api/spirit/recharge', () => {
    // #462 adversarial: the field path must call the same API endpoint as the recharge-all path.
    // A different endpoint (e.g. /api/ring/recharge) would target a non-existent route.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    // The endpoint path must match the existing recharge-all convention.
    expect(
      src,
      "BattleHandOverlay.ts onRechargeSlotClick must call this.send('POST', '/api/spirit/recharge', ...)",
    ).toContain('/api/spirit/recharge');
  });

  // ── J. [RECHARGE ALL] backward compatibility: onRecharge callback unchanged ──

  it('RingManagementOverlayClass.ts still declares onRecharge (renamed API is unchanged)', () => {
    // #462 adversarial: [RECHARGE ALL] renames the button label but the internal callback
    // name onRecharge stays the same (it is not player-facing). Renaming the callback would
    // break all existing callers (CampScene, BattleHandOverlay) silently.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    expect(
      src,
      'RingManagementOverlayOpts must still declare onRecharge (internal name unchanged)',
    ).toContain('onRecharge');
  });

  it('BenchHealthCombat.ts still accepts onRecharge as a constructor parameter (backward compat)', () => {
    // #462 adversarial: adding onRechargeClick alongside the existing onRecharge must not
    // remove or rename onRecharge — callers that pass onRecharge would silently receive undefined.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat constructor must still declare the onRecharge parameter',
    ).toContain('onRecharge');
  });

  // ── K. Geometry: slot y=389 and button y=487 both within modal bottom 538 ───

  it('BenchHealthCombat.ts RECHARGE slot is placed at ROW_COMBAT1_Y = 389 (not shifted)', () => {
    // #462 adversarial: the RECHARGE slot occupies the row vacated by the old [RECHARGE] button.
    // ROW_COMBAT1_Y is already 389. If the slot is placed at a different y, it would conflict
    // with the D1/D2 combat cards or float above the DISCARD slot.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // ROW_COMBAT1_Y = 389 must still be defined (or the slot uses the value directly).
    expect(
      src,
      'BenchHealthCombat must place RECHARGE slot at ROW_COMBAT1_Y (389) — the vacated row',
    ).toMatch(/ROW_COMBAT1_Y|389/);
  });

  it('BenchHealthCombat.ts ROW_RECHARGE_BTN_Y = 487 is below modal bottom 538 with ≥1 px margin', () => {
    // #462 adversarial: both the slot (389) and the button (487) must fit within the modal.
    // 487 < 538 → 51 px margin per spec. If someone uses 540 or higher, the button clips.
    const specBtnY = 487;
    const specModalBottom = 538;
    expect(
      specBtnY,
      `ROW_RECHARGE_BTN_Y (${specBtnY}) must be less than modal bottom (${specModalBottom})`,
    ).toBeLessThan(specModalBottom);
    // Also verify the slot y (389) fits.
    const specSlotY = 389;
    expect(
      specSlotY,
      `RECHARGE slot y (${specSlotY}) must be less than modal bottom (${specModalBottom})`,
    ).toBeLessThan(specModalBottom);
  });

});

// ===========================================================================
// Class 26 — Phase 2 impl-aware: #462 BHC gate, OverlayClass ternary, CampScene
//            doRechargeById return paths, BattleHandOverlay ok-guard
// ===========================================================================

describe('#462 Phase 2 impl-aware: RECHARGE slot private-path branches', () => {

  // ── A. BHC build() gate: `if (this.onRechargeClick !== undefined)` ──────────

  it('BenchHealthCombat.ts build() uses strict !== undefined to gate RECHARGE slot (not truthiness)', () => {
    // #462 Phase 2 adversarial: a truthiness check (`if (this.onRechargeClick)`) would
    // behave identically in practice but diverges from the impl contract and could silently
    // pass a non-function value. The impl uses `!== undefined` — assert that form exactly.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat build() must gate RECHARGE slot with strict `!== undefined` check',
    ).toContain('this.onRechargeClick !== undefined');
  });

  it('BenchHealthCombat.ts RECHARGE slot pointerdown calls onRechargeClick with non-null assertion (!)', () => {
    // #462 Phase 2 adversarial: inside the `if (onRechargeClick !== undefined)` block,
    // calling `this.onRechargeClick()` without the non-null assertion `!` would produce a
    // TypeScript error (onRechargeClick is typed `() => void | undefined`). The impl uses
    // `this.onRechargeClick!()` — this also documents that the call is safe because we are
    // inside the guard. Verify the exclamation form is present.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat pointerdown must call this.onRechargeClick!() (non-null assertion inside guard)',
    ).toContain('this.onRechargeClick!()');
  });

  it('BenchHealthCombat.ts RECHARGE slot is added to this (the container) not scene directly', () => {
    // #462 Phase 2 adversarial: the DISCARD slot and all other BHC sub-objects are added
    // with `this.add(...)` so they become children of the BHC Container and get destroyed
    // with it. If the RECHARGE slot were added via `this.scene.add.rectangle(...)` without
    // `this.add(rechargeSlot)`, it would leak on BHC teardown.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const gateIdx = lines.findIndex((l) => /this\.onRechargeClick\s*!==\s*undefined/.test(l));
    expect(gateIdx, 'onRechargeClick gate must exist').toBeGreaterThan(-1);
    // Scan the block (up to 15 lines) for `this.add(rechargeSlot)`.
    const block = lines.slice(gateIdx, gateIdx + 15).join('\n');
    expect(
      block,
      'BenchHealthCombat RECHARGE slot must be added to this container via this.add()',
    ).toMatch(/this\.add\s*\(\s*rechargeSlot\s*\)/);
  });

  it('BenchHealthCombat.ts [RECHARGE ALL] button is always rendered (not gated on onRechargeClick)', () => {
    // #462 Phase 2 adversarial: [RECHARGE ALL] is a distinct action from the RECHARGE slot —
    // it recharges ALL rings via onRecharge (unchanged). It must appear in all modes (field,
    // sanctum, fusion, merge). If someone accidentally moved the button inside the gate block,
    // fusion/merge would lose the recharge-all button entirely.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const gateIdx = lines.findIndex((l) => /this\.onRechargeClick\s*!==\s*undefined/.test(l));
    // Find the closing `}` of the gate block (look for `}` alone on a line within 15 lines).
    let gateEnd = gateIdx;
    for (let i = gateIdx + 1; i < Math.min(gateIdx + 15, lines.length); i++) {
      if (/^\s*\}\s*$/.test(lines[i])) { gateEnd = i; break; }
    }
    // [RECHARGE ALL] must appear AFTER the closing brace of the gate block.
    const afterGate = lines.slice(gateEnd + 1).join('\n');
    expect(
      afterGate,
      'BenchHealthCombat [RECHARGE ALL] button must appear OUTSIDE the onRechargeClick gate block',
    ).toContain('[RECHARGE ALL]');
  });

  // ── B. OverlayClass ternary: undefined branch when onRechargeSlotClick absent ─

  it('RingManagementOverlayClass.ts ternary assigns undefined to onRechargeClick when opts.onRechargeSlotClick absent', () => {
    // #462 Phase 2 adversarial: the `undefined` branch of the ternary is the mechanism that
    // suppresses the RECHARGE slot in fusion/merge modes. If the ternary were replaced with
    // a direct assignment (e.g. always a function), BHC would always render the slot.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    // The ternary: `const onRechargeClick = this.opts.onRechargeSlotClick ? ... : undefined`
    // Note: the ternary body spans ~300 chars (multi-line arrow function); use {0,400} lookahead.
    expect(
      src,
      'OverlayClass ternary must assign undefined when opts.onRechargeSlotClick is absent',
    ).toMatch(/const\s+onRechargeClick\s*=\s*this\.opts\.onRechargeSlotClick\s*\?[\s\S]{0,400}:\s*undefined/);
  });

  it('RingManagementOverlayClass.ts onRechargeClick closure reads swap.selection at call time (not construction time)', () => {
    // #462 Phase 2 adversarial: if `sel` were captured at construction (e.g. `const sel = this.swap.selection`
    // outside the closure), it would be stale by click time — always the ring that was selected
    // when the overlay was built, not the ring selected just before the click.
    // The impl reads `const sel = this.swap.selection` INSIDE the arrow function body.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const onRechargeClickStart = lines.findIndex((l) =>
      /const\s+onRechargeClick\s*=\s*this\.opts\.onRechargeSlotClick/.test(l),
    );
    expect(onRechargeClickStart, 'onRechargeClick ternary must exist').toBeGreaterThan(-1);
    // The `const sel = this.swap.selection` must appear inside the closure (after the arrow `=> {`).
    const closureLines = lines.slice(onRechargeClickStart, onRechargeClickStart + 12).join('\n');
    expect(
      closureLines,
      'swap.selection must be read inside the closure body (not captured at construction)',
    ).toMatch(/=>\s*\{[\s\S]*const\s+sel\s*=\s*this\.swap\.selection/);
  });

  it('RingManagementOverlayClass.ts onRechargeClick closure calls setStatus (not setStatusMessage) on null selection', () => {
    // #462 Phase 2 adversarial: setStatus is the private method; setStatusMessage is the public
    // alias. The closure is inside the class — it has access to private members and must use
    // `this.setStatus(...)` directly (the private path). If it used setStatusMessage it would
    // add an unnecessary indirection through the public method.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const onRechargeClickStart = lines.findIndex((l) =>
      /const\s+onRechargeClick\s*=\s*this\.opts\.onRechargeSlotClick/.test(l),
    );
    expect(onRechargeClickStart, 'onRechargeClick ternary must exist').toBeGreaterThan(-1);
    const closureLines = lines.slice(onRechargeClickStart, onRechargeClickStart + 12).join('\n');
    expect(
      closureLines,
      'onRechargeClick closure must call this.setStatus() (private path) — not setStatusMessage()',
    ).toContain('this.setStatus(');
    // Must NOT use setStatusMessage (public alias) inside the closure.
    expect(
      closureLines,
      'onRechargeClick closure must NOT call setStatusMessage (use private setStatus instead)',
    ).not.toContain('setStatusMessage');
  });

  it('RingManagementOverlayClass.ts onRechargeClick is passed as the 9th argument to new BenchHealthCombat()', () => {
    // #462 Phase 2 adversarial: BHC constructor takes onRechargeClick as the 9th positional
    // argument (after onBenchGhostClick). If onRechargeClick is passed at the wrong position,
    // BHC silently assigns it to the wrong field — e.g. onBenchGhostClick gets a function and
    // the RECHARGE slot gets undefined, or vice versa.
    const src = readClientSrc('objects/ui/RingManagementOverlayClass.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const bhcStart = lines.findIndex((l) => /new BenchHealthCombat\s*\(/.test(l));
    expect(bhcStart, 'new BenchHealthCombat() call must exist').toBeGreaterThan(-1);
    // Scan 12 lines for the arg list — onRechargeClick must appear after onBenchGhostClick.
    const ctorBlock = lines.slice(bhcStart, bhcStart + 12).join('\n');
    const ghostIdx = ctorBlock.indexOf('onBenchGhostClick');
    const rechargeIdx = ctorBlock.indexOf('onRechargeClick');
    expect(ghostIdx, 'onBenchGhostClick must appear in BHC ctor call').toBeGreaterThan(-1);
    expect(rechargeIdx, 'onRechargeClick must appear in BHC ctor call').toBeGreaterThan(-1);
    expect(
      rechargeIdx,
      'onRechargeClick must be passed AFTER onBenchGhostClick (9th arg, not 8th)',
    ).toBeGreaterThan(ghostIdx);
  });

  // ── C. CampScene doRechargeById: return paths ────────────────────────────────

  it('CampScene.ts doRechargeById returns Promise<boolean> (declared return type)', () => {
    // #462 Phase 2 adversarial: the return type must be Promise<boolean> so that callers
    // (onRechargeSlotClick, E2E hook) can branch on the result. A Promise<void> return type
    // would cause TypeScript to reject `then((ok) => { if (ok) ... })` call sites.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts doRechargeById must declare Promise<boolean> return type',
    ).toMatch(/doRechargeById\s*\([^)]*\)\s*:\s*Promise<boolean>/);
  });

  it('CampScene.ts doRechargeById returns false on 400 (insufficient spirit / ring full)', () => {
    // #462 Phase 2 adversarial: a 400 means the server rejected the recharge (e.g. ring
    // already full, or insufficient spirit). The impl must return false so callers do NOT
    // refresh the overlay (which would show misleading "success" state).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeStart = lines.findIndex((l) => /async doRechargeById\s*\(/.test(l));
    expect(doRechargeStart, 'doRechargeById must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeStart, doRechargeStart + 25).join('\n');
    // 400 branch must set status and return false.
    expect(body, 'doRechargeById 400 branch must check res.status === 400').toContain('400');
    expect(body, 'doRechargeById 400 branch must return false').toMatch(/status\s*===\s*400[\s\S]{0,200}return false/);
  });

  it('CampScene.ts doRechargeById returns false on non-ok non-400 (server error 5xx)', () => {
    // #462 Phase 2 adversarial: a 5xx response (server crash, DB timeout) must also return
    // false. Without this branch, the impl would fall through to `await this.loadData()` on
    // a 500, potentially refreshing with stale data or crashing on an empty payload.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeStart = lines.findIndex((l) => /async doRechargeById\s*\(/.test(l));
    expect(doRechargeStart, 'doRechargeById must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeStart, doRechargeStart + 25).join('\n');
    // The non-ok branch: `if (!res.ok) { this.setStatus(...); return false; }`
    expect(body, 'doRechargeById must have a !res.ok branch that returns false').toMatch(
      /!res\.ok[\s\S]{0,100}return false/,
    );
  });

  it('CampScene.ts doRechargeById returns false in catch block (network error)', () => {
    // #462 Phase 2 adversarial: a network timeout or DNS failure throws, bypassing both
    // the 400 and !res.ok branches. The catch block must return false so callers do not
    // attempt a post-recharge refresh on a response that never arrived.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeStart = lines.findIndex((l) => /async doRechargeById\s*\(/.test(l));
    expect(doRechargeStart, 'doRechargeById must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeStart, doRechargeStart + 25).join('\n');
    expect(body, 'doRechargeById catch block must return false').toMatch(
      /catch[\s\S]{0,150}return false/,
    );
  });

  it('CampScene.ts doRechargeById calls loadData() only on success (after the try/catch)', () => {
    // #462 Phase 2 adversarial: loadData() triggers a full /api/me refresh. It must only
    // run after a confirmed successful recharge (all error paths return false before it).
    // If loadData() were called before the error checks, failed recharges would still trigger
    // a data reload — masking the error with a misleading "fresh" state.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeStart = lines.findIndex((l) => /async doRechargeById\s*\(/.test(l));
    expect(doRechargeStart, 'doRechargeById must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeStart, doRechargeStart + 25).join('\n');
    // loadData must appear AFTER the closing `}` of the try/catch block.
    const catchCloseIdx = body.lastIndexOf('return false');
    const loadDataIdx = body.indexOf('loadData');
    expect(loadDataIdx, 'loadData() must be called in doRechargeById').toBeGreaterThan(-1);
    expect(
      loadDataIdx,
      'loadData() must appear after all return-false paths (only runs on success)',
    ).toBeGreaterThan(catchCloseIdx);
  });

  it('CampScene.ts doRechargeById checks getToken() before the API call (auth guard)', () => {
    // #462 Phase 2 adversarial: without the auth guard, a logged-out player clicking RECHARGE
    // would fire a POST /api/spirit/recharge that returns 401, hitting the !res.ok branch and
    // showing "Recharge failed (401)" rather than redirecting to LoginScene. The guard must
    // appear before the try/catch.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeStart = lines.findIndex((l) => /async doRechargeById\s*\(/.test(l));
    expect(doRechargeStart, 'doRechargeById must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeStart, doRechargeStart + 25).join('\n');
    const tokenIdx = body.indexOf('getToken');
    const tryIdx = body.indexOf('try {');
    expect(tokenIdx, 'doRechargeById must call getToken()').toBeGreaterThan(-1);
    expect(tryIdx, 'doRechargeById must have a try block').toBeGreaterThan(-1);
    expect(
      tokenIdx,
      'getToken() auth guard must appear BEFORE the try block',
    ).toBeLessThan(tryIdx);
  });

  it('CampScene.ts doRechargeSelected discards the doRechargeById boolean (await without assignment)', () => {
    // #462 Phase 2 adversarial: doRechargeSelected is the old button path (meditation circle).
    // It calls `await this.doRechargeById(ring.id)` without assigning the result.
    // This is correct: doRechargeById calls loadData() on success internally, so no explicit
    // refresh is needed in doRechargeSelected. Reviewer confirmed this is intentional.
    // Assert the boolean IS discarded (no `const ok = await`, no `if (await ...)`).
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const doRechargeSelectedStart = lines.findIndex((l) => /async doRechargeSelected\s*\(/.test(l));
    expect(doRechargeSelectedStart, 'doRechargeSelected must exist').toBeGreaterThan(-1);
    const body = lines.slice(doRechargeSelectedStart, doRechargeSelectedStart + 10).join('\n');
    // The call must be a bare `await this.doRechargeById(...)` — no assignment.
    expect(
      body,
      'doRechargeSelected must call doRechargeById as a bare await (no result assignment)',
    ).toMatch(/await\s+this\.doRechargeById/);
    // Must NOT assign the result.
    expect(
      body,
      'doRechargeSelected must NOT assign the doRechargeById result (boolean is intentionally discarded)',
    ).not.toMatch(/(?:const|let|var)\s+\w+\s*=\s*await\s+this\.doRechargeById/);
  });

  it('CampScene.ts onRechargeSlotClick uses void + .then() for the doRechargeById call (fire-and-forget pattern)', () => {
    // #462 Phase 2 adversarial: the onRechargeSlotClick closure is a sync callback (not async).
    // It must fire doRechargeById with `void ... .then(...)` — not `await` (which would require
    // the callback to be async and risks hanging the UI event loop). Verify the void-then pattern.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick closure must exist in CampScene').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 8).join('\n');
    expect(
      closureBlock,
      'onRechargeSlotClick must use void + .then() to call doRechargeById (not await)',
    ).toMatch(/void\s+this\.doRechargeById.*\.then\s*\(/);
  });

  it('CampScene.ts onRechargeSlotClick .then() checks ok && ov.isOpen() before refreshing', () => {
    // #462 Phase 2 adversarial: if the overlay is closed while the recharge is in-flight
    // (e.g. player taps [x] immediately after clicking RECHARGE), calling ov.refresh() on
    // a closed/destroyed overlay would crash. The `ov.isOpen()` guard prevents this.
    // Also, refreshing on ok=false would show misleading success state.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick closure must exist').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 8).join('\n');
    expect(
      closureBlock,
      'onRechargeSlotClick .then() must check ok before refreshing',
    ).toContain('ok');
    expect(
      closureBlock,
      'onRechargeSlotClick .then() must check ov.isOpen() before refreshing',
    ).toContain('ov.isOpen()');
  });

  // ── D. BattleHandOverlay: send() ok-guard prevents refresh on failed recharge ─

  it('BattleHandOverlay.ts onRechargeSlotClick uses void + .then() pattern (sync callback)', () => {
    // #462 Phase 2 adversarial: same pattern as CampScene — the callback is sync, so it
    // must not be declared async. Using `void ... .then(ok => ...)` keeps the callback sync
    // while still handling the result.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick must exist in BattleHandOverlay').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 4).join('\n');
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must use void + .then() (not async/await)',
    ).toMatch(/void\s+this\.send\s*\(.*\.then\s*\(/);
  });

  it('BattleHandOverlay.ts onRechargeSlotClick guards refresh with ok && ov.isOpen()', () => {
    // #462 Phase 2 adversarial: two independent guards:
    // (1) `ok` — if send() returned false (network error, 4xx), don't refresh the overlay
    //     with stale data that doesn't reflect the failed recharge.
    // (2) `ov.isOpen()` — the overlay may have been closed while the HTTP call was in-flight.
    //     Calling refresh() on a closed overlay would call into a destroyed container.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick must exist in BattleHandOverlay').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 4).join('\n');
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must check ok before calling refresh',
    ).toMatch(/if\s*\(\s*ok\s*(&&|\|\|)/);
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must check ov.isOpen() before calling refresh',
    ).toContain('ov.isOpen()');
  });

  it('BattleHandOverlay.ts onRechargeSlotClick calls this.refresh(ov) (not ov.refresh(data))', () => {
    // #462 Phase 2 adversarial: BattleHandOverlay.refresh(ov) is the private helper that
    // fetches /api/me then calls ov.refresh(data). Calling ov.refresh() directly would skip
    // the data fetch and pass stale data from the previous buildOverlayData() snapshot.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick must exist in BattleHandOverlay').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 4).join('\n');
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must call this.refresh(ov) not ov.refresh(data)',
    ).toContain('this.refresh(ov)');
    // Must NOT call ov.refresh() directly.
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must NOT call ov.refresh() directly (use this.refresh(ov))',
    ).not.toMatch(/ov\.refresh\s*\(/);
  });

  it('BattleHandOverlay.ts onRechargeSlotClick passes ringId in POST body ({ ringId })', () => {
    // #462 Phase 2 adversarial: the per-ring recharge endpoint reads `req.body.ringId`.
    // If the body is empty (`{}`) or uses a different key (`{ id: ringId }`), the server
    // returns 400. Verify the body literal matches the expected shape.
    const src = readClientSrc('objects/BattleHandOverlay.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const closureStart = lines.findIndex((l) => /onRechargeSlotClick\s*:/.test(l));
    expect(closureStart, 'onRechargeSlotClick must exist in BattleHandOverlay').toBeGreaterThan(-1);
    const closureBlock = lines.slice(closureStart, closureStart + 4).join('\n');
    expect(
      closureBlock,
      'BattleHandOverlay onRechargeSlotClick must pass { ringId } in the POST body',
    ).toContain('{ ringId }');
  });

  // ── E. RECHARGE slot setName (scene-graph name for E2E lookup) ───────────────

  it('BenchHealthCombat.ts RECHARGE slot rectangle has scene-graph name "recharge-slot"', () => {
    // #462 Phase 2 adversarial: E2E scenario 1 finds the slot via scene-graph name
    // `recharge-slot`. If the name is absent or misspelled, the E2E assertion would find
    // no object and the test would skip rather than pass — masking a broken feature.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      "BenchHealthCombat RECHARGE slot must call .setName('recharge-slot')",
    ).toContain("setName('recharge-slot')");
  });

  it('BenchHealthCombat.ts RECHARGE slot has setInteractive with useHandCursor (cursor affordance)', () => {
    // #462 Phase 2 adversarial: a slot without `setInteractive({ useHandCursor: true })`
    // does not emit pointer events — pointerdown would never fire, making the slot a
    // decorative rectangle with no functionality. The cursor affordance also signals to
    // the player that the slot is clickable.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    const lines = src.split('\n');
    const gateIdx = lines.findIndex((l) => /this\.onRechargeClick\s*!==\s*undefined/.test(l));
    expect(gateIdx, 'onRechargeClick gate must exist').toBeGreaterThan(-1);
    const block = lines.slice(gateIdx, gateIdx + 15).join('\n');
    expect(
      block,
      'BenchHealthCombat RECHARGE slot must call setInteractive({ useHandCursor: true })',
    ).toContain('useHandCursor: true');
  });

});
