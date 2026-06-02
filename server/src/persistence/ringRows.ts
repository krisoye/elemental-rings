import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import type { RingRow } from './PlayerRepo';

/**
 * #299 — persistence ring-row helpers. Centralises the ring-row construction
 * literal and the most-repeated single-ring prepared statements that were
 * spelled out verbatim across PlayerRepo.ts.
 *
 * These helpers operate on the module-level `db` singleton (imported from
 * ./db) rather than taking a connection parameter, matching the established
 * PlayerRepo.ts style. better-sqlite3 is synchronous, so they compose freely
 * inside the db.transaction wrappers in PlayerRepo.
 */

/**
 * The mutable, insert-time shape of a ring: just the gameplay columns a caller
 * supplies when minting a ring. `id` and `owner_id` are supplied separately at
 * insert time; `parent_dominant` (fusion two-tone metadata) and `in_carry` are
 * handled by their own dedicated paths, so they are not part of this base shape.
 */
export interface RingRowInput {
  element: number;
  tier: number;
  xp: number;
  maxUses: number;
  currentUses: number;
  escrowed: 0 | 1;
}

/**
 * Factory for a ring-row literal. Returns a fresh copy so callers never share a
 * mutable object. Replaces the `{ element, tier, ... }` literals previously
 * spelled out verbatim at the starter-ring, grant, and merchant-buy sites.
 */
export function makeRing(input: RingRowInput): RingRowInput {
  return { ...input };
}

// Ring INSERT. Mirrors the columns the schema accepts for a base ring; escrowed
// is written explicitly so the factory's value is honoured (the column DEFAULT
// is 0, which RingRowInput defaults to at the call sites).
const insertRingStmt = db.prepare(
  `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, escrowed)
   VALUES (@id, @owner_id, @element, @tier, @max_uses, @current_uses, @xp, @escrowed)`,
);

// Single-ring read by id (no ownership filter — callers validate owner_id).
const selectRingByIdStmt = db.prepare(`SELECT * FROM rings WHERE id = ?`);
// All rings owned by a player.
const selectRingsByOwnerStmt = db.prepare(`SELECT * FROM rings WHERE owner_id = ?`);
// current_uses set, clamped to the ring's own max_uses.
const setRingUsesStmt = db.prepare(
  `UPDATE rings SET current_uses = MIN(?, max_uses) WHERE id = ?`,
);
// Add to current_uses, clamped to max_uses.
const addRingUsesStmt = db.prepare(
  `UPDATE rings SET current_uses = MIN(current_uses + ?, max_uses) WHERE id = ?`,
);
// Escrow flag set.
const setRingEscrowStmt = db.prepare(`UPDATE rings SET escrowed = ? WHERE id = ?`);
// in_carry flag set.
const setRingCarryStmt = db.prepare(`UPDATE rings SET in_carry = ? WHERE id = ?`);
// EPIC #302 — heart_slot flag set.
const setRingHeartSlotStmt = db.prepare(`UPDATE rings SET heart_slot = ? WHERE id = ?`);
// Owned delete (the loser/forfeit/discard/consume/sell path). Returns the
// better-sqlite3 RunResult so callers can read `.changes`.
const deleteRingOwnedStmt = db.prepare(`DELETE FROM rings WHERE id = ? AND owner_id = ?`);

/**
 * Insert a new ring for `playerId`, minting a fresh uuid. Returns the new ring
 * id. The fusion two-tone (`parent_dominant`) path is NOT handled here — fusion
 * inserts persist that extra column via their own dedicated statement.
 */
export function insertRing(playerId: string, ring: RingRowInput): string {
  const ringId = uuidv4();
  insertRingStmt.run({
    id: ringId,
    owner_id: playerId,
    element: ring.element,
    tier: ring.tier,
    max_uses: ring.maxUses,
    current_uses: ring.currentUses,
    xp: ring.xp,
    escrowed: ring.escrowed,
  });
  return ringId;
}

/** A single ring by id, or undefined. Callers validate ownership. */
export function getRingById(ringId: string): RingRow | undefined {
  return selectRingByIdStmt.get(ringId) as RingRow | undefined;
}

/** All rings owned by a player. */
export function getRingsForPlayer(playerId: string): RingRow[] {
  return selectRingsByOwnerStmt.all(playerId) as RingRow[];
}

/** Set a ring's current_uses, clamped to its own max_uses. */
export function setRingUses(ringId: string, currentUses: number): void {
  setRingUsesStmt.run(currentUses, ringId);
}

/** Add `n` uses to a ring, clamped to its max_uses. */
export function addRingUses(ringId: string, n: number): void {
  addRingUsesStmt.run(n, ringId);
}

/** Set (or clear) a ring's escrowed flag. */
export function setRingEscrow(ringId: string, escrowed: 0 | 1): void {
  setRingEscrowStmt.run(escrowed, ringId);
}

/** Set (or clear) a ring's in_carry flag. */
export function setRingCarry(ringId: string, inCarry: 0 | 1): void {
  setRingCarryStmt.run(inCarry, ringId);
}

/** EPIC #302 — set (or clear) a ring's heart_slot flag. */
export function setRingHeartSlot(ringId: string, heartSlot: 0 | 1): void {
  setRingHeartSlotStmt.run(heartSlot, ringId);
}

/**
 * Delete a ring the player owns. Returns the better-sqlite3 RunResult so callers
 * can read `.changes` to detect "not found / not owned". Callers that have FK
 * loadout references must null those slots out first.
 */
export function deleteRingOwned(ringId: string, ownerId: string): { changes: number } {
  return deleteRingOwnedStmt.run(ringId, ownerId);
}
