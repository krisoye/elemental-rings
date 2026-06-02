import type { Request, Response, NextFunction } from 'express';
import { getPlayerById } from '../persistence/PlayerRepo';

/**
 * Express middleware that resolves the authenticated player from req.playerId
 * (set upstream by requireAuth) and attaches the row as req.player. Responds
 * 404 { error: 'Player not found' } and short-circuits when the id has no
 * matching player. Mount AFTER requireAuth so req.playerId is populated.
 *
 * getPlayerById is a synchronous better-sqlite3 read, so this middleware is
 * synchronous — no Promise is returned.
 */
export function requirePlayer(req: Request, res: Response, next: NextFunction): void {
  const playerId = req.playerId as string;
  const player = getPlayerById(playerId);
  if (!player) {
    fail(res, 404, 'Player not found');
    return;
  }
  req.player = player;
  next();
}

/**
 * Standard JSON error response helper. Replaces the inline
 * res.status(code).json({ error: msg }) pattern repeated across the API routes.
 */
export function fail(res: Response, code: number, msg: string): void {
  res.status(code).json({ error: msg });
}
