import { describe, expect, it } from 'vitest';
import { normalisePublicBaseUrl, parseSettings, type SettingsDefaults } from '../../shared/schemas/settings.ts';

// R2.4b: the settings rules shared by the server and the UI.
const CURRENT: SettingsDefaults = {
  name_ar: 'مطعم',
  name_en: '',
  vat_number: '300000000000003',
  cr_number: '',
  street_ar: '',
  building_no: '',
  city_ar: '',
  postal_code: '',
  public_base_url: '',
  thermal_width_mm: 80,
  auto_print_receipt: 1,
  font_size: 'medium',
  table_page_size: 10,
};

describe('parseSettings', () => {
  it('returns the current settings when nothing is sent (null counts as not sent)', () => {
    expect(parseSettings({ name_en: null }, CURRENT)).toEqual({ ok: true, value: CURRENT });
  });

  it('falls back to the defaults when a stored choice is no longer valid', () => {
    const odd = { ...CURRENT, thermal_width_mm: 72, table_page_size: 7, font_size: 'tiny' as never };
    const parsed = parseSettings({}, odd);
    expect(parsed.ok ? [parsed.value.thermal_width_mm, parsed.value.table_page_size, parsed.value.font_size] : null).toEqual([
      80, 10, 'medium',
    ]);
  });

  it('reports one problem per field, the public link first', () => {
    const parsed = parseSettings({ public_base_url: 'x', name_ar: '', table_page_size: 3 }, CURRENT);
    expect(parsed.ok ? [] : parsed.problems.map((p) => `${p.field}:${p.reason}`)).toEqual([
      'public_base_url:INVALID_URL',
      'name_ar:REQUIRED',
      'table_page_size:INVALID_CHOICE',
    ]);
  });
});

describe('normalisePublicBaseUrl', () => {
  it('keeps origin and path without trailing slashes', () => {
    expect(normalisePublicBaseUrl(' https://Example.com/a/b// ')).toEqual({ ok: true, url: 'https://example.com/a/b' });
    expect(normalisePublicBaseUrl('https://example.com')).toEqual({ ok: true, url: 'https://example.com' });
    expect(normalisePublicBaseUrl('')).toEqual({ ok: true, url: '' });
  });

  it('refuses other schemes and malformed links', () => {
    expect(normalisePublicBaseUrl('javascript:alert(1)').ok).toBe(false);
    expect(normalisePublicBaseUrl('example.com').ok).toBe(false);
  });
});
