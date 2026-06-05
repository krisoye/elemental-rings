import os from 'os';
import path from 'path';
import fs from 'fs';
import { describe, test, expect, beforeAll } from 'vitest';
import { ElementEnum } from '../../shared/types';

// ---------------------------------------------------------------------------
// #397 — rechargeAllWithSpirit with includeReliquary=true/false.
//
// Each test gets an isolated player in a shared throwaway DB (one beforeAll).
// DB_PATH must be set before the first import of db.ts (process-level singleton).
// ---------------------------------------------------------------------------

const SPIRIT_PER_RING_USE = 1; // matches server/src/game/constants.ts

let repo: typeof import('../../server/src/persistence/PlayerRepo');
let dbInstance: import('better-sqlite3').Database;

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

/** Create a bare player row + empty loadout (no starter rings). */
function makePlayer(): string {
  const id = `p_${Math.random().toString(36).slice(2)}`;
  dbInstance
    .prepare(`INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`)
    .run(id, `u_${id}`, 'x');
  dbInstance
    .prepare(
      `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2) VALUES (?, NULL, NULL, NULL, NULL, NULL)`,
    )
    .run(id);
  return id;
}

/** Set the player's spirit_current to the given value. */
function setSpirit(playerId: string, amount: number): void {
  dbInstance
    .prepare(`UPDATE players SET spirit_current = ?, spirit_max = ? WHERE id = ?`)
    .run(amount, amount, playerId);
}

interface MakeRingOpts {
  inCarry?: number;
  heartSlot?: number;
  escrowed?: number;
  currentUses?: number;
  maxUses?: number;
}

/** Insert a ring owned by playerId with configurable flags. */
function makeRing(playerId: string, opts: MakeRingOpts = {}): string {
  const id = `ring_${Math.random().toString(36).slice(2)}`;
  const {
    inCarry = 0,
    heartSlot = 0,
    escrowed = 0,
    currentUses = 3,
    maxUses = 3,
  } = opts;
  dbInstance
    .prepare(
      `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
       VALUES (?, ?, ?, 0, ?, ?, 0, ?, ?, ?)`,
    )
    .run(id, playerId, ElementEnum.FIRE, maxUses, currentUses, inCarry, escrowed, heartSlot);
  return id;
}

/** Read a ring's current_uses directly from the DB. */
function getUses(ringId: string): number {
  const row = dbInstance
    .prepare(`SELECT current_uses FROM rings WHERE id = ?`)
    .get(ringId) as { current_uses: number } | undefined;
  return row?.current_uses ?? 0;
}

/** Read the player's spirit_current from the DB. */
function getSpirit(playerId: string): number {
  const row = dbInstance
    .prepare(`SELECT spirit_current FROM players WHERE id = ?`)
    .get(playerId) as { spirit_current: number } | undefined;
  return row?.spirit_current ?? 0;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  const dbFile = path.join(
    os.tmpdir(),
    `er-reliquary-recharge-test-${process.pid}-${Date.now()}.db`,
  );
  for (const ext of ['', '-wal', '-shm']) {
    if (fs.existsSync(dbFile + ext)) fs.unlinkSync(dbFile + ext);
  }
  process.env.DB_PATH = dbFile;
  repo = await import('../../server/src/persistence/PlayerRepo');
  dbInstance = (await import('../../server/src/persistence/db')).db;
});

// ===========================================================================
// Class 1 — Priority ordering: reliquary recharged AFTER all carried rings
// ===========================================================================

