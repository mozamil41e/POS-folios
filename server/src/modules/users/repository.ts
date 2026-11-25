import { ALL_PERMISSION_KEYS, sanitizePermissions } from '../../../../shared/permissions.ts';
import type { ManagedUser, PermissionKey, RoleRecord } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Users and roles data access (R2.4b), moved from src/server/db.ts with the
 * same queries and mapping. Every function takes the executor, so the service
 * passes `trx` when reads and writes must belong together.
 */

/** The admin role always has every permission; other roles keep only known keys. */
function rolePermissions(slug: string, permissionsJson: string): PermissionKey[] {
  if (slug === 'admin') return [...ALL_PERMISSION_KEYS];
  try {
    return sanitizePermissions(JSON.parse(permissionsJson));
  } catch {
    return [];
  }
}

// --------------------------------------------------------------------- roles

function selectRoles(q: Executor) {
  return q
    .selectFrom('roles as r')
    .select((eb) => [
      'r.id',
      'r.slug',
      'r.name_ar',
      'r.name_en',
      'r.description_ar',
      'r.description_en',
      'r.permissions_json',
      'r.is_system',
      'r.created_at',
      eb
        .selectFrom('users as u')
        .select((inner) => inner.fn.countAll<number>().as('n'))
        .whereRef('u.role_id', '=', 'r.id')
        .as('users_count'),
    ]);
}

type RoleRow = Awaited<ReturnType<ReturnType<typeof selectRoles>['executeTakeFirstOrThrow']>>;

function toRole(row: RoleRow): RoleRecord {
  return {
    id: row.id,
    slug: row.slug,
    name_ar: row.name_ar,
    name_en: row.name_en,
    description_ar: row.description_ar,
    description_en: row.description_en,
    permissions: rolePermissions(row.slug, row.permissions_json),
    is_system: row.is_system,
    users_count: Number(row.users_count ?? 0),
    created_at: row.created_at,
  };
}

export const roles = {
  /** System roles first, then in creation order. */
  async list(q: Executor): Promise<RoleRecord[]> {
    const rows = await selectRoles(q).orderBy('r.is_system', 'desc').orderBy('r.id', 'asc').execute();
    return rows.map(toRole);
  },

  async findById(q: Executor, id: number): Promise<RoleRecord | undefined> {
    const row = await selectRoles(q).where('r.id', '=', id).executeTakeFirst();
    return row ? toRole(row) : undefined;
  },

  async findBySlug(q: Executor, slug: string): Promise<RoleRecord | undefined> {
    const row = await selectRoles(q).where('r.slug', '=', slug).executeTakeFirst();
    return row ? toRole(row) : undefined;
  },

  async insert(
    q: Executor,
    values: {
      slug: string;
      name_ar: string;
      name_en: string;
      description_ar: string;
      description_en: string;
      permissions: PermissionKey[];
      created_at: string;
    }
  ): Promise<number> {
    const { permissions, ...rest } = values;
    const result = await q
      .insertInto('roles')
      .values({ ...rest, permissions_json: JSON.stringify(permissions), is_system: 0 })
      .executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async update(
    q: Executor,
    id: number,
    values: { name_ar: string; name_en: string; description_ar: string; description_en: string; permissions: PermissionKey[] }
  ): Promise<void> {
    const { permissions, ...rest } = values;
    await q
      .updateTable('roles')
      .set({ ...rest, permissions_json: JSON.stringify(permissions) })
      .where('id', '=', id)
      .execute();
  },

  async delete(q: Executor, id: number): Promise<void> {
    await q.deleteFrom('roles').where('id', '=', id).execute();
  },
};

// --------------------------------------------------------------------- users

export const users = {
  /** The accounts list for the users screen (no password hashes). */
  async list(q: Executor): Promise<ManagedUser[]> {
    const rows = await q
      .selectFrom('users as u')
      .leftJoin('roles as r', 'r.id', 'u.role_id')
      .select(({ fn, ref, val }) => [
        'u.id',
        'u.full_name',
        'u.email',
        'u.phone',
        'u.role_id',
        'u.is_active',
        'u.last_login_at',
        'u.created_at',
        fn.coalesce(ref('r.name_ar'), ref('u.role')).as('role_name_ar'),
        fn.coalesce(ref('r.name_en'), ref('u.role')).as('role_name_en'),
        fn.coalesce(ref('r.permissions_json'), val('[]')).as('permissions_json'),
        fn.coalesce(ref('r.slug'), ref('u.role')).as('role_slug'),
      ])
      .orderBy('u.id', 'asc')
      .execute();

    return rows.map((row) => ({
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone ?? '',
      role: row.role_slug,
      role_id: row.role_id ?? 0,
      role_name_ar: row.role_name_ar,
      role_name_en: row.role_name_en,
      permissions_count: rolePermissions(row.role_slug, row.permissions_json).length,
      is_active: row.is_active ?? 1,
      last_login_at: row.last_login_at ?? null,
      created_at: row.created_at,
    }));
  },

  async findById(q: Executor, id: number) {
    return q
      .selectFrom('users')
      .select(['id', 'email', 'role', 'role_id', 'is_active'])
      .where('id', '=', id)
      .executeTakeFirst();
  },

  async findIdByEmail(q: Executor, email: string): Promise<number | undefined> {
    return (await q.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst())?.id;
  },

  /** True when an account other than `exceptId` uses this email. */
  async emailTaken(q: Executor, email: string, exceptId = 0): Promise<boolean> {
    const row = await q
      .selectFrom('users')
      .select('id')
      .where('email', '=', email)
      .where('id', '!=', exceptId)
      .executeTakeFirst();
    return Boolean(row);
  },

  /**
   * Whether an active account other than `exceptId` can still manage users:
   * the legacy admin role text, or a role with users.manage.
   */
  async otherActiveManagerExists(q: Executor, exceptId: number): Promise<boolean> {
    const rows = await q
      .selectFrom('users as u')
      .leftJoin('roles as r', 'r.id', 'u.role_id')
      .select(({ fn, ref, val }) => ['u.role', fn.coalesce(ref('r.permissions_json'), val('[]')).as('permissions_json')])
      .where('u.is_active', '=', 1)
      .where('u.id', '!=', exceptId)
      .execute();
    return rows.some((u) => u.role === 'admin' || rolePermissions('', u.permissions_json).includes('users.manage'));
  },

  async insert(
    q: Executor,
    values: {
      full_name: string;
      email: string;
      phone: string;
      password_hash: string;
      role: string;
      role_id: number;
      is_active: number;
      created_at: string;
    }
  ): Promise<number> {
    const result = await q.insertInto('users').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async update(
    q: Executor,
    id: number,
    values: { full_name: string; email: string; phone: string; role: string; role_id: number; is_active: number }
  ): Promise<void> {
    await q.updateTable('users').set(values).where('id', '=', id).execute();
  },

  /** Emergency recovery (scripts/create-admin.ts): make the account an active administrator. */
  async restoreAdmin(q: Executor, id: number, values: { password_hash: string; role: string; role_id: number }) {
    await q
      .updateTable('users')
      .set({ ...values, is_active: 1 })
      .where('id', '=', id)
      .execute();
  },

  async setPassword(q: Executor, id: number, passwordHash: string): Promise<void> {
    await q.updateTable('users').set({ password_hash: passwordHash }).where('id', '=', id).execute();
  },

  /** Hard delete, as before (owner's decision 2026-11-25; revisited in R3 with created_by). */
  async delete(q: Executor, id: number): Promise<void> {
    await q.deleteFrom('users').where('id', '=', id).execute();
  },
};
