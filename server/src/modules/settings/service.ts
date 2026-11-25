import type { Raw } from '../../../../shared/schemas/common.ts';
import { parseSettings } from '../../../../shared/schemas/settings.ts';
import type { OrganizationSettings } from '../../../../shared/types.ts';
import { kysely } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import * as repo from './repository.ts';

/**
 * Restaurant and printing settings (R2.4b). Same rules and messages as the
 * legacy route, with the owner's options (a)+(a): length limits on the text
 * fields, and values outside the allowed choices refused.
 */

/** The settings row; initDatabase() always creates it, so a missing row is a bug (500). */
export async function getSettings(): Promise<OrganizationSettings> {
  const current = await repo.settings.get(kysely);
  if (!current) throw new Error('organization_settings row 1 is missing');
  return current;
}

/** Fields not sent keep their value. Returns the saved settings. */
export async function updateSettings(raw: Raw): Promise<OrganizationSettings> {
  const input = valueOrThrow(parseSettings(raw, await getSettings()));
  await withTransaction((trx) => repo.settings.update(trx, input));
  return getSettings();
}
