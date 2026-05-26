import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { signToken, requireAuth } from '../auth/auth';
import { makeRng } from '../game/ai/AIProfiles';
import { previewStakeElement, AI_PERSONALITIES } from '../game/ai/AILoadout';
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
  rechargeRingWithSpirit,
  rechargeAllWithSpirit,
  getSpiritAndFood,
  spendSpirit,
  lockStake,
  unlockStake,
} from '../persistence/PlayerRepo';
import { FOOD_PER_SLEEP } from '../game/constants';

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
  res.status(200).json({
    player,
    rings: getRingsByOwner(playerId),
    loadout: getLoadout(playerId) ?? null,
  });
});

/**
 * POST /api/camp/sleep — spend food to rest: advance game_day by 1 and fully
 * restore the spirit gauge (#41 replaces the old gold cost). 400 if the player
 * has fewer than FOOD_PER_SLEEP food units. Requires auth.
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
 * PUT /api/loadout — update one or more loadout slots.
 * Body: partial Record<SlotKey, string | null>
 * Requires auth.
 */
apiRouter.put('/api/loadout', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
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
 * GET /api/encounter/preview — returns a randomized stake element per AI
 * personality so the EncounterScene can color each opponent marker before
 * the player commits to a duel. No auth required.
 *
 * Response: Record<AIPersonality, number>  (personality → stake element index)
 */
apiRouter.get('/api/encounter/preview', (_req: Request, res: Response): void => {
  const baseSeed = Date.now() & 0xffffffff;
  // Derive a deterministic per-personality aiSeed from the base seed so the
  // preview and the actual BattleRoom loadout use identical RNG state.
  // BattleRoom seeds its loadout RNG as makeRng(aiSeed ^ 0x1a2b3c4d); we do
  // the same here so intBetween(0, templates.length-1) returns the same index.
  const preview: Record<string, { element: number; aiSeed: number }> = {};
  AI_PERSONALITIES.forEach((p, i) => {
    const aiSeed = (baseSeed ^ (i * 0xdeadbeef)) & 0xffffffff;
    const loadoutRng = makeRng(aiSeed ^ 0x1a2b3c4d);
    preview[p] = { element: previewStakeElement(p, loadoutRng), aiSeed };
  });
  res.status(200).json(preview);
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
   * POST /api/test/drain-spirit — set the authenticated player's spirit to 0 so
   * the no-spirit recharge guard can be asserted deterministically. Test-only.
   */
  apiRouter.post('/api/test/drain-spirit', requireAuth, (req: Request, res: Response): void => {
    const playerId = req.playerId as string;
    const { spirit_current } = getSpiritAndFood(playerId);
    if (spirit_current > 0) spendSpirit(playerId, spirit_current);
    res.status(200).json({ spirit_current: getSpiritAndFood(playerId).spirit_current });
  });
}
