import type { RequestHandler } from 'express';
import { userForSession } from '../modules/auth/service.ts';
import { sendError } from '../shared/respond.ts';
import type { AuthUser, PermissionKey } from '../../../shared/types.ts';

/**
 * Bearer-session authentication and permission checks (moved out of the
 * legacy routes in R2.4a so the modules use the same code). Sessions belong
 * to the auth module (R2.4b). Cookie sessions replace the Bearer token in R2.6.
 */
export function requireAuth(): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const user = token ? await userForSession(token) : null;
    if (!user) {
      // The current routes answered without a code; v1 gets UNAUTHENTICATED (R2.5).
      sendError(req, res, 401, 'UNAUTHENTICATED', 'Authentication required.', {}, { legacyWithoutCode: true });
      return;
    }
    res.locals.authUser = user;
    res.locals.authToken = token;
    next();
  };
}

/** Every route declares the permission it needs, reads included (CLAUDE.md §11). */
export function requirePermission(permission: PermissionKey): RequestHandler {
  return (req, res, next) => {
    const authUser = res.locals.authUser as AuthUser | undefined;
    if (!authUser || authUser.is_active === 0 || !authUser.permissions.includes(permission)) {
      sendError(req, res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.', {}, { legacyWithoutCode: true });
      return;
    }
    next();
  };
}
