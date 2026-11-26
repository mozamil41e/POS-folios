import crypto from 'node:crypto';
import type { Executor } from '../db/kysely.ts';
import { AppError, ConflictError } from './errors.ts';

/**
 * Idempotency-Key (R2.5a, owner's decision a): a client sends one key per
 * attempt of a write (the till: one per sale). If the answer is lost (the
 * network drops after the server saved the sale) and the same request is sent
 * again with the same key, the server answers with what it saved the first
 * time instead of saving again. The same key with a different request is a
 * client bug: 409 IDEMPOTENCY_KEY_REUSED.
 *
 * Keys belong to one user and one endpoint, are kept 24 hours and are purged
 * while saving (no background worker on Hostinger). The record is written in
 * the same transaction as the document, so a failed save leaves no key.
 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

/** Letters, digits and - _ : . ; 8 to 100 characters (a UUID fits). */
const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,100}$/;

/** The header value, or null when none was sent. A malformed key is a 400. */
export function idempotencyKeyFrom(header: string | undefined): string | null {
  const key = (header ?? '').trim();
  if (!key) return null;
  if (!KEY_PATTERN.test(key)) {
    throw new AppError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8 to 100 letters, digits, "-", "_", ":" or ".".');
  }
  return key;
}

/** JSON with object keys sorted, so the same request always hashes the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, canonical(v)])
    );
  }
  return value;
}

/** SHA-256 of the request body: tells "the same request again" from "another request". */
export function requestHash(body: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(body ?? {}))).digest('hex');
}

export interface IdempotencyScope {
  userId: number;
  key: string;
  endpoint: string;
  hash: string;
}

/**
 * The id saved by an earlier request with this key, or undefined. Throws 409
 * when the key was used for a different request or another endpoint.
 */
export async function savedResourceId(q: Executor, scope: IdempotencyScope, now = Date.now()): Promise<number | undefined> {
  const row = await q
    .selectFrom('idempotency_keys')
    .select(['endpoint', 'request_hash', 'resource_id'])
    .where('user_id', '=', scope.userId)
    .where('idem_key', '=', scope.key)
    .where('created_at', '>', new Date(now - IDEMPOTENCY_TTL_MS).toISOString())
    .executeTakeFirst();
  if (!row) return undefined;
  if (row.endpoint !== scope.endpoint || row.request_hash !== scope.hash) {
    throw new ConflictError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different request.', {
      field: 'Idempotency-Key',
    });
  }
  return row.resource_id;
}

/** Records the key with what it created; old keys are purged first. Call it inside the document's transaction. */
export async function rememberKey(q: Executor, scope: IdempotencyScope, resourceId: number, now = Date.now()): Promise<void> {
  // Purging first also frees an expired record of the same key for reuse.
  await q.deleteFrom('idempotency_keys').where('created_at', '<=', new Date(now - IDEMPOTENCY_TTL_MS).toISOString()).execute();
  await q
    .insertInto('idempotency_keys')
    .values({
      user_id: scope.userId,
      idem_key: scope.key,
      endpoint: scope.endpoint,
      request_hash: scope.hash,
      resource_id: resourceId,
      created_at: new Date(now).toISOString(),
    })
    .execute();
}