describe('#397 rechargeAllWithSpirit: reliquary recharged after all carried rings', () => {

  test('carried spare is recharged before a more-depleted reliquary ring', () => {
    // Setup: 1 carried spare (current_uses=0, max=3) and 1 reliquary ring that is
    // more depleted (current_uses=0, max=3) — but carried MUST be topped first.
    // Spirit: only enough to recharge 2 uses total — if priority is wrong, reliquary
    // would be recharged at the expense of the carried ring.
    const p = makePlayer();
    const carryRing = makeRing(p, { inCarry: 1, currentUses: 1, maxUses: 3 }); // deficit=2
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });   // deficit=3
    // Spirit = 4: enough to top off carry (2 uses) + 2 more into reliquary.
    setSpirit(p, 4);

    repo.rechargeAllWithSpirit(p, true);

    // Carry ring must be fully restored (deficit=2 → full).
    expect(getUses(carryRing)).toBe(3);
    // Reliquary ring gets the leftover 2 spirit.
    expect(getUses(relRing)).toBe(2);
    expect(getSpirit(p)).toBe(0);
  });

  test('battle-slot ring is recharged before spare which is recharged before reliquary', () => {
    // Three rings: one in the loadout (a1), one carried spare, one reliquary.
    // Spirit just enough to top the battle-slot ring + 1 use on the spare.
    const p = makePlayer();
    const battleRing = makeRing(p, { inCarry: 1, currentUses: 1, maxUses: 3 }); // deficit=2
    const spareRing = makeRing(p, { inCarry: 1, currentUses: 2, maxUses: 3 });  // deficit=1
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });    // deficit=3

    // Assign battleRing to a1 slot.
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(battleRing, p);
    // Spirit = 3: enough for battle (2) + spare (1) + 0 for reliquary.
    setSpirit(p, 3);

    repo.rechargeAllWithSpirit(p, true);

    expect(getUses(battleRing)).toBe(3); // fully restored
    expect(getUses(spareRing)).toBe(3);  // fully restored
    expect(getUses(relRing)).toBe(0);    // nothing left for reliquary
    expect(getSpirit(p)).toBe(0);
  });

  test('reliquary ring is recharged only after ALL carried rings are full', () => {
    // Two carried rings both at full uses. Reliquary ring is depleted.
    // With includeReliquary=true, the reliquary ring should be recharged.
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full — skipped
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full — skipped
    const relRing = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 }); // deficit=2
    setSpirit(p, 5);

    repo.rechargeAllWithSpirit(p, true);

    // Reliquary ring is now recharged (all carried rings were already full).
    expect(getUses(relRing)).toBe(3);
    expect(getSpirit(p)).toBe(3); // 2 uses × 1 spirit each
  });

});

// ===========================================================================
// Class 2 — Spirit stops at 0 even if reliquary rings remain depleted
// ===========================================================================

describe('#397 rechargeAllWithSpirit: spirit exhausted before reliquary fully recharged', () => {

  test('spirit stops at 0 when reliquary rings cannot all be topped off', () => {
    // One reliquary ring with deficit=3. Spirit=2 → can restore 2 uses, not 3.
    const p = makePlayer();
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 }); // deficit=3
    setSpirit(p, 2);

    const remaining = repo.rechargeAllWithSpirit(p, true);

    expect(remaining).toBe(0);
    expect(getSpirit(p)).toBe(0);
    expect(getUses(relRing)).toBe(2); // only 2 uses restored
  });

  test('spirit never goes negative', () => {
    const p = makePlayer();
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 10 }); // deficit=10
    setSpirit(p, 3);

    const remaining = repo.rechargeAllWithSpirit(p, true);

    expect(remaining).toBe(0);
    expect(getSpirit(p)).toBe(0);
    expect(getUses(relRing)).toBe(3); // only 3 uses
  });

  test('spirit stops at 0 mid-reliquary when carried rings consumed most spirit', () => {
    // Carry: 1 ring with deficit=5, spirit=6. After carry, 1 spirit left for reliquary.
    const p = makePlayer();
    const carryRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 5 }); // deficit=5
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });   // deficit=3
    setSpirit(p, 6);

    repo.rechargeAllWithSpirit(p, true);

    expect(getUses(carryRing)).toBe(5); // fully restored (5 spirit)
    expect(getUses(relRing)).toBe(1);   // only 1 spirit remained
    expect(getSpirit(p)).toBe(0);
  });

});

// ===========================================================================
// Class 3 — includeReliquary=false (or absent) — byte-identical to old behavior
// ===========================================================================

