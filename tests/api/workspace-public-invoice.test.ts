import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b, last step: the public invoice page and the workspace bootstrap are
// modules and the legacy router is gone. Same answers as before.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp(); // with the demo workspace
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());

describe('bootstrap reads through the modules, with the same data as the old queries', () => {
  it('products, categories and movements equal the legacy SQL, row for row', async () => {
    const body = await getBootstrap(t.app, adminToken);
    // The exact statements of the removed db.ts readers.
    expect(body.products).toEqual(t.db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY id ASC').all());
    expect(body.categories).toEqual(
      t.db
        .prepare(
          `SELECT c.id, c.name_ar, c.name_en, c.sort_order, c.created_at, c.updated_at,
                  (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
           FROM categories c ORDER BY c.sort_order ASC, c.id ASC`
        )
        .all()
    );
    expect(body.movements).toEqual(
      t.db
        .prepare(
          `SELECT sm.*, p.name_ar as product_name_ar, p.name_en as product_name_en, p.sku as sku
           FROM stock_movements sm JOIN products p ON p.id = sm.product_id ORDER BY sm.id DESC LIMIT 80`
        )
        .all()
    );
  });

  it('settings equal the stored row', async () => {
    const body = await getBootstrap(t.app, adminToken);
    expect(body.settings).toEqual(t.db.prepare('SELECT * FROM organization_settings WHERE id = 1').get());
  });
});

describe('the public invoice page', () => {
  let uuid: string;

  beforeAll(async () => {
    const invoices = (await getBootstrap(t.app, adminToken)).invoices as Array<{ uuid: string; customer_vat: string }>;
    // A B2B invoice of the demo workspace: its customer has a VAT number.
    uuid = (invoices.find((i) => i.customer_vat) ?? invoices[0]).uuid;
  });

  it('answers without a session, with the allowlist only', async () => {
    const res = await request(t.app).get(`/api/public/invoices/${uuid}`);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(['invoice', 'store']);
    expect(Object.keys(res.body.invoice).sort()).toEqual(
      [
        'card_amount',
        'cash_amount',
        'created_at',
        'customer_name',
        'discount_total',
        'grand_total',
        'invoice_number',
        'invoice_subtype',
        'invoice_type_code',
        'items',
        'payment_method',
        'related_invoice_number',
        'subtotal',
        'uuid',
        'vat_total',
      ].sort()
    );
    expect(Object.keys(res.body.invoice.items[0]).sort()).toEqual(
      ['discount', 'line_subtotal', 'line_total', 'line_vat', 'name_ar', 'name_en', 'qty', 'sku', 'tax_category', 'tax_rate', 'unit_ar', 'unit_price'].sort()
    );
    expect(Object.keys(res.body.store).sort()).toEqual(
      ['building_no', 'city_ar', 'cr_number', 'name_ar', 'name_en', 'postal_code', 'public_base_url', 'street_ar', 'vat_number'].sort()
    );
    expect(JSON.stringify(res.body)).not.toMatch(/"(id|invoice_id|product_id|customer_id|customer_vat)"/);
  });

  it('keeps the old messages and adds codes', async () => {
    expect((await request(t.app).get('/api/public/invoices/no-such-invoice')).body).toEqual({
      error: 'Invoice not found.',
      code: 'INVOICE_NOT_FOUND',
    });
    expect((await request(t.app).get(`/api/public/invoices/${'x'.repeat(81)}`)).body).toEqual({
      error: 'Invalid invoice identifier.',
      code: 'INVALID_INVOICE_ID',
    });
  });
});

describe('the API gate after the modules', () => {
  it('answers 401 for any other /api path without a session, so routes cannot be probed', async () => {
    expect((await request(t.app).get('/api/no-such-route')).status).toBe(401);
    expect((await request(t.app).post('/api/no-such-route').send({})).status).toBe(401);
  });

  it('lets a signed-in request through to "not found"', async () => {
    expect((await request(t.app).get('/api/no-such-route').set(bearer(adminToken))).status).toBe(404);
  });
});
