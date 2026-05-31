import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { signToken, requireAuth, verifyToken } from '../auth/auth';
import { makeRng } from '../game/ai/AIProfiles';
import { previewOpponent, AI_PERSONALITIES } from '../game/ai/AILoadout';
import {
  createPlayer,
  getPlayerByUsername,
  getPlayerById,
  getRingsByOwner,
  getLoadout,
  saveLoadout,
  sleepRecharge,
  packLoadout,
  discardRing,
  spendFood,
  restoreSpirit,
  setSpiritCurrent,
  rechargeRingWithSpirit,
  rechargeAllWithSpirit,
  getSpiritAndFood,
  spendSpirit,
  spendSpiritAtomic,
  getSpiritStats,
  lockStake,
  unlockStake,
  fuseRings,
  setRingXP,
  addGold,
  getAttunements,
  attuneWaystone,
  getAnchor,
  setAnchor,
  getTalismanLoadout,
  equipTalisman,
  rechargeNecklace,
  getCarry,
  getCarryCap,
  getSpareCapacity,
  getDefeatedNpcs,
  forage,
  getForageStatus,
  merchantBuyFood,
  merchantBuyRing,
  merchantSellFood,
  merchantSellRing,
  ringBuyPrice,
  ringSellPrice,
  getReliquaryCap,
  getReliquaryShards,
  getReliquaryCount,
  addReliquaryShardToReliquary,
  grantRing,
  grantShard,
} from '../persistence/PlayerRepo';
import { NPC_SPAWNS, hashNpcId } from '../persistence/NpcSpawns';
import {
  FOOD_PER_SLEEP,
  FOOD_BUY_PRICE,
  FOOD_SELL_PRICE,
} from '../game/constants';
import { WAYSTONES, getWaystone } from '../../../shared/waystones';
import { getTalisman } from '../../../shared/talismans';
import { blinkCost } from '../../../shared/blink';

/**
 * Build the /api/waystones payload for a player: the catalog joined with the
 * player's attunement set, aggregate XP, and current spirit. `meetsThreshold` is
 * the §10.8 teleport-gate predicate — true when the player holds at least the
 * destination's `spiritCost` (#87 Part B; replaces the old aggregate-XP gate).
 * The GET and POST share this one shape so the client can render and disable
 * unaffordable destinations in a single round-trip.
 */
function buildWaystonePayload(playerId: string): {
  aggregateXp: number;
  spiritCurrent: number;
  anchor: string;
  waystones: Array<{
    id: string;
    name: string;
    xpThreshold: number;
    spiritCost: number;
    attuned: boolean;
    meetsThreshold: boolean;
  }>;
} {
  const { aggregateXp } = getSpiritStats(playerId);
  const { spirit_current } = getSpiritAndFood(playerId);
  const attuned = new Set(getAttunements(playerId));
  return {
    aggregateXp,
    spiritCurrent: spirit_current,
    anchor: getAnchor(playerId),
    waystones: WAYSTONES.map((w) => ({
      id: w.id,
      name: w.name,
      xpThreshold: w.xpThreshold,
      spiritCost: w.spiritCost,
      attuned: attuned.has(w.id),
      meetsThreshold: spirit_current >= w.spiritCost,
    })),
  };
}

const BCRYPT_ROUNDS = 10;

export const apiRouter: Router = Router();

/**
 * POST /auth/register — create a player with starter inventory + default
 * loadout. Returns a signed token and the new player id. 409 if the username
 * is taken; 400 if the body is missing fields.
 */
apiRouter.post('/auth/register', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }
  // Fast-path check before the async bcrypt call; the DB UNIQUE constraint is
  // the authoritative guard (try/catch below handles the concurrent-insert race).
  if (getPlayerByUsername(username)) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const playerId = createPlayer(username, passwordHash);
    const token = signToken({ playerId, username });
    res.status(201).json({ token, playerId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE constraint failed')) {
      res.status(409).json({ error: 'Username already taken' });
    } else {
      res.status(500).json({ error: 'Registration failed' });
    }
  }
});

/**
 * POST /auth/login — verify credentials and return a signed token. 401 on an
 * unknown username or a bad password; 400 if the body is missing fields.
 */
apiRouter.post('/auth/login', async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    res.status(400).json({ error: 'username and password are required' });
    return;
  }

  const player = getPlayerByUsername(username);
  if (!player) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }
  const ok = await bcrypt.compare(password, player.password_hash);
  if (!ok) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const token = signToken({ playerId: player.id, username: player.username });
  res.status(200).json({ token, playerId: player.id });
});

/**
 * GET /api/me — return the authenticated player, their rings, and loadout.
 * Requires a valid Bearer token (enforced by requireAuth → 401 otherwise).
 */
