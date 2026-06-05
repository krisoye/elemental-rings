import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import {
  makeRing,
  insertRing as insertRingRow,
  getRingById,
  getRingsForPlayer,
  setRingUses as setRingUsesRow,
  addRingUses as addRingUsesRow,
  setRingEscrow,
  setRingCarry,
  setRingHeartSlot,
  deleteRingOwned,
} from './ringRows';
import { ElementEnum, DIFFICULTY_MULTIPLIERS, type DifficultyTier, type SlotKey } from '../../../shared/types';
import { fusionOf, isFusion, componentsOf } from '../game/Fusions';
import { tierForXp, naturalMaxUses } from '../game/Tiers';
import { getTalisman } from '../../../shared/talismans';
import {
  SPIRIT_PER_RING_USE,
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
  CORE_SLOTS,
  SPARE_SLOTS,
} from '../game/constants';

// EPIC #378 — the default spare-ring max (kept as the DB-level fallback literal,
// matching the schema DEFAULT 9 / the db.ts migration DEFAULT 9). Not exported
// as game logic — callers use getSpareRingMax(playerId) instead.
const SPARE_RING_MAX_DEFAULT = SPARE_SLOTS;

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
  /** EPIC #279 — player-chosen difficulty tier; scales spirit_max. */
  difficulty: DifficultyTier;
  /**
   * EPIC #302 — the ring equipped in the Heart slot, or null when empty. The
   * referenced ring carries heart_slot = 1 and is excluded from spirit sums.
   */
  heart_ring_id: string | null;
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
  /**
   * #263 — element index of the higher-XP parent at fusion time (the dominant
   * component, rendered top/left on the two-tone fused card). -1 for base rings
   * and pre-migration / AI-granted fusions (which render in static order).
   */
  parent_dominant: number;
  /**
   * EPIC #302 — 1 when this ring is equipped in the player's Heart slot. A heart
   * ring is excluded from spirit_max and from carry/Reliquary counts (it is held
   * with in_carry = 0). At most one ring per player carries heart_slot = 1.
   */
  heart_slot: number;
  /**
   * EPIC #378 — 1 when this ring was received as a WON ring and has not yet been
   * assigned to a slot or discarded. Cleared by clearPendingFlag when the player
   * accepts it as a spare, assigns it to a slot, or discards it. 0 for all normal
   * rings.
   */
  pending: number;
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

// EPIC #302 — starter inventory: 11 rings total. One Wind ring lands in the
// dedicated Heart slot (in_carry = 0, heart_slot = 1); five fill the battle hand
// (in_carry = 1); five non-heart resting rings seed the Reliquary (in_carry = 0,
// heart_slot = 0) so spirit_max > 0 from the start. GET /api/me filters heart_slot
// rings from the rings array, so clients see exactly 10 rings. Canonical integer
// values come from shared ElementEnum (FIRE=0, WATER=1, EARTH=2, WIND=3, WOOD=4)
// — do not hardcode the integers here.
//
//   Heart  → Wind   (in_carry = 0, heart_slot = 1)
//   Thumb  → Earth   a1 → Wind   a2 → Wind   d1 → Earth   d2 → Earth
//   Reliquary (in_carry = 0, heart_slot = 0): Fire, Water, Earth, Wind, Earth
const STARTER_HEART_ELEMENT = ElementEnum.WIND;
const STARTER_BATTLE_HAND: ReadonlyArray<{ slot: SlotKey; element: number }> = [
  { slot: 'thumb', element: ElementEnum.EARTH },
  { slot: 'a1', element: ElementEnum.WIND },
  { slot: 'a2', element: ElementEnum.WIND },
  { slot: 'd1', element: ElementEnum.EARTH },
  { slot: 'd2', element: ElementEnum.EARTH },
];
// EPIC #378 — five starter resting rings seed the Reliquary so spirit_max > 0
// from the first session. These are in_carry=0, heart_slot=0 (Reliquary rings).
// The mix includes FIRE and WATER so all four base elements are represented in
// the starter inventory.
const STARTER_RELIQUARY_ELEMENTS: ReadonlyArray<number> = [
  ElementEnum.FIRE,
  ElementEnum.WATER,
  ElementEnum.EARTH,
  ElementEnum.WIND,
  ElementEnum.EARTH,
];

// GDD §4.2 / EPIC #173 C8 — starter rings begin at tier 0 with 3 max uses (xp=0).
// Tier is XP-derived; a fresh ring at 0 XP is tier 0, and naturalMaxUses(0) = 3.
const STARTER_TIER = 0;
const STARTER_MAX_USES = 3;

