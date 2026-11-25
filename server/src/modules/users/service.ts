import crypto from 'node:crypto';
import { ALL_PERMISSION_KEYS } from '../../../../shared/permissions.ts';
import type { Parsed, Raw } from '../../../../shared/schemas/common.ts';
import {
  parseNewRole,
  parseNewUser,
  parseRoleUpdate,
  parseUserUpdate,
  type UserInput,
} from '../../../../shared/schemas/users.ts';
import type { AuthUser, RoleRecord } from '../../../../shared/types.ts';
import { kysely, type Executor } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import {
  accountInputOrThrow,
  clearLoginFailures,
  hashPassword,
  resolveAuthUserById,
  revokeAllSessionsForUser,
} from '../auth/service.ts';
import * as repo from './repository.ts';

/**
 * User accounts and roles (R2.4b). Same rules, messages and status codes as
 * the legacy routes; errors gain stable codes. Passwords are hashed before
 * withTransaction(); the checks that another request could invalidate during
 * the hashing (duplicate email, last administrator) run again inside it.
 */

const userNotFound = () => new NotFoundError('USER_NOT_FOUND', 'User not found.');
const roleNotFound = () => new NotFoundError('ROLE_NOT_FOUND', 'Role not found.');
const timestamp = () => new Date().toISOString();

async function roleOrThrow(q: Executor, roleId: number): Promise<RoleRecord> {
  const role = await repo.roles.findById(q, roleId);
  if (!role) throw new ValidationError('role_id', 'NOT_FOUND', 'Selected role does not exist.');
  return role;
}

// ---------------------------------------------------------------- lists

export const lists = {
  users: () => repo.users.list(kysely),
  roles: () => repo.roles.list(kysely),
  role: (id: number) => repo.roles.findById(kysely, id),
  roleBySlug: (slug: string) => repo.roles.findBySlug(kysely, slug),
};

// ---------------------------------------------------------------- users

export async function createUser(raw: Raw): Promise<number> {
  const input = accountInputOrThrow(parseNewUser(raw));
  const role = await roleOrThrow(kysely, input.role_id);
  const emailExists = () =>
    new ConflictError('EMAIL_EXISTS', 'An account with this email already exists.', { field: 'email' });
  if (await repo.users.emailTaken(kysely, input.email)) throw emailExists();

  const passwordHash = await hashPassword(input.password);
  return withTransaction(async (trx) => {
    // Re-checked after the hashing: another request may have used the email meanwhile.
    if (await repo.users.emailTaken(trx, input.email)) throw emailExists();
    const userId = await repo.users.insert(trx, {
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      password_hash: passwordHash,
      role: role.slug,
      role_id: role.id,
      is_active: input.is_active,
      created_at: timestamp(),
    });
    // Failures recorded before the account existed must not carry over.
    await clearLoginFailures([input.email], trx);
    return userId;
  });
}

type ExistingUser = NonNullable<Awaited<ReturnType<typeof repo.users.findById>>>;

/**
 * The checks of an account change, in the legacy order. Run once before the
 * password is hashed and again inside the transaction.
 */
async function assertUserChangeAllowed(
  q: Executor,
  existing: ExistingUser,
  input: UserInput,
  target: RoleRecord,
  actor: AuthUser
): Promise<void> {
  if (await repo.users.emailTaken(q, input.email, existing.id)) {
    throw new ConflictError('EMAIL_EXISTS', 'Another account already uses this email.', { field: 'email' });
  }
  if (existing.id === actor.id && input.is_active === 0) {
    throw new AppError(400, 'CANNOT_DEACTIVATE_SELF', 'You cannot deactivate your own active account.');
  }

  // Never leave the system without an active account that can manage users.
  const currentRole = existing.role_id ? await repo.roles.findById(q, existing.role_id) : undefined;
  const wasManager = Boolean(currentRole?.permissions.includes('users.manage')) || existing.role === 'admin';
  const staysManager = target.permissions.includes('users.manage') && input.is_active === 1;
  if (wasManager && !staysManager && !(await repo.users.otherActiveManagerExists(q, existing.id))) {
    throw new AppError(400, 'LAST_ADMIN', 'Cannot demote or deactivate the last active user administrator.');
  }
}

