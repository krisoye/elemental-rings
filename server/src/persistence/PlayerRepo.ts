import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { ElementEnum } from '../../../shared/types';
import { RECHARGE_COST_PER_USE } from '../game/constants';

/** A persisted player row (no password hash exposed to callers of read helpers). */
export interface PlayerRow {
  id: string;
  username: string;
  gold: number;
  game_day: number;
}

/** A persisted ring row. */
export interface RingRow {
  id: string;
  owner_id: string;
  element: number;
  tier: number;
  max_uses: number;
  current_uses: number;
  xp: number;
  escrowed: number;
}

/** A persisted loadout row — each slot holds a ring id (or null when empty). */
export interface LoadoutRow {
  player_id: string;
  thumb: string | null;
  a1: string | null;
  a2: string | null;
  d1: string | null;
  d2: string | null;
}

// Starter inventory: two rings of each base element (Fire/Water/Wood/Wind/Earth).
// Order matters — the default loadout below indexes into the created rings by
// element. Canonical integer values come from shared ElementEnum (FIRE=0,
// WATER=1, EARTH=2, WIND=3, WOOD=4) — do not hardcode the integers here.
const STARTER_ELEMENTS: number[] = [
  ElementEnum.FIRE,
  ElementEnum.FIRE,
  ElementEnum.WATER,
  ElementEnum.WATER,
  ElementEnum.WOOD,
  ElementEnum.WOOD,
  ElementEnum.WIND,
  ElementEnum.WIND,
  ElementEnum.EARTH,
  ElementEnum.EARTH,
];

const STARTER_TIER = 1;
const STARTER_MAX_USES = 3;

const insertPlayer = db.prepare(
  `INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`,
);
const insertRing = db.prepare(
  `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
   VALUES (@id, @owner_id, @element, @tier, @max_uses, @current_uses, 0)`,
);
const insertLoadout = db.prepare(
  `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2)
   VALUES (@player_id, @thumb, @a1, @a2, @d1, @d2)`,
);

const selectByUsername = db.prepare(`SELECT * FROM players WHERE username = ?`);
const selectById = db.prepare(
  `SELECT id, username, gold, game_day FROM players WHERE id = ?`,
);
const selectRingsByOwner = db.prepare(`SELECT * FROM rings WHERE owner_id = ?`);
const selectLoadout = db.prepare(`SELECT * FROM loadout WHERE player_id = ?`);

/**
 * Create a player with the full starter package: the player row, 10 starter
 * rings (two of each base element), and a default loadout. Runs in a single
 * transaction so a partial registration can never persist.
 *
 * @param username unique handle (uniqueness enforced by the DB).
 * @param passwordHash bcrypt hash of the player's password.
 * @returns the new player's id.
 */
export const createPlayer = db.transaction(
  (username: string, passwordHash: string): string => {
    const playerId = uuidv4();
    insertPlayer.run(playerId, username, passwordHash);

    // Create the starter rings, keeping their ids grouped by element so the
    // default loadout can reference specific rings deterministically.
    const ringsByElement: Record<number, string[]> = {};
    for (const element of STARTER_ELEMENTS) {
      const ringId = uuidv4();
      insertRing.run({
        id: ringId,
        owner_id: playerId,
        element,
        tier: STARTER_TIER,
        max_uses: STARTER_MAX_USES,
        current_uses: STARTER_MAX_USES,
      });
      (ringsByElement[element] ??= []).push(ringId);
    }

    // Default loadout: thumb=Fire[0], a1=Fire[1], a2=Water[0], d1=Wood[0],
    // d2=Earth[0] (GDD §6.1 / issue #26 spec).
    insertLoadout.run({
      player_id: playerId,
      thumb: ringsByElement[ElementEnum.FIRE][0],
      a1: ringsByElement[ElementEnum.FIRE][1],
      a2: ringsByElement[ElementEnum.WATER][0],
      d1: ringsByElement[ElementEnum.WOOD][0],
      d2: ringsByElement[ElementEnum.EARTH][0],
    });

    return playerId;
  },
);

/** Full player row including password_hash — used by the login flow only. */
export function getPlayerByUsername(
  username: string,
): (PlayerRow & { password_hash: string }) | undefined {
  return selectByUsername.get(username) as
    | (PlayerRow & { password_hash: string })
    | undefined;
}

/** Public player row (no password hash) by id. */
export function getPlayerById(id: string): PlayerRow | undefined {
  return selectById.get(id) as PlayerRow | undefined;
}

/** All rings owned by a player. */
export function getRingsByOwner(ownerId: string): RingRow[] {
  return selectRingsByOwner.all(ownerId) as RingRow[];
}

