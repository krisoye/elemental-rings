import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { signToken, requireAuth } from '../auth/auth';
import {
  createPlayer,
  getPlayerByUsername,
  getPlayerById,
  getRingsByOwner,
  getLoadout,
} from '../persistence/PlayerRepo';

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
  if (getPlayerByUsername(username)) {
    res.status(409).json({ error: 'Username already taken' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const playerId = createPlayer(username, passwordHash);
  const token = signToken({ playerId, username });
  res.status(200).json({ token, playerId });
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
    res.status(401).json({ error: 'Player not found' });
    return;
  }
  res.status(200).json({
    player,
    rings: getRingsByOwner(playerId),
    loadout: getLoadout(playerId) ?? null,
  });
});
