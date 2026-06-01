import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { ElementEnum } from '../../../shared/types';
import { fusionOf } from '../game/Fusions';
import { tierForXp } from '../game/Tiers';
import { getTalisman } from '../../../shared/talismans';
import {
  SPIRIT_PER_RING_USE,
  SPIRIT_BASE,
  XP_SCALER,
  FORAGE_YIELD,
  FORAGE_RESPAWN_DAYS,
  FOOD_SELL_PRICE,
  FOOD_BUY_PRICE,
  MERCHANT_RING_BUY_PRICE_T1,
  MERCHANT_RING_BUY_PRICE_NEUTRAL,
  MERCHANT_RING_SELL_PRICE_T1,
  MERCHANT_RING_SELL_PRICE_NEUTRAL,
  RELIQUARY_BASE_CAP,
  RELIQUARY_SHARD_INCREMENT,
} from '../game/constants';

/** A persisted player row (no password hash exposed to callers of read helpers). */
export interface PlayerRow {
  id: string;
  username: string;
  gold: number;
  game_day: number;
  carry_cap: number;
  spirit_max: number;
  spirit_current: number;
  food_units: number;
  /** #182 — current Reliquary capacity (starts at RELIQUARY_BASE_CAP=9; #240). */
  reliquary_cap: number;
  /** #182 — unspent Reliquary Shards held by the player. */
  reliquary_shards: number;
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
  in_carry: number;
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

// GDD §4.2 / EPIC #173 C8 — starter rings begin at tier 0 with 3 max uses (xp=0).
// Tier is XP-derived; a fresh ring at 0 XP is tier 0, and naturalMaxUses(0) = 3.
const STARTER_TIER = 0;
const STARTER_MAX_USES = 3;

const insertPlayer = db.prepare(
  `INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`,
);
const insertRing = db.prepare(
  `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp)
   VALUES (@id, @owner_id, @element, @tier, @max_uses, @current_uses, @xp)`,
);
const insertLoadout = db.prepare(
  `INSERT INTO loadout (player_id, thumb, a1, a2, d1, d2)
   VALUES (@player_id, @thumb, @a1, @a2, @d1, @d2)`,
);
// #61 — waystone attunement (idempotent via the composite primary key).
const insertAttunement = db.prepare(
  `INSERT OR IGNORE INTO waystone_attunements (player_id, waystone_id, attuned_at)
   VALUES (?, ?, ?)`,
);
const selectAttunements = db.prepare(
  `SELECT waystone_id FROM waystone_attunements WHERE player_id = ?`,
);
// #81 — talisman loadout. Seeded empty at createPlayer; equip UPSERTs so it works
// whether or not a row already exists; spend/recharge mutate the charge count.
const insertTalismanLoadout = db.prepare(
  `INSERT INTO talisman_loadout (player_id, necklace_id, necklace_charges)
   VALUES (@player_id, @necklace_id, @necklace_charges)`,
);
const selectTalismanLoadout = db.prepare(
  `SELECT necklace_id, necklace_charges FROM talisman_loadout WHERE player_id = ?`,
);
const upsertTalismanNecklace = db.prepare(
  `INSERT INTO talisman_loadout (player_id, necklace_id, necklace_charges)
   VALUES (@player_id, @necklace_id, @necklace_charges)
   ON CONFLICT(player_id) DO UPDATE SET
     necklace_id = excluded.necklace_id,
     necklace_charges = excluded.necklace_charges`,
);
const updateTalismanCharges = db.prepare(
  `UPDATE talisman_loadout SET necklace_charges = ? WHERE player_id = ?`,
);
// #83 — NPC defeat tracking. The UPSERT records (or refreshes) the defeat day so
// a periodic NPC's respawn clock restarts from the most recent win.
const upsertNpcDefeat = db.prepare(
  `INSERT INTO npc_defeats (player_id, npc_id, defeated_at_day)
   VALUES (@player_id, @npc_id, @defeated_at_day)
   ON CONFLICT(player_id, npc_id) DO UPDATE SET
     defeated_at_day = excluded.defeated_at_day`,
);
const selectNpcDefeats = db.prepare(
  `SELECT npc_id, defeated_at_day FROM npc_defeats WHERE player_id = ?`,
);
// #63 — Sanctum anchor (the waystone the overworld spawns the player beside).
const selectAnchor = db.prepare(
  `SELECT anchored_waystone FROM players WHERE id = ?`,
);
const updateAnchor = db.prepare(
  `UPDATE players SET anchored_waystone = ? WHERE id = ?`,
);

const selectByUsername = db.prepare(`SELECT * FROM players WHERE username = ?`);
const selectById = db.prepare(
  `SELECT id, username, gold, game_day, carry_cap, spirit_max, spirit_current, food_units,
          reliquary_cap, reliquary_shards
   FROM players WHERE id = ?`,
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
        xp: 0,
      });
      (ringsByElement[element] ??= []).push(ringId);
    }

    // Default loadout: thumb=Fire[0], a1=Fire[1], a2=Water[0], d1=Wood[0],
    // d2=Earth[0] (GDD §6.1 / issue #26 spec).
    const defaultSlots = {
      thumb: ringsByElement[ElementEnum.FIRE][0],
      a1: ringsByElement[ElementEnum.FIRE][1],
      a2: ringsByElement[ElementEnum.WATER][0],
      d1: ringsByElement[ElementEnum.WOOD][0],
      d2: ringsByElement[ElementEnum.EARTH][0],
    };
    insertLoadout.run({ player_id: playerId, ...defaultSlots });

    // #40 — the five battle-slot rings start carried (in_carry = 1); the other
    // five starter rings remain at the Sanctum, well within the carry_cap of 10.
    const setCarry = db.prepare('UPDATE rings SET in_carry = 1 WHERE id = ?');
    for (const ringId of Object.values(defaultSlots)) setCarry.run(ringId);

    // #61 — every new player starts attuned to the Forest entry waystone so the
    // overworld's first teleport destination is available immediately (GDD §10.7).
    insertAttunement.run(playerId, 'forest_entry', Date.now());

    // #81 — seed an empty talisman loadout (no necklace, 0 charges). Starting
    // players do not own a Sanctum Stone (GDD §14.3 — it is a mid-game upgrade).
    insertTalismanLoadout.run({ player_id: playerId, necklace_id: null, necklace_charges: 0 });

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
// EPIC #173 C2 — awardXP applies XP, the recomputed cached tier, and any
// natural-crossing max_uses bonus in one statement so they never desync.
const applyXpAndTierGrant = db.prepare(
  `UPDATE rings SET xp = ?, tier = ?, max_uses = ? WHERE id = ?`,
);
const setRingXPAbsolute = db.prepare(`UPDATE rings SET xp = ? WHERE id = ? AND owner_id = ?`);
const updatePlayerGold = db.prepare(`UPDATE players SET gold = gold + ? WHERE id = ?`);
const updateRingEscrowed = db.prepare(`UPDATE rings SET escrowed = ? WHERE id = ?`);
const updateRingOwner = db.prepare(
  `UPDATE rings SET owner_id = ?, escrowed = 0, in_carry = 0 WHERE id = ? AND owner_id = ?`,
);
const deleteRing = db.prepare(`DELETE FROM rings WHERE id = ? AND owner_id = ?`);
const updateGameDay = db.prepare(`UPDATE players SET game_day = game_day + 1 WHERE id = ?`);