describe('#397 rechargeAllWithSpirit: includeReliquary=false is identical to old behavior', () => {

  test('reliquary ring is NOT recharged when includeReliquary=false', () => {
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });
    setSpirit(p, 10);

    repo.rechargeAllWithSpirit(p, false);

    expect(getUses(relRing)).toBe(0); // untouched
    expect(getSpirit(p)).toBe(10);    // no spirit spent (carry already full)
  });

  test('reliquary ring is NOT recharged when includeReliquary is absent (default)', () => {
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });
    setSpirit(p, 10);

    // Call without second argument — defaults to false.
    repo.rechargeAllWithSpirit(p);

    expect(getUses(relRing)).toBe(0); // untouched
    expect(getSpirit(p)).toBe(10);
  });

  test('carried rings are still recharged in the correct priority when includeReliquary=false', () => {
    // Battle-slot ring before spare — same as pre-#397 behavior.
    const p = makePlayer();
    const battleRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 3 }); // deficit=3
    const spareRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 3 });  // deficit=3
    dbInstance.prepare(`UPDATE loadout SET a1 = ? WHERE player_id = ?`).run(battleRing, p);
    setSpirit(p, 10);

    repo.rechargeAllWithSpirit(p, false);

    expect(getUses(battleRing)).toBe(3);
    expect(getUses(spareRing)).toBe(3);
    expect(getSpirit(p)).toBe(4); // 6 uses × 1 spirit, 10 − 6 = 4 remaining
  });

  test('spirit is NOT spent on reliquary when flag is false — no hidden deduction', () => {
    const p = makePlayer();
    const relRing1 = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });
    const relRing2 = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 });
    setSpirit(p, 15);

    repo.rechargeAllWithSpirit(p, false);

    // Both reliquary rings untouched.
    expect(getUses(relRing1)).toBe(0);
    expect(getUses(relRing2)).toBe(1);
    // All spirit retained.
    expect(getSpirit(p)).toBe(15);
  });

});

// ===========================================================================
// Class 4 — Most-depleted reliquary ring is recharged first within the group
// ===========================================================================

describe('#397 rechargeAllWithSpirit: most-depleted reliquary ring recharged first', () => {

  test('two reliquary rings: the more-depleted one is recharged first', () => {
    // relA: deficit=3 (current=0, max=3)
    // relB: deficit=1 (current=2, max=3)
    // Spirit=2: enough for all of relA's deficit → relA gets 2 uses; relB gets 0.
    const p = makePlayer();
    const relA = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 }); // deficit=3
    const relB = makeRing(p, { inCarry: 0, currentUses: 2, maxUses: 3 }); // deficit=1
    setSpirit(p, 2);

    repo.rechargeAllWithSpirit(p, true);

    // relA is more depleted; it receives the 2 available spirit.
    expect(getUses(relA)).toBe(2);
    // relB is less depleted; nothing left for it.
    expect(getUses(relB)).toBe(2); // unchanged (was already 2)
    expect(getSpirit(p)).toBe(0);
  });

  test('three reliquary rings: most-depleted recharged completely before next', () => {
    // Deficits: relA=3, relB=2, relC=1. Spirit=4.
    // Expected: relA fully topped (3 spirit), relB gets 1 use, relC untouched.
    const p = makePlayer();
    const relA = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 }); // deficit=3
    const relB = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 }); // deficit=2
    const relC = makeRing(p, { inCarry: 0, currentUses: 2, maxUses: 3 }); // deficit=1
    setSpirit(p, 4);

    repo.rechargeAllWithSpirit(p, true);

    expect(getUses(relA)).toBe(3); // fully topped
    expect(getUses(relB)).toBe(2); // got 1 use from 1 remaining spirit
    expect(getUses(relC)).toBe(2); // untouched
    expect(getSpirit(p)).toBe(0);
  });

  test('equal-deficit reliquary rings: stable ordering by id (lexicographic)', () => {
    // Two rings with equal deficit=2. The one with the lexicographically earlier id
    // should be recharged first. Spirit=2 (enough for only one ring).
    // We ensure ringA id < ringB id so we can predict which comes first.
    const p = makePlayer();
    // Insert directly with known ids to guarantee ordering.
    const idA = 'ring_aaa';
    const idB = 'ring_zzz';
    dbInstance
      .prepare(
        `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
         VALUES (?, ?, 0, 0, 3, 1, 0, 0, 0, 0)`,
      )
      .run(idA, p); // deficit=2
    dbInstance
      .prepare(
        `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, in_carry, escrowed, heart_slot)
         VALUES (?, ?, 0, 0, 3, 1, 0, 0, 0, 0)`,
      )
      .run(idB, p); // deficit=2
    setSpirit(p, 2);

    repo.rechargeAllWithSpirit(p, true);

    // idA (earlier id) gets the 2 uses; idB is untouched.
    expect(getUses(idA)).toBe(3);
    expect(getUses(idB)).toBe(1);
    expect(getSpirit(p)).toBe(0);
  });

});

