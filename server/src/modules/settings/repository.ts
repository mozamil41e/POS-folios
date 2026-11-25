import type { SettingsInput } from '../../../../shared/schemas/settings.ts';
import type { FontSizeLevel, OrganizationSettings } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Restaurant settings data access (R2.4b). One row (id = 1), created by
 * initDatabase(). Reads name every column (no SELECT *), so a column added
 * later never reaches the client by accident.
 */
const SETTINGS_ID = 1;

const COLUMNS = [
  'id',
  'name_ar',
  'name_en',
  'vat_number',
  'cr_number',
  'street_ar',
  'building_no',
  'city_ar',
  'postal_code',
  'country_code',
  'public_base_url',
  'thermal_width_mm',
  'auto_print_receipt',
  'font_size',
  'table_page_size',
] as const;

const fontSize = (value: string): FontSizeLevel => (value === 'small' || value === 'large' ? value : 'medium');

export const settings = {
  async get(q: Executor): Promise<OrganizationSettings | undefined> {
    const row = await q.selectFrom('organization_settings').select(COLUMNS).where('id', '=', SETTINGS_ID).executeTakeFirst();
    return row ? { ...row, font_size: fontSize(row.font_size) } : undefined;
  },

  async update(q: Executor, values: SettingsInput): Promise<void> {
    await q.updateTable('organization_settings').set(values).where('id', '=', SETTINGS_ID).execute();
  },
};