const insertPlayer = db.prepare(
  `INSERT INTO players (id, username, password_hash) VALUES (?, ?, ?)`,
);
// #299 — base ring INSERT now lives in ringRows.ts (insertRingRow). Fusion
// inserts persist the extra parent_dominant column via their own statement below.
// #263 — fusion inserts also persist parent_dominant (the higher-XP parent's
// element at fusion time). Base/granted rings keep the schema DEFAULT (-1) via
// insertRing, signalling "render in static order".
const insertFusionRing = db.prepare(
  `INSERT INTO rings (id, owner_id, element, tier, max_uses, current_uses, xp, parent_dominant)
   VALUES (@id, @owner_id, @element, @tier, @max_uses, @current_uses, @xp, @parent_dominant)`,
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

// EPIC #302 — heart slot. The pointer column on players + the heart ring lookup.
const updateHeartRingId = db.prepare(`UPDATE players SET heart_ring_id = ? WHERE id = ?`);
const selectHeartRingId = db.prepare(`SELECT heart_ring_id FROM players WHERE id = ?`);
// The full row of the player's equipped heart ring (joined via the pointer).
const selectHeartRing = db.prepare(
  `SELECT r.* FROM rings r
   JOIN players p ON p.heart_ring_id = r.id
   WHERE p.id = ?`,
);
// SUM(xp) across ALL owned rings (no in_carry / heart_slot filter) — the total
// lifetime XP figure surfaced on /api/me (EPIC #302).
const selectTotalRingXp = db.prepare(
  `SELECT COALESCE(SUM(xp), 0) AS xp_sum FROM rings WHERE owner_id = ?`,
);

const selectByUsername = db.prepare(`SELECT * FROM players WHERE username = ?`);
const selectById = db.prepare(
  `SELECT id, username, gold, game_day, carry_cap, spirit_max, spirit_current, food_units,
          reliquary_cap, reliquary_shards, difficulty, heart_ring_id
   FROM players WHERE id = ?`,
);
// #299 — selectRingsByOwner / selectRingById / single-ring mutators now live in
// ringRows.ts (getRingsForPlayer, getRingById, setRingUses, addRingUses,
// setRingEscrow, setRingCarry, deleteRingOwned).
const selectLoadout = db.prepare(`SELECT * FROM loadout WHERE player_id = ?`);

/** Mint one starter ring (tier 0, full uses, no XP) and return its id. */
function insertStarterRing(playerId: string, element: number): string {
  return insertRingRow(
    playerId,
    makeRing({
      element,
      tier: STARTER_TIER,
      xp: 0,
      maxUses: STARTER_MAX_USES,
      currentUses: STARTER_MAX_USES,
      escrowed: 0,
    }),
  );
}

/**
 * Create a player with the full starter package (EPIC #302): the player row, 6
 * starter rings (one Wind ring in the Heart slot, five rings filling the battle
 * hand), a default loadout, and the heart_ring_id pointer. Runs in a single
 * transaction so a partial registration can never persist.
 *
 * The Reliquary starts empty (no resting rings) and the heart ring is excluded
 * from the spirit sum, so a fresh player has spirit_max = 0 — earned only by
 * winning rings and retiring them to the Reliquary.
 *
 * @param username unique handle (uniqueness enforced by the DB).
 * @param passwordHash bcrypt hash of the player's password.
 * @returns the new player's id.
 */
export const createPlayer = db.transaction(
  (username: string, passwordHash: string): string => {
    const playerId = uuidv4();
    insertPlayer.run(playerId, username, passwordHash);

    // Heart-slot ring: a Wind ring that rests (in_carry = 0) outside the battle
    // hand and Reliquary. heart_slot = 1 excludes it from the spirit/carry sums,
    // and players.heart_ring_id points at it as the authoritative equipped ring.
    const heartRingId = insertStarterRing(playerId, STARTER_HEART_ELEMENT);
    setRingHeartSlot(heartRingId, 1);
    updateHeartRingId.run(heartRingId, playerId);

    // Battle hand: one ring per named slot (Thumb=Earth, A1/A2=Wind, D1/D2=Earth).
    const defaultSlots = {
      thumb: '' as string,
      a1: '' as string,
      a2: '' as string,
      d1: '' as string,
      d2: '' as string,
    };
    for (const { slot, element } of STARTER_BATTLE_HAND) {
      defaultSlots[slot] = insertStarterRing(playerId, element);
    }
    insertLoadout.run({ player_id: playerId, ...defaultSlots });

    // #40 — the five battle-slot rings start carried (in_carry = 1). The heart
    // ring is intentionally NOT carried — it lives in the dedicated Heart slot.
    for (const ringId of Object.values(defaultSlots)) setRingCarry(ringId, 1);

    // EPIC #378 — five starter Reliquary rings (in_carry=0, heart_slot=0). These
    // seed spirit_max > 0 from the first session and give the player rings to swap
    // into carry. insertStarterRing defaults to in_carry=0, heart_slot=0, so no
    // extra flags are needed. GET /api/me filters heart_slot rings from the rings
    // array, giving clients exactly 10 visible rings (5 carried + 5 resting).
    for (const element of STARTER_RELIQUARY_ELEMENTS) {
      insertStarterRing(playerId, element);
    }

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

/**
 * #263 — a serialized ring row plus its dominant-first component order. For a
 * fusion, `fusionParents` is `[dominant, other]` (the higher-XP parent at fusion
 * time leads — top/left on the two-tone card) when `parent_dominant >= 0`, else
 * the static `componentsOf` order. For a base ring it is `[]`. Every fused-ring
 * renderer treats index 0 as top/left (EPIC #256 Contracts).
 */
export interface SerializedRing extends RingRow {
  fusionParents: number[];
}

/**
 * #263 — the dominant-first component pair for a fusion ring, or the static
 * `componentsOf` order when no parent context was recorded.
 *
 * Returns `[dominant, other]` when `ring.parent_dominant >= 0` (a human fusion
 * whose higher-XP parent we persisted); `other` is the fusion's component that
 * is not `dominant`. Falls back to the static `componentsOf(element)` order for a
 * pre-migration fusion (`-1`), an AI/granted fused thumb (no parent XP), or a
 * base ring (which yields its single element).
 */
export function orderedParents(ring: Pick<RingRow, 'element' | 'parent_dominant'>): number[] {
  const components = componentsOf(ring.element);
  if (ring.parent_dominant < 0 || components.length < 2) return components;
  // Guard against a stored dominant that is not actually a component of this
  // fusion (corrupt/legacy row): fall back to the static order.
  if (!components.includes(ring.parent_dominant)) return components;
  const other = components.find((c) => c !== ring.parent_dominant)!;
  return [ring.parent_dominant, other];
}

/**
 * All rings owned by a player, each annotated with its dominant-first
 * `fusionParents` (#263) so the client renders the two-tone card without
 * recomputing fusion logic. Base rings carry `fusionParents: []`.
 */
export function getRingsByOwner(ownerId: string): SerializedRing[] {
  const rows = getRingsForPlayer(ownerId);
  return rows.map((r) => ({
    ...r,
    fusionParents: isFusion(r.element) ? orderedParents(r) : [],
  }));
}

/** A player's loadout row, or undefined if none exists. */
export function getLoadout(playerId: string): LoadoutRow | undefined {
  return selectLoadout.get(playerId) as LoadoutRow | undefined;
}

// ---------------------------------------------------------------------------
// Prepared statements for new functions (Camp / Loadout / Staking)
// ---------------------------------------------------------------------------

const updateLoadoutSlot = db.prepare(
  `UPDATE loadout SET thumb = @thumb, a1 = @a1, a2 = @a2, d1 = @d1, d2 = @d2 WHERE player_id = @player_id`,
);
const updateRingXP = db.prepare(`UPDATE rings SET xp = xp + ? WHERE id = ?`);
// EPIC #173 C2 — awardXP applies XP, the recomputed cached tier, and any
// natural-crossing max_uses bonus in one statement so they never desync.
const applyXpAndTierGrant = db.prepare(
  `UPDATE rings SET xp = ?, tier = ?, max_uses = ? WHERE id = ?`,
);
const setRingXPAbsolute = db.prepare(`UPDATE rings SET xp = ? WHERE id = ? AND owner_id = ?`);
const updatePlayerGold = db.prepare(`UPDATE players SET gold = gold + ? WHERE id = ?`);
// #299 — updateRingEscrowed / deleteRing now live in ringRows.ts (setRingEscrow,
// deleteRingOwned).
const updateRingOwner = db.prepare(
  `UPDATE rings SET owner_id = ?, escrowed = 0, in_carry = 0 WHERE id = ? AND owner_id = ?`,
);
const updateGameDay = db.prepare(`UPDATE players SET game_day = game_day + 1 WHERE id = ?`);

// #40 — carry flag management. #299 — single-ring in_carry set now lives in
// ringRows.ts (setRingCarry).
const selectCarryByOwner = db.prepare(`SELECT * FROM rings WHERE owner_id = ? AND in_carry = 1`);
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
// aggregate_xp is the raw sum of XP across the player's Reliquary rings
// (in_carry = 0). It still drives ring-tier display in the HUD — it is NOT the
// spirit_max input anymore (EPIC #279 moved that to the max_uses sum below).
const selectAggregateRingXp = db.prepare(
  `SELECT COALESCE(SUM(xp), 0) AS xp_sum FROM rings WHERE owner_id = ? AND in_carry = 0 AND heart_slot = 0`,
);
// EPIC #279 — spirit_max is now derived from the SUM of max_uses across the
// player's Reliquary rings (in_carry = 0), scaled by their difficulty multiplier.
// Must match the boot-time recompute filter in db.ts. Carried rings are excluded.
const selectReliquaryMaxUsesSum = db.prepare(
  `SELECT COALESCE(SUM(max_uses), 0) AS uses_sum FROM rings WHERE owner_id = ? AND in_carry = 0 AND heart_slot = 0`,
);
// #397 — resting rings eligible for Sanctum RECHARGE (in_carry=0, heart_slot=0,
// escrowed=0). Ordered most-depleted first, then stable by id, to match spare ordering.
const selectReliquaryResting = db.prepare(
  `SELECT * FROM rings
   WHERE owner_id = ? AND in_carry = 0 AND heart_slot = 0 AND escrowed = 0
   ORDER BY (max_uses - current_uses) DESC, id ASC`,
);
// EPIC #279 — read the player's difficulty tier for the spirit_max multiplier.
const selectPlayerDifficulty = db.prepare(`SELECT difficulty FROM players WHERE id = ?`);
const updateSpiritCurrent = db.prepare(
  `UPDATE players SET spirit_current = ? WHERE id = ?`,
);
const updateSpiritMax = db.prepare(`UPDATE players SET spirit_max = ? WHERE id = ?`);
// EPIC #279 — set the player's difficulty tier; clamp spirit_current to a new max.
const updatePlayerDifficulty = db.prepare(`UPDATE players SET difficulty = ? WHERE id = ?`);
const clampSpiritCurrentMax = db.prepare(
  `UPDATE players SET spirit_current = MIN(spirit_current, ?) WHERE id = ?`,
);
const updateFoodAdd = db.prepare(`UPDATE players SET food_units = food_units + ? WHERE id = ?`);
const updateFoodDeduct = db.prepare(`UPDATE players SET food_units = food_units - ? WHERE id = ?`);
// #299 — add-uses (clamped to max) now lives in ringRows.ts (addRingUsesRow).

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

    const ownerRings = new Set(getRingsForPlayer(playerId).map((r) => r.id));

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

    // EPIC #378 — spare-cap guard: compute the net spare-grid delta from the
    // slot changes in `partial`. A slot cleared to null displaces its current ring
    // to spare (+addingToSpare); a slot assigned a new ring pulls that ring out of
    // spare (−removingFromSpare). Ring-for-ring swaps are net-zero. Rings not
    // currently in the spare set are no-ops on the respective side.
    const addingToSpare: string[] = [];
    const removingFromSpare: string[] = [];
    const currentSpareIds = new Set(getSpareIds(playerId));
    for (const key of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
      if (!(key in partial)) continue;
      const oldVal = current[key] as string | null;
      const newVal = slots[key] as string | null;
      if (oldVal === newVal) continue;
      // Slot cleared: the old ring (if any) moves to spare.
      if (newVal === null && oldVal !== null) addingToSpare.push(oldVal);
      // Slot assigned: the new ring (if in spare) leaves spare.
      if (newVal !== null && currentSpareIds.has(newVal)) removingFromSpare.push(newVal);
    }
    assertSpareWithinMax(playerId, { addingToSpare, removingFromSpare });

    updateLoadoutSlot.run({
      player_id: playerId,
      thumb: slots.thumb,
      a1: slots.a1,
      a2: slots.a2,
      d1: slots.d1,
      d2: slots.d2,
    });

    // EPIC #378 — pending lifecycle: clear the pending flag when the WON ring is
    // assigned to any loadout slot (the overflow is resolved by slotting the ring).
    const pendingId = getPendingRingId(playerId);
    if (pendingId) {
      for (const key of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
        if (slots[key] === pendingId) {
          clearPendingFlag(pendingId);
          break;
        }
      }
    }

    return selectLoadout.get(playerId) as LoadoutRow;
  },
);

/**
 * Persist the current in-battle uses for a ring, clamped to the ring's own
 * max_uses to prevent transient in-battle passives from persisting above capacity.
 */
export function saveRingUses(ringId: string, currentUses: number): void {
  setRingUsesRow(ringId, currentUses);
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
  const ring = getRingById(ringId);
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
  addRingUsesRow(ringId, n);
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
    addRingUsesRow(ringId, affordableUses);
  },
);

