import crypto from 'node:crypto';
import { ALL_PERMISSION_KEYS, sanitizePermissions } from '../../../../shared/permissions.ts';
import type { AuthUser, PermissionKey } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Auth data access (R2.4b): accounts as seen by sign-in, and sessions. Moved
 * from src/server/db.ts with the same queries and rules. Every function takes
 * the executor, so a service passes `trx` when writes belong together.
 */

/** Sessions last 24 hours (sliding expiry and cookies come in R2.6). */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/** Only the SHA-256 of a session token is stored: a leaked table cannot be replayed. */
const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

// ------------------------------------------------------------------ sessions

export const sessions = {
  /** A new random token; the user's expired sessions are purged on the way. */
  async create(q: Executor, userId: number, now = new Date()): Promise<{ token: string; expiresAt: string }> {
    const token = crypto.randomBytes(32).toString('hex');
    const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();

    await q.deleteFrom('user_sessions').where('user_id', '=', userId).where('expires_at', '<=', nowIso).execute();
    await q
      .insertInto('user_sessions')
      .values({ user_id: userId, token_hash: hashToken(token), expires_at: expiresAt, created_at: nowIso })
      .execute();
    return { token, expiresAt };
  },

  /** The user behind a token that is unexpired and belongs to an active account. */
  async findActiveUserId(q: Executor, token: string, now = new Date()): Promise<number | undefined> {
    if (!token) return undefined;
    const row = await q
      .selectFrom('user_sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select('u.id')
      .where('s.token_hash', '=', hashToken(token))
      .where('s.expires_at', '>', now.toISOString())
      .where('u.is_active', '=', 1)
      .executeTakeFirst();
    return row?.id;
  },

  async revoke(q: Executor, token: string): Promise<void> {
    if (!token) return;
    await q.deleteFrom('user_sessions').where('token_hash', '=', hashToken(token)).execute();
  },

  /** On password change, deactivation, deletion and emergency recovery. */
  async revokeAllForUser(q: Executor, userId: number): Promise<void> {
    await q.deleteFrom('user_sessions').where('user_id', '=', userId).execute();
  },
};

// --------------------------------------------------------------------- users

export const users = {
  async any(q: Executor): Promise<boolean> {
    return Boolean(await q.selectFrom('users').select('id').limit(1).executeTakeFirst());
  },

  /** What sign-in needs; emails are stored in lower case. */
  async credentialsByEmail(q: Executor, email: string) {
    return q.selectFrom('users').select(['id', 'password_hash', 'is_active']).where('email', '=', email).executeTakeFirst();
  },

  async insertFirstAdmin(
    q: Executor,
    values: { full_name: string; email: string; password_hash: string; role: string; role_id: number | null; now: string }
  ): Promise<number> {
    const result = await q
      .insertInto('users')
      .values({
        full_name: values.full_name,
        email: values.email,
        phone: '',
        password_hash: values.password_hash,
        role: values.role,
        role_id: values.role_id,
        is_active: 1,
        last_login_at: values.now,
        created_at: values.now,
      })
      .executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async touchLastLogin(q: Executor, userId: number, at: string): Promise<void> {
    await q.updateTable('users').set({ last_login_at: at }).where('id', '=', userId).execute();
  },

  /**
   * The signed-in user with the permissions of their role. The admin role
   * always has every permission; other roles keep only known keys.
   */
  async authUserById(q: Executor, userId: number): Promise<AuthUser | null> {
    const row = await q
      .selectFrom('users as u')
      .leftJoin('roles as r', 'r.id', 'u.role_id')
      .select(({ fn, ref, val }) => [
        'u.id',
        'u.full_name',
        'u.email',
        'u.phone',
        'u.role_id',
        'u.is_active',
        'u.created_at',
        fn.coalesce(ref('r.slug'), ref('u.role')).as('role_slug'),
        fn.coalesce(ref('r.name_ar'), ref('u.role')).as('role_name_ar'),
        fn.coalesce(ref('r.name_en'), ref('u.role')).as('role_name_en'),
        fn.coalesce(ref('r.permissions_json'), val('[]')).as('permissions_json'),
      ])
      .where('u.id', '=', userId)
      .executeTakeFirst();
    if (!row) return null;

    let permissions: PermissionKey[] = [];
    if (row.role_slug === 'admin') {
      permissions = [...ALL_PERMISSION_KEYS];
    } else {
      try {
        permissions = sanitizePermissions(JSON.parse(row.permissions_json));
      } catch {
        permissions = [];
      }
    }

    return {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone ?? '',
      role: row.role_slug,
      role_id: row.role_id ?? 0,
      role_name_ar: row.role_name_ar,
      role_name_en: row.role_name_en,
      permissions,
      is_active: row.is_active ?? 1,
      created_at: row.created_at,
    };
  },
};

// --------------------------------------------------------------------- roles

export const roles = {
  async findBySlug(q: Executor, slug: string) {
    return q.selectFrom('roles').select(['id', 'slug']).where('slug', '=', slug).executeTakeFirst();
  },
};
