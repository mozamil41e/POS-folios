import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  SEED,
  bearer,
  createTestApp,
  createUserWithRole,
  registerFirstAdmin,
  stockOf,
  type TestApp,
} from '../helpers/app.ts';

describe('POST /api/invoices/:id/credit-note (characterization)', () => {
  let t: TestApp;
  let adminToken: string;
  let cashierToken: string;
  let sale: { id: number; invoice_number: string; grand_total: number };
  let creditNote: { id: number };

  const creditNoteFor = (token: string, id: number) =>
    request(t.app).post(`/api/invoices/${id}/credit-note`).set(bearer(token));

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
    ({ token: cashierToken } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local'));
    const res = await request(t.app)
      .post('/api/invoices')
      .set(bearer(adminToken))
      .send({
        items: [{ product_id: SEED.milk.id, qty: 2 }],
        invoice_subtype: '0200000',
        payment_method: 'cash',
        cash_amount: 0,
        discount_total: 0,
        customer_id: null,
      });
    sale = res.body.invoice;
  });
  afterAll(() => t.cleanup());

  it('forbids a user without sales.return', async () => {
    const res = await creditNoteFor(cashierToken, sale.id);
    expect(res.status).toBe(403);
  });

  // D5 (owner): a credit note reverses revenue and VAT but never restocks:
  // a returned dish cannot go back to raw ingredients.
  it('issues a full credit note without putting anything back in stock', async () => {
    const before = await stockOf(t.app, adminToken, SEED.milk.id);
    const movementsBefore = t.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get();
    const res = await creditNoteFor(adminToken, sale.id);
    expect(res.status).toBe(201);

    creditNote = res.body.invoice;
    const cn = res.body.invoice;
    expect(cn.invoice_type_code).toBe('381');
    expect(cn.invoice_number).toMatch(/^CN-\d{4}-\d{5}$/);
    expect(cn.related_invoice_number).toBe(sale.invoice_number);
    expect(cn.grand_total).toBe(sale.grand_total);

    expect(cn.items).toHaveLength(1); // same lines as the sale (milk x2)
    expect(await stockOf(t.app, adminToken, SEED.milk.id)).toBe(before);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual(movementsBefore);
  });

  it('refuses a second credit note for the same invoice', async () => {
    const res = await creditNoteFor(adminToken, sale.id);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already returned/);
  });

  it('refuses a credit note for a credit note', async () => {
    const res = await creditNoteFor(adminToken, creditNote.id);
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown invoice', async () => {
    const res = await creditNoteFor(adminToken, 999_999);
    expect(res.status).toBe(404);
  });
});