apiRouter.get('/api/me', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const player = getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }
  // One query, both values — aggregate_xp is the raw ring XP sum; spirit_max is
  // derived from it. Both served live so the HUD always reflects current state.
  // #171 — carry_cap is now XP-derived (5 + floor(aggregate_xp/100)); override the
  // DB column so the client always receives the enforced cap, not the stale default.
  // #182 — reliquary fields: cap (from DB column), shards held, and current count.
  const { aggregateXp, spiritMax } = getSpiritStats(playerId);
  res.status(200).json({
    player: {
      ...player,
      spirit_max: spiritMax,
      aggregate_xp: aggregateXp,
      carry_cap: getCarryCap(playerId),
      reliquaryCap: getReliquaryCap(playerId),
      reliquaryShards: getReliquaryShards(playerId),
      reliquaryCount: getReliquaryCount(playerId),
      spareCapacity: getSpareCapacity(playerId),
    },
    rings: getRingsByOwner(playerId),
    loadout: getLoadout(playerId) ?? null,
  });
});

/**
 * POST /api/camp/sleep — spend food to rest: advance game_day by 1 and fully
 * restore the spirit gauge (#41 replaces the old gold cost). 400 if the player
 * has fewer than FOOD_PER_SLEEP food units. Requires auth.
 *
 * CB2 (#180) — this endpoint backs BOTH Sanctum campfire rest AND Anchorage
 * campfire rest. It is location-agnostic: the client calls it wherever the
 * player rests (Sanctum reliquary, Forest/Swamp Anchorage). The
 * reliquary/teleport restriction visible in the Sanctum UI is client-only;
 * the server does not distinguish the rest location.
 */
apiRouter.post('/api/camp/sleep', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const player = getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }
  if (player.food_units < FOOD_PER_SLEEP) {
    res.status(400).json({ error: `Not enough food (need ${FOOD_PER_SLEEP})` });
    return;
  }
  spendFood(playerId, FOOD_PER_SLEEP);
  restoreSpirit(playerId);
  sleepRecharge(playerId);
  // #81 — sleeping at the Sanctum refills the equipped necklace talisman's
  // charges (GDD §14.3). No-op when no necklace is equipped.
  rechargeNecklace(playerId);
  res.status(200).json({
    player: getPlayerById(playerId),
    rings: getRingsByOwner(playerId),
  });
});

/**
 * PUT /api/carry — set the carried set to exactly the given ring ids (#40).
 * Body: { ringIds: string[] }. Returns the full updated ring list. 400 when the
 * count exceeds the carry cap or an id is not owned by the player. Requires auth.
 */
apiRouter.put('/api/carry', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { ringIds } = req.body ?? {};
  if (!Array.isArray(ringIds) || ringIds.some((id) => typeof id !== 'string')) {
    res.status(400).json({ error: 'ringIds must be an array of strings' });
    return;
  }
  try {
    packLoadout(playerId, ringIds as string[]);
    res.status(200).json({ rings: getRingsByOwner(playerId) });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * DELETE /api/rings/:ringId — permanently discard a ring the player owns (#40
 * won-ring prompt Discard choice). Requires auth.
 */
apiRouter.delete('/api/rings/:ringId', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const ringId = req.params.ringId;
  const result = discardRing(playerId, ringId);
  if (!result.ok) {
    res.status(404).json({ error: 'ring not found' });
    return;
  }
  res.status(200).json({ rings: getRingsByOwner(playerId) });
});

/**
 * POST /api/spirit/recharge — recharge one ring using spirit (#41). Body:
 * { ringId: string, uses?: number }. uses defaults to a full top-off. Spends
 * SPIRIT_PER_RING_USE per restored use. 400 when out of spirit or not owned.
 * Requires auth.
 */
apiRouter.post('/api/spirit/recharge', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { ringId, uses } = req.body ?? {};
  if (typeof ringId !== 'string' || !ringId) {
    res.status(400).json({ error: 'ringId is required' });
    return;
  }
  if (uses !== undefined && (typeof uses !== 'number' || uses < 0)) {
    res.status(400).json({ error: 'uses must be a non-negative number' });
    return;
  }
  const result = rechargeRingWithSpirit(playerId, ringId, uses);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  const rings = getRingsByOwner(playerId);
  const ring = rings.find((r) => r.id === ringId);
  res.status(200).json({
    ring,
    restored: result.restored,
    spirit_current: getSpiritAndFood(playerId).spirit_current,
  });
});

/**
 * POST /api/spirit/recharge-all — recharge every carried ring in priority order
 * (Thumb→A1→A2→D1→D2→spares), stopping when spirit hits 0 (#41). No body.
 * Requires auth.
 */
apiRouter.post('/api/spirit/recharge-all', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const spiritRemaining = rechargeAllWithSpirit(playerId);
  res.status(200).json({
    rings: getRingsByOwner(playerId),
    spirit_current: spiritRemaining,
  });
});

