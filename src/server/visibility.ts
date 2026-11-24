// Server-side read scoping (R1.3, SEC-02 / SEC-03).
//
// Every response that carries workspace data passes through scopeForUser():
// - lists a user may not read are removed (rules in src/permissions.ts),
// - product cost prices are removed for users without cost permission (D11),
// - organisation settings never include secrets. Since R1.4 (ZATCA removed) the
//   settings table holds none; the legacy names stay blocked as a safety net in
//   case an old, unmigrated database is ever served.
import type { AuthUser, OrganizationSettings } from '../types.ts';
import { DATA_VISIBILITY, canViewCost, canViewData, type VisibleDataKey } from '../permissions.ts';

const LEGACY_SECRET_FIELDS = [
  'private_key_pem',
  'ccsid_secret',
  'pcsid_secret',
  'ccsid_token',
  'pcsid_token',
  'csr_pem',
] as const;

function omit<T extends object>(source: T, keys: readonly string[]): T {
  const copy = { ...source } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as T;
}

export function toPublicSettings(org: OrganizationSettings): OrganizationSettings {
  return omit(org, LEGACY_SECRET_FIELDS);
}

function stripCost<T extends object>(product: T): T {
  return omit(product, ['cost_price']);
}

/**
 * Removes everything the user may not read from a response payload. Keys that
 * are not workspace data (invoice, purchase, users, message, ...) pass through.
 */
export function scopeForUser<T extends Record<string, unknown>>(user: AuthUser, payload: T): T {
  const scoped: Record<string, unknown> = {};
  const showCost = canViewCost(user);

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;

    if (key in DATA_VISIBILITY && !canViewData(user, key as VisibleDataKey)) {
      continue;
    }

    if (key === 'settings' && value) {
      scoped[key] = toPublicSettings(value as OrganizationSettings);
    } else if (key === 'products' && Array.isArray(value) && !showCost) {
      scoped[key] = value.map((p) => stripCost(p as object));
    } else if (key === 'product' && value && typeof value === 'object' && !showCost) {
      scoped[key] = stripCost(value);
    } else {
      scoped[key] = value;
    }
  }

  return scoped as T;
}
