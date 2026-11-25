import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b: the purchases module. Same totals, numbers and responses as before
// (tests/api/purchases.test.ts runs unchanged), plus the fixes and the
// owner's decisions: whole quantities, status from the amount for "partial",
// VAT 15 or 0, unknown statuses refused, and a product listed twice adds up.
let t: TestApp;
let adminToken: string;
let supplierId: number;
let productA: number;
let productB: number;

const api = (method: 'post', path: string, body: Record<string, unknown>, token = adminToken) =>
  request(t.app)[method](path).set(bearer(token)).send(body);
const buy = (body: Record<string, unknown>) =>
  api('post', '/api/purchases', { supplier_id: supplierId, supplier_invoice_no: '', notes: '', payment_status: 'paid', ...body });
const line = (product_id: number, qty: unknown, unit_cost: unknown = 10, tax_rate: unknown = 15) => ({
  product_id,
  qty,
  unit_cost,
  tax_rate,
});

const stock = (id: number) => (t.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id) as { stock_qty: number }).stock_qty;
const ledger = (id: number) =>
  (t.db.prepare('SELECT COALESCE(SUM(qty_delta), 0) AS n FROM stock_movements WHERE product_id = ?').get(id) as { n: number }).n;
const purchaseCount = () => (t.db.prepare('SELECT COUNT(*) AS n FROM purchases').get() as { n: number }).n;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  supplierId = (await api('post', '/api/suppliers', { name_ar: 'مورد اللحوم' })).body.supplierId;
  productA = (await api('post', '/api/products', { sku: 'A', name_ar: 'لحم', sell_price: 50, tax_rate: 15 })).body.product.id;
  productB = (await api('post', '/api/products', { sku: 'B', name_ar: 'رز', sell_price: 20, tax_rate: 0 })).body.product.id;
});
afterAll(() => t.cleanup());

describe('recording a purchase', () => {
  it('adds up a product listed twice (the legacy route kept only the last line)', async () => {
    const res = await buy({ items: [line(productA, 3), line(productA, 5, 12)] });
    expect(res.status).toBe(201);
    expect(stock(productA)).toBe(8);
    expect(ledger(productA)).toBe(stock(productA));
    const balances = (t.db.prepare('SELECT balance_after FROM stock_movements WHERE product_id = ? ORDER BY id').all(productA) as Array<{
      balance_after: number;
    }>).map((m) => m.balance_after);
    expect(balances).toEqual([3, 8]);
    // The last line's cost becomes the cost price (moving average comes in R5).
    expect((t.db.prepare('SELECT cost_price FROM products WHERE id = ?').get(productA) as { cost_price: number }).cost_price).toBe(12);
  });

  it('computes the totals line by line, with VAT 15% and 0%', async () => {
    const res = await buy({ items: [line(productA, 3, 1.15, 15), line(productB, 2, 4, 0)] });
    expect(res.body.purchase).toMatchObject({ subtotal: 11.45, vat_total: 0.52, grand_total: 11.97, paid_amount: 11.97 });
    expect(res.body.purchase.items.map((i: { line_total: number }) => i.line_total)).toEqual([3.97, 8]);
    expect(res.body.purchases[0].id).toBe(res.body.purchase.id); // newest first
    expect(res.body.purchases[0].supplier_name).toBe('مورد اللحوم');
  });

  it('numbers purchases without gaps, even after refused ones', async () => {
    const first = (await buy({ items: [line(productB, 1)] })).body.purchase.purchase_number as string;
    expect((await buy({ items: [line(productB, 1.5)] })).status).toBe(400);
    expect((await buy({ items: [line(productB, 1), line(99999, 1)] })).status).toBe(400);
    const next = (await buy({ items: [line(productB, 1)] })).body.purchase.purchase_number as string;
    const n = (s: string) => Number(s.split('-')[2]);
    expect(n(next)).toBe(n(first) + 1);
  });
});

describe("owner's decision (a): whole quantities only", () => {
  it('refuses 2.7 instead of recording 2, and changes nothing', async () => {
    const before = { stock: stock(productB), purchases: purchaseCount() };
    const res = await buy({ items: [line(productB, 1), line(productB, 2.7)] });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'INVALID_PURCHASE_LINE', code: 'INVALID_PURCHASE_LINE', line: 2, field: 'qty', reason: 'NOT_INTEGER' });
    expect({ stock: stock(productB), purchases: purchaseCount() }).toEqual(before);
  });

  it('accepts Arabic digits', async () => {
    expect((await buy({ items: [line(productB, '٤')] })).status).toBe(201);
  });
});

describe("owner's decision (a): a partial payment's status follows the amount", () => {
  const partial = async (paid: unknown) => (await buy({ payment_status: 'partial', paid_amount: paid, items: [line(productB, 1, 100, 0)] })).body;

  it('nothing paid is credit, the full amount is paid, in between is partial', async () => {
    expect((await partial(0)).purchase).toMatchObject({ payment_status: 'credit', paid_amount: 0 });
    expect((await partial('')).purchase).toMatchObject({ payment_status: 'credit', paid_amount: 0 });
    expect((await partial(40)).purchase).toMatchObject({ payment_status: 'partial', paid_amount: 40 });
    expect((await partial(100)).purchase).toMatchObject({ payment_status: 'paid', paid_amount: 100 });
    expect((await partial(250)).purchase).toMatchObject({ payment_status: 'paid', paid_amount: 100 }); // capped, as before
  });

  it('refuses an amount that is not a number or is negative', async () => {
    expect(await partial('abc')).toMatchObject({ code: 'VALIDATION_FAILED', field: 'paid_amount', reason: 'INVALID_NUMBER' });
    expect(await partial(-5)).toMatchObject({ field: 'paid_amount', reason: 'MUST_NOT_BE_NEGATIVE' });
  });

  it('ignores paid_amount for paid and credit, as before', async () => {
    const paid = (await buy({ payment_status: 'paid', paid_amount: 'abc', items: [line(productB, 1, 100, 0)] })).body.purchase;
    expect(paid).toMatchObject({ payment_status: 'paid', paid_amount: 100 });
    const credit = (await buy({ payment_status: 'credit', paid_amount: 60, items: [line(productB, 1, 100, 0)] })).body.purchase;
    expect(credit).toMatchObject({ payment_status: 'credit', paid_amount: 0 });
  });
});