/**
 * POST /api/spirit/blink — spend spirit to short-range blink onto an interaction
 * zone (#87 Part A, GDD §12). Body: { distance: number } (pixels travelled). The
 * server computes the authoritative cost via blinkCost(distance), guards that the
 * player holds at least that much spirit, and on success spends it, returning
 * { spirit_current, cost }. 400 { error: 'insufficient spirit' } when the player
 * cannot afford the blink. This is the first non-recharge spirit sink. Requires
 * auth. The client may pre-check with the same blinkCost, but the server is the
 * authority — distance is clamped and re-costed here regardless of client input.
 */
apiRouter.post('/api/spirit/blink', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { distance } = req.body ?? {};
  const cost = blinkCost(typeof distance === 'number' ? distance : 0);
  // Atomic check-and-spend (single guarded UPDATE) closes the read→check→spend
  // race two concurrent blinks would otherwise share, which could push spirit
  // negative. false → the balance was insufficient at deduct time.
  if (!spendSpiritAtomic(playerId, cost)) {
    res.status(400).json({ error: 'insufficient spirit' });
    return;
  }
  res.status(200).json({ spirit_current: getSpiritAndFood(playerId).spirit_current, cost });
});

/**
 * PUT /api/loadout — update one or more loadout slots.
 * Body: partial Record<SlotKey, string | null>
 * #171 — rejects when the player's carried-ring count already exceeds the
 * XP-derived carry cap (5 + spareCapacity) so that excess rings cannot be
 * assigned to battle slots.
 * Requires auth.
 */
apiRouter.put('/api/loadout', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  // #171 — carry-cap gate: count carried rings and reject if the cap is already
  // exceeded. This guards against excess carry when spareCapacity has decreased
  // since the rings were first carried (e.g. XP was lost / transferred).
  // Use getCarry() (indexed selectCarryByOwner) rather than a full ring scan.
  const carriedCount = getCarry(playerId).length;
  const cap = getCarryCap(playerId);
  if (carriedCount > cap) {
    const spare = getSpareCapacity(playerId);
    res
      .status(400)
      .json({ error: `carry cap exceeded: ${carriedCount} carried > ${cap} (5 + ${spare} spare)` });
    return;
  }
  const body = req.body ?? {};
  const VALID_SLOTS = new Set(['thumb', 'a1', 'a2', 'd1', 'd2']);
  const partial: Record<string, string | null> = {};
  for (const key of Object.keys(body)) {
    if (!VALID_SLOTS.has(key)) continue;
    const val = body[key];
    if (val !== null && typeof val !== 'string') {
      res.status(400).json({ error: `Invalid value for slot ${key}` });
      return;
    }
    partial[key] = val;
  }
  try {
    const loadout = saveLoadout(playerId, partial);
    res.status(200).json({ loadout });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(400).json({ error: msg });
  }
});

/**
 * POST /api/stake/lock — escrow the player's current thumb ring.
 * Requires auth.
 */
apiRouter.post('/api/stake/lock', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  lockStake(playerId);
  res.status(200).json({ ok: true });
});

/**
 * POST /api/stake/unlock — release the player's current thumb ring from escrow.
 * Requires auth.
 */
apiRouter.post('/api/stake/unlock', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  unlockStake(playerId);
  res.status(200).json({ ok: true });
});

/**
 * GET /api/encounter/preview — returns each AI personality's randomized staked
 * ring (element + tier + XP), the loadout's total XP, and (since #196) the NPC's
 * effective XP scaled to the requesting player's level, so the EncounterScene can
 * color each opponent marker, show what beating them transfers, and render a
 * relative difficulty label before the player commits to a duel.
 *
 * Auth is OPTIONAL (#196): a valid Bearer token scales each opponent to the
 * authenticated player's aggregate XP; no/invalid token falls back to
 * playerAggregateXp = 0 (a fresh opponent), preserving backwards-compat for
 * unauthenticated E2E. The response includes the resolved playerAggregateXp so the
 * client can compute the difficulty label without a second round-trip.
 *
 * Response: {
 *   playerAggregateXp: number,
 *   [AIPersonality]: { element, aiSeed, stakeTier, stakeXp, totalXp, npcEffectiveXp }
 * }
 */
apiRouter.get('/api/encounter/preview', (req: Request, res: Response): void => {
  // Optional auth: read a Bearer token if present and resolve the player's
  // aggregate XP from the DB. Any missing/invalid token → playerAggregateXp = 0.
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : undefined;
  const payload = token ? verifyToken(token) : null;
  const playerAggregateXp = payload ? getSpiritStats(payload.playerId).aggregateXp : 0;

  const baseSeed = Date.now() & 0xffffffff;
  // Derive a deterministic per-personality aiSeed from the base seed so the
  // preview and the actual BattleRoom loadout use identical RNG state.
  // BattleRoom seeds its loadout RNG as makeRng(aiSeed ^ 0x1a2b3c4d); we do
  // the same here so intBetween(0, templates.length-1) returns the same index.
  const preview: Record<
    string,
    | number
    | {
        element: number;
        aiSeed: number;
        stakeTier: number;
        stakeXp: number;
        totalXp: number;
        npcEffectiveXp: number;
      }
  > = { playerAggregateXp };
  AI_PERSONALITIES.forEach((p, i) => {
    const aiSeed = (baseSeed ^ (i * 0xdeadbeef)) & 0xffffffff;
    const loadoutRng = makeRng(aiSeed ^ 0x1a2b3c4d);
    const { element, stakeTier, stakeXp, totalXp, npcEffectiveXp } = previewOpponent(
      p,
      loadoutRng,
      playerAggregateXp,
    );
    preview[p] = { element, aiSeed, stakeTier, stakeXp, totalXp, npcEffectiveXp };
  });
  res.status(200).json(preview);
});

