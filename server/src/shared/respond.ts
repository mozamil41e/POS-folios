import type { Response } from 'express';
import { scopeForUser } from '../../../src/server/visibility.ts';
import type { AuthUser } from '../../../shared/types.ts';

/**
 * Sends workspace data through the read-scope filter (R1.3): lists the user
 * may not read are dropped, cost prices are removed without cost permission,
 * settings never carry secrets. Use it for every response with workspace data.
 */
export function sendScoped(res: Response, payload: Record<string, unknown>): void {
  res.json(scopeForUser(res.locals.authUser as AuthUser, payload));
}
