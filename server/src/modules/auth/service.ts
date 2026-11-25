import crypto from 'node:crypto';
import {
  PASSWORD_LENGTH_ERROR,
  parseLoginInput,
  parseSetupInput,
} from '../../../../shared/schemas/auth.ts';
import type { Parsed, Raw } from '../../../../shared/schemas/common.ts';
import type { AuthUser } from '../../../../shared/types.ts';
import { kysely, type Executor } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import {
  AppError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
  ValidationError,
} from '../../shared/errors.ts';
import * as lockout from './lockout.ts';
import { dummyPasswordHash, hashPassword, verifyPassword } from './passwords.ts';
import * as repo from './repository.ts';

/**
 * Sign-in, first-run setup and sessions (R2.4b). Same behaviour, messages and
 * codes as the legacy routes (R1.2, R1.9); the responses only gain a `code`
 * (and `field`/`reason` for invalid input) where they had none.
 * Password hashing happens before withTransaction(), never inside it.
 */
export interface SignedIn {
  token: string;
  user: AuthUser | null;
}

const registrationClosed = () =>
  new ForbiddenError('REGISTRATION_CLOSED', 'Registration is closed. Ask an administrator to create your account.');

const passwordLength = () => new AppError(400, 'PASSWORD_TOO_SHORT', PASSWORD_LENGTH_ERROR);

function loginLocked(retryAfterMs: number): TooManyRequestsError {
  return new TooManyRequestsError(
    'LOGIN_LOCKED',
    'Too many failed sign-in attempts. Sign-in is paused for this account.',
    Math.max(1, Math.ceil(retryAfterMs / 1000))
  );
}

/**
 * When SETUP_TOKEN is configured (always in production), first-run setup must
 * present it. Without it (local development) setup stays open on an empty DB.
 * Hashing both sides makes the comparison constant-time whatever the length.
 */
function setupTokenMatches(provided: unknown, expected: string | undefined): boolean {
  if (!expected) return true;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function status(setupToken: string | undefined) {
  return { hasUsers: await repo.users.any(kysely), setupTokenRequired: Boolean(setupToken) };
}

/**
 * First-run setup only (SEC-01): creates the first administrator while there
 * are no accounts. Afterwards accounts are created by an admin via /api/users.
 * Checked in this order: closed, then setup token, then input.
 */
export async function setupFirstAdmin(raw: Raw, setupToken: string | undefined): Promise<SignedIn> {
  if (await repo.users.any(kysely)) throw registrationClosed();
  if (!setupTokenMatches(raw.setup_token, setupToken)) {
    throw new ForbiddenError('INVALID_SETUP_TOKEN', 'Invalid setup token.');
  }

  const input = accountInputOrThrow(parseSetupInput(raw));
  const passwordHash = await hashPassword(input.password);

  return withTransaction(async (trx) => {
    // Re-checked inside the transaction so two simultaneous setup requests
    // cannot both create an account.
    if (await repo.users.any(trx)) throw registrationClosed();
    const adminRole = await repo.roles.findBySlug(trx, 'admin');
    const userId = await repo.users.insertFirstAdmin(trx, {
      full_name: input.full_name,
      email: input.email,
      password_hash: passwordHash,
      role: adminRole?.slug ?? 'admin',
      role_id: adminRole?.id ?? null,
      now: new Date().toISOString(),
    });
    const session = await repo.sessions.create(trx, userId);
    return { token: session.token, user: await repo.users.authUserById(trx, userId) };
  });
}

export async function login(raw: Raw): Promise<SignedIn> {
  const parsed = parseLoginInput(raw);
  if (!parsed.ok) {
    const first = parsed.problems[0];
    throw new ValidationError(first.field, first.reason, first.message);
  }
  const { email, password } = parsed.value;

  // R1.9 (SEC-05): while locked, even the right password is refused.
  const lockedForMs = await lockout.lockRemainingMs(kysely, email);
  if (lockedForMs > 0) throw loginLocked(lockedForMs);

  const account = await repo.users.credentialsByEmail(kysely, email);
  const passwordOk = await verifyPassword(password, account?.password_hash ?? (await dummyPasswordHash()));
  if (!account || !passwordOk) {
    const failure = await withTransaction((trx) => lockout.recordFailure(trx, email));
    if (failure.locked) throw loginLocked(failure.retryAfterMs);
    throw new UnauthorizedError('INVALID_CREDENTIALS', 'Invalid email or password.', {
      attemptsLeft: failure.attemptsLeft,
    });
  }

  await lockout.clearFailures(kysely, email);
  if (account.is_active === 0) {
    throw new ForbiddenError('ACCOUNT_DEACTIVATED', 'This account has been deactivated by an administrator.');
  }

  return withTransaction(async (trx) => {
    await repo.users.touchLastLogin(trx, account.id, new Date().toISOString());
    const session = await repo.sessions.create(trx, account.id);
    return { token: session.token, user: await repo.users.authUserById(trx, account.id) };
  });
}

export async function logout(token: string): Promise<void> {
  await repo.sessions.revoke(kysely, token);
}

/** The user of a valid session (requireAuth), or null. */
export async function userForSession(token: string): Promise<AuthUser | null> {
  const userId = await repo.sessions.findActiveUserId(kysely, token);
  return userId === undefined ? null : repo.users.authUserById(kysely, userId);
}

// ------------------------- used by the users module and scripts/create-admin.ts
// Each takes the executor last, so a caller can pass its transaction (`trx`).

export { hashPassword };

/**
 * The first problem of an account form: a password problem keeps its own code
 * PASSWORD_TOO_SHORT (R1.9, the UI knows it); others are VALIDATION_FAILED.
 */
export function accountInputOrThrow<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  const first = parsed.problems[0];
  if (first.field === 'password') throw passwordLength();
  throw new ValidationError(first.field, first.reason, first.message);
}

export const resolveAuthUserById = (userId: number, q: Executor = kysely) => repo.users.authUserById(q, userId);

/** On password change, deactivation, deletion and emergency recovery. */
export const revokeAllSessionsForUser = (userId: number, q: Executor = kysely) =>
  repo.sessions.revokeAllForUser(q, userId);

/** An administrator setting a new password also lifts a lockout (R1.9). */
export const clearLoginFailures = (emails: readonly string[], q: Executor = kysely) =>
  lockout.clearFailures(q, ...emails);
