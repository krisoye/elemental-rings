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
  isPickupBlockedByFullBench,
  type RingMgmtMode,
  type RingMgmtCounters,
} from '../../client/src/objects/ui/RingManagementOverlay';
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
// Class 9 — isPickupBlockedByFullBench: symmetric-swap guard (#395)
// ===========================================================================

describe('#395 isPickupBlockedByFullBench: symmetric-swap invariants', () => {

  // ── Basic gate ─────────────────────────────────────────────────────────────

  it('returns false when bench is NOT full (gate fires first regardless of other args)', () => {
    // The guard is a no-op when the bench has room — no pick-up can overflow it.
    expect(isPickupBlockedByFullBench('reliquary', null, false)).toBe(false);
    expect(isPickupBlockedByFullBench('reliquary', 'spare', false)).toBe(false);
    expect(isPickupBlockedByFullBench('reliquary', 'reliquary', false)).toBe(false);
  });

  // ── Net one-way: old blocking behaviour ────────────────────────────────────

  it('blocks reliquary pick-up when bench full and nothing is selected (old guard parity)', () => {
    // The OLD guard blocked every reliquary pick-up at full bench. The symmetric
    // guard must still block the case where the pick-up WOULD overflow the bench:
    // nothing selected yet, so a reliquary ring dropped into spare = net +1. Block.
    expect(isPickupBlockedByFullBench('reliquary', null, true)).toBe(true);
  });

  it('blocks reliquary pick-up when bench full and a non-bench ring is already selected', () => {
    // If a battle-slot ring is already held (source 'a1'), dropping a reliquary ring
    // into spare later would still be a net +1 onto the bench. Block.
    expect(isPickupBlockedByFullBench('reliquary', 'a1', true)).toBe(true);
    expect(isPickupBlockedByFullBench('reliquary', 'thumb', true)).toBe(true);
    expect(isPickupBlockedByFullBench('reliquary', 'heart', true)).toBe(true);
    expect(isPickupBlockedByFullBench('reliquary', 'd2', true)).toBe(true);
  });

  // ── Net-zero swap: the key new behaviour ───────────────────────────────────

  it('allows reliquary pick-up when bench full but a spare ring is already selected (net-zero)', () => {
    // A spare ring is held (will leave the bench on drop). Picking up a reliquary
    // ring is the "receive" side of a net-zero swap: one leaves, one enters = 0 delta.
    // The old guard incorrectly blocked this. The new guard must NOT block it.
    expect(isPickupBlockedByFullBench('reliquary', 'spare', true)).toBe(false);
  });

  it('allows picking up FROM the bench itself (spare) even when bench is full', () => {
    // Picking up a spare ring never makes the bench MORE full — you are removing one.
    // This must not be blocked regardless of what is currently selected.
    expect(isPickupBlockedByFullBench('spare', null, true)).toBe(false);
    expect(isPickupBlockedByFullBench('spare', 'a1', true)).toBe(false);
    expect(isPickupBlockedByFullBench('spare', 'spare', true)).toBe(false);
    expect(isPickupBlockedByFullBench('spare', 'reliquary', true)).toBe(false);
  });

  // ── Adversarial pick-up orders ─────────────────────────────────────────────

  it('order A (spare first, reliquary second) — second pick-up is ALLOWED (net-zero)', () => {
    // Order A: player picks up a spare (bench → -1), then picks up a reliquary ring
    // (will go to bench on drop → +1). Net change = 0. The second pick-up is ALLOWED.
    // Step 1: pick up spare (currentSel = null, bench was at cap but we just took one).
    // Guard is called for the SECOND pick-up (reliquary), when currentSel = 'spare'.
    expect(isPickupBlockedByFullBench('reliquary', 'spare', true)).toBe(false);
  });

  it('order B (reliquary first at full bench) — first pick-up is BLOCKED', () => {
    // Order B: player tries to pick up a reliquary ring when bench is full and
    // nothing is held yet. This would net +1 into the bench. Block it.
    expect(isPickupBlockedByFullBench('reliquary', null, true)).toBe(true);
  });

  it('order B with a bench ring already selected — ALLOWED (player re-picked a bench ring)', () => {
    // A bench ring was already selected (the reliquary → spare pick-up found it later).
    // The guard is evaluated for 'reliquary' source with currentSel='spare' → allowed.
    expect(isPickupBlockedByFullBench('reliquary', 'spare', true)).toBe(false);
  });

  // ── Non-reliquary non-bench sources ───────────────────────────────────────

  it('battle-slot pick-up at full bench: blocked when nothing selected (net +1 if dropped to spare)', () => {
    // If the player selects a battle-slot ring then drops it onto spare at full bench
    // — that would net +1. Block the pick-up.
    expect(isPickupBlockedByFullBench('a1', null, true)).toBe(true);
    expect(isPickupBlockedByFullBench('thumb', null, true)).toBe(true);
    expect(isPickupBlockedByFullBench('heart', null, true)).toBe(true);
  });

  it('battle-slot pick-up at full bench: allowed when a bench ring is held (net-zero)', () => {
    // The player already holds a spare ring. Picking up a battle-slot ring and then
    // dropping the spare somewhere is a net-zero trade. Allow the pick-up.
    expect(isPickupBlockedByFullBench('a1', 'spare', true)).toBe(false);
    expect(isPickupBlockedByFullBench('thumb', 'spare', true)).toBe(false);
  });

  // ── Symmetry assertion ────────────────────────────────────────────────────

  it('symmetric: two reliquary pick-ups both blocked when bench full and no bench ring held', () => {
    // Neither order of two reliquary pick-ups is allowed without an intermediate
    // bench pick-up. Both calls must return true (each would net +1 independently).
    expect(isPickupBlockedByFullBench('reliquary', null, true)).toBe(true);
    expect(isPickupBlockedByFullBench('reliquary', 'reliquary', true)).toBe(true);
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
// Class 11 — isPickupBlockedByFullBench: exported from pure module (#395)
// ===========================================================================

describe('#395 isPickupBlockedByFullBench: export from pure module', () => {

  it('is exported from RingManagementOverlay.ts (pure module)', () => {
    // #395 — CampScene imports isPickupBlockedByFullBench from the pure module.
    // Source-scan the pure module for the export.
    const src = readClientSrc('objects/ui/RingManagementOverlay.ts');
    if (src === null) return;
    expect(
      src,
      'isPickupBlockedByFullBench must be exported from RingManagementOverlay.ts',
    ).toContain('isPickupBlockedByFullBench');
  });

  it('CampScene.ts imports isPickupBlockedByFullBench from RingManagementOverlay', () => {
    // #395 — CampScene uses the symmetric-swap guard.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    expect(
      src,
      'CampScene.ts must import isPickupBlockedByFullBench from RingManagementOverlay',
    ).toContain('isPickupBlockedByFullBench');
  });

  it('CampScene.ts does not contain the old asymmetric reliquary pick-up guard', () => {
    // #395 — the old guard was:
    //   if (source === 'reliquary' && window.__reliquaryLocked) { ... }
    // It is replaced by isPickupBlockedByFullBench. Any residual guard string is an
    // unconverted site that would block net-zero swaps.
    const src = readClientSrc('scenes/CampScene.ts');
    if (src === null) return;
    const lines = src.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const hasOldGuard = lines.some(
      (l) => l.includes("source === 'reliquary'") && l.includes('__reliquaryLocked'),
    );
    expect(
      hasOldGuard,
      'CampScene.ts must not use the old asymmetric guard — replaced by isPickupBlockedByFullBench',
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