/** A player's loadout row, or undefined if none exists. */
export function getLoadout(playerId: string): LoadoutRow | undefined {
  return selectLoadout.get(playerId) as LoadoutRow | undefined;
}

// ---------------------------------------------------------------------------
// Prepared statements for new functions (Camp / Loadout / Staking)
// ---------------------------------------------------------------------------

const selectRingById = db.prepare(`SELECT * FROM rings WHERE id = ?`);
const updateLoadoutSlot = db.prepare(
  `UPDATE loadout SET thumb = @thumb, a1 = @a1, a2 = @a2, d1 = @d1, d2 = @d2 WHERE player_id = @player_id`,
);
const updateRingUses = db.prepare(
  `UPDATE rings SET current_uses = MIN(?, max_uses) WHERE id = ?`,
);
const updateRingXP = db.prepare(`UPDATE rings SET xp = xp + ? WHERE id = ?`);
const updatePlayerGold = db.prepare(`UPDATE players SET gold = gold + ? WHERE id = ?`);
const updateRingEscrowed = db.prepare(`UPDATE rings SET escrowed = ? WHERE id = ?`);
const updateRingOwner = db.prepare(
  `UPDATE rings SET owner_id = ?, escrowed = 0 WHERE id = ? AND owner_id = ?`,
);
const deleteRing = db.prepare(`DELETE FROM rings WHERE id = ? AND owner_id = ?`);
const updateGameDay = db.prepare(`UPDATE players SET game_day = game_day + 1 WHERE id = ?`);
const rechargeAllRings = db.prepare(`UPDATE rings SET current_uses = max_uses WHERE owner_id = ?`);
const updatePlayerGoldDeduct = db.prepare(
  `UPDATE players SET gold = gold - ? WHERE id = ?`,
);
const updateRingUsesMax = db.prepare(
  `UPDATE rings SET current_uses = max_uses WHERE id = ?`,
);

const SLOT_KEYS: ReadonlyArray<keyof LoadoutRow> = ['thumb', 'a1', 'a2', 'd1', 'd2'];

/**
 * Update a player's loadout with a partial set of slot assignments.
 *
 * Validates each ring id belongs to the player. Enforces the one-slot rule:
 * if ring X is assigned to slot S, it is nulled out from any other slot
 * currently holding X. Wraps everything in a transaction.
 */
export const saveLoadout = db.transaction(
  (playerId: string, partial: Partial<Record<'thumb' | 'a1' | 'a2' | 'd1' | 'd2', string | null>>): LoadoutRow => {
    const current = selectLoadout.get(playerId) as LoadoutRow | undefined;
    if (!current) throw new Error(`No loadout for player ${playerId}`);

    const ownerRings = new Set((selectRingsByOwner.all(playerId) as RingRow[]).map((r) => r.id));

    // Build the updated slot map starting from the current state.
    const slots: Record<string, string | null> = {
      thumb: current.thumb,
      a1: current.a1,
      a2: current.a2,
      d1: current.d1,
      d2: current.d2,
    };

    for (const key of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
      if (!(key in partial)) continue;
      const val = partial[key] ?? null;
      // null clears the slot; a ring id is validated against ownership.
      if (val !== null && !ownerRings.has(val)) continue;
      if (val !== null) {
        // Clear the same ring from any other slot to enforce one-slot rule.
        for (const other of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
          if (other !== key && slots[other] === val) slots[other] = null;
        }
      }
      slots[key] = val;
    }

    updateLoadoutSlot.run({
      player_id: playerId,
      thumb: slots.thumb,
      a1: slots.a1,
      a2: slots.a2,
      d1: slots.d1,
      d2: slots.d2,
    });

    return selectLoadout.get(playerId) as LoadoutRow;
  },
);

/**
 * Persist the current in-battle uses for a ring, clamped to the ring's own
 * max_uses to prevent transient in-battle passives from persisting above capacity.
 */
export function saveRingUses(ringId: string, currentUses: number): void {
  updateRingUses.run(currentUses, ringId);
}

/** Award XP to a ring. */
export function awardXP(ringId: string, xpAmount: number): void {
  updateRingXP.run(xpAmount, ringId);
}

/** Add (or subtract) gold from a player's balance. */
export function addGold(playerId: string, amount: number): void {
  updatePlayerGold.run(amount, playerId);
}

/** Set or clear the escrowed flag on a ring (true → 1, false → 0). */
export function setEscrowed(ringId: string, escrowed: boolean): void {
  updateRingEscrowed.run(escrowed ? 1 : 0, ringId);
}

