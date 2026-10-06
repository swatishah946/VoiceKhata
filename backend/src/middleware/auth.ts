import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthUser {
  orgId: string;
  role: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

/**
 * Dashboard API authentication (Bearer JWT).
 * Changes: the secret comes from validated config (no hard-coded fallback), the
 * algorithm is pinned to HS256, and the payload shape is checked.
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing or invalid token' });
  }

  try {
    const decoded = jwt.verify(header.slice(7), config.JWT_SECRET, { algorithms: ['HS256'] }) as any;
    if (typeof decoded?.orgId !== 'string') throw new Error('bad payload');
    req.user = { orgId: decoded.orgId, role: decoded.role };
    next();
  } catch {
    return res.status(401).json({ error: 'Unauthorized: Invalid token' });
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: config.JWT_EXPIRES_IN as any });
}
