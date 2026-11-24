import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

describe('GET /api/public/invoices/:uuid (characterization)', () => {
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

    // CURRENT BEHAVIOUR (SEC-14): the buyer VAT number is sent although the
    // page never shows it. R1.9 removes it — flip this expectation then.
    expect(invoice).toHaveProperty('customer_vat');
  });

  it('returns 404 for an unknown uuid and 400 for an oversized identifier', async () => {
    expect((await request(t.app).get('/api/public/invoices/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await request(t.app).get(`/api/public/invoices/${'x'.repeat(81)}`)).status).toBe(400);
  });
});