/** Set or clear the escrowed flag on a ring (true → 1, false → 0). */
export function setEscrowed(ringId: string, escrowed: boolean): void {
  setRingEscrow(ringId, escrowed ? 1 : 0);
}

/**
 * Grant a new ring (tier 1, full uses) to a player. Used when the human
 * player beats the AI — the AI has no DB ring to transfer, so we create one
 * matching the AI's thumb element (GDD §9.1: winner receives the staked ring).
 *
 * EPIC #378 — WON ring overflow model: the ring enters carry immediately with
 * `in_carry=1, pending=1`. The spare count may reach spare_ring_max+1 (exactly
 * one overflow slot). This path intentionally bypasses `assertSpareWithinMax`
 * — the overflow is by design and requires the player to resolve it.
 */
// Awards a WON ring: enters carry immediately (in_carry=1, pending=1). For non-pending grants use insertRingRow directly.
export function grantRing(
  ownerId: string,
  element: number,
  tier = STARTER_TIER,
  maxUses = STARTER_MAX_USES,
  xp = 0,
): string {
  return insertRingRow(
    ownerId,
    makeRing({
      element,
      tier,
      xp,
      maxUses,
      currentUses: maxUses,
      escrowed: 0,
      inCarry: 1,
      pending: 1,
    }),
  );
}

