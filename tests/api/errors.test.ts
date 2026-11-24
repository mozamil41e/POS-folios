import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED, bearer, createTestApp, getBootstrap, registerFirstAdmin, stockOf, type TestApp } from '../helpers/app.ts';

// Failures are simulated with temporary SQLite triggers on the test database.
describe('error handling (R1.5)', () => {
  let t: TestApp;
  let adminToken: string;

  const cashSale = (productId: number) => ({
    items: [{ product_id: productId, qty: 1 }],
    invoice_subtype: '0200000',
    payment_method: 'cash',
    cash_amount: 0,
    discount_total: 0,
    customer_id: null,
  });
  const sell = () => request(t.app).post('/api/invoices').set(bearer(adminToken)).send(cashSale(SEED.milk.id));
  const expectJsonWithoutInternals = (res: { headers: Record<string, string>; text: string }) => {
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.text).not.toMatch(/<html|<pre>|\bat \S+ \(|node_modules|server\.ts/i);
  };

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it('answers malformed JSON with a 400 JSON error', async () => {
    const res = await request(t.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": "broken"');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_JSON');
    expectJsonWithoutInternals(res);
  });

  it('answers an oversized body with a 413 JSON error', async () => {
    const res = await request(t.app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'x@test.local', password: 'x'.repeat(3 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('turns an unexpected error in a sync route into a 500 JSON without internals', async () => {
    t.db.exec(`CREATE TRIGGER fail_vouchers BEFORE INSERT ON vouchers BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
    try {
      const res = await request(t.app)
        .post('/api/vouchers')
        .set(bearer(adminToken))
        .send({ voucher_type: 'receipt', payment_channel: 'cash', party_name: 'X', amount: 10, voucher_date: '2026-11-01' });
      expect(res.status).toBe(500);
      expect(res.body).toEqual({ error: 'Internal server error.', code: 'INTERNAL' });
      expectJsonWithoutInternals(res);
      expect(res.text).not.toContain('simulated failure');
    } finally {
      t.db.exec('DROP TRIGGER fail_vouchers');
    }
  });

  // SEC-08: before R1.5 this was an unhandled rejection that crashed the process.
  it('keeps the server alive when an async route fails (credit note)', async () => {
    const sale = await sell();
    expect(sale.status).toBe(201);
    const stockAfterSale = await stockOf(t.app, adminToken, SEED.milk.id);

    t.db.exec(
      `CREATE TRIGGER fail_credit_notes BEFORE INSERT ON invoices WHEN NEW.invoice_type_code = '381'
       BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`
    );
    try {
      const res = await request(t.app)
        .post(`/api/invoices/${sale.body.invoice.id}/credit-note`)
        .set(bearer(adminToken));
      expect(res.status).toBe(500);
      expect(res.body.code).toBe('INTERNAL');
      expectJsonWithoutInternals(res);
    } finally {
      t.db.exec('DROP TRIGGER fail_credit_notes');
    }

    // The failed credit note was rolled back (no restock) and the server still answers.
    expect(await stockOf(t.app, adminToken, SEED.milk.id)).toBe(stockAfterSale);
    expect((await request(t.app).get('/api/auth/status')).status).toBe(200);
  });

  // The R1.5 "failure after save" test hooked the ZATCA status update, which no
  // longer exists since R1.4 (nothing runs after the sale is committed). A sale
  // that fails inside its transaction leaves nothing behind:
  it('leaves no invoice and no stock change when the sale itself fails', async () => {
    const before = await getBootstrap(t.app, adminToken);
    const stockBefore = before.products.find((p: { id: number }) => p.id === SEED.milk.id).stock_qty;

    t.db.exec(`CREATE TRIGGER fail_invoice_items BEFORE INSERT ON invoice_items BEGIN SELECT RAISE(ABORT, 'simulated'); END;`);
    let res;
    try {
      res = await sell();
    } finally {
      t.db.exec('DROP TRIGGER fail_invoice_items');
    }

    expect(res.status).toBe(500);
    const after = await getBootstrap(t.app, adminToken);
    expect(after.invoices.length).toBe(before.invoices.length);
    expect(after.products.find((p: { id: number }) => p.id === SEED.milk.id).stock_qty).toBe(stockBefore);
  });

  it('still reports known business errors as 400 with their code', async () => {
    const res = await request(t.app)
      .post('/api/invoices')
      .set(bearer(adminToken))
      .send(cashSale(SEED.juiceOutOfStock.id));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(res.body.error).toMatch(/^INSUFFICIENT_STOCK:/);
  });

  it('hides unexpected purchase errors behind a generic 500', async () => {
    t.db.exec(`CREATE TRIGGER fail_purchases BEFORE INSERT ON purchases BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`);
    try {
      const res = await request(t.app)
        .post('/api/purchases')
        .set(bearer(adminToken))
        .send({ supplier_id: SEED.supplierId, items: [{ product_id: SEED.milk.id, qty: 1, unit_cost: 5, tax_rate: 15 }] });
      expect(res.status).toBe(500);
      expect(res.text).not.toContain('simulated failure');
    } finally {
      t.db.exec('DROP TRIGGER fail_purchases');
    }
  });
});