/**
 * POST /api/fusion/combine — fuse two maxed parent rings into a Tier 2 fusion
 * ring (#47, GDD §5). Body: { ringId1, ringId2 }. On success returns the new
 * fusion ring. 400 with a descriptive message on any validation failure
 * (not owned, not at XP cap, invalid pair). Requires auth.
 */
apiRouter.post('/api/fusion/combine', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { ringId1, ringId2 } = req.body ?? {};
  if (typeof ringId1 !== 'string' || !ringId1 || typeof ringId2 !== 'string' || !ringId2) {
    res.status(400).json({ error: 'ringId1 and ringId2 are required' });
    return;
  }
  try {
    const newRingId = fuseRings(playerId, ringId1, ringId2);
    const ring = getRingsByOwner(playerId).find((r) => r.id === newRingId);
    res.status(200).json({ ring });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Fusion failed';
    res.status(400).json({ error: msg });
  }
});

/**
 * GET /api/waystones — the waystone catalog joined with this player's
 * attunements and aggregate XP (#61, GDD §10.7). Each entry reports `attuned`
 * (the player has touched it) and `meetsThreshold` (aggregate XP ≥ its teleport
 * gate). Requires auth.
 */
apiRouter.get('/api/waystones', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  res.status(200).json(buildWaystonePayload(playerId));
});

/**
 * POST /api/waystones/attune — attune the player to a waystone (#61). Body:
 * { waystoneId: string }. 400 when the id is not in the catalog. Idempotent —
 * re-attuning an already-attuned waystone succeeds. Returns the same payload as
 * GET /api/waystones so the client can refresh in one round-trip. Requires auth.
 */
apiRouter.post('/api/waystones/attune', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { waystoneId } = req.body ?? {};
  const def = typeof waystoneId === 'string' ? getWaystone(waystoneId) : undefined;
  if (!def) {
    res.status(400).json({ error: 'Unknown waystone' });
    return;
  }
  attuneWaystone(playerId, waystoneId);
  // GDD §10.7 — revelation waystones unlock their targets on attune (8C.2, #82):
  // attuning the Ironbark Rune also attunes the hidden Forest alcove Anchorage,
  // which has no walking path and is otherwise unreachable. Each revealed id is
  // validated against the catalog so a malformed `reveals` entry is a safe no-op.
  for (const revealedId of def.reveals ?? []) {
    if (getWaystone(revealedId)) attuneWaystone(playerId, revealedId);
  }
  res.status(200).json(buildWaystonePayload(playerId));
});

/**
 * POST /api/teleport — re-anchor the player's Sanctum to a waystone (#63, GDD
 * §10.7/§10.8). Body: { waystoneId: string }. Three rejection cases each return
 * 400: an unknown id, a waystone the player has not attuned, and one whose spirit
 * cost the player cannot afford (§10.8 spirit gate, #87 Part B — replaces the old
 * aggregate-XP gate). On success SPENDS the destination's spiritCost, persists the
 * anchor, and returns { anchor, spirit_current, spiritCost }. Requires auth.
 */
apiRouter.post('/api/teleport', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { waystoneId } = req.body ?? {};
  if (typeof waystoneId !== 'string' || !getWaystone(waystoneId)) {
    res.status(400).json({ error: 'unknown waystone' });
    return;
  }
  if (!getAttunements(playerId).includes(waystoneId)) {
    res.status(400).json({ error: 'not attuned' });
    return;
  }
  const def = getWaystone(waystoneId)!;
  // Atomic check-and-spend: the guarded UPDATE both verifies affordability and
  // deducts in one statement, so two concurrent teleports can't both spend past
  // zero. A zero-cost destination is a no-op that still succeeds. (canTeleport is
  // the pre-check the client mirrors; this is the authoritative deduction.)
  if (!spendSpiritAtomic(playerId, def.spiritCost)) {
    res.status(400).json({ error: `requires ${def.spiritCost} spirit` });
    return;
  }
  setAnchor(playerId, waystoneId);
  res.status(200).json({
    anchor: waystoneId,
    spirit_current: getSpiritAndFood(playerId).spirit_current,
    spiritCost: def.spiritCost,
  });
});

