import { z } from 'zod';
import { sanitizePermissions } from '../permissions';
import type { PermissionKey } from '../types';
import { emailField, fullNameField, newPasswordField, optionalNewPasswordField } from './auth';
import { isMissing, phoneField, problemsOf, type InputReason, type Parsed, type Raw } from './common';

/**
 * User account and role input rules (R2.4b). Same checks and messages as the
 * legacy routes; every failure also carries a `reason`. One change approved by
 * the owner: a phone longer than 30 characters, or with letters, is refused
 * (customers' and suppliers' rule) instead of being cut silently.
 */
export const ROLE_NAME_MIN_LENGTH = 2;
export const ROLE_NAME_MAX_LENGTH = 60;
export const ROLE_NAME_ERROR = `Role name must be between ${ROLE_NAME_MIN_LENGTH} and ${ROLE_NAME_MAX_LENGTH} characters.`;

function parse<T>(schema: z.ZodType<T>, raw: Raw): Parsed<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

/** A role id as sent by the form; anything that is not a whole number matches no role. */
function toRoleId(value: unknown): number {
  const id = Number(value ?? 0);
  return Number.isInteger(id) ? id : 0;
}

/** false or 0 deactivate; anything else that is sent activates. */
const toActive = (value: unknown): 0 | 1 => (value === false || value === 0 ? 0 : 1);

// --------------------------------------------------------------------- users

export interface UserInput {
  full_name: string;
  email: string;
  phone: string;
  /** '' on an update means: keep the current password. */
  password: string;
  role_id: number;
  is_active: 0 | 1;
}

/** What an existing account contributes when the update leaves a field out. */
export interface UserDefaults {
  email: string;
  role_id: number | null;
  is_active: number;
}

const userFields = (password: z.ZodType<string>) =>
  z.object({
    full_name: fullNameField,
    email: emailField,
    phone: phoneField,
    password,
  });

/** POST /api/users. Problems in the legacy order: name, email, (phone), password. */
export function parseNewUser(raw: Raw): Parsed<UserInput> {
  const parsed = parse(userFields(newPasswordField), raw);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { ...parsed.value, role_id: toRoleId(raw.role_id), is_active: toActive(raw.is_active) } };
}

/**
 * PUT /api/users/:id. As before: email, role and status keep their value when
 * not sent; the name and phone are always taken from the request.
 */
export function parseUserUpdate(raw: Raw, existing: UserDefaults): Parsed<UserInput> {
  const parsed = parse(userFields(optionalNewPasswordField), { ...raw, email: raw.email ?? existing.email });
  if (!parsed.ok) return parsed;
  return {
    ok: true,
    value: {
      ...parsed.value,
      role_id: toRoleId(raw.role_id ?? existing.role_id),
      is_active: raw.is_active === undefined ? (existing.is_active === 0 ? 0 : 1) : toActive(raw.is_active),
    },
  };
}

// --------------------------------------------------------------------- roles

export interface RoleInput {
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  /** undefined on an update means: keep the current permissions. */
  permissions: PermissionKey[] | undefined;
}

export interface RoleDefaults {
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
}

const text = (value: unknown, fallback = '') => (isMissing(value) ? fallback : String(value)).trim();

const roleName = z.string().superRefine((value, ctx) => {
  let reason: InputReason | null = null;
  if (value.length === 0) reason = 'REQUIRED';
  else if (value.length < ROLE_NAME_MIN_LENGTH) reason = 'TOO_SHORT';
  else if (value.length > ROLE_NAME_MAX_LENGTH) reason = 'TOO_LONG';
  if (reason) ctx.addIssue({ code: 'custom', message: ROLE_NAME_ERROR, params: { reason } });
});

function checkRoleName(value: RoleInput): Parsed<RoleInput> {
  const checked = parse(z.object({ name_ar: roleName }), { name_ar: value.name_ar });
  return checked.ok ? { ok: true, value } : checked;
}

/** POST /api/roles: the English name and description fall back to the Arabic ones. */
export function parseNewRole(raw: Raw): Parsed<RoleInput> {
  const nameAr = text(raw.name_ar);
  const descAr = text(raw.description_ar);
  return checkRoleName({
    name_ar: nameAr,
    name_en: text(raw.name_en) || nameAr,
    description_ar: descAr,
    description_en: text(raw.description_en) || descAr,
    permissions: sanitizePermissions(raw.permissions),
  });
}

/** PUT /api/roles/:id: fields not sent keep their value (as before). */
export function parseRoleUpdate(raw: Raw, existing: RoleDefaults): Parsed<RoleInput> {
  const nameAr = text(raw.name_ar, existing.name_ar);
  return checkRoleName({
    name_ar: nameAr,
    name_en: text(raw.name_en, existing.name_en) || nameAr,
    description_ar: text(raw.description_ar, existing.description_ar),
    description_en: text(raw.description_en, existing.description_en),
    permissions: raw.permissions === undefined ? undefined : sanitizePermissions(raw.permissions),
  });
}