// ===========================================================================
// Class 5 — Player with no reliquary rings is unaffected (idempotent)
// ===========================================================================

describe('#397 rechargeAllWithSpirit: no reliquary rings — idempotent', () => {

  test('includeReliquary=true with no resting rings does not crash', () => {
    // Player has only carried rings; reliquary is empty.
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full
    setSpirit(p, 10);

    expect(() => repo.rechargeAllWithSpirit(p, true)).not.toThrow();
    expect(getSpirit(p)).toBe(10); // no spirit spent
  });

  test('includeReliquary=true with no reliquary rings returns same result as false', () => {
    // Both paths should be identical when there are no resting rings.
    const p1 = makePlayer();
    const p2 = makePlayer();
    makeRing(p1, { inCarry: 1, currentUses: 1, maxUses: 3 }); // deficit=2
    makeRing(p2, { inCarry: 1, currentUses: 1, maxUses: 3 }); // deficit=2
    setSpirit(p1, 5);
    setSpirit(p2, 5);

    const rem1 = repo.rechargeAllWithSpirit(p1, true);
    const rem2 = repo.rechargeAllWithSpirit(p2, false);

    expect(rem1).toBe(rem2);
    expect(getSpirit(p1)).toBe(getSpirit(p2));
  });

  test('escrowed reliquary rings are NOT recharged (escrowed=1 excluded from resting pool)', () => {
    // An escrowed ring should not be in the resting pool even with includeReliquary=true.
    const p = makePlayer();
    const escrowedRing = makeRing(p, { inCarry: 0, escrowed: 1, currentUses: 0, maxUses: 3 });
    setSpirit(p, 10);

    repo.rechargeAllWithSpirit(p, true);

    // Escrowed ring is excluded; spirit is untouched.
    expect(getUses(escrowedRing)).toBe(0);
    expect(getSpirit(p)).toBe(10);
  });

  test('already-full reliquary rings are skipped (no spirit spent on full rings)', () => {
    // Reliquary ring at full uses — including it should not cost any spirit.
    const p = makePlayer();
    const fullRel = makeRing(p, { inCarry: 0, currentUses: 3, maxUses: 3 }); // full
    setSpirit(p, 5);

    repo.rechargeAllWithSpirit(p, true);

    expect(getUses(fullRel)).toBe(3); // unchanged
    expect(getSpirit(p)).toBe(5);     // no spirit spent
  });

});

// ===========================================================================
// Class 6 — Phase 2 impl-aware: rechargeAllWithSpirit transaction + edge branches
// ===========================================================================