/**
 * POST /api/sanctum/summon — summon the player's Sanctum to an attuned Anchorage
 * (#180, GDD §12 / §14). Body: { anchorageId: string }. Re-anchoring is now a
 * natural ability — no talisman or item required.
 *
 * Cost model: the Sanctum travels FROM its current anchor to the destination, so
 * the player pays the CURRENT anchor's spirit cost. If the Sanctum is already at
 * the destination the cost is 0 (a no-op journey). Spending is atomic (single
 * guarded UPDATE) to prevent concurrent calls from pushing spirit negative.
 *
 * Rejection cases (400):
 *   - anchorageId is not in the waystone catalog
 *   - anchorageId is not attuned by this player
 *   - insufficient spirit (anchor unchanged)
 *
 * Requires auth.
 */
apiRouter.post('/api/sanctum/summon', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { anchorageId } = req.body ?? {};
  // Validate anchorageId is a known waystone.
  if (typeof anchorageId !== 'string' || !getWaystone(anchorageId)) {
    res.status(400).json({ error: 'unknown anchorage' });
    return;
  }
  // Validate the player is attuned to the destination.
  if (!getAttunements(playerId).includes(anchorageId)) {
    res.status(400).json({ error: 'not attuned' });
    return;
  }
  // Cost: the current anchor's spiritCost — the Sanctum travels from there.
  // If already at the destination the cost is 0 (no travel).
  const currentAnchor = getAnchor(playerId);
  const cost = currentAnchor === anchorageId ? 0 : (getWaystone(currentAnchor)?.spiritCost ?? 0);
  // Atomic check-and-spend — false means insufficient spirit; anchor stays put.
  if (!spendSpiritAtomic(playerId, cost)) {
    res.status(400).json({ error: `requires ${cost} spirit` });
    return;
  }
  setAnchor(playerId, anchorageId);
  res.status(200).json({
    anchor: anchorageId,
    spirit_current: getSpiritAndFood(playerId).spirit_current,
    spiritCost: cost,
  });
});

/**
 * POST /api/sanctum/expand-reliquary — spend one Reliquary Shard to expand the
 * Reliquary capacity by RELIQUARY_SHARD_INCREMENT (#182). Atomic: the Shard is
 * consumed and the cap raised in a single transaction; a second concurrent call
 * for the same Shard cannot succeed. Requires auth.
 *
 * 400 { error: 'no Reliquary Shards' } when the player holds 0 Shards.
 * 200 { reliquaryCap, reliquaryShards } on success.
 */
apiRouter.post('/api/sanctum/expand-reliquary', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const expanded = addReliquaryShardToReliquary(playerId);
  if (!expanded) {
    res.status(400).json({ error: 'no Reliquary Shards' });
    return;
  }
  res.status(200).json({
    reliquaryCap: getReliquaryCap(playerId),
    reliquaryShards: getReliquaryShards(playerId),
  });
});

/**
 * GET /api/talisman-loadout — the player's equipped necklace talisman id and its
 * remaining charges (#81, GDD §14.2/§14.3). A fresh player reports
 * { necklaceId: null, necklaceCharges: 0 }. Requires auth.
 */
apiRouter.get('/api/talisman-loadout', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  res.status(200).json(getTalismanLoadout(playerId));
});

/**
 * POST /api/talisman/equip — equip a talisman to the necklace slot, resetting its
 * charges to the catalog max (#81). Body: { talismanlId, slot }. 400 on an unknown
 * talisman id or a talisman whose slot does not match the requested slot. Returns
 * { necklaceId, necklaceCharges }. Requires auth.
 */
apiRouter.post('/api/talisman/equip', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { talismanlId, slot } = req.body ?? {};
  if (typeof talismanlId !== 'string' || slot !== 'necklace') {
    res.status(400).json({ error: 'talismanlId (string) and slot="necklace" are required' });
    return;
  }
  const def = getTalisman(talismanlId);
  if (!def || def.slot !== 'necklace') {
    res.status(400).json({ error: 'Unknown necklace talisman' });
    return;
  }
  res.status(200).json(equipTalisman(playerId, talismanlId, 'necklace'));
});

/**
 * GET /api/overworld/npcs?biome=<biome>&screen=<screen> — the NPCs currently
 * present on the requested Forest-region screen for this player (#83, #99,
 * GDD §10.5 / §10.15). Hides any NPC the player has already defeated when it is
 * permanent (respawnDays === 0) or its respawn period has not yet elapsed
 * (game_day − defeated_day < respawnDays). Each visible NPC reports its stable
 * previewed stake element (so the overworld can color the marker) and its tile
 * center in world pixels (tx*32+16, ty*32+16). Requires auth.
 *
 * 8E.3 (#99) — `screen` scopes the roster to one screen of the multi-screen
 * overworld, so the client only loads the NPCs on the screen it is rendering.
 * `biome` without `screen` is a 400 (the multi-screen overworld must always name
 * its current screen). `screen` alone (no biome) is permitted as a global lookup.
 */