/** Returns the actor's refreshed profile when they edited their own account. */
export async function updateUser(id: number, raw: Raw, actor: AuthUser): Promise<AuthUser | null | undefined> {
  const existing = await repo.users.findById(kysely, id);
  if (!existing) throw userNotFound();
  const input = accountInputOrThrow(parseUserUpdate(raw, existing));
  const target = await roleOrThrow(kysely, input.role_id);
  await assertUserChangeAllowed(kysely, existing, input, target, actor);

  // Hashed before any write, so a failure cannot leave a half-updated user.
  const passwordHash = input.password ? await hashPassword(input.password) : null;

  await withTransaction(async (trx) => {
    // The hashing let other requests run: check again against the current data
    // (two administrators demoting each other at the same moment).
    const current = await repo.users.findById(trx, id);
    if (!current) throw userNotFound();
    const role = await roleOrThrow(trx, input.role_id);
    await assertUserChangeAllowed(trx, current, input, role, actor);

    await repo.users.update(trx, id, {
      full_name: input.full_name,
      email: input.email,
      phone: input.phone,
      role: role.slug,
      role_id: role.id,
      is_active: input.is_active,
    });
    if (passwordHash) {
      await repo.users.setPassword(trx, id, passwordHash);
      // An administrator setting a new password also lifts a lockout (R1.9).
      await clearLoginFailures([current.email, input.email], trx);
    }
    if (input.is_active === 0 || passwordHash) {
      await revokeAllSessionsForUser(id, trx);
    }
  });

  return id === actor.id ? resolveAuthUserById(actor.id) : undefined;
}

/** Hard delete, as before (owner's decision 2026-11-25); its sessions go with it. */
export async function deleteUser(id: number, actor: AuthUser): Promise<void> {
  if (id === actor.id) throw new AppError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account.');
  await withTransaction(async (trx) => {
    if (!(await repo.users.findById(trx, id))) throw userNotFound();
    await revokeAllSessionsForUser(id, trx);
    await repo.users.delete(trx, id);
  });
}

// ---------------------------------------------------------------- roles

function roleInputOrThrow<T>(parsed: Parsed<T>): T {
  if (parsed.ok) return parsed.value;
  const first = parsed.problems[0];
  throw new ValidationError(first.field, first.reason, first.message);
}

/** Slug from the English name plus 4 random hex characters, as before. */
function roleSlug(nameEn: string): string {
  const base =
    nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'custom_role';
  return `${base}_${crypto.randomBytes(2).toString('hex')}`;
}

export async function createRole(raw: Raw): Promise<number> {
  const input = roleInputOrThrow(parseNewRole(raw));
  return withTransaction((trx) =>
    repo.roles.insert(trx, {
      slug: roleSlug(input.name_en),
      name_ar: input.name_ar,
      name_en: input.name_en,
      description_ar: input.description_ar,
      description_en: input.description_en,
      permissions: input.permissions ?? [],
      created_at: timestamp(),
    })
  );
}

export async function updateRole(id: number, raw: Raw): Promise<void> {
  const role = await repo.roles.findById(kysely, id);
  if (!role) throw roleNotFound();
  const input = roleInputOrThrow(parseRoleUpdate(raw, role));
  // The administrator role always keeps every permission.
  const permissions = role.slug === 'admin' ? [...ALL_PERMISSION_KEYS] : (input.permissions ?? role.permissions);
  await withTransaction((trx) =>
    repo.roles.update(trx, id, {
      name_ar: input.name_ar,
      name_en: input.name_en,
      description_ar: input.description_ar,
      description_en: input.description_en,
      permissions,
    })
  );
}

export async function deleteRole(id: number): Promise<void> {
  await withTransaction(async (trx) => {
    const role = await repo.roles.findById(trx, id);
    if (!role) throw roleNotFound();
    if (role.is_system === 1 || role.slug === 'admin') {
      throw new AppError(400, 'SYSTEM_ROLE', 'System administrator role cannot be deleted.');
    }
    if ((role.users_count ?? 0) > 0) {
      throw new AppError(400, 'ROLE_IN_USE', 'Reassign users from this role before deleting it.', {
        count: role.users_count,
      });
    }
    await repo.roles.delete(trx, id);
  });
}
