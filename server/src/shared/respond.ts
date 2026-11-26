import type { Request, Response } from 'express';
import { scopeForUser } from '../../../src/server/visibility.ts';
import { parsePage, type PageMeta, type PageRequest } from '../../../shared/schemas/pagination.ts';
import { valueOrThrow } from './validation.ts';
import type { AuthUser } from '../../../shared/types.ts';

/**
 * Sends workspace data through the read-scope filter (R1.3): lists the user
 * may not read are dropped, cost prices are removed without cost permission,
 * settings never carry secrets. Use it for every response with workspace data.
 */
export function sendScoped(res: Response, payload: Record<string, unknown>): void {
  res.json(scopeForUser(res.locals.authUser as AuthUser, payload));
}

// ------------------------------------------------------------- API v1 (R2.5)
//
// Routes under /api/v1 answer with one envelope (CLAUDE.md §11):
//   success  { "data": … }
//   lists    { "data": [...], "meta": { page, pageSize, total } }
//   errors   { "error": { "code", "message", "details" } }
// The current /api/* routes keep their shape until the UI moves to v1 (R4).

/** True for /api/v1 and everything below it. */
export function isV1(req: Request): boolean {
  return /^\/api\/v1(?:[/?]|$)/.test(req.originalUrl);
}

export function sendData(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ data });
}

export function sendList(res: Response, rows: readonly unknown[], meta: PageMeta): void {
  res.json({ data: rows, meta });
}

/** A complete (unpaged) list: one page holding every row. */
export function sendAll(res: Response, rows: readonly unknown[]): void {
  sendList(res, rows, { page: 1, pageSize: rows.length, total: rows.length });
}

/**
 * One value through the read-scope filter, under the key scopeForUser knows
 * (products, product, settings, ...): cost prices hidden without cost
 * permission (D11), settings kept to their public fields.
 */
export function scopedFor<T>(res: Response, key: string, value: T): T {
  const scoped = scopeForUser(res.locals.authUser as AuthUser, { [key]: value });
  return scoped[key] as T;
}

/** ?page=&pageSize= of a v1 list; a bad value is a 400 VALIDATION_FAILED. */
export function pageFrom(req: Request): PageRequest {
  return valueOrThrow(parsePage(req.query as Record<string, unknown>));
}

/**
 * An error in the shape of the route's API: the v1 envelope under /api/v1,
 * the current { error, code, ...details } elsewhere (the code is left out
 * where the current routes never sent one).
 */
export function sendError(
  req: Request,
  res: Response,
  status: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {},
  options: { legacyWithoutCode?: boolean } = {}
): void {
  if (isV1(req)) {
    res.status(status).json({ error: { code, message, details } });
    return;
  }
  res.status(status).json(options.legacyWithoutCode ? { error: message, ...details } : { error: message, code, ...details });
}
