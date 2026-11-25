import type { RequestHandler } from 'express';
import { getUserBySessionToken } from '../../../src/server/db.ts';
import type { AuthUser, PermissionKey } from '../../../shared/types.ts';

/**
 * Bearer-session authentication and permission checks (moved out of the
 * legacy routes in R2.4a so the modules use the same code). Cookie sessions
 * replace the Bearer token in R2.6.
 */
export function requireAuth(): RequestHandler {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const user = getUserBySessionToken(token);
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    res.locals.authUser = user;
    res.locals.authToken = token;
    next();
  };
}

/** Every route declares the permission it needs, reads included (CLAUDE.md §11). */
export function requirePermission(permission: PermissionKey): RequestHandler {
  return (_req, res, next) => {
    const authUser = res.locals.authUser as AuthUser | undefined;
    if (!authUser || authUser.is_active === 0 || !authUser.permissions.includes(permission)) {
      res.status(403).json({ error: 'You do not have permission to perform this action.' });
      return;
    }
    next();
  };
}