/**
 * Grant a new ring (tier 1, full uses) to a player. Used when the human
 * player beats the AI — the AI has no DB ring to transfer, so we create one
 * matching the AI's thumb element (GDD §9.1: winner receives the staked ring).
 */
export function grantRing(ownerId: string, element: number): void {
  insertRing.run({
    id: uuidv4(),
    owner_id: ownerId,
    element,
    tier: STARTER_TIER,
    max_uses: STARTER_MAX_USES,
    current_uses: STARTER_MAX_USES,
  });
}

/**
 * Transfer ownership of a ring from one player to another. Nulls out any
 * loadout slots that referenced the ring on the losing player. The ring's XP
 * travels with it (GDD §9.1).
 */
export const transferRing = db.transaction(
  (ringId: string, fromPlayerId: string, toPlayerId: string): void => {
    const fromLoadout = selectLoadout.get(fromPlayerId) as LoadoutRow | undefined;
    if (fromLoadout) {
      const slots: Record<string, string | null> = {
        thumb: fromLoadout.thumb,
        a1: fromLoadout.a1,
        a2: fromLoadout.a2,
        d1: fromLoadout.d1,
        d2: fromLoadout.d2,
      };
      let changed = false;
      for (const key of SLOT_KEYS) {
        if (slots[key as string] === ringId) {
          slots[key as string] = null;
          changed = true;
        }
      }
      if (changed) {
        updateLoadoutSlot.run({
          player_id: fromPlayerId,
          thumb: slots.thumb,
          a1: slots.a1,
          a2: slots.a2,
          d1: slots.d1,
          d2: slots.d2,
        });
      }
    }
    updateRingOwner.run(toPlayerId, ringId, fromPlayerId);
  },
);

/**
 * Remove a ring from the database (used when the AI wins and there is no DB
 * recipient for the staked thumb ring). GDD §9.1: loser forfeits regardless.
 */
export const forfeitRing = db.transaction(
  (ringId: string, fromPlayerId: string): void => {
    const fromLoadout = selectLoadout.get(fromPlayerId) as LoadoutRow | undefined;
    if (fromLoadout) {
      const slots: Record<string, string | null> = {
        thumb: fromLoadout.thumb,
        a1: fromLoadout.a1,
        a2: fromLoadout.a2,
        d1: fromLoadout.d1,
        d2: fromLoadout.d2,
      };
      let changed = false;
      for (const key of SLOT_KEYS) {
        if (slots[key as string] === ringId) {
          slots[key as string] = null;
          changed = true;
        }
      }
      if (changed) {
        updateLoadoutSlot.run({
          player_id: fromPlayerId,
          thumb: slots.thumb,
          a1: slots.a1,
          a2: slots.a2,
          d1: slots.d1,
          d2: slots.d2,
        });
      }
    }
    deleteRing.run(ringId, fromPlayerId);
  },
);

/** Escrow the player's current thumb ring (mark it as staked). */
export function lockStake(playerId: string): void {
  const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
  if (loadout?.thumb) setEscrowed(loadout.thumb, true);
}

/** Release the player's current thumb ring from escrow. */
export function unlockStake(playerId: string): void {
  const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
  if (loadout?.thumb) setEscrowed(loadout.thumb, false);
}

/**
 * Advance the game day by 1 and fully recharge all rings owned by the player
 * (simplified full recharge for all tiers per issue #27 spec).
 */
export const sleepRecharge = db.transaction((playerId: string): void => {
  updateGameDay.run(playerId);
  rechargeAllRings.run(playerId);
});

/**
 * Pay gold to recharge a single ring to full uses.
 *
 * Returns `{ ok: false, reason }` if the ring is already full, not owned by
 * the player, or the player lacks sufficient gold. Otherwise deducts gold and
 * sets current_uses = max_uses.
 */
export const rechargeRing = db.transaction(
  (playerId: string, ringId: string): { ok: boolean; reason?: string } => {
    const ring = selectRingById.get(ringId) as RingRow | undefined;
    if (!ring || ring.owner_id !== playerId) {
      return { ok: false, reason: 'ring not found' };
    }
    const deficit = ring.max_uses - ring.current_uses;
    if (deficit === 0) return { ok: false, reason: 'already full' };
    const cost = RECHARGE_COST_PER_USE * deficit;
    const player = selectById.get(playerId) as { gold: number } | undefined;
    if (!player || player.gold < cost) return { ok: false, reason: 'insufficient gold' };
    updatePlayerGoldDeduct.run(cost, playerId);
    updateRingUsesMax.run(ringId);
    return { ok: true };
  },
);