/**
 * Transfer ownership of a staked ring from one player to another. Nulls out
 * any loadout slots that referenced the ring on the losing player. The ring's
 * XP travels with it (GDD §9.1).
 *
 * EPIC #378 — WON ring overflow model: after ownership changes the ring enters
 * the winner's carry with `in_carry=1, pending=1`. The spare count may reach
 * spare_ring_max+1 (one overflow slot). This path intentionally bypasses
 * `assertSpareWithinMax` — the overflow is by design.
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
    // updateRingOwner resets escrowed=0, in_carry=0. After ownership changes we
    // set in_carry=1 and pending=1 to place the ring in the winner's carry as
    // overflow (WON ring — one slot beyond spare_ring_max, by design).
    updateRingOwner.run(toPlayerId, ringId, fromPlayerId);
    setRingCarry(ringId, 1);
    setPendingStmt.run(ringId);
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
    deleteRingOwned(ringId, fromPlayerId);
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
  setRingCarry(ringId, inCarry ? 1 : 0);
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
    // EPIC #302 — if the discarded ring is the equipped heart ring, null the
    // pointer in the same transaction so it never dangles. Spirit is unaffected:
    // the heart ring was already excluded from the spirit sum.
    if (getHeartRingId(playerId) === ringId) {
      updateHeartRingId.run(null, playerId);
    }
    // EPIC #378 — pending lifecycle: clear the pending flag before deletion so it
    // is never left dangling (the row will not exist after deleteRingOwned, but
    // clearing beforehand is the safe, explicit contract).
    clearPendingFlag(ringId);
    const info = deleteRingOwned(ringId, playerId);
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
 * Validates (in order): ownership of both distinct rings, that NEITHER parent is
 * itself a fusion ring (`isFusion(element)` — a fusion cannot be fused again),
 * that EACH parent independently sits at Tier 1 or above (`tierForXp(xp) >= 1`,
 * i.e. ≥ 500 XP), and that the two base elements form a valid fusion pair. The
 * parents do NOT have to share a tier (#390 dropped that requirement). On
 * success it inserts the new fusion ring — element from `fusionOf`, XP
 * the sum of both parents, tier recomputed from that summed XP via {@link
 * tierForXp}, and `max_uses = naturalMaxUses(fusedTier) = 3 + tier` — the same
 * pure-XP rule every natural ring obeys, so a fused ring is no exception to the
 * `max_uses === 3 + tierForXp(xp)` invariant (`current_uses` starts full). It
 * then permanently deletes both parents, nulling each out of any loadout slot
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
    const r1 = getRingById(ringId1);
    const r2 = getRingById(ringId2);
    if (!r1 || r1.owner_id !== playerId || !r2 || r2.owner_id !== playerId) {
      throw new Error('Ring not found or not owned');
    }

    // §4.6 — neither parent may itself be a fusion ring (a fusion cannot be fused
    // again). Checked BEFORE the pair check so it yields a distinct message rather
    // than the generic "do not form a valid fusion".
    if (isFusion(r1.element) || isFusion(r2.element)) {
      throw new Error('A fusion ring is already a fusion and cannot be fused again');
    }

    // §4.6 — each parent must independently reach at least Tier 1 (≥ 500 XP).
    // The same-tier requirement was dropped (#390): two rings of DIFFERENT tiers
    // may fuse so long as both clear the Tier-1 floor. Tier is derived live from
    // XP (not the cached column).
    if (tierForXp(r1.xp) < 1 || tierForXp(r2.xp) < 1) {
      throw new Error('Both rings must reach Tier 1 to fuse');
    }

    const fusionElement = fusionOf(r1.element, r2.element);
    if (fusionElement === null) {
      throw new Error('These two elements do not form a valid fusion');
    }

    // §4.6 — XP additive; tier from the summed XP; max_uses = 3 + tier, the same
    // pure-XP rule every natural ring follows. Combined XP can cross into the next
    // tier, in which case the child lands at that higher tier's full uses (which
    // may exceed either parent — intended).
    const fusedXp = r1.xp + r2.xp;
    const fusedTier = tierForXp(fusedXp);
    const fusedMaxUses = naturalMaxUses(fusedTier);

    // #263 — persist the dominant (higher-XP) parent element so the two-tone card
    // renders the parent the player leveled first (top/left). A STRICT higher-XP
    // parent sets the dominant; on equal XP we store -1 so the card falls through
    // to the static FUSION_PARENTS order as the deterministic, argument-order-
    // independent tiebreak (EPIC #256 Contracts / AC #3).
    const parentDominant = r1.xp > r2.xp ? r1.element : r2.xp > r1.xp ? r2.element : -1;

    const newRingId = uuidv4();
    insertFusionRing.run({
      id: newRingId,
      owner_id: playerId,
      element: fusionElement,
      tier: fusedTier,
      max_uses: fusedMaxUses,
      current_uses: fusedMaxUses,
      xp: fusedXp,
      parent_dominant: parentDominant,
    });

    // Consume both parents: null them out of any loadout slot, then delete.
    for (const ring of [r1, r2]) {
      clearRingFromLoadout(playerId, ring.id);
      deleteRingOwned(ring.id, playerId);
    }

    return newRingId;
  },
);

// ---------------------------------------------------------------------------
// EPIC #378 — Spare-grid cap primitives (replaces assertCarryWithinCap)
// ---------------------------------------------------------------------------

/**
 * The per-player cap on spare-grid rings. Reads the `spare_ring_max` column;
 * falls back to SPARE_RING_MAX_DEFAULT (9) when the row is missing.
 */