// #40 — carry flag management.
const selectCarryByOwner = db.prepare(`SELECT * FROM rings WHERE owner_id = ? AND in_carry = 1`);
const updateRingCarry = db.prepare(`UPDATE rings SET in_carry = ? WHERE id = ?`);
const clearCarryForOwner = db.prepare(`UPDATE rings SET in_carry = 0 WHERE owner_id = ?`);
// selectCarryCap removed (#171): getCarryCap is now XP-derived, not read from the DB column.

// #41 — spirit / food economy.
const selectSpiritFood = db.prepare(
  `SELECT spirit_current, spirit_max, food_units FROM players WHERE id = ?`,
);
const updateSpiritDeduct = db.prepare(
  `UPDATE players SET spirit_current = spirit_current - ? WHERE id = ?`,
);
// Atomic check-and-spend: the WHERE clause guards affordability in the same
// statement, so two concurrent requests can never both deduct past zero.
const updateSpiritDeductGuarded = db.prepare(
  `UPDATE players SET spirit_current = spirit_current - ? WHERE id = ? AND spirit_current >= ?`,
);
// spirit_max is XP-derived (SPIRIT_BASE + floor(aggregate_xp / XP_SCALER)), so
// restoring sets spirit_current to the freshly computed max, not the column.
// Only Reliquary rings (in_carry = 0) count toward aggregate_xp — carried rings
// are excluded. Must match the boot-time recompute filter in db.ts.
const selectAggregateRingXp = db.prepare(
  `SELECT COALESCE(SUM(xp), 0) AS xp_sum FROM rings WHERE owner_id = ? AND in_carry = 0`,
);
const updateSpiritCurrent = db.prepare(
  `UPDATE players SET spirit_current = ? WHERE id = ?`,
);
const updateSpiritMax = db.prepare(`UPDATE players SET spirit_max = ? WHERE id = ?`);
const updateFoodAdd = db.prepare(`UPDATE players SET food_units = food_units + ? WHERE id = ?`);
const updateFoodDeduct = db.prepare(`UPDATE players SET food_units = food_units - ? WHERE id = ?`);
const updateRingUsesAdd = db.prepare(
  `UPDATE rings SET current_uses = MIN(current_uses + ?, max_uses) WHERE id = ?`,
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
    // #171 — carry-cap guard: reject if the player is currently carrying more
    // rings than the XP-derived cap (5 + floor(aggregate_xp / 100)). Single-
    // sourced via getCarryCap so the limit matches packLoadout and the route check.
    const carriedCount = (selectCarryByOwner.all(playerId) as RingRow[]).length;
    const cap = getCarryCap(playerId);
    if (carriedCount > cap) {
      throw new Error(`carry cap exceeded (${carriedCount} > ${cap})`);
    }

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

/**
 * Award XP to a ring and apply any natural tier-crossing (GDD §4.2, EPIC #173 C2).
 *
 * Recomputes the tier from the new XP total via {@link tierForXp} and always
 * refreshes the cached `tier` column. When the award pushes the ring across one
 * or more tier thresholds, `max_uses` is permanently incremented by the number of
 * tiers crossed (the natural +1-per-tier grant). `current_uses` is left untouched
 * — the grant raises the ceiling; recharge fills it. A non-positive `xpAmount` is
 * a no-op (no XP change can cross a threshold). Runs as a single transaction so
 * the xp/tier/max_uses writes can never desync.
 */
export const awardXP = db.transaction((ringId: string, xpAmount: number): void => {
  if (xpAmount <= 0) return;
  const ring = selectRingById.get(ringId) as RingRow | undefined;
  if (!ring) return;
  const newXp = ring.xp + xpAmount;
  const oldTier = tierForXp(ring.xp);
  const newTier = tierForXp(newXp);
  const grant = newTier > oldTier ? newTier - oldTier : 0;
  applyXpAndTierGrant.run(newXp, newTier, ring.max_uses + grant, ringId);
});

/**
 * Set a ring's XP to an absolute value (only when owned by the player). Used by
 * the E2E test-only route to deterministically max a parent ring for fusion;
 * never wired into normal gameplay.
 */
export function setRingXP(playerId: string, ringId: string, xp: number): boolean {
  return setRingXPAbsolute.run(xp, ringId, playerId).changes > 0;
}

/** Add (or subtract) gold from a player's balance. */
export function addGold(playerId: string, amount: number): void {
  updatePlayerGold.run(amount, playerId);
}

/**
 * Deduct gold floored at 0: the balance never goes negative. Reads the current
 * balance and subtracts only as much as the player can afford. Used by the
 * forfeit penalty (GDD §6.3). No-op for an unknown player.
 */
export function deductGoldFloored(playerId: string, amount: number): void {
  const player = getPlayerById(playerId);
  if (!player) return;
  const toDeduct = Math.min(Math.max(0, amount), player.gold);
  if (toDeduct > 0) updatePlayerGold.run(-toDeduct, playerId);
}

/**
 * Restore `n` uses to a ring (clamped to its max_uses). Used by the in-duel
 * recharge action (GDD §6.3) to persist the ring row alongside the live
 * PlayerState mutation. A non-positive `n` is a no-op.
 */
export function addRingUses(ringId: string, n: number): void {
  if (n <= 0) return;
  updateRingUsesAdd.run(n, ringId);
}

/**
 * Atomic in-duel recharge persistence (#124): spend `affordableUses *
 * SPIRIT_PER_RING_USE` spirit AND restore `affordableUses` uses to the ring in a
 * single transaction, so a crash between the two writes can never leave spirit
 * spent without uses restored (or vice versa). The affordability is computed by
 * the caller against the live PlayerState; a non-positive `affordableUses` is a
 * no-op. Mirrors the spirit-per-use coupling of the camp recharge path.
 */
export const rechargeRingInBattle = db.transaction(
  (playerId: string, ringId: string, affordableUses: number): void => {
    if (affordableUses <= 0) return;
    updateSpiritDeduct.run(affordableUses * SPIRIT_PER_RING_USE, playerId);
    updateRingUsesAdd.run(affordableUses, ringId);
  },
);

/** Set or clear the escrowed flag on a ring (true → 1, false → 0). */
export function setEscrowed(ringId: string, escrowed: boolean): void {
  updateRingEscrowed.run(escrowed ? 1 : 0, ringId);
}

/**
 * Grant a new ring (tier 1, full uses) to a player. Used when the human
 * player beats the AI — the AI has no DB ring to transfer, so we create one
 * matching the AI's thumb element (GDD §9.1: winner receives the staked ring).
 */
export function grantRing(
  ownerId: string,
  element: number,
  tier = STARTER_TIER,
  maxUses = STARTER_MAX_USES,
  xp = 0,
): string {
  const ringId = uuidv4();
  insertRing.run({
    id: ringId,
    owner_id: ownerId,
    element,
    tier,
    max_uses: maxUses,
    current_uses: maxUses,
    xp,
  });
  return ringId;
}

/**
 * Grant a new ring directly into the player's CARRY (in_carry = 1) — used when a
 * win drops a ready-to-use ring rather than one that rests in the Reliquary. The
 * ring's element decides fusion-ness (isFusion(element)); no separate flag exists.
 * Mirrors {@link grantRing}'s defaults (full uses, no XP) and runs in a single
 * transaction so the insert + carry flag never desync. Returns the new ring id.
 *
 * #231 — the Thornado Shrine Guardian drops a Thornado (Wood+Wind) ring on defeat
 * via this path so the player can immediately carry it to the altar as the seal key.
 */
export const grantRingToCarry = db.transaction(
  (
    ownerId: string,
    element: number,
    tier = STARTER_TIER,
    maxUses = STARTER_MAX_USES,
    xp = 0,
  ): string => {
    const ringId = grantRing(ownerId, element, tier, maxUses, xp);
    updateRingCarry.run(1, ringId);
    return ringId;
  },
);

/**
 * Transfer ownership of a ring from one player to another. Nulls out any
 * loadout slots that referenced the ring on the losing player. The ring's XP
 * travels with it (GDD §9.1).
 */
export const transferRing = db.transaction(
  (ringId: string, fromPlayerId: string, toPlayerId: string): string => {
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
    return ringId;
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

/**
 * Atomic forfeit settlement (#124): transfer the forfeiter's staked thumb ring to
 * the winner AND deduct the gold penalty (floored at 0) in a SINGLE transaction,
 * so a crash can't leave the ring transferred without the penalty applied (or
 * vice versa). Returns the transferred ring id. Both inner ops nest under one
 * better-sqlite3 transaction (savepoint). Used when the loser is a human and the
 * winner is a human.
 */
export const transferRingWithGoldPenalty = db.transaction(
  (ringId: string, fromPlayerId: string, toPlayerId: string, penalty: number): string => {
    const id = transferRing(ringId, fromPlayerId, toPlayerId);
    deductGoldFloored(fromPlayerId, penalty);
    return id;
  },
);

/**
 * Atomic forfeit settlement vs an AI/no-DB winner (#124): delete the forfeiter's
 * staked thumb ring AND deduct the gold penalty (floored at 0) in one transaction.
 */
export const forfeitRingWithGoldPenalty = db.transaction(
  (ringId: string, fromPlayerId: string, penalty: number): void => {
    forfeitRing(ringId, fromPlayerId);
    deductGoldFloored(fromPlayerId, penalty);
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
 * Advance the game day by 1. Resting recovery now flows through the spirit
 * system (#41): the sleep route restores spirit and spends food separately, so
 * sleeping no longer auto-recharges every ring.
 */
export const sleepRecharge = db.transaction((playerId: string): void => {
  updateGameDay.run(playerId);
});

// ---------------------------------------------------------------------------
// #40 — Carry system
// ---------------------------------------------------------------------------

/** All rings the player is currently carrying (in_carry = 1). */
export function getCarry(playerId: string): RingRow[] {
  return selectCarryByOwner.all(playerId) as RingRow[];
}

/** Set or clear the in_carry flag on a single ring (true → 1, false → 0). */
export function setInCarry(ringId: string, inCarry: boolean): void {
  updateRingCarry.run(inCarry ? 1 : 0, ringId);
}

/**
 * Permanently delete a ring the player owns (the Discard choice on the won-ring
 * prompt / Manage Battle Hand). Nulls the ring out of any loadout slot first so
 * the delete does not violate the loadout→rings FK constraint (a carried ring
 * may be assigned to thumb/a1/a2/d1/d2). Runs in a transaction. No-op if the
 * ring is not owned by the player.
 */
export const discardRing = db.transaction(
  (playerId: string, ringId: string): { ok: boolean } => {
    const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
    if (loadout) {
      const slots: Record<string, string | null> = {
        thumb: loadout.thumb,
        a1: loadout.a1,
        a2: loadout.a2,
        d1: loadout.d1,
        d2: loadout.d2,
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
          player_id: playerId,
          thumb: slots.thumb,
          a1: slots.a1,
          a2: slots.a2,
          d1: slots.d1,
          d2: slots.d2,
        });
      }
    }
    const info = deleteRing.run(ringId, playerId);
    return { ok: info.changes > 0 };
  },
);

/**
 * Null the given ring out of every loadout slot that references it for the
 * player, so a subsequent delete cannot violate the loadout→rings FK. No-op
 * when no loadout exists or no slot holds the ring. Must run inside a
 * transaction (callers are db.transaction wrappers).
 */
function clearRingFromLoadout(playerId: string, ringId: string): void {
  const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
  if (!loadout) return;
  const slots: Record<string, string | null> = {
    thumb: loadout.thumb,
    a1: loadout.a1,
    a2: loadout.a2,
    d1: loadout.d1,
    d2: loadout.d2,
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
      player_id: playerId,
      thumb: slots.thumb,
      a1: slots.a1,
      a2: slots.a2,
      d1: slots.d1,
      d2: slots.d2,
    });
  }
}

/**
 * Fuse two parent rings into a single compound-element fusion ring (GDD §4.6).
 *
 * Validates (in order): ownership of both distinct rings, that both parents sit
 * in the SAME tier (`tierForXp(r1.xp) === tierForXp(r2.xp)`), that the shared
 * tier is at least Tier 2, and that the two base elements form a valid fusion
 * pair. On success it inserts the new fusion ring — element from `fusionOf`, XP
 * the sum of both parents, tier recomputed from that summed XP via {@link
 * tierForXp}, and `max_uses = max(1, min(parent uses) − 1)` (a fusion ring lands
 * one use shy of its weaker parent, floored at 1; `current_uses` starts full).
 * It then permanently deletes both parents, nulling each out of any loadout slot
 * first so the FK constraint holds. Runs in a single transaction, so any thrown
 * validation error leaves the inventory untouched.
 *
 * @returns the new fusion ring's id.
 * @throws Error with a caller-displayable message on any validation failure.
 */
export const fuseRings = db.transaction(
  (playerId: string, ringId1: string, ringId2: string): string => {
    if (ringId1 === ringId2) {
      throw new Error('Cannot fuse a ring with itself');
    }
    const r1 = selectRingById.get(ringId1) as RingRow | undefined;
    const r2 = selectRingById.get(ringId2) as RingRow | undefined;
    if (!r1 || r1.owner_id !== playerId || !r2 || r2.owner_id !== playerId) {
      throw new Error('Ring not found or not owned');
    }

    // §4.6 — both parents must be the same XP-derived tier, and that tier must
    // be at least Tier 1 (≥ 500 XP). Tier is derived live from XP (not the cached column).
    const tier1 = tierForXp(r1.xp);
    const tier2 = tierForXp(r2.xp);
    if (tier1 !== tier2) {
      throw new Error('Rings must be the same tier to fuse');
    }
    if (tier1 < 1) {
      throw new Error('Both rings must reach Tier 1 to fuse');
    }

    const fusionElement = fusionOf(r1.element, r2.element);
    if (fusionElement === null) {
      throw new Error('These two elements do not form a valid fusion');
    }

    // §4.6 — XP additive; tier from the summed XP; uses = min(parents) − 1,
    // floored at 1 so a fusion always has at least one use.
    const fusedXp = r1.xp + r2.xp;
    const fusedTier = tierForXp(fusedXp);
    const fusedMaxUses = Math.max(1, Math.min(r1.max_uses, r2.max_uses) - 1);

    const newRingId = uuidv4();
    insertRing.run({
      id: newRingId,
      owner_id: playerId,
      element: fusionElement,
      tier: fusedTier,
      max_uses: fusedMaxUses,
      current_uses: fusedMaxUses,
      xp: fusedXp,
    });

    // Consume both parents: null them out of any loadout slot, then delete.
    for (const ring of [r1, r2]) {
      clearRingFromLoadout(playerId, ring.id);
      deleteRing.run(ring.id, playerId);
    }

    return newRingId;
  },
);

/**
 * The player's spare carry capacity (#171, GDD §4.1).
 * spare_slots = floor(aggregate_xp / 100), where aggregate_xp = SUM(xp) WHERE
 * in_carry = 0 (Reliquary rings only — same filter as spirit_max derivation).
 * Returns 0 for a fresh player with no Reliquary XP.
 */
export function getSpareCapacity(playerId: string): number {
  const { aggregateXp } = getSpiritStats(playerId);
  return Math.floor(aggregateXp / 100);
}

/**
 * The player's carry cap (rings carryable on an expedition). XP-derived (#171):
 * carry_cap = 5 + floor(aggregate_xp / 100). Base = 5 spare slots for a fresh
 * player; each 100 aggregate Reliquary XP grants one additional spare slot.
 * Single-sourced here so packLoadout, merchantBuyRing, and route validation
 * all agree on the same cap.
 */
export function getCarryCap(playerId: string): number {
  return 5 + getSpareCapacity(playerId);
}

/**
 * Atomically set the carried set to EXACTLY the given ring ids. Validates that
 * the count is within the player's carry_cap and that every id is owned by the
 * player; throws otherwise. All other rings have their in_carry flag cleared.
 *
 * #182 — Reliquary cap guard: after setting the new carry set, the number of
 * resting (non-carried, non-escrowed) rings must not exceed reliquary_cap.
 * Throws 'Reliquary full' when the resulting resting count would exceed the cap.
 */
export const packLoadout = db.transaction(
  (playerId: string, ringIds: string[]): void => {
    const cap = getCarryCap(playerId);
    // Dedupe defensively so a repeated id can't inflate the count past the cap.
    const unique = Array.from(new Set(ringIds));
    if (unique.length > cap) {
      throw new Error(`carry cap exceeded (${unique.length} > ${cap})`);
    }
    const ownerRings = (selectRingsByOwner.all(playerId) as RingRow[]);
    const ownerRingSet = new Set(ownerRings.map((r) => r.id));
    for (const id of unique) {
      if (!ownerRingSet.has(id)) throw new Error(`ring ${id} not owned by player`);
    }

    // #182 — Reliquary cap guard: count owned non-escrowed rings; the ones NOT
    // in the new carry set will rest in the Reliquary.
    const ownedNonEscrowed = (
      db.prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND escrowed = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    const resultingReliquary = ownedNonEscrowed - unique.length;
    const reliquaryCap =
      (db.prepare('SELECT reliquary_cap FROM players WHERE id = ?').get(playerId) as
        | { reliquary_cap: number }
        | undefined)?.reliquary_cap ?? RELIQUARY_BASE_CAP;
    if (resultingReliquary > reliquaryCap) {
      throw new Error('Reliquary full');
    }

    clearCarryForOwner.run(playerId);
    for (const id of unique) updateRingCarry.run(1, id);
  },
);

// ---------------------------------------------------------------------------
// #182 — Reliquary capacity + Shard expansion
// ---------------------------------------------------------------------------

/**
 * Count of rings currently resting in the Reliquary for this player.
 * Definition: in_carry=0 AND escrowed=0. Carried rings (in_carry=1) and
 * staked rings (escrowed=1) do NOT consume Reliquary slots.
 */
export function getReliquaryCount(playerId: string): number {
  const row = db
    .prepare(
      'SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 0 AND escrowed = 0',
    )
    .get(playerId) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

/** Current Reliquary capacity for this player (reads reliquary_cap column). */
export function getReliquaryCap(playerId: string): number {
  const row = db
    .prepare('SELECT reliquary_cap FROM players WHERE id = ?')
    .get(playerId) as { reliquary_cap: number } | undefined;
  return row?.reliquary_cap ?? RELIQUARY_BASE_CAP;
}

/** Unspent Reliquary Shards held by this player. */
export function getReliquaryShards(playerId: string): number {
  const row = db
    .prepare('SELECT reliquary_shards FROM players WHERE id = ?')
    .get(playerId) as { reliquary_shards: number } | undefined;
  return row?.reliquary_shards ?? 0;
}

/**
 * Grant the player one Reliquary Shard (from NPC reward / loot drop).
 * Does NOT expand the cap directly — the player must spend the Shard via
 * addReliquaryShardToReliquary(). No player-facing route; called by server hooks.
 */
export function grantShard(playerId: string): void {
  db.prepare('UPDATE players SET reliquary_shards = reliquary_shards + 1 WHERE id = ?').run(
    playerId,
  );
}

/**
 * Spend one Reliquary Shard to expand the Reliquary by RELIQUARY_SHARD_INCREMENT
 * slots. Atomic: the SELECT and UPDATE run in the same transaction so two
 * concurrent calls cannot both consume the same Shard.
 *
 * @returns true when the expansion succeeded; false when the player held 0 Shards
 * (caller should return 400 'no Reliquary Shards').
 */
export const addReliquaryShardToReliquary = db.transaction(
  (playerId: string): boolean => {
    const row = db
      .prepare('SELECT reliquary_shards FROM players WHERE id = ?')
      .get(playerId) as { reliquary_shards: number } | undefined;
    if (!row || row.reliquary_shards < 1) return false;
    db.prepare(
      `UPDATE players
         SET reliquary_shards = reliquary_shards - 1,
             reliquary_cap    = reliquary_cap    + ${RELIQUARY_SHARD_INCREMENT}
       WHERE id = ?`,
    ).run(playerId);
    return true;
  },
);

// ---------------------------------------------------------------------------
// #41 — Spirit / food economy
// ---------------------------------------------------------------------------

/** The player's current spirit gauge and food balance. */
export function getSpiritAndFood(playerId: string): {
  spirit_current: number;
  spirit_max: number;
  food_units: number;
} {
  const row = selectSpiritFood.get(playerId) as
    | { spirit_current: number; spirit_max: number; food_units: number }
    | undefined;
  if (!row) throw new Error(`player ${playerId} not found`);
  return row;
}

/** Deduct spirit; throws if the player lacks the requested amount. */
export function spendSpirit(playerId: string, amount: number): void {
  const { spirit_current } = getSpiritAndFood(playerId);
  if (spirit_current < amount) throw new Error('insufficient spirit');
  updateSpiritDeduct.run(amount, playerId);
}

/**
 * Atomic check-and-spend in a single SQLite statement. Deducts `cost` only if the
 * player currently holds at least that much spirit, via a guarded UPDATE. Returns
 * true when one row was affected (deducted), false when the balance was
 * insufficient — closing the read→check→spend TOCTOU window two concurrent
 * blink/teleport requests would otherwise share. A zero/negative cost is a no-op
 * that still reports success.
 */
export function spendSpiritAtomic(playerId: string, cost: number): boolean {
  if (cost <= 0) return true;
  const info = updateSpiritDeductGuarded.run(cost, playerId, cost);
  return info.changes === 1;
}

/**
 * Single query returning both the raw aggregate ring XP and the derived
 * spirit_max. Use this wherever both values are needed to avoid a second
 * DB round-trip.
 *   aggregate_xp = SUM(xp) WHERE in_carry = 0   -- Reliquary rings only
 *   spirit_max   = SPIRIT_BASE + floor(aggregate_xp / XP_SCALER)
 */
export function getSpiritStats(playerId: string): { aggregateXp: number; spiritMax: number } {
  const row = selectAggregateRingXp.get(playerId) as { xp_sum: number } | undefined;
  const aggregateXp = row?.xp_sum ?? 0;
  return { aggregateXp, spiritMax: SPIRIT_BASE + Math.floor(aggregateXp / XP_SCALER) };
}

/** Return the raw sum of XP across all rings owned by the player. */
export function getAggregateXp(playerId: string): number {
  return getSpiritStats(playerId).aggregateXp;
}

// ---------------------------------------------------------------------------
// #61 — Waystone attunement (Phase 8B, GDD §10.7)
// ---------------------------------------------------------------------------

/** The ids of every waystone the player has attuned (permanent, append-only). */
export function getAttunements(playerId: string): string[] {
  return (selectAttunements.all(playerId) as Array<{ waystone_id: string }>).map(
    (r) => r.waystone_id,
  );
}

/**
 * Attune the player to a waystone. Idempotent — repeated calls for the same
 * (player, waystone) are no-ops via the composite primary key. Caller validates
 * that waystoneId is a known waystone (the catalog lives in shared/waystones.ts).
 */
export function attuneWaystone(playerId: string, waystoneId: string): void {
  insertAttunement.run(playerId, waystoneId, Date.now());
}

/**
 * The waystone the player's Sanctum is currently anchored at (#63, GDD §10.7).
 * Drives the overworld spawn point. Falls back to `forest_entry` for a player
 * row that predates the column default (defensive — the migration backfills it).
 */
export function getAnchor(playerId: string): string {
  const row = selectAnchor.get(playerId) as { anchored_waystone: string } | undefined;
  return row?.anchored_waystone ?? 'forest_entry';
}

/**
 * Re-anchor the player's Sanctum to a waystone (#63). Caller is responsible for
 * validating that the waystone is known, attuned, and meets the teleport gate;
 * this is a bare persistence write.
 */
export function setAnchor(playerId: string, waystoneId: string): void {
  updateAnchor.run(waystoneId, playerId);
}

// ---------------------------------------------------------------------------
// #81 — Talisman loadout (Phase 8C.1, GDD §14.2/§14.3)
// ---------------------------------------------------------------------------

/**
 * The player's equipped necklace talisman and its remaining charges. Returns the
 * "nothing equipped" baseline ({ necklaceId: null, necklaceCharges: 0 }) when no
 * row exists (defensive — createPlayer seeds one for every new player).
 */
export function getTalismanLoadout(playerId: string): {
  necklaceId: string | null;
  necklaceCharges: number;
} {
  const row = selectTalismanLoadout.get(playerId) as
    | { necklace_id: string | null; necklace_charges: number }
    | undefined;
  if (!row) return { necklaceId: null, necklaceCharges: 0 };
  return { necklaceId: row.necklace_id, necklaceCharges: row.necklace_charges };
}

/**
 * Equip a talisman to the necklace slot, resetting its charges to the catalog's
 * maxCharges. UPSERTs so it works whether or not a loadout row already exists.
 * Caller validates that `talismanlId` is a known necklace talisman before
 * calling. (The param name carries the issue contract's exact spelling.)
 */
export function equipTalisman(
  playerId: string,
  talismanlId: string,
  _slot: 'necklace',
): { necklaceId: string; necklaceCharges: number } {
  const def = getTalisman(talismanlId);
  const charges = def?.maxCharges ?? 0;
  upsertTalismanNecklace.run({
    player_id: playerId,
    necklace_id: talismanlId,
    necklace_charges: charges,
  });
  return { necklaceId: talismanlId, necklaceCharges: charges };
}

/**
 * Spend one necklace charge. Returns the new charge count, or -1 when the
 * necklace is already at 0 charges (no charge spent). Bare persistence write —
 * the route validates the necklace is equipped and the action is legal first.
 */
export function spendTalismanCharge(playerId: string): number {
  const { necklaceCharges } = getTalismanLoadout(playerId);
  if (necklaceCharges <= 0) return -1;
  const next = necklaceCharges - 1;
  updateTalismanCharges.run(next, playerId);
  return next;
}

/**
 * Restore the equipped necklace to its catalog maxCharges (the sleep refill,
 * GDD §14.3). No-op when no necklace is equipped or its id is unknown.
 */
export function rechargeNecklace(playerId: string): void {
  const { necklaceId } = getTalismanLoadout(playerId);
  if (!necklaceId) return;
  const def = getTalisman(necklaceId);
  if (!def) return;
  updateTalismanCharges.run(def.maxCharges, playerId);
}

/**
 * Compute the player's spirit_max from their aggregate ring XP.
 * Always derived live so it reflects the current inventory.
 * Does not write to the DB — see refreshSpiritMax.
 */
export function computeSpiritMax(playerId: string): number {
  return getSpiritStats(playerId).spiritMax;
}

/**
 * Recompute spirit_max from aggregate ring XP and persist it to the players
 * column. Call after XP is awarded (or rings are transferred) so a subsequent
 * /api/me reflects the updated cap. Returns the new spirit_max.
 */
export function refreshSpiritMax(playerId: string): number {
  const max = computeSpiritMax(playerId);
  updateSpiritMax.run(max, playerId);
  return max;
}

/** Restore the spirit gauge to its (XP-derived) maximum (resting effect). */
export function restoreSpirit(playerId: string): void {
  updateSpiritCurrent.run(computeSpiritMax(playerId), playerId);
}

/**
 * Set the spirit gauge to an exact value (clamped at ≥ 0). Used only by the E2E
 * test route to seed a precise partial-spirit recharge scenario; never wired into
 * normal gameplay.
 */
export function setSpiritCurrent(playerId: string, value: number): void {
  updateSpiritCurrent.run(Math.max(0, value), playerId);
}

/** Add food units to the player's larder. */
export function addFood(playerId: string, amount: number): void {
  updateFoodAdd.run(amount, playerId);
}

/** Spend food units; throws if the player lacks the requested amount. */
export function spendFood(playerId: string, amount: number): void {
  const { food_units } = getSpiritAndFood(playerId);
  if (food_units < amount) throw new Error('insufficient food');
  updateFoodDeduct.run(amount, playerId);
}

/**
 * Recharge a specific ring using spirit. Restores `uses` (or as many as the
 * deficit and the player's spirit allow when omitted), spending
 * SPIRIT_PER_RING_USE per restored use. Returns the number of uses restored.
 *
 * Throws on an unowned ring or when the player has no spirit to spend.
 */
export const rechargeRingWithSpirit = db.transaction(
  (playerId: string, ringId: string, uses?: number): { ok: boolean; reason?: string; restored: number } => {
    const ring = selectRingById.get(ringId) as RingRow | undefined;
    if (!ring || ring.owner_id !== playerId) {
      return { ok: false, reason: 'ring not found', restored: 0 };
    }
    const deficit = ring.max_uses - ring.current_uses;
    if (deficit === 0) return { ok: false, reason: 'already full', restored: 0 };

    const { spirit_current } = getSpiritAndFood(playerId);
    const affordable = Math.floor(spirit_current / SPIRIT_PER_RING_USE);
    if (affordable === 0) return { ok: false, reason: 'insufficient spirit', restored: 0 };

    // Requested uses (default: top off) clamped to the deficit and to spirit.
    const wanted = uses === undefined ? deficit : Math.max(0, Math.min(uses, deficit));
    const restored = Math.min(wanted, affordable);
    if (restored === 0) return { ok: false, reason: 'insufficient spirit', restored: 0 };

    updateRingUsesAdd.run(restored, ringId);
    updateSpiritDeduct.run(restored * SPIRIT_PER_RING_USE, playerId);
    return { ok: true, restored };
  },
);

/**
 * Recharge every carried ring in priority order (Thumb → A1 → A2 → D1 → D2,
 * then spares most-depleted first), stopping when spirit reaches 0. Returns the
 * remaining spirit after the operation.
 */
export const rechargeAllWithSpirit = db.transaction(
  (playerId: string): number => {
    const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
    const carried = selectCarryByOwner.all(playerId) as RingRow[];
    const byId = new Map(carried.map((r) => [r.id, r]));

    // Priority list: battle-slot rings first (in slot order), then spares.
    const ordered: RingRow[] = [];
    const seen = new Set<string>();
    if (loadout) {
      for (const slot of SLOT_KEYS) {
        const id = loadout[slot] as string | null;
        if (id && byId.has(id) && !seen.has(id)) {
          ordered.push(byId.get(id)!);
          seen.add(id);
        }
      }
    }
    const spares = carried
      .filter((r) => !seen.has(r.id))
      .sort((a, b) => {
        // Most-depleted first (largest deficit), then stable by id.
        const da = a.max_uses - a.current_uses;
        const dbf = b.max_uses - b.current_uses;
        return dbf !== da ? dbf - da : a.id.localeCompare(b.id);
      });
    ordered.push(...spares);

    let spirit = getSpiritAndFood(playerId).spirit_current;
    for (const ring of ordered) {
      if (spirit <= 0) break;
      const deficit = ring.max_uses - ring.current_uses;
      if (deficit === 0) continue;
      const affordable = Math.floor(spirit / SPIRIT_PER_RING_USE);
      const restored = Math.min(deficit, affordable);
      if (restored === 0) break;
      updateRingUsesAdd.run(restored, ring.id);
      spirit -= restored * SPIRIT_PER_RING_USE;
    }
    updateSpiritDeduct.run(getSpiritAndFood(playerId).spirit_current - spirit, playerId);
    return spirit;
  },
);

// ---------------------------------------------------------------------------
// #83 — NPC defeat tracking (Phase 8C.3, GDD §10.5)
// ---------------------------------------------------------------------------

/**
 * Record that the player defeated the given NPC. Stamps the defeat with the
 * player's CURRENT game_day (read via getPlayerById), so periodic NPCs respawn
 * relative to the day they were last beaten. UPSERT: a repeat win for an already
 * defeated NPC refreshes the day (restarting its respawn clock). No-op for an
 * unknown player (getPlayerById returns undefined → game_day falls back to 0).
 */
export function recordNpcDefeat(playerId: string, npcId: string): void {
  const player = getPlayerById(playerId);
  const day = player?.game_day ?? 0;
  upsertNpcDefeat.run({ player_id: playerId, npc_id: npcId, defeated_at_day: day });
}

/**
 * Every NPC the player has defeated, mapped npc_id → defeated_at_day (the
 * game_day the win was recorded). The overworld NPC route joins this with the
 * spawn table's respawnDays + the player's current game_day to decide which
 * NPCs are currently hidden.
 */
export function getDefeatedNpcs(playerId: string): Map<string, number> {
  const rows = selectNpcDefeats.all(playerId) as Array<{
    npc_id: string;
    defeated_at_day: number;
  }>;
  return new Map(rows.map((r) => [r.npc_id, r.defeated_at_day]));
}

// ---------------------------------------------------------------------------
// #231 — Fusion Shrine seal state (GDD §4.6 shrine crafting)
// ---------------------------------------------------------------------------

const selectShrineUnlocked = db.prepare(
  `SELECT 1 FROM shrines WHERE player_id = ? AND shrine_id = ?`,
);
const upsertShrineUnlock = db.prepare(
  `INSERT INTO shrines (player_id, shrine_id, unlocked_at)
   VALUES (?, ?, ?)
   ON CONFLICT(player_id, shrine_id) DO NOTHING`,
);

/** True when this player has permanently unsealed the given shrine (#231). */
export function isShrineUnlocked(playerId: string, shrineId: string): boolean {
  return selectShrineUnlocked.get(playerId, shrineId) !== undefined;
}

/**
 * Permanently mark a shrine as unsealed for this player (#231). Idempotent via
 * the composite primary key — a repeat call for an already-unsealed shrine is a
 * no-op (the original unlock day is preserved). `day` is the player's game_day at
 * unlock time. Bare persistence write; the route validates the ring-key first.
 */
export function unlockShrine(playerId: string, shrineId: string, day: number): void {
  upsertShrineUnlock.run(playerId, shrineId, day);
}

/**
 * Consume (delete) a specific ring the player owns — the ring-key spent to
 * unseal a shrine (#231). Returns true when the ring existed, belonged to the
 * player, and was deleted; false otherwise. Nulls the ring out of any loadout
 * slot first so the delete cannot violate the loadout→rings FK. Runs in a
 * transaction. Caller validates the ring's element/carry state before calling.
 */
export const consumeRing = db.transaction(
  (playerId: string, ringId: string): boolean => {
    clearRingFromLoadout(playerId, ringId);
    return deleteRing.run(ringId, playerId).changes > 0;
  },
);

// ---------------------------------------------------------------------------
// #127 — Foraging system (GDD §10.10)
// ---------------------------------------------------------------------------

/** A forage-node depletion row (per player). */
export interface ForageNodeRow {
  node_id: string;
  player_id: string;
  depleted_day: number;
}

const selectForageNode = db.prepare(
  `SELECT node_id, player_id, depleted_day FROM forage_nodes WHERE node_id = ? AND player_id = ?`,
);
const upsertForageNode = db.prepare(
  `INSERT INTO forage_nodes (node_id, player_id, depleted_day)
   VALUES (?, ?, ?)
   ON CONFLICT(node_id, player_id) DO UPDATE SET depleted_day = excluded.depleted_day`,
);
const selectForageNodesByPlayerBiomeScreen = db.prepare(
  `SELECT node_id, depleted_day FROM forage_nodes WHERE player_id = ? AND node_id LIKE ?`,
);

/**
 * Try to forage a node for a player. Returns `{ ok: true, food_units, yielded }`
 * when the node is available (fresh or respawned), or `{ ok: false, reason }` when
 * it is still within the respawn window (caller sends 409). Per-player: two
 * players can forage the same node on the same day. Runs in a transaction so the
 * food increment and depletion record are atomic.
 */
export const forage = db.transaction(
  (
    playerId: string,
    nodeId: string,
  ): { ok: true; food_units: number; yielded: number } | { ok: false; reason: string } => {
    const player = getPlayerById(playerId);
    if (!player) return { ok: false, reason: 'Player not found' };

    const row = selectForageNode.get(nodeId, playerId) as ForageNodeRow | undefined;
    if (row !== undefined && player.game_day - row.depleted_day < FORAGE_RESPAWN_DAYS) {
      return { ok: false, reason: 'Node depleted' };
    }

    // Credit food and record depletion in a single transaction.
    updateFoodAdd.run(FORAGE_YIELD, playerId);
    upsertForageNode.run(nodeId, playerId, player.game_day);

    const updated = getPlayerById(playerId)!;
    return { ok: true, food_units: updated.food_units, yielded: FORAGE_YIELD };
  },
);

/**
 * Return all forage node ids matching a biome+screen prefix, each annotated with
 * whether the node is currently depleted for the requesting player. The client uses
 * this on scene load to initialise sprite visual states without a forage attempt.
 *
 * Node ids follow the convention `{screen_id}:{tag}_{n}` — the screen-level
 * prefix is used as a LIKE pattern here (`{screen_id}:%`).
 */
export function getForageStatus(
  playerId: string,
  screenId: string,
): Array<{ node_id: string; depleted: boolean }> {
  // Reject screen ids containing LIKE metacharacters (`%`, `_`) or any character
  // outside the safe [a-z0-9_] screen-id alphabet, so the prefix can be used as a
  // LIKE pattern without injection. (Screen ids in shared/world/forest.ts match this.)
  if (!/^[a-z0-9_]+$/.test(screenId)) {
    return [];
  }
  const player = getPlayerById(playerId);
  if (!player) return [];
  const currentDay = player.game_day;
  const pattern = `${screenId}:%`;
  const rows = selectForageNodesByPlayerBiomeScreen.all(playerId, pattern) as Array<{
    node_id: string;
    depleted_day: number;
  }>;
  return rows.map((r) => ({
    node_id: r.node_id,
    depleted: currentDay - r.depleted_day < FORAGE_RESPAWN_DAYS,
  }));
}

// ---------------------------------------------------------------------------
// #130 — Merchant buy / sell (GDD §10.11)
// ---------------------------------------------------------------------------

/** Triangle-element elements (Fire, Water, Wood) use the T1 premium price. */
const TRIANGLE_ELEMENTS = new Set<number>([ElementEnum.FIRE, ElementEnum.WATER, ElementEnum.WOOD]);

/**
 * Base elements (0–4) the merchant will trade (GDD §10.11). Fusions (5–14),
 * Shadow (15), and any non-base element are rejected by merchantSellRing.
 */
const MERCHANT_TRADEABLE_ELEMENTS = new Set<number>([
  ElementEnum.FIRE,
  ElementEnum.WATER,
  ElementEnum.EARTH,
  ElementEnum.WIND,
  ElementEnum.WOOD,
]);

/** Buy price the merchant charges the player for a Tier 1 ring of the given element. */
export function ringBuyPrice(element: number): number {
  return TRIANGLE_ELEMENTS.has(element)
    ? MERCHANT_RING_BUY_PRICE_T1
    : MERCHANT_RING_BUY_PRICE_NEUTRAL;
}

/**
 * Sell price the merchant pays the player for a ring.
 * Base is element-type determined; XP adds floor(xp / 100) GP on top.
 * The catalog endpoint passes xp=0 to expose the base rate.
 */
export function ringSellPrice(element: number, xp = 0): number {
  const base = TRIANGLE_ELEMENTS.has(element)
    ? MERCHANT_RING_SELL_PRICE_T1
    : MERCHANT_RING_SELL_PRICE_NEUTRAL;
  return base + Math.floor(xp / 100);
}

const updateGold = db.prepare(`UPDATE players SET gold = gold + ? WHERE id = ?`);

/**
 * Buy food from the merchant. Deducts `quantity * FOOD_BUY_PRICE` gold from the
 * player and credits the food. Returns `{ ok: true, gold, food_units }` on
 * success, or `{ ok: false, reason }` (caller sends 400) on insufficient gold.
 */
export const merchantBuyFood = db.transaction(
  (
    playerId: string,
    quantity: number,
  ): { ok: true; gold: number; food_units: number } | { ok: false; reason: string } => {
    const player = getPlayerById(playerId);
    if (!player) return { ok: false, reason: 'Player not found' };
    const cost = quantity * FOOD_BUY_PRICE;
    if (player.gold < cost) {
      return { ok: false, reason: `Insufficient gold (need ${cost}, have ${player.gold})` };
    }
    updateGold.run(-cost, playerId);
    updateFoodAdd.run(quantity, playerId);
    const updated = getPlayerById(playerId)!;
    return { ok: true, gold: updated.gold, food_units: updated.food_units };
  },
);

/**
 * Buy a Tier 1 ring from the merchant. Deducts `ringBuyPrice(element)` gold.
 * Returns `{ ok: true, gold, ring }` or `{ ok: false, reason }`. 400-worthy
 * reasons: insufficient gold, carry cap exceeded, unknown element.
 */
export const merchantBuyRing = db.transaction(
  (
    playerId: string,
    element: number,
  ):
    | { ok: true; gold: number; ring: RingRow }
    | { ok: false; reason: string } => {
    const player = getPlayerById(playerId);
    if (!player) return { ok: false, reason: 'Player not found' };

    const price = ringBuyPrice(element);
    if (player.gold < price) {
      return { ok: false, reason: `Insufficient gold (need ${price}, have ${player.gold})` };
    }

    // Carry cap check: use getCarryCap (XP-derived) so the limit stays in sync
    // with packLoadout and the PUT /api/loadout validation.
    const carried = (selectCarryByOwner.all(playerId) as RingRow[]).length;
    if (carried >= getCarryCap(playerId)) {
      return { ok: false, reason: 'Carry cap full' };
    }

    // Deduct gold, create ring, mark it as carried.
    updateGold.run(-price, playerId);
    const ringId = uuidv4();
    insertRing.run({
      id: ringId,
      owner_id: playerId,
      element,
      tier: 1,
      max_uses: 3,
      current_uses: 3,
      xp: 0,
    });
    updateRingCarry.run(1, ringId);

    const updated = getPlayerById(playerId)!;
    const ring = (selectRingById.get(ringId) as RingRow)!;
    return { ok: true, gold: updated.gold, ring };
  },
);

/**
 * Sell food to the merchant. Credits `quantity * FOOD_SELL_PRICE` gold.
 * Returns `{ ok: true, gold, food_units }` or `{ ok: false, reason }` on
 * insufficient food.
 */
export const merchantSellFood = db.transaction(
  (
    playerId: string,
    quantity: number,
  ): { ok: true; gold: number; food_units: number } | { ok: false; reason: string } => {
    const player = getPlayerById(playerId);
    if (!player) return { ok: false, reason: 'Player not found' };
    if (player.food_units < quantity) {
      return {
        ok: false,
        reason: `Insufficient food (need ${quantity}, have ${player.food_units})`,
      };
    }
    updateFoodDeduct.run(quantity, playerId);
    updateGold.run(quantity * FOOD_SELL_PRICE, playerId);
    const updated = getPlayerById(playerId)!;
    return { ok: true, gold: updated.gold, food_units: updated.food_units };
  },
);

/**
 * Sell a ring to the merchant. The ring must be owned by the player and NOT
 * currently assigned to any loadout slot. Returns `{ ok: true, gold }` on success
 * or `{ ok: false, reason }` on failure.
 */
export const merchantSellRing = db.transaction(
  (
    playerId: string,
    ringId: string,
  ): { ok: true; gold: number } | { ok: false; reason: string } => {
    const ring = selectRingById.get(ringId) as RingRow | undefined;
    if (!ring || ring.owner_id !== playerId) {
      return { ok: false, reason: 'Ring not found or not owned' };
    }
    // Merchants trade any tier of base-element ring (fusions 5–14 and Shadow 15
    // are still rejected). The tier gate is removed so XP-earned tiers fetch
    // their full XP-adjusted price.
    if (!MERCHANT_TRADEABLE_ELEMENTS.has(ring.element)) {
      return { ok: false, reason: 'Ring type not accepted by merchant' };
    }
    // Block selling a ring that is currently equipped in a battle-hand slot.
    const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
    if (loadout) {
      for (const slot of SLOT_KEYS) {
        if (slot === 'player_id') continue;
        if (loadout[slot] === ringId) {
          return { ok: false, reason: 'Cannot sell a ring currently equipped in a battle slot' };
        }
      }
    }
    const price = ringSellPrice(ring.element, ring.xp);
    deleteRing.run(ringId, playerId);
    updateGold.run(price, playerId);
    const updated = getPlayerById(playerId)!;
    return { ok: true, gold: updated.gold };
  },
);