// 16px after the #149/#159 Forest/Swamp 16px map migration; spawn tx/ty in
// NpcSpawns were halved to preserve world-pixel positions.
const TILE_SIZE = 16;
apiRouter.get('/api/overworld/npcs', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const biome = typeof req.query.biome === 'string' ? req.query.biome : undefined;
  const screen = typeof req.query.screen === 'string' ? req.query.screen : undefined;

  if (biome && !screen) {
    res.status(400).json({ error: 'screen required' });
    return;
  }

  const player = getPlayerById(playerId);
  if (!player) {
    res.status(404).json({ error: 'Player not found' });
    return;
  }
  const defeated = getDefeatedNpcs(playerId);

  const visible = NPC_SPAWNS.filter(
    (npc) => (!biome || npc.biome === biome) && (!screen || npc.screen === screen),
  ).filter((npc) => {
    const defeatedDay = defeated.get(npc.id);
    if (defeatedDay === undefined) return true; // never beaten → always present
    // Permanent NPC stays hidden; periodic NPC hidden until its respawn elapses.
    if (npc.respawnDays === 0) return false;
    return player.game_day - defeatedDay >= npc.respawnDays;
  });

  // Element is now fixed in the spawn table (npc.element) — no longer derived from
  // the personality RNG. aiSeed is still returned for BattleRoom loadout seeding.
  const npcs = visible.map((npc) => {
    const aiSeed = hashNpcId(npc.id);
    return {
      id: npc.id,
      personality: npc.personality,
      type: npc.type,
      element: npc.element,
      spriteFrame: npc.spriteFrame,
      x: npc.tx * TILE_SIZE + TILE_SIZE / 2,
      y: npc.ty * TILE_SIZE + TILE_SIZE / 2,
      aiSeed,
    };
  });

  res.status(200).json(npcs);
});

// ───────────────────────────────────────────────────────────────────────────
// #127 — Foraging endpoints (GDD §10.10)
// ───────────────────────────────────────────────────────────────────────────

/**
 * POST /api/overworld/forage — harvest a berry node. Body: { node_id: string }.
 * Per-player depletion: two players can forage the same node on the same day.
 * 409 when the node is within its respawn window for this player. Requires auth.
 */
apiRouter.post('/api/overworld/forage', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { node_id } = req.body ?? {};
  if (typeof node_id !== 'string' || !node_id) {
    res.status(400).json({ error: 'node_id is required' });
    return;
  }
  const result = forage(playerId, node_id);
  if (!result.ok) {
    // Distinguish "depleted" (409) from other errors (400).
    if (result.reason === 'Node depleted') {
      res.status(409).json({ error: result.reason });
    } else {
      res.status(400).json({ error: result.reason });
    }
    return;
  }
  res.status(200).json({ food_units: result.food_units, yielded: result.yielded });
});

/**
 * GET /api/overworld/forage-status?screen=<screenId> — returns the depletion
 * state of every node the player has ever foraged on the given screen. Nodes that
 * have never been foraged are not returned (they are implicitly available). Client
 * uses this on scene load to set initial sprite visuals. Requires auth.
 */
apiRouter.get('/api/overworld/forage-status', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const screen = typeof req.query.screen === 'string' ? req.query.screen : undefined;
  if (!screen) {
    res.status(400).json({ error: 'screen query parameter is required' });
    return;
  }
  const nodes = getForageStatus(playerId, screen);
  res.status(200).json({ nodes });
});

// ───────────────────────────────────────────────────────────────────────────
// #130 — Merchant endpoints (GDD §10.11)
// ───────────────────────────────────────────────────────────────────────────

/** Element name → integer index map for merchant buy/sell body parsing. */
const ELEMENT_NAME_MAP: Record<string, number> = {
  fire: 0,
  water: 1,
  earth: 2,
  wind: 3,
  wood: 4,
};

/**
 * GET /api/merchant/catalog — the fixed merchant inventory with buy and sell
 * prices. No auth required (prices are public). Returns food prices and a ring
 * entry per base element (Tier 1 only for MVP).
 */
apiRouter.get('/api/merchant/catalog', (_req: Request, res: Response): void => {
  const rings = Object.entries(ELEMENT_NAME_MAP).map(([name, element]) => ({
    element: name,
    elementIndex: element,
    tier: 1,
    buyPrice: ringBuyPrice(element),
    sellPrice: ringSellPrice(element),
  }));
  res.status(200).json({
    food: { buyPrice: FOOD_BUY_PRICE, sellPrice: FOOD_SELL_PRICE },
    rings,
  });
});

/**
 * POST /api/merchant/buy — buy food or a Tier 1 ring from the merchant.
 * Body: { item: 'food', quantity: number } | { item: 'ring', element: string, tier: 1 }
 * 400 on insufficient gold, carry cap full, or unknown element. Requires auth.
 */
