import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

describe('GET /api/public/invoices/:uuid', () => {
  let t: TestApp;
  let uuid: string;

  beforeAll(async () => {
    t = await createTestApp();
    const adminToken = await registerFirstAdmin(t.app);
    const body = await getBootstrap(t.app, adminToken);
    uuid = body.invoices[0].uuid;
  });
  afterAll(() => t.cleanup());

  it('serves a limited public view of an invoice without authentication', async () => {
    const res = await request(t.app).get(`/api/public/invoices/${uuid}`);
    expect(res.status).toBe(200);

    const { invoice, store } = res.body;
    expect(invoice.uuid).toBe(uuid);
    expect(invoice.items.length).toBeGreaterThan(0);
    expect(invoice).not.toHaveProperty('id');
    expect(invoice).not.toHaveProperty('xml_content');
    expect(invoice).not.toHaveProperty('invoice_hash');
    expect(invoice).not.toHaveProperty('qr_tlv_base64');
    expect(store).toHaveProperty('name_ar');
    expect(store).toHaveProperty('vat_number');
    expect(store).not.toHaveProperty('private_key_pem');
    expect(store).not.toHaveProperty('pcsid_secret');

    // SEC-14 fixed in R1.9: the page never shows the buyer VAT number, so it is not sent.
    expect(invoice).not.toHaveProperty('customer_vat');
    // Lines carry no internal ids either.
    for (const item of invoice.items) {
      expect(Object.keys(item).sort()).toEqual(
        ['discount', 'line_subtotal', 'line_total', 'line_vat', 'name_ar', 'name_en', 'qty', 'sku',
          'tax_category', 'tax_rate', 'unit_ar', 'unit_price'].sort()
      );
    }
  });

  it('asks search engines not to index it (R1.9)', async () => {
    const res = await request(t.app).get(`/api/public/invoices/${uuid}`);
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('returns 404 for an unknown uuid and 400 for an oversized identifier', async () => {
    expect((await request(t.app).get('/api/public/invoices/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(t.app).get(`/api/public/invoices/${'x'.repeat(81)}`)).status).toBe(400);
  });
});
