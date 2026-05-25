import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { signToken, requireAuth } from '../auth/auth';
import {
  createPlayer,
  getPlayerByUsername,
  getPlayerById,
  getRingsByOwner,
  getLoadout,
  saveLoadout,
  sleepRecharge,
  rechargeRing,
  addGold,
  lockStake,
  unlockStake,
} from '../persistence/PlayerRepo';

const SLEEP_COST = 50;

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
 * POST /api/camp/sleep — advance game_day by 1 and fully recharge all rings.
 * Requires auth.
 */
apiRouter.post('/api/camp/sleep', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const player = getPlayerById(playerId);
  if (!player || player.gold < SLEEP_COST) {
    res.status(400).json({ error: `Sleep costs ${SLEEP_COST}g (not enough gold)` });
    return;
  }
  addGold(playerId, -SLEEP_COST);
  sleepRecharge(playerId);
  res.status(200).json({
    player: getPlayerById(playerId),
    rings: getRingsByOwner(playerId),
  });
});

/**
 * POST /api/camp/recharge — pay gold to recharge a specific ring to full.
 * Body: { ringId: string }
 * Requires auth.
 */
apiRouter.post('/api/camp/recharge', requireAuth, (req: Request, res: Response): void => {
  const playerId = req.playerId as string;
  const { ringId } = req.body ?? {};
  if (typeof ringId !== 'string' || !ringId) {
    res.status(400).json({ error: 'ringId is required' });
    return;
  }
  const result = rechargeRing(playerId, ringId);
  if (!result.ok) {
    res.status(400).json({ error: result.reason });
    return;
  }
  const rings = getRingsByOwner(playerId);
  const ring = rings.find((r) => r.id === ringId);
  const player = getPlayerById(playerId);
  res.status(200).json({ ring, gold: player?.gold ?? 0 });
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
