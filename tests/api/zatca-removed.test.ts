import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED, bearer, createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

const ZATCA_INVOICE_FIELDS = [
  'icv', 'invoice_hash', 'previous_hash', 'qr_tlv_base64', 'xml_content',
  'zatca_status', 'zatca_mode', 'zatca_response_json',
];
const ZATCA_SETTINGS_FIELDS = [
  'egs_serial', 'mode', 'zatca_enabled', 'ccsid_token', 'ccsid_secret', 'ccsid_request_id',
  'pcsid_token', 'pcsid_secret', 'private_key_pem', 'public_key_base64', 'csr_pem',
  'onboarding_step', 'last_icv', 'last_pih',
];

// R1.4: the ZATCA integration is out of scope and fully removed.
describe('ZATCA integration removed (R1.4)', () => {
  let t: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it.each([
    ['/api/zatca/generate-keys'],
    ['/api/zatca/onboard'],
    ['/api/zatca/decode-qr'],
    ['/api/invoices/1/retry'],
  ])('no longer serves %s (404, even for an admin)', async (path) => {
    const res = await request(t.app).post(path).set(bearer(adminToken)).send({});
    expect(res.status).toBe(404);
  });

  it('removes the ZATCA permission from every role', async () => {
    const me = await request(t.app).get('/api/auth/me').set(bearer(adminToken));
    expect(me.body.user.permissions).not.toContain('zatca.manage');
    const roles = await request(t.app).get('/api/roles').set(bearer(adminToken));
    for (const role of roles.body.roles) expect(role.permissions).not.toContain('zatca.manage');
  });

  it('keeps no ZATCA columns in the database', () => {
    const cols = (table: string) =>
      (t.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
    for (const field of ZATCA_INVOICE_FIELDS) expect(cols('invoices')).not.toContain(field);
    for (const field of ZATCA_SETTINGS_FIELDS) expect(cols('organization_settings')).not.toContain(field);
  });

  it('issues sales invoices and credit notes without XML, hashes or ZATCA status', async () => {
    const sale = await request(t.app)
      .post('/api/invoices')
      .set(bearer(adminToken))
      .send({
        items: [{ product_id: SEED.milk.id, qty: 1 }],
        invoice_subtype: '0200000',
        payment_method: 'cash',
        cash_amount: 0,
        discount_total: 0,
        customer_id: null,
      });
    expect(sale.status).toBe(201);
    expect(sale.body.invoice.uuid).toMatch(/^[0-9a-f-]{36}$/); // used by the public link / QR

    const creditNote = await request(t.app)
      .post(`/api/invoices/${sale.body.invoice.id}/credit-note`)
      .set(bearer(adminToken));
    expect(creditNote.status).toBe(201);

    for (const invoice of [sale.body.invoice, creditNote.body.invoice]) {
      for (const field of ZATCA_INVOICE_FIELDS) expect(invoice).not.toHaveProperty(field);
    }
  });

  it('ignores legacy ZATCA fields sent to the settings API', async () => {
    const res = await request(t.app)
      .put('/api/settings')
      .set(bearer(adminToken))
      .send({ zatca_enabled: 1, mode: 'fatoora_simulation', egs_serial: 'X', table_page_size: 20 });
    expect(res.status).toBe(200);
    expect(res.body.settings.table_page_size).toBe(20);
    for (const field of ZATCA_SETTINGS_FIELDS) expect(res.body.settings).not.toHaveProperty(field);
  });

  it('serves the public invoice page data that the receipt QR links to', async () => {
    const { invoices } = await getBootstrap(t.app, adminToken);
    const res = await request(t.app).get(`/api/public/invoices/${invoices[0].uuid}`);
    expect(res.status).toBe(200);
    expect(res.body.invoice.invoice_number).toBe(invoices[0].invoice_number);
  });
});
