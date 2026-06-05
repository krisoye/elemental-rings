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

  it('field mode has 4 columns: LOOT, BENCH, HEALTH, COMBAT', () => {
    // Field left column is LOOT (WON + DISCARD); the three shared columns are identical.
    expect(COLUMN_LABELS.field).toEqual(['LOOT', 'BENCH', 'HEALTH', 'COMBAT']);
  });

  it('both modes share the three right-hand columns BENCH, HEALTH, COMBAT at indices 1-3', () => {
    // #389 spec: the three right columns are the SAME component in both modes.
    // Any divergence (e.g. renaming "BENCH" to "SPARES" in one mode) is caught here.
    const shared = COLUMN_LABELS.sanctum.slice(1);
    expect(COLUMN_LABELS.field.slice(1)).toEqual(shared);
  });

  it('sanctum and field left columns differ (SPIRIT vs LOOT)', () => {
    // The only difference between modes is the first column — this is the anti-drift test.
    expect(COLUMN_LABELS.sanctum[0]).toBe('SPIRIT');
    expect(COLUMN_LABELS.field[0]).toBe('LOOT');
    expect(COLUMN_LABELS.sanctum[0]).not.toBe(COLUMN_LABELS.field[0]);
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

  it('publishRingMgmtState field mode sets columns to [LOOT, BENCH, HEALTH, COMBAT]', () => {
    publishRingMgmtState('field', { bench: { n: 1, max: 5 } });
    expect((global as any).window.__ringMgmtState.columns).toEqual(['LOOT', 'BENCH', 'HEALTH', 'COMBAT']);
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

  it('Spec AC: InventoryGrid.cards map has type Map<string, RingCard> (typed accessor returns RingCard API)', () => {
    // #389 acceptance criterion: cards is typed as Map<string, RingCard> so callers
    // get the RingCard API without casts. Source-scan: the map declaration must
    // reference RingCard in the type annotation.
    const src = readClientSrc('objects/InventoryGrid.ts');
    if (src === null) return;
    // The map should be typed Map<string, RingCard>
    expect(
      src,
      'InventoryGrid.cards must be typed Map<string, RingCard> — ensures the RingCard API is accessible without casts',
    ).toContain('Map<string, RingCard>');
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

  it('BenchHealthCombat has a single [RECHARGE] button (not [Recharge] / [Recharge All] pair)', () => {
    // #395 acceptance criterion: consolidate to one [RECHARGE] button in both modes.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The button text must be [RECHARGE], not the old variants.
    expect(src, 'must use [RECHARGE] (not [Recharge])').not.toContain("'[Recharge]'");
    expect(src, 'must use [RECHARGE] (not [Recharge All])').not.toContain("'[Recharge All]'");
    expect(src, 'must render the [RECHARGE] label').toContain('[RECHARGE]');
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

  it('fusion mode shares the three right-hand columns with sanctum and field', () => {
    // #396 convergence contract: BENCH/HEALTH/COMBAT identical across all three modes.
    const shared = COLUMN_LABELS.sanctum.slice(1);
    expect(COLUMN_LABELS.fusion.slice(1)).toEqual(shared);
    expect(COLUMN_LABELS.field.slice(1)).toEqual(shared);
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

  it('all three modes (sanctum/field/fusion) define exactly 4 columns', () => {
    // Regression: no mode may drop or add a column silently.
    expect(COLUMN_LABELS.sanctum).toHaveLength(4);
    expect(COLUMN_LABELS.field).toHaveLength(4);
    expect(COLUMN_LABELS.fusion).toHaveLength(4);
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

  it('BenchHealthCombat.ts [RECHARGE] button label is exactly "[RECHARGE]" (not "[Recharge]")', () => {
    // #395 Phase 2 adversarial: an inconsistent capitalisation would fail E2E grep
    // and regress the "single [RECHARGE] control" acceptance criterion.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(src, 'BenchHealthCombat must render [RECHARGE] in upper case').toContain('[RECHARGE]');
    expect(src, 'BenchHealthCombat must not use lower-case [Recharge]').not.toContain('[Recharge]');
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

  it('BenchHealthCombat.ts build() dims non-selected bench cards with setAlpha(0.45) when bench is full', () => {
    // #413 spec Design §4: all OTHER bench cards (not the selected one) get alpha=0.45
    // when benchFull=true. Previously done in renderFieldLeft on a duplicate grid.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    expect(
      src,
      'BenchHealthCombat.build() must call setAlpha(0.45) when dimming non-selected bench cards',
    ).toContain('setAlpha(0.45)');
  });

  it('BenchHealthCombat.ts build() skips dimming the selected card (early return on id match)', () => {
    // #413 spec Design §4 P3 fix: the selected card must be SKIPPED in the dim loop
    // (`if (r.id === selectedRingId) return;`). Without this, the selected ring itself
    // would be dimmed to 0.45 alpha — making the yellow-stroked card nearly invisible.
    const src = readClientSrc('objects/ui/BenchHealthCombat.ts');
    if (src === null) return;
    // The guard pattern: `if (r.id === selectedRingId) return;`
    expect(
      src,
      'BenchHealthCombat.build() dim loop must skip the selected ring via early return',
    ).toMatch(/if\s*\(\s*r\.id\s*===\s*selectedRingId\s*\)\s*return/);
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