describe('following earlier decisions: VAT 15 or 0, unknown statuses refused', () => {
  it('refuses another VAT rate, and a rate that is not a number (it used to fail with 500)', async () => {
    expect((await buy({ items: [line(productB, 1, 10, 7)] })).body).toMatchObject({ code: 'INVALID_PURCHASE_LINE', field: 'tax_rate', reason: 'INVALID_TAX' });
    const notANumber = await buy({ items: [line(productB, 1, 10, 'abc')] });
    expect(notANumber.status).toBe(400);
    expect(notANumber.body).toMatchObject({ code: 'INVALID_PURCHASE_LINE', field: 'tax_rate' });
  });

  it('defaults a missing VAT rate to 15%, as before', async () => {
    const res = await buy({ items: [{ product_id: productB, qty: 1, unit_cost: 100 }] });
    expect(res.body.purchase.vat_total).toBe(15);
  });

  it('refuses a misspelt payment status instead of recording it as paid', async () => {
    const before = purchaseCount();
    const res = await buy({ payment_status: 'credt', items: [line(productB, 1)] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'payment_status', reason: 'INVALID_CHOICE' });
    expect(purchaseCount()).toBe(before);
  });
});

describe('the old messages and codes, now with the line and field', () => {
  it('requires a supplier and lines', async () => {
    const noSupplier = await api('post', '/api/purchases', { items: [line(productB, 1)] });
    expect(noSupplier.body).toEqual({
      error: 'Supplier and at least one line item are required.',
      code: 'VALIDATION_FAILED',
      field: 'supplier_id',
      reason: 'REQUIRED',
    });
    const noLines = await buy({ items: [] });
    expect(noLines.body).toMatchObject({ error: 'Supplier and at least one line item are required.', field: 'items' });
  });

  it('names the unknown supplier and the line of an unknown or inactive product', async () => {
    expect((await buy({ supplier_id: 99999, items: [line(productB, 1)] })).body).toEqual({
      error: 'SUPPLIER_NOT_FOUND',
      code: 'SUPPLIER_NOT_FOUND',
      field: 'supplier_id',
    });
    expect((await buy({ items: [line(productB, 1), line(99999, 1)] })).body).toEqual({
      error: 'PRODUCT_NOT_FOUND',
      code: 'PRODUCT_NOT_FOUND',
      line: 2,
      field: 'product_id',
    });
    const hidden = (await api('post', '/api/products', { sku: 'HIDDEN', name_ar: 'موقوف', sell_price: 1, tax_rate: 0 })).body.product.id;
    await request(t.app).delete(`/api/products/${hidden}`).set(bearer(adminToken));
    expect((await buy({ items: [line(hidden, 1)] })).body).toMatchObject({ code: 'PRODUCT_NOT_FOUND', line: 1 });
  });

  it('checks the lines in order, as before: a bad line 1 comes before an unknown product on line 2', async () => {
    expect((await buy({ items: [line(productB, 0), line(99999, 1)] })).body).toMatchObject({
      code: 'INVALID_PURCHASE_LINE',
      line: 1,
      field: 'qty',
      reason: 'MUST_BE_POSITIVE',
    });
  });
});

describe('paying a supplier', () => {
  let purchaseId: number;
  const pay = (id: number, amount: unknown) => api('post', `/api/purchases/${id}/pay`, { amount });

  beforeAll(async () => {
    purchaseId = (await buy({ payment_status: 'credit', items: [line(productB, 1, 100, 0)] })).body.purchase.id;
  });

  it('keeps the old messages and adds codes', async () => {
    expect((await pay(99999, 10)).body).toEqual({ error: 'Purchase invoice not found.', code: 'PURCHASE_NOT_FOUND' });
    for (const amount of ['abc', 'Infinity', 0, -1]) {
      const res = await pay(purchaseId, amount);
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ error: 'Positive payment amount is required.', code: 'VALIDATION_FAILED', field: 'amount' });
    }
  });

  it('applies two payments sent at the same time', async () => {
    const [a, b] = await Promise.all([pay(purchaseId, 30), pay(purchaseId, 20)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const row = t.db.prepare('SELECT paid_amount, payment_status FROM purchases WHERE id = ?').get(purchaseId);
    expect(row).toEqual({ paid_amount: 50, payment_status: 'partial' });
  });

  it('needs purchases.manage', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local');
    expect((await api('post', `/api/purchases/${purchaseId}/pay`, { amount: 1 }, token)).status).toBe(403);
    expect((await api('post', '/api/purchases', { supplier_id: supplierId, items: [line(productB, 1)] }, token)).status).toBe(403);
  });
});

describe('the ledger', () => {
  it('still equals the balance of every product after all of the above', () => {
    for (const id of [productA, productB]) expect(ledger(id)).toBe(stock(id));
  });
});
