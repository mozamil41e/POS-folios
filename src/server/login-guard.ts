import type Database from 'better-sqlite3';

/**
 * Temporary lockout per email after repeated wrong passwords (R1.9, SEC-05),
 * approved by the owner: 5 failures within 15 minutes lock that email for
 * 15 minutes, even with the right password. Unknown emails are counted the
 * same way, so the response never reveals whether an account exists.
 *
 * The counter lives in the database (table login_attempts) so a process
 * restart does not reset it. The per-IP limit in server.ts is a second,
 * looser layer for attacks spread over many emails.
 */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCK_MS = 15 * 60 * 1000;

interface AttemptRow {
  failed_count: number;
  window_started_at: string;
  locked_until: string | null;
}

export type LoginFailureResult =
  | { locked: true; retryAfterMs: number }
  | { locked: false; attemptsLeft: number };

function readRow(db: Database.Database, email: string): AttemptRow | undefined {
  return db
    .prepare('SELECT failed_count, window_started_at, locked_until FROM login_attempts WHERE email = ?')
    .get(email) as AttemptRow | undefined;
}

/** Milliseconds until this email may try again; 0 when it is not locked. */
export function loginLockRemainingMs(db: Database.Database, email: string, now = Date.now()): number {
  const lockedUntil = readRow(db, email)?.locked_until;
  if (!lockedUntil) return 0;
  return Math.max(0, Date.parse(lockedUntil) - now);
}

/** Counts one wrong password for this email and locks it on the fifth within the window. */
export function recordLoginFailure(
  db: Database.Database,
  email: string,
  now = Date.now()
): LoginFailureResult {
  const record = db.transaction((): LoginFailureResult => {
    const row = readRow(db, email);
    const windowExpired = !row || now - Date.parse(row.window_started_at) >= LOGIN_WINDOW_MS;
    const lockExpired = Boolean(row?.locked_until) && Date.parse(row!.locked_until!) <= now;

    // A new window starts after the old one ran out or after a lock ended.
    const failedCount = windowExpired || lockExpired ? 1 : row!.failed_count + 1;
    const windowStartedAt =
      windowExpired || lockExpired ? new Date(now).toISOString() : row!.window_started_at;
    const lockedUntil =
      failedCount >= LOGIN_MAX_FAILURES ? new Date(now + LOGIN_LOCK_MS).toISOString() : null;

    db.prepare(`
      INSERT INTO login_attempts (email, failed_count, window_started_at, locked_until)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        failed_count = excluded.failed_count,
        window_started_at = excluded.window_started_at,
        locked_until = excluded.locked_until
    `).run(email, failedCount, windowStartedAt, lockedUntil);

    return lockedUntil
      ? { locked: true, retryAfterMs: LOGIN_LOCK_MS }
      : { locked: false, attemptsLeft: LOGIN_MAX_FAILURES - failedCount };
  });
  return record();
}

/** After a successful login, or when an administrator sets a new password. */
export function clearLoginFailures(db: Database.Database, ...emails: string[]): void {
  const remove = db.prepare('DELETE FROM login_attempts WHERE email = ?');
  for (const email of emails) remove.run(email.trim().toLowerCase());
}