apiRouter.post('/api/merchant/buy', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const body = req.body ?? {};

  if (body.item === 'food') {
    const quantity = typeof body.quantity === 'number' ? Math.floor(body.quantity) : 0;
    if (quantity <= 0) {
      res.status(400).json({ error: 'quantity must be a positive integer' });
      return;
    }
    const result = merchantBuyFood(playerId, quantity);
    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({ gold: result.gold, food_units: result.food_units });

  } else if (body.item === 'ring') {
    if (typeof body.element !== 'string' || !(body.element in ELEMENT_NAME_MAP)) {
      res.status(400).json({ error: 'element must be one of: fire, water, earth, wind, wood' });
      return;
    }
    const element = ELEMENT_NAME_MAP[body.element];
    const result = merchantBuyRing(playerId, element);
    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({ gold: result.gold, ring: result.ring });

  } else {
    res.status(400).json({ error: 'item must be "food" or "ring"' });
  }
});

/**
 * POST /api/merchant/sell — sell food or a ring to the merchant.
 * Body: { item: 'food', quantity: number } | { item: 'ring', ring_id: string }
 * 400 on insufficient food, ring not owned, or ring in active battle slot. Requires auth.
 */
apiRouter.post('/api/merchant/sell', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const body = req.body ?? {};

  if (body.item === 'food') {
    const quantity = typeof body.quantity === 'number' ? Math.floor(body.quantity) : 0;
    if (quantity <= 0) {
      res.status(400).json({ error: 'quantity must be a positive integer' });
      return;
    }
    const result = merchantSellFood(playerId, quantity);
    if (!result.ok) {
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({ gold: result.gold, food_units: result.food_units });

  } else if (body.item === 'ring') {
    if (typeof body.ring_id !== 'string' || !body.ring_id) {
      res.status(400).json({ error: 'ring_id is required' });
      return;
    }
    const result = merchantSellRing(playerId, body.ring_id);
    if (!result.ok) {
      // "equipped" → 400; "not found" → 400 (same status; caller can inspect message)
      res.status(400).json({ error: result.reason });
      return;
    }
    res.status(200).json({ gold: result.gold });

  } else {
    res.status(400).json({ error: 'item must be "food" or "ring"' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Test-only routes. Mounted ONLY when E2E_TEST_ROUTES=1 (set by the Playwright
// webServer env). Never available in production. These exist because some
// server guards are unreachable through normal play and would otherwise be
// untestable end-to-end — e.g. the spirit gauge can hold at most ~15 spent uses
// across a full loadout (5 rings × 3 uses), so it can never legitimately reach
// 0 against the spirit_max of 30, leaving the "no spirit" recharge guard with no
// gameplay path to exercise it.
// ───────────────────────────────────────────────────────────────────────────
if (process.env.E2E_TEST_ROUTES === '1') {
  /**
   * POST /api/test/mint-token — provision a fresh player exactly like
   * /auth/register (starter inventory + default loadout + forest_entry
   * attunement via createPlayer) but WITHOUT bcrypt, then return a signed token.
   * This skips the deliberately-slow bcrypt hash on the hot path that every E2E
   * test hits to seed auth, which dominates per-test setup once the suite runs
   * in parallel. The resulting player is indistinguishable from a registered one
   * for all downstream reads (rings/loadout/attunement all seeded). No body.
   * Test-only.
   */
  apiRouter.post('/api/test/mint-token', (_req: Request, res: Response): void => {
    // Unique handle so concurrent workers never collide on the username UNIQUE.
    const username = `e2e_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Constant placeholder hash — login is never exercised against E2E players,
    // so a real bcrypt hash is pure waste here.
    const playerId = createPlayer(username, 'e2e-no-hash');
    const token = signToken({ playerId, username });
    res.json({ token, playerId });
  });

  /**
   * POST /api/test/create-battle-room — mint a unique room key for the keyed
   * PvP matchmaking flow (#67). With `gameServer.define('battle').filterBy(
   * ['e2eRoomId'])`, two contexts that joinOrCreate('battle', { e2eRoomId }) with
   * the SAME id pair into one isolated room — so parallel Playwright workers
   * never cross-pair. No reservation is needed (filterBy handles matching); this
   * route just centralizes id generation. No body. Test-only.
   */
  apiRouter.post('/api/test/create-battle-room', (_req: Request, res: Response): void => {
    res.json({ roomId: `e2e_${Date.now()}_${Math.random().toString(36).slice(2)}` });
  });

  /**
   * POST /api/test/drain-spirit — set the authenticated player's spirit to 0 so
   * the no-spirit recharge guard can be asserted deterministically. Test-only.
   */
  apiRouter.post('/api/test/drain-spirit', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { spirit_current } = getSpiritAndFood(playerId);
    if (spirit_current > 0) spendSpirit(playerId, spirit_current);
    res.status(200).json({ spirit_current: getSpiritAndFood(playerId).spirit_current });
  });

  /**
   * POST /api/test/set-ring-xp — set a ring's XP to an absolute value so a
   * parent ring can be deterministically maxed for fusion. Rings start at xp=0
   * with no normal-play path to a precise XP cap, so the fusion E2E suite needs
   * this hook. Body: { ringId, xp }. Test-only.
   */
  apiRouter.post('/api/test/set-ring-xp', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { ringId, xp } = req.body ?? {};
    if (typeof ringId !== 'string' || !ringId || typeof xp !== 'number' || xp < 0) {
      res.status(400).json({ error: 'ringId (string) and xp (non-negative number) are required' });
      return;
    }
    const ok = setRingXP(playerId, ringId, xp);
    if (!ok) {
      res.status(404).json({ error: 'ring not found' });
      return;
    }
    res.status(200).json({ rings: getRingsByOwner(playerId) });
  });

  /**
   * POST /api/test/set-gold — set the authenticated player's gold to an exact
   * value. The forfeit gold penalty (#124) floors at 0, so the floor case needs a
   * player seeded below the penalty; gold has no precise normal-play setter.
   * Body: { gold }. Test-only.
   */
  apiRouter.post('/api/test/set-gold', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { gold } = req.body ?? {};
    if (typeof gold !== 'number' || gold < 0 || !Number.isInteger(gold)) {
      res.status(400).json({ error: 'gold (non-negative integer) is required' });
      return;
    }
    const player = getPlayerById(playerId);
    if (!player) {
      res.status(404).json({ error: 'player not found' });
      return;
    }
    // addGold takes a delta; compute the delta to reach the target exactly.
    addGold(playerId, gold - player.gold);
    res.status(200).json({ gold: getPlayerById(playerId)?.gold ?? 0 });
  });

  /**
   * POST /api/test/set-spirit — set the authenticated player's spirit_current to
   * an exact value so the partial-spirit recharge case (#124) can be seeded
   * deterministically (drain-spirit only zeroes). Body: { spirit }. Test-only.
   */
  apiRouter.post('/api/test/set-spirit', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { spirit } = req.body ?? {};
    if (typeof spirit !== 'number' || spirit < 0 || !Number.isInteger(spirit)) {
      res.status(400).json({ error: 'spirit (non-negative integer) is required' });
      return;
    }
    setSpiritCurrent(playerId, spirit);
    res.status(200).json({ spirit_current: getSpiritAndFood(playerId).spirit_current });
  });

  /**
   * POST /api/test/grant-shard — credit one Reliquary Shard to the authenticated
   * player. Used by E2E specs that need to test POST /api/sanctum/expand-reliquary
   * without a normal-play path to earn a Shard. No body. Test-only.
   */
  apiRouter.post('/api/test/grant-shard', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    grantShard(playerId);
    res.status(200).json({ ok: true, reliquaryShards: getReliquaryShards(playerId) });
  });

  /**
   * POST /api/test/seed-resting-rings — add `count` rings directly to the
   * authenticated player's Reliquary (in_carry = 0, escrowed = 0). The default
   * element is 0 (Fire) and default uses/xp match grantRing defaults. Used by
   * E2E specs that need to fill the Reliquary near or at capacity without
   * going through normal ring-win mechanics.
   * Body: { count: number, element?: number }. Test-only.
   */
  apiRouter.post('/api/test/seed-resting-rings', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { count, element = 0 } = req.body ?? {};
    if (typeof count !== 'number' || count < 1 || !Number.isInteger(count)) {
      res.status(400).json({ error: 'count (positive integer) is required' });
      return;
    }
    if (typeof element !== 'number' || !Number.isInteger(element) || element < 0) {
      res.status(400).json({ error: 'element must be a non-negative integer' });
      return;
    }
    // grantRing inserts with in_carry = 0 (DB default), so rings land in the Reliquary.
    for (let i = 0; i < count; i++) {
      grantRing(playerId, element, 0, 3, 0);
    }
    res.status(200).json({ ok: true, reliquaryCount: getReliquaryCount(playerId) });
  });

  /**
   * POST /api/test/set-aggregate-xp — grant the authenticated player a single
   * Reliquary ring carrying `xp` XP, so their aggregate_xp (= SUM(xp) WHERE
   * in_carry = 0) reaches at least `xp` for the #196 NPC-XP-scaling specs. A fresh
   * E2E player starts at aggregate_xp = 0 (all starter rings have xp = 0), so this
   * is additive: one call seeds a veteran. There is no normal-play path to a
   * precise aggregate XP, hence the test hook. Body: { xp: number }. Test-only.
   */
  apiRouter.post('/api/test/set-aggregate-xp', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { xp } = req.body ?? {};
    if (typeof xp !== 'number' || xp < 0 || !Number.isInteger(xp)) {
      res.status(400).json({ error: 'xp (non-negative integer) is required' });
      return;
    }
    // A Reliquary ring (in_carry = 0) counts toward aggregate_xp; element/tier are
    // irrelevant to the XP sum, so a Fire ring with the requested XP suffices.
    grantRing(playerId, 0, 0, 3, xp);
    res.status(200).json({ ok: true, aggregateXp: getSpiritStats(playerId).aggregateXp });
  });
}
