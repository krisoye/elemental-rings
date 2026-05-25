import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';

const JWT_SECRET: string = process.env.JWT_SECRET || 'dev-secret';
const TOKEN_EXPIRY = '30d';

/** Claims carried inside a signed token. */
export interface TokenPayload {
  playerId: string;
  username: string;
}

// Augment Express's Request so handlers downstream of requireAuth can read the
// authenticated identity without re-verifying the token.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      playerId?: string;
      username?: string;
    }
  }
}

/** Sign a 30-day JWT for the given player identity. */
export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

/**
 * Verify and decode a token. Returns the payload on success, or null if the
 * token is missing, malformed, expired, or signed with the wrong secret.
 */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload;
    if (typeof decoded.playerId === 'string' && typeof decoded.username === 'string') {
      return { playerId: decoded.playerId, username: decoded.username };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Express middleware enforcing a valid Bearer token. On success it sets
 * req.playerId / req.username and calls next(); otherwise it responds 401.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  const payload = verifyToken(header.slice('Bearer '.length).trim());
  if (!payload) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  req.playerId = payload.playerId;
  req.username = payload.username;
  next();
}
