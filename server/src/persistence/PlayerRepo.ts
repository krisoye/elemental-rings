import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { ElementEnum } from '../../../shared/types';
import { fusionOf } from '../game/Fusions';
import {
  SPIRIT_PER_RING_USE,
  SPIRIT_BASE,
  XP_SCALER,
  TIER1_XP_CAP,
  TIER2_XP_CAP,
  TIER2_MAX_USES,
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

const STARTER_TIER = 1;
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
// #63 — Sanctum anchor (the waystone the overworld spawns the player beside).
const selectAnchor = db.prepare(
  `SELECT anchored_waystone FROM players WHERE id = ?`,
);
const updateAnchor = db.prepare(
  `UPDATE players SET anchored_waystone = ? WHERE id = ?`,
);

const selectByUsername = db.prepare(`SELECT * FROM players WHERE username = ?`);
const selectById = db.prepare(
  `SELECT id, username, gold, game_day, carry_cap, spirit_max, spirit_current, food_units
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
const selectCarryCap = db.prepare(`SELECT carry_cap FROM players WHERE id = ?`);

// #41 — spirit / food economy.
const selectSpiritFood = db.prepare(
  `SELECT spirit_current, spirit_max, food_units FROM players WHERE id = ?`,
);
const updateSpiritDeduct = db.prepare(
  `UPDATE players SET spirit_current = spirit_current - ? WHERE id = ?`,
);
// spirit_max is XP-derived (SPIRIT_BASE + floor(SUM(ring xp) / XP_SCALER)), so
// restoring sets spirit_current to the freshly computed max, not the column.
const selectAggregateRingXp = db.prepare(
  `SELECT COALESCE(SUM(xp), 0) AS xp_sum FROM rings WHERE owner_id = ?`,
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
 * The XP cap a ring of the given tier must reach before it can be fused
 * (GDD §5.1). Tier 1 → 100, Tier 2 → 300. Tiers without a defined cap (Tier 3,
 * the current ceiling) cannot be a fusion parent.
 */
function xpCapForTier(tier: number): number | null {
  if (tier === 1) return TIER1_XP_CAP;
  if (tier === 2) return TIER2_XP_CAP;
  return null;
}

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
 * Fuse two maxed parent rings into a single higher-tier fusion ring (GDD §5).
 *
 * Validates (in order) ownership of both rings, that each parent has reached its
 * tier's XP cap, and that the two base elements form a valid v4 fusion pair. On
 * success it inserts the new fusion ring (element from fusionOf, combined parent
 * XP, tier 2, full Tier 2 uses), then permanently deletes both parents — nulling
 * each out of any loadout slot first so the FK constraint holds. Runs in a single
 * transaction, so any thrown validation error leaves the inventory untouched.
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

    for (const ring of [r1, r2]) {
      const cap = xpCapForTier(ring.tier);
      if (cap === null) {
        throw new Error(`Ring ${ring.id} cannot be fused at its tier`);
      }
      if (ring.xp < cap) {
        throw new Error(
          `Ring ${ring.id} has not reached XP cap (needs ${cap}, has ${ring.xp})`,
        );
      }
    }

    const fusionElement = fusionOf(r1.element, r2.element);
    if (fusionElement === null) {
      throw new Error('These two elements do not form a valid fusion');
    }

    const newRingId = uuidv4();
    insertRing.run({
      id: newRingId,
      owner_id: playerId,
      element: fusionElement,
      tier: 2,
      max_uses: TIER2_MAX_USES,
      current_uses: TIER2_MAX_USES,
      xp: r1.xp + r2.xp,
    });

    // Consume both parents: null them out of any loadout slot, then delete.
    for (const ring of [r1, r2]) {
      clearRingFromLoadout(playerId, ring.id);
      deleteRing.run(ring.id, playerId);
    }

    return newRingId;
  },
);

/** The player's carry cap (rings carryable on an expedition). */
export function getCarryCap(playerId: string): number {
  const row = selectCarryCap.get(playerId) as { carry_cap: number } | undefined;
  return row?.carry_cap ?? 0;
}

/**
 * Atomically set the carried set to EXACTLY the given ring ids. Validates that
 * the count is within the player's carry_cap and that every id is owned by the
 * player; throws otherwise. All other rings have their in_carry flag cleared.
 */
export const packLoadout = db.transaction(
  (playerId: string, ringIds: string[]): void => {
    const cap = getCarryCap(playerId);
    // Dedupe defensively so a repeated id can't inflate the count past the cap.
    const unique = Array.from(new Set(ringIds));
    if (unique.length > cap) {
      throw new Error(`carry cap exceeded (${unique.length} > ${cap})`);
    }
    const ownerRings = new Set(
      (selectRingsByOwner.all(playerId) as RingRow[]).map((r) => r.id),
    );
    for (const id of unique) {
      if (!ownerRings.has(id)) throw new Error(`ring ${id} not owned by player`);
    }
    clearCarryForOwner.run(playerId);
    for (const id of unique) updateRingCarry.run(1, id);
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
 * Single query returning both the raw aggregate ring XP and the derived
 * spirit_max. Use this wherever both values are needed to avoid a second
 * DB round-trip.
 *   aggregate_xp = SUM(rings.xp)
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
