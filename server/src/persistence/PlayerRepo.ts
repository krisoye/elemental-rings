import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { ElementEnum } from '../../../shared/types';

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