export function getSpareRingMax(playerId: string): number {
  const row = db
    .prepare('SELECT spare_ring_max FROM players WHERE id = ?')
    .get(playerId) as { spare_ring_max: number } | undefined;
  return row?.spare_ring_max ?? SPARE_RING_MAX_DEFAULT;
}

/**
 * The ids of every ring currently in the spare grid for this player: rings with
 * in_carry=1 that are NOT assigned to any of the 5 loadout slots. These are the
 * rings that count toward `spare_ring_max`.
 */
export function getSpareIds(playerId: string): string[] {
  const carry = getCarry(playerId);
  const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
  const loadoutIds = new Set<string>();
  if (loadout) {
    for (const slot of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
      const id = loadout[slot];
      if (id) loadoutIds.add(id);
    }
  }
  return carry.filter((r) => !loadoutIds.has(r.id)).map((r) => r.id);
}

/**
 * The number of spare-grid rings the player would have after applying the given
 * delta. Uses a Set so repeated ids in the delta arrays are deduplicated.
 *
 * @param addingToSpare - ring ids that would enter the spare grid (e.g. a cleared
 *   battle slot's old ring, an old heart ring released to spare).
 * @param removingFromSpare - ring ids that would leave the spare grid (e.g. a ring
 *   assigned to a battle slot, a spare ring moved to the heart slot).
 */
export function spareCountAfter(
  playerId: string,
  { addingToSpare = [], removingFromSpare = [] }: {
    addingToSpare?: string[];
    removingFromSpare?: string[];
  } = {},
): number {
  const set = new Set(getSpareIds(playerId));
  for (const id of removingFromSpare) set.delete(id);
  for (const id of addingToSpare) set.add(id);
  return set.size;
}

/**
 * Throws `'spare grid full (n > max)'` if the post-delta spare count would
 * exceed `spare_ring_max`. Clearing a battle slot does NOT free spare capacity —
 * only rings that leave the spare grid via `removingFromSpare` do.
 */
export function assertSpareWithinMax(
  playerId: string,
  delta: { addingToSpare?: string[]; removingFromSpare?: string[] } = {},
): void {
  const n = spareCountAfter(playerId, delta);
  const max = getSpareRingMax(playerId);
  if (n > max) throw new Error(`spare grid full (${n} > ${max})`);
}

/**
 * Throws `'Reliquary full'` if adding the given rings to the Reliquary (while
 * removing the specified rings from it) would exceed `reliquary_cap`.
 *
 * Used by the `packLoadout` reliquary portion (extracted from the former inline
 * `resultingReliquary > reliquaryCap` check in #182).
 */
export function assertReliquaryWithinMax(
  playerId: string,
  delta: { addingToReliquary?: string[]; removingFromReliquary?: string[] } = {},
): void {
  const { addingToReliquary = [], removingFromReliquary = [] } = delta;
  const currentCount = getReliquaryCount(playerId);
  const set = new Set<string>();
  // Build a virtual set by size: +1 per adding id (if not already counted),
  // -1 per removing id. We use a Set of adding/removing ids for deduplication
  // since getReliquaryCount returns a scalar (no id list available here).
  // Net delta: unique adds minus unique removes that might be in the Reliquary.
  const addSet = new Set(addingToReliquary);
  const removeSet = new Set(removingFromReliquary);
  // Remove any overlap: if same id is in both, it is net-zero.
  for (const id of addSet) if (removeSet.has(id)) { addSet.delete(id); removeSet.delete(id); }
  const netDelta = addSet.size - removeSet.size;
  const resulting = currentCount + netDelta;
  const cap = getReliquaryCap(playerId);
  if (resulting > cap) throw new Error('Reliquary full');
}

// EPIC #378 — module-level prepared statements for the pending-flag lifecycle.
// Both are module-level to avoid re-preparing on every call (same pattern as
// all other single-column mutators in this file).
const setPendingStmt = db.prepare('UPDATE rings SET pending = 1 WHERE id = ?');
const clearPendingStmt = db.prepare('UPDATE rings SET pending = 0 WHERE id = ?');

/**
 * Clear the `pending` flag on a ring (set pending=0). Called when a WON ring
 * is accepted as a regular spare (PUT /api/rings/:ringId/accept), assigned to
 * a slot, or discarded.
 */
export function clearPendingFlag(ringId: string): void {
  clearPendingStmt.run(ringId);
}

/**
 * The id of the player's pending WON ring (the ring with pending=1), or null
 * when no WON ring awaits resolution. At most one ring per player holds pending=1
 * at any time.
 */
