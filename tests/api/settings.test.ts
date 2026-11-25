import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b: the settings module (server/src/modules/settings). Same path, rules,
// messages and response as before, plus the owner's options (a)+(a): length
// limits on the text fields, and values outside the choices refused.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());

const VALID = { name_ar: 'مطعم الميزان', vat_number: '300000000000003' };
const put = (body: Record<string, unknown>, token = adminToken) =>
  request(t.app).put('/api/settings').set(bearer(token)).send(body);
const stored = () =>
  t.db.prepare('SELECT * FROM organization_settings WHERE id = 1').get() as Record<string, string | number>;

describe('saving settings', () => {
  it('saves every field and answers with the settings', async () => {
    const res = await put({
      ...VALID,
      name_en: ' Mizan Restaurant ',
      cr_number: '1010101010',
      street_ar: 'طريق الملك فهد',
      building_no: '1234',
      city_ar: 'الرياض',
      postal_code: '12345',
      public_base_url: ' https://pos.example.com/receipts/// ',
      thermal_width_mm: 58,
      auto_print_receipt: 1,
      font_size: 'large',
      table_page_size: 20,
    });
    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      name_ar: 'مطعم الميزان',
      name_en: 'Mizan Restaurant',
      vat_number: '300000000000003',
      public_base_url: 'https://pos.example.com/receipts',
      thermal_width_mm: 58,
      auto_print_receipt: 1,
      font_size: 'large',
      table_page_size: 20,
    });
    expect(stored()).toMatchObject({ street_ar: 'طريق الملك فهد', postal_code: '12345', city_ar: 'الرياض' });
  });

  it('keeps every field that is not sent', async () => {
    const before = stored();
    const res = await put({ table_page_size: 50 });
    expect(res.status).toBe(200);
    expect(stored()).toEqual({ ...before, table_page_size: 50 });
  });

  it('reads the choices as before: strings for numbers, true/false or 0/1 for auto print', async () => {
    expect((await put({ thermal_width_mm: '80', table_page_size: '10', auto_print_receipt: false })).status).toBe(200);
    expect(stored()).toMatchObject({ thermal_width_mm: 80, table_page_size: 10, auto_print_receipt: 0 });
    expect((await put({ auto_print_receipt: true, font_size: 'small' })).status).toBe(200);
    expect(stored()).toMatchObject({ auto_print_receipt: 1, font_size: 'small' });
  });

  it('clears the public link with an empty value, and drops query and fragment', async () => {
    expect((await put({ public_base_url: 'http://192.168.1.5:3000/?x=1#top' })).body.settings.public_base_url).toBe(
      'http://192.168.1.5:3000'
    );
    expect((await put({ public_base_url: '' })).body.settings.public_base_url).toBe('');
  });

  it('sends only the known settings columns', async () => {
    const res = await put({});
    expect(Object.keys(res.body.settings).sort()).toEqual(
      [
        'auto_print_receipt',
        'building_no',
        'city_ar',
        'country_code',
        'cr_number',
        'font_size',
        'id',
        'name_ar',
        'name_en',
        'postal_code',
        'public_base_url',
        'street_ar',
        'table_page_size',
        'thermal_width_mm',
        'vat_number',
      ].sort()
    );
  });
});

describe('the old checks, messages and order', () => {
  it('checks the public link first, then the store name and VAT number', async () => {
    const badScheme = await put({ public_base_url: 'ftp://example.com', name_ar: '' });
    expect(badScheme.status).toBe(400);
    expect(badScheme.body).toEqual({
      error: 'Public Base URL must use http:// or https://',
      code: 'VALIDATION_FAILED',
      field: 'public_base_url',
      reason: 'INVALID_URL',
    });

    const badFormat = await put({ public_base_url: 'not a url' });
    expect(badFormat.body).toMatchObject({ error: 'Invalid Public Base URL format.', reason: 'INVALID_URL' });

    const noName = await put({ name_ar: '  ' });
    expect(noName.body).toEqual({
      error: 'Store name and VAT number are required.',
      code: 'VALIDATION_FAILED',
      field: 'name_ar',
      reason: 'REQUIRED',
    });

    const noVat = await put({ vat_number: '' });
    expect(noVat.body).toMatchObject({ error: 'Store name and VAT number are required.', field: 'vat_number', reason: 'REQUIRED' });

    const badVat = await put({ vat_number: '123' });
    expect(badVat.body).toEqual({
      error: 'VAT number must be 15 digits starting and ending with 3.',
      code: 'VALIDATION_FAILED',
      field: 'vat_number',
      reason: 'INVALID_VAT',
    });
  });

  it('changes nothing when a request is refused', async () => {
    const before = stored();
    await put({ name_en: 'Changed', vat_number: '123' });
    expect(stored()).toEqual(before);
  });

  it('needs settings.manage', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'manager', 'manager@test.local', 'manager-pass-1');
    expect((await put(VALID, token)).status).toBe(403);
    expect((await request(t.app).put('/api/settings').send(VALID)).status).toBe(401);
  });
});

describe("owner's option (a): length limits on the text fields", () => {
  it.each([
    ['name_ar', 121],
    ['name_en', 121],
    ['cr_number', 31],
    ['street_ar', 121],
    ['building_no', 21],
    ['city_ar', 61],
    ['postal_code', 21],
  ])('refuses %s longer than the limit', async (field, length) => {
    const res = await put({ [field]: 'ب'.repeat(length) });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field, reason: 'TOO_LONG' });
  });

  it('accepts the limits exactly, and does not check formats', async () => {
    const res = await put({
      name_ar: 'ب'.repeat(120),
      cr_number: 'CR-ABC-1',
      building_no: '7',
      postal_code: 'P.O. 1',
    });
    expect(res.status).toBe(200);
  });

  it('refuses a public link longer than 300 characters', async () => {
    const res = await put({ public_base_url: `https://example.com/${'a'.repeat(300)}` });
    expect(res.body).toMatchObject({ field: 'public_base_url', reason: 'TOO_LONG' });
  });
});

describe("owner's option (a): values outside the choices are refused", () => {
  it.each([
    ['thermal_width_mm', 70],
    ['thermal_width_mm', 'wide'],
    ['table_page_size', 15],
    ['font_size', 'huge'],
    ['auto_print_receipt', 'yes'],
  ])('refuses %s = %s', async (field, value) => {
    const before = stored();
    const res = await put({ [field]: value });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field, reason: 'INVALID_CHOICE' });
    expect(stored()).toEqual(before);
  });
});