describe('#397 Phase 2 impl-aware: rechargeAllWithSpirit implementation branches', () => {

  test('spirit update is atomic: spirit_current in DB matches spirit-after-recharge return value', () => {
    // #397 Phase 2 adversarial: the impl computes a local `spirit` variable,
    // applies uses, then writes the delta back with:
    //   updateSpiritDeduct.run(getSpiritAndFood(p).spirit_current - spirit, p)
    // If the delta is 0 (all rings already full), spirit_current must be unchanged.
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 3, maxUses: 3 }); // full — no spirit spent
    setSpirit(p, 7);

    const remaining = repo.rechargeAllWithSpirit(p, false);

    // All rings full → delta = 0 → no deduction.
    expect(remaining).toBe(7);
    expect(getSpirit(p)).toBe(7);
  });

  test('return value equals the spirit remaining in the DB after the call', () => {
    // #397 Phase 2 adversarial: the return value is the local `spirit` counter
    // not a fresh DB read. Verify they agree so callers can use the return value
    // as a reliable remaining-spirit indicator.
    const p = makePlayer();
    makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 4 }); // deficit=4
    setSpirit(p, 6);

    const remaining = repo.rechargeAllWithSpirit(p, false);

    // deficit=4, spirit=6 → 4 uses restored, 2 spirit remains.
    expect(remaining).toBe(2);
    expect(getSpirit(p)).toBe(2);
    expect(remaining).toBe(getSpirit(p));
  });

  test('heart ring is recharged after battle-slot rings but before spares (priority order)', () => {
    // #397 Phase 2 adversarial: the heart ring is folded in after the battle hand
    // but before spares. Spirit just enough for the heart ring but not the spare.
    const p = makePlayer();
    const heartRing = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 }); // deficit=2
    const spareRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 3 }); // deficit=3
    // Mark heartRing as heart_slot=1 and update the pointer.
    dbInstance.prepare(`UPDATE rings SET heart_slot = 1 WHERE id = ?`).run(heartRing);
    dbInstance.prepare(`UPDATE players SET heart_ring_id = ? WHERE id = ?`).run(heartRing, p);
    setSpirit(p, 2); // enough for heart (2 uses) but not spare (3 more uses)

    repo.rechargeAllWithSpirit(p, false);

    expect(getUses(heartRing)).toBe(3); // fully restored
    expect(getUses(spareRing)).toBe(0); // no spirit left
    expect(getSpirit(p)).toBe(0);
  });

  test('includeReliquary=true with spirit=0 returns 0 immediately without touching any ring', () => {
    // #397 Phase 2 adversarial: the main loop breaks on `if (spirit <= 0)`.
    // With spirit=0 from the start, no ring must be touched.
    const p = makePlayer();
    const carryRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 3 }); // deficit=3
    const relRing = makeRing(p, { inCarry: 0, currentUses: 0, maxUses: 3 });   // deficit=3
    setSpirit(p, 0);

    const remaining = repo.rechargeAllWithSpirit(p, true);

    expect(remaining).toBe(0);
    expect(getUses(carryRing)).toBe(0); // untouched
    expect(getUses(relRing)).toBe(0);   // untouched
    expect(getSpirit(p)).toBe(0);
  });

  test('seen Set prevents double-recharging a ring that appears in both loadout and carry list', () => {
    // #397 Phase 2 adversarial: the impl builds `ordered` by iterating the loadout
    // slots then appending spare rings from `carried`. A ring already added from a
    // loadout slot must not appear a second time in the spares list (the seen Set
    // guards this). If the Set is broken, the ring would receive double uses.
    const p = makePlayer();
    const battleRing = makeRing(p, { inCarry: 1, currentUses: 0, maxUses: 3 }); // deficit=3
    dbInstance.prepare(`UPDATE loadout SET thumb = ? WHERE player_id = ?`).run(battleRing, p);
    setSpirit(p, 10); // more than enough to expose double-recharge

    repo.rechargeAllWithSpirit(p, false);

    // Must be exactly 3 (max_uses), not 6 (double-recharged).
    expect(getUses(battleRing)).toBe(3);
  });

  test('multiple reliquary rings with the same deficit are both recharged when spirit allows', () => {
    // #397 Phase 2 adversarial: two rings with identical deficit must both be
    // recharged when there is enough spirit (not just the first one picked by
    // the sort). Spirit = deficit of both rings combined.
    const p = makePlayer();
    const relA = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 }); // deficit=2
    const relB = makeRing(p, { inCarry: 0, currentUses: 1, maxUses: 3 }); // deficit=2
    setSpirit(p, 4); // exactly enough for both

    repo.rechargeAllWithSpirit(p, true);

    expect(getUses(relA)).toBe(3);
    expect(getUses(relB)).toBe(3);
    expect(getSpirit(p)).toBe(0);
  });

  test('SPIRIT_PER_RING_USE = 1: one spirit restores exactly one use (constant sanity)', () => {
    // #397 Phase 2 adversarial: if SPIRIT_PER_RING_USE were changed to 2 but the
    // local test constant stayed at 1, all test spirit/use counts would be wrong.
    // This test locks the constant to 1 so any deviation is caught immediately.
    const p = makePlayer();
    const ring = makeRing(p, { inCarry: 1, currentUses: 2, maxUses: 3 }); // deficit=1
    setSpirit(p, 1);

    const remaining = repo.rechargeAllWithSpirit(p, false);

    expect(getUses(ring)).toBe(3);  // 1 use restored
    expect(remaining).toBe(0);     // exactly 1 spirit spent
  });

});