export function getPendingRingId(playerId: string): string | null {
  const row = db
    .prepare('SELECT id FROM rings WHERE owner_id = ? AND pending = 1 LIMIT 1')
    .get(playerId) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * The player's carry cap (rings carryable on an expedition). Derived from the
 * per-player spare cap: carry_cap = CORE_SLOTS(5) + spare_ring_max. The
 * playerId parameter is required because spare_ring_max is per-player.
 */
export function getCarryCap(playerId: string): number {
  return CORE_SLOTS + getSpareRingMax(playerId);
}

/**
 * Atomically set the carried set to EXACTLY the given ring ids. Validates that
 * the count is within the player's spare_ring_max and that every id is owned by
 * the player; throws otherwise. All other rings have their in_carry flag cleared.
 *
 * #182 — Reliquary cap guard: after setting the new carry set, the number of
 * resting (non-carried, non-escrowed) rings must not exceed reliquary_cap.
 * Throws 'Reliquary full' when the resulting resting count would exceed the cap.
 *
 * EPIC #378 — spare-grid guard: uses assertSpareWithinMax so only spare rings
 * (in_carry=1 AND not in any loadout slot) are counted. Clearing a battle slot
 * does NOT free spare capacity.
 */
export const packLoadout = db.transaction(
  (playerId: string, ringIds: string[]): void => {
    // Dedupe defensively so a repeated id can't inflate the count past the cap.
    const unique = Array.from(new Set(ringIds));
    const ownerRings = getRingsForPlayer(playerId);
    const ownerRingSet = new Set(ownerRings.map((r) => r.id));
    for (const id of unique) {
      if (!ownerRingSet.has(id)) throw new Error(`ring ${id} not owned by player`);
    }

    // EPIC #378 — spare-cap guard. Compute the new spare set: rings in `unique`
    // that are NOT assigned to any loadout slot. Compare against current spare set.
    const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
    const loadoutSlotIds = new Set<string>();
    if (loadout) {
      for (const slot of ['thumb', 'a1', 'a2', 'd1', 'd2'] as const) {
        const id = loadout[slot];
        if (id) loadoutSlotIds.add(id);
      }
    }
    const nonLoadoutInUnique = unique.filter((id) => !loadoutSlotIds.has(id));
    assertSpareWithinMax(playerId, {
      addingToSpare: nonLoadoutInUnique,
      removingFromSpare: getSpareIds(playerId),
    });

    // #182 — Reliquary cap guard (EPIC #378: extracted via assertReliquaryWithinMax).
    // Count rings that will rest (owned non-escrow non-heart minus the new carry set).
    const ownedNonEscrowed = (
      db.prepare('SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND escrowed = 0 AND heart_slot = 0')
        .get(playerId) as { cnt: number }
    ).cnt;
    const resultingReliquary = ownedNonEscrowed - unique.length;
    // Use assertReliquaryWithinMax by expressing the delta as the resulting resting
    // count vs. the cap. We add a direct inline cap check here because the full
    // delta-based primitive needs the pre/post sets; the packLoadout path already
    // computed resultingReliquary directly, so we call getReliquaryCap and throw
    // with the canonical message.
    const relCapForPack = getReliquaryCap(playerId);
    if (resultingReliquary > relCapForPack) {
      throw new Error('Reliquary full');
    }

    clearCarryForOwner.run(playerId);
    for (const id of unique) setRingCarry(id, 1);
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
      'SELECT COUNT(*) as cnt FROM rings WHERE owner_id = ? AND in_carry = 0 AND escrowed = 0 AND heart_slot = 0',
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
 * Both the raw aggregate ring XP (for HUD ring-tier display) and the derived
 * spirit_max (EPIC #279). Use this wherever both values are needed.
 *   aggregate_xp = SUM(xp) WHERE in_carry = 0        -- Reliquary rings only
 *   spirit_max   = SUM(max_uses) WHERE in_carry = 0
 *                  × DIFFICULTY_MULTIPLIERS[player.difficulty]
 * An empty Reliquary yields spirit_max = 0 by design — a new player earns their
 * first spirit by winning a ring and retiring it to the Reliquary. There is no
 * floor or starting grant.
 */
export function getSpiritStats(playerId: string): { aggregateXp: number; spiritMax: number } {
  const xpRow = selectAggregateRingXp.get(playerId) as { xp_sum: number } | undefined;
  const aggregateXp = xpRow?.xp_sum ?? 0;
  const usesRow = selectReliquaryMaxUsesSum.get(playerId) as { uses_sum: number } | undefined;
  const usesSum = usesRow?.uses_sum ?? 0;
  const diffRow = selectPlayerDifficulty.get(playerId) as { difficulty: string } | undefined;
  const tier = (diffRow?.difficulty ?? 'seeker') as DifficultyTier;
  const multiplier = DIFFICULTY_MULTIPLIERS[tier] ?? DIFFICULTY_MULTIPLIERS.seeker;
  return { aggregateXp, spiritMax: usesSum * multiplier };
}

/** Return the raw sum of XP across all rings owned by the player. */
export function getAggregateXp(playerId: string): number {
  return getSpiritStats(playerId).aggregateXp;
}

/** Weighted-average XP of the player's carried battle hand (#244). Thumb is
 *  weighted 50%; the two attack slots share 25%; the two defense slots share 25%.
 *  Null slots contribute 0. A fully empty hand returns 0. */
export function getBattleHandAvgXp(playerId: string): number {
  const loadout = getLoadout(playerId);
  if (!loadout) return 0;
  const rings = getCarry(playerId);
  const byId = new Map(rings.map((r) => [r.id, r]));
  const xp = (id: string | null): number => (id ? (byId.get(id)?.xp ?? 0) : 0);
  const thumbXp = xp(loadout.thumb);
  const atkAvg = (xp(loadout.a1) + xp(loadout.a2)) / 2;
  const defAvg = (xp(loadout.d1) + xp(loadout.d2)) / 2;
  return thumbXp * 0.5 + atkAvg * 0.25 + defAvg * 0.25;
}

// ---------------------------------------------------------------------------
// EPIC #302 — Heart slot
// ---------------------------------------------------------------------------

/** EPIC #302 — release targets for a ring displaced out of the Heart slot. */
export type HeartReleaseTarget = 'reliquary' | 'spare' | 'thumb' | 'a1' | 'a2' | 'd1' | 'd2';

/** The battle-hand slots a displaced heart ring can be swapped directly into. */
const BATTLE_SLOTS: ReadonlyArray<SlotKey> = ['thumb', 'a1', 'a2', 'd1', 'd2'];

function isBattleSlot(target: HeartReleaseTarget): target is SlotKey {
  return (BATTLE_SLOTS as ReadonlyArray<string>).includes(target);
}

/**
 * The ring currently equipped in the player's Heart slot (EPIC #302), or null
 * when the slot is empty. Joins players.heart_ring_id → rings, so a stale pointer
 * (ring deleted) yields null.
 */
export function getHeartRing(playerId: string): RingRow | null {
  return (selectHeartRing.get(playerId) as RingRow | undefined) ?? null;
}

/** The id of the player's equipped heart ring, or null when the slot is empty. */
function getHeartRingId(playerId: string): string | null {
  const row = selectHeartRingId.get(playerId) as { heart_ring_id: string | null } | undefined;
  return row?.heart_ring_id ?? null;
}

/**
 * EPIC #302 — equip `ringId` into the Heart slot (or, for a battle-slot
 * `releaseTo`, perform a slot-for-slot swap). Atomically routes the displaced
 * heart ring and recomputes spirit. Runs in a single transaction.
 *
 * Semantics:
 *  - Battle-slot `releaseTo` ('thumb'|'a1'|'a2'|'d1'|'d2'): a slot-for-slot swap
 *    — `ringId` is IGNORED. The current heart ring (if any) is assigned to that
 *    loadout slot and carried; the ring previously in that slot (if any) becomes
 *    the new heart ring (heart_slot = 1, in_carry = 0).
 *  - 'reliquary' (default): the new `ringId` becomes the heart ring; the old
 *    heart ring rests in the Reliquary (heart_slot = 0, in_carry = 0).
 *  - 'spare': as 'reliquary', but the old heart ring is carried (in_carry = 1).
 *    Throws 'carry cap exceeded' if carrying it would exceed the carry cap.
 *  - When `ringId` is null/undefined with a non-battle `releaseTo`, the heart
 *    slot is simply cleared (the old heart ring is routed per `releaseTo`).
 *
 * @throws Error when `ringId` is provided but not owned by the player, or when a
 *   'spare' release would exceed the carry cap.
 */
export const setHeartRing = db.transaction(
  (playerId: string, ringId: string | null, releaseTo: HeartReleaseTarget = 'reliquary'): void => {
    const oldHeartId = getHeartRingId(playerId);

    if (isBattleSlot(releaseTo)) {
      // Slot-for-slot swap. `ringId` is ignored: the new heart ring is whatever
      // currently sits in the target battle slot.
      const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
      const displacedId = (loadout?.[releaseTo] ?? null) as string | null;

      // The displaced battle ring leaves the carry first (it becomes the heart
      // ring), so the net carried count is unchanged when saveLoadout runs its
      // carry-cap guard — even for a player sitting exactly at the cap.
      if (displacedId) {
        setRingCarry(displacedId, 0);
        setRingHeartSlot(displacedId, 1);
      }
      // Old heart ring (if any) takes the battle slot and becomes carried.
      if (oldHeartId) {
        setRingHeartSlot(oldHeartId, 0);
        setRingCarry(oldHeartId, 1);
      }
      // Put the old heart ring into the target slot (null clears it when there
      // was no heart ring to place). saveLoadout enforces the one-slot rule and
      // validates ownership.
      saveLoadout(playerId, { [releaseTo]: oldHeartId });

      // The displaced battle ring (if any) is the new heart ring; an empty slot
      // leaves the heart slot empty.
      updateHeartRingId.run(displacedId, playerId);
    } else {
      // Reliquary / spare release. Validate the incoming ring (when provided).
      if (ringId) {
        const ring = getRingById(ringId);
        if (!ring || ring.owner_id !== playerId) {
          throw new Error('ring not found or not owned');
        }
      }

      // Route the displaced old heart ring out of the slot.
      if (oldHeartId && oldHeartId !== ringId) {
        setRingHeartSlot(oldHeartId, 0);
        if (releaseTo === 'spare') {
          // EPIC #378 — spare-grid guard: old heart joins carry (spare grid).
          // Use spare-membership to compute the accurate net delta:
          //   - Spare ring → heart: old heart joins spare (+1), incoming leaves spare (−1) → net zero.
          //   - Battle-slot ring → heart: old heart joins spare (+1), no ring leaves spare → net +1.
          //   - null incoming: old heart joins spare (+1), nothing leaves spare → net +1.
          // Using in_carry===1 (old guard) would treat a battle-slot ring (in_carry=1,
          // NOT in spare) the same as a spare ring, silently bypassing the cap.
          const incomingIsSpare = ringId ? getSpareIds(playerId).includes(ringId) : false;
          if (incomingIsSpare) {
            // net-zero: spare ring leaves spare (−1), old heart joins spare (+1)
            assertSpareWithinMax(playerId, {
              addingToSpare: [oldHeartId],
              removingFromSpare: [ringId!],
            });
          } else {
            // battle-slot ring → heart: old heart joins spare (+1), no ring leaves spare
            // (or null incoming: new ring from nowhere → old heart joins spare +1)
            assertSpareWithinMax(playerId, {
              addingToSpare: [oldHeartId],
              removingFromSpare: [],
            });
          }
          setRingCarry(oldHeartId, 1);
        } else {
          // 'reliquary' — rest it (in_carry = 0).
          setRingCarry(oldHeartId, 0);
        }
      }

      // Equip the new ring (if any) into the heart slot.
      if (ringId) {
        // EPIC #378 — pending lifecycle: clear the pending flag when the WON ring
        // is equipped to the Heart slot (overflow resolved by heart assignment).
        const incomingRing = getRingById(ringId);
        if (incomingRing?.pending === 1) {
          clearPendingFlag(ringId);
        }
        setRingCarry(ringId, 0);
        setRingHeartSlot(ringId, 1);
        updateHeartRingId.run(ringId, playerId);
      } else {
        updateHeartRingId.run(null, playerId);
      }
    }

    // Heart rings are excluded from the spirit sum, so equipping/unequipping one
    // changes spirit_max. Recompute and clamp the gauge to the new ceiling.
    const spiritMax = refreshSpiritMax(playerId);
    clampSpiritCurrent(playerId, spiritMax);
  },
);

/**
 * #318 — permanently destroy a player's heart ring when it shatters on a 0-HP
 * loss (GDD §6.7). Deletes the ring row and nulls players.heart_ring_id in a
 * single transaction. The heart ring rests with in_carry = 0 and heart_slot = 1
 * — it is never in a loadout slot — so no loadout-slot nulling is needed.
 * spirit_max is unaffected: a heart ring is already excluded from the spirit sum
 * (heart_slot = 1), so no recompute is required (mirrors discardRing's reasoning).
 */
export const destroyHeartRing = db.transaction(
  (heartRingId: string, playerId: string): void => {
    deleteRingOwned(heartRingId, playerId); // delete the ring row
    updateHeartRingId.run(null, playerId); // null players.heart_ring_id
  },
);

/** Total lifetime XP across ALL rings the player owns (no carry/heart filter). */
export function getTotalRingXp(playerId: string): number {
  const row = selectTotalRingXp.get(playerId) as { xp_sum: number } | undefined;
  return row?.xp_sum ?? 0;
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
 * Set the player's difficulty tier (EPIC #279). A bare persistence write — the
 * caller validates the tier (via isDifficultyTier) and is responsible for
 * recomputing spirit_max and clamping spirit_current afterwards.
 */
export function setPlayerDifficulty(playerId: string, tier: DifficultyTier): void {
  updatePlayerDifficulty.run(tier, playerId);
}

/**
 * Clamp spirit_current down to `max` if it currently exceeds it (EPIC #279). Used
 * after a difficulty change lowers spirit_max so the gauge never reads above its
 * cap. Never raises spirit_current — a single guarded UPDATE.
 */
export function clampSpiritCurrent(playerId: string, max: number): void {
  clampSpiritCurrentMax.run(max, playerId);
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
    const ring = getRingById(ringId);
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

    addRingUsesRow(ringId, restored);
    updateSpiritDeduct.run(restored * SPIRIT_PER_RING_USE, playerId);
    return { ok: true, restored };
  },
);

/**
 * Recharge every carried ring in priority order (Thumb → A1 → A2 → D1 → D2,
 * then heart ring, then spares most-depleted first), stopping when spirit reaches
 * 0. Returns the remaining spirit after the operation.
 *
 * When `includeReliquary` is `true` (Sanctum RECHARGE path — #397), the resting
 * pool (`in_carry=0, heart_slot=0, escrowed=0`) is recharged last, after all
 * carried rings, most-depleted first. When false/absent, behavior is byte-identical
 * to the pre-#397 implementation (carried rings only; reliquary rings untouched).
 */
export const rechargeAllWithSpirit = db.transaction(
  (playerId: string, includeReliquary = false): number => {
    const loadout = selectLoadout.get(playerId) as LoadoutRow | undefined;
    const carried = selectCarryByOwner.all(playerId) as RingRow[];
    const byId = new Map(carried.map((r) => [r.id, r]));

    // Priority list: battle-slot rings first (in slot order), then the equipped
    // heart ring (EPIC #302 — it is in_carry = 0, so it is not in `carried`),
    // then spares.
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
    // EPIC #302 — fold the heart ring in after the battle hand. It rests with
    // in_carry = 0, so it never appears in `carried`; fetch its full row directly.
    const heartRing = getHeartRing(playerId);
    if (heartRing && !seen.has(heartRing.id)) {
      ordered.push(heartRing);
      seen.add(heartRing.id);
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

    // #397 — Sanctum RECHARGE: append resting pool after all carried rings.
    // The SQL already orders most-depleted first, then stable by id.
    if (includeReliquary) {
      const resting = selectReliquaryResting.all(playerId) as RingRow[];
      for (const r of resting) {
        if (!seen.has(r.id)) {
          ordered.push(r);
          seen.add(r.id);
        }
      }
    }

    let spirit = getSpiritAndFood(playerId).spirit_current;
    for (const ring of ordered) {
      if (spirit <= 0) break;
      const deficit = ring.max_uses - ring.current_uses;
      if (deficit === 0) continue;
      const affordable = Math.floor(spirit / SPIRIT_PER_RING_USE);
      const restored = Math.min(deficit, affordable);
      if (restored === 0) break;
      addRingUsesRow(ring.id, restored);
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
 * Atomically consume the ring-key and record the shrine unlock in one transaction
 * (#231). If ring deletion fails (ring not found / not owned), the shrine row is
 * never written. Uses better-sqlite3 nested-transaction (SAVEPOINT) semantics so
 * the outer call and {@link consumeRing}'s inner transaction compose safely. Returns
 * false if the ring could not be consumed; the route should respond 400 in that case.
 */
export const consumeAndUnlockShrine = db.transaction(
  (playerId: string, ringId: string, shrineId: string, day: number): boolean => {
    if (!consumeRing(playerId, ringId)) return false;
    upsertShrineUnlock.run(playerId, shrineId, day);
    return true;
  },
);

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
    return deleteRingOwned(ringId, playerId).changes > 0;
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
    const ringId = insertRingRow(
      playerId,
      makeRing({
        element,
        tier: 1,
        xp: 0,
        maxUses: 3,
        currentUses: 3,
        escrowed: 0,
      }),
    );
    setRingCarry(ringId, 1);

    const updated = getPlayerById(playerId)!;
    const ring = getRingById(ringId)!;
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
    const ring = getRingById(ringId);
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
    deleteRingOwned(ringId, playerId);
    updateGold.run(price, playerId);
    const updated = getPlayerById(playerId)!;
    return { ok: true, gold: updated.gold };
  },
);
