import type { Executor } from '../../db/kysely.ts';

/**
 * Temporary lockout per email after repeated wrong passwords (R1.9, SEC-05),
 * approved by the owner: 5 failures within 15 minutes lock that email for
 * 15 minutes, even with the right password. Unknown emails are counted the
 * same way, so the response never reveals whether an account exists.
 *
 * The counter lives in the database (table login_attempts) so a restart does
 * not reset it. The per-IP limit (src/server/security.ts) is a second, looser
 * layer for attacks spread over many emails.
 *
 * R2.4b: Kysely port of src/server/login-guard.ts, same numbers and rules.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

export type LoginFailureResult =
  | { locked: true; retryAfterMs: number }
  | { locked: false; attemptsLeft: number };

const normalise = (email: string) => email.trim().toLowerCase();

function readRow(q: Executor, email: string) {
  return q
    .selectFrom('login_attempts')
    .select(['failed_count', 'window_started_at', 'locked_until'])
    .where('email', '=', email)
    .executeTakeFirst();
}

/** Milliseconds until this email may try again; 0 when it is not locked. */
export async function lockRemainingMs(q: Executor, email: string, now = Date.now()): Promise<number> {
  const lockedUntil = (await readRow(q, email))?.locked_until;
  if (!lockedUntil) return 0;
  return Math.max(0, Date.parse(lockedUntil) - now);
}

/**
 * Counts one wrong password for this email and locks it on the fifth within
 * the window. Pass the transaction: the read and the write belong together.
 */
export async function recordFailure(q: Executor, email: string, now = Date.now()): Promise<LoginFailureResult> {
  const row = await readRow(q, email);
  const windowExpired = !row || now - Date.parse(row.window_started_at) >= LOGIN_WINDOW_MS;
  const lockExpired = Boolean(row?.locked_until) && Date.parse(row?.locked_until ?? '') <= now;

  // A new window starts after the old one ran out or after a lock ended.
  const restart = windowExpired || lockExpired;
  const failedCount = restart || !row ? 1 : row.failed_count + 1;
  const windowStartedAt = restart || !row ? new Date(now).toISOString() : row.window_started_at;
  const lockedUntil = failedCount >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_LOCK_MS).toISOString() : null;

  const values = { failed_count: failedCount, window_started_at: windowStartedAt, locked_until: lockedUntil };
  // Read then insert or update (no dialect-specific upsert, ready for MariaDB in R3).
  if (row) {
    await q.updateTable('login_attempts').set(values).where('email', '=', email).execute();
  } else {
    await q.insertInto('login_attempts').values({ email, ...values }).execute();
  }

  return lockedUntil
    ? { locked: true, retryAfterMs: LOGIN_LOCK_MS }
    : { locked: false, attemptsLeft: LOGIN_MAX_FAILURES - failedCount };
}

/** After a successful sign-in, or when an administrator sets a new password. */
export async function clearFailures(q: Executor, ...emails: string[]): Promise<void> {
  const list = [...new Set(emails.map(normalise))];
  if (list.length === 0) return;
  await q.deleteFrom('login_attempts').where('email', 'in', list).execute();
}
