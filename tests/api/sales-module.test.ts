import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as settingsService from '../../server/src/modules/settings/service.ts';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b: the sales module. Same totals, numbers, codes and responses as
// before (checkout/credit-note tests run unchanged), plus the owner's split
// rule (a), whole quantities and refused unknown choices, and 400 instead
// of 500 for values that are not numbers.
let t: TestApp;
let adminToken: string;
let tea: number;
let rice: number;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  const product = async (sku: string, price: number, stock: number) =>
    (await request(t.app).post('/api/products').set(bearer(adminToken)).send({ sku, name_ar: sku === 'TEA' ? 'شاي' : 'رز', sell_price: price, tax_rate: 15, stock_qty: stock })).body.product.id as number;
  tea = await product('TEA', 10, 50); // 11.50 with VAT
  rice = await product('RICE', 20, 3);
});
afterAll(() => t.cleanup());
afterEach(() => {
  vi.restoreAllMocks();
});

const sell = (body: Record<string, unknown>, token = adminToken) =>
  request(t.app)
    .post('/api/invoices')
    .set(bearer(token))
    .send({ items: [{ product_id: tea, qty: 1 }], payment_method: 'cash', invoice_subtype: '0200000', discount_total: 0, ...body });
const stock = (id: number) => (t.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id) as { stock_qty: number }).stock_qty;
const ledger = (id: number) =>
  (t.db.prepare('SELECT COALESCE(SUM(qty_delta), 0) AS n FROM stock_movements WHERE product_id = ?').get(id) as { n: number }).n;
const invoiceCount = () => (t.db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n;

describe("owner's decision (a): a split payment has a cash part and a card part", () => {
  it('refuses a split without cash, or with all of it in cash, and saves nothing', async () => {
    const before = { stock: stock(tea), invoices: invoiceCount() };
    for (const cash of [0, '', undefined, 11.5, 500]) {
      const res = await sell({ payment_method: 'split', cash_amount: cash });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ code: 'INVALID_SPLIT', field: 'cash_amount', grand_total: 11.5 });
    }
    expect({ stock: stock(tea), invoices: invoiceCount() }).toEqual(before);
  });

  it('accepts a real split, with the cash part rounded to halalas', async () => {
    const res = await sell({ payment_method: 'split', cash_amount: 5.004 });
    expect(res.status).toBe(201);
    expect(res.body.invoice).toMatchObject({ payment_method: 'split', cash_amount: 5, card_amount: 6.5, grand_total: 11.5 });
  });

  it('refuses a cash part that is not a number (it used to fail with 500)', async () => {
    const res = await sell({ payment_method: 'split', cash_amount: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'cash_amount', reason: 'INVALID_NUMBER' });
  });

  it('ignores cash_amount for cash and card, as before', async () => {
    expect((await sell({ payment_method: 'cash', cash_amount: 'abc' })).body.invoice).toMatchObject({ cash_amount: 11.5, card_amount: 0 });
    expect((await sell({ payment_method: 'card', cash_amount: 3 })).body.invoice).toMatchObject({ cash_amount: 0, card_amount: 11.5 });
  });
});

describe('following earlier decisions', () => {
  it('refuses 2.7 instead of selling 2, and names the line', async () => {
    const before = stock(tea);
    const res = await sell({ items: [{ product_id: tea, qty: 1 }, { product_id: tea, qty: 2.7 }] });
    expect(res.body).toEqual({ error: 'INVALID_QTY', code: 'INVALID_QTY', line: 2, field: 'qty', reason: 'NOT_INTEGER' });
    expect(stock(tea)).toBe(before);
  });

  it('refuses a misspelt payment method or invoice type instead of using cash / simplified', async () => {
    const before = invoiceCount();
    expect((await sell({ payment_method: 'cardd' })).body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'payment_method', reason: 'INVALID_CHOICE' });
    expect((await sell({ invoice_subtype: 'xyz' })).body).toMatchObject({ field: 'invoice_subtype', reason: 'INVALID_CHOICE' });
    expect(invoiceCount()).toBe(before);
  });

  it('refuses a discount that is not a number (it used to fail with 500) or is negative', async () => {
    expect((await sell({ discount_total: 'abc' })).body).toMatchObject({ field: 'discount_total', reason: 'INVALID_NUMBER' });
    expect((await sell({ discount_total: -2 })).body).toMatchObject({ field: 'discount_total', reason: 'MUST_NOT_BE_NEGATIVE' });
  });
});

describe('what stays the same', () => {
  it('sells the same product on two lines and keeps the ledger equal to the balance', async () => {
    const before = stock(tea);
    const res = await sell({ items: [{ product_id: tea, qty: 3 }, { product_id: tea, qty: 2 }] });
    expect(res.status).toBe(201);
    expect(stock(tea)).toBe(before - 5);
    expect(ledger(tea)).toBe(stock(tea));
  });

  it('keeps the stock message and adds the line and what is available', async () => {
    const res = await sell({ items: [{ product_id: tea, qty: 1 }, { product_id: rice, qty: 4 }] });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: 'INSUFFICIENT_STOCK:رز', code: 'INSUFFICIENT_STOCK', line: 2, available: 3, product_id: rice });
  });

  it('numbers sales without gaps, even after refused ones', async () => {
    const first = (await sell({})).body.invoice.invoice_number as string;
    await sell({ payment_method: 'split', cash_amount: 0 });
    await sell({ items: [{ product_id: rice, qty: 99 }] });
    const next = (await sell({})).body.invoice.invoice_number as string;
    const n = (s: string) => Number(s.split('-')[2]);
    expect(n(next)).toBe(n(first) + 1);
  });

  it('confirms a saved sale even when loading the response lists fails (R1.5)', async () => {
    vi.spyOn(settingsService, 'getSettings').mockRejectedValueOnce(new Error('lists unavailable'));
    const before = invoiceCount();
    const res = await sell({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ invoiceId: expect.any(Number), invoice_number: expect.stringMatching(/^INV-/) });
    expect(invoiceCount()).toBe(before + 1);
  });
});

describe('credit notes', () => {
  const credit = (id: number | string) => request(t.app).post(`/api/invoices/${id}/credit-note`).set(bearer(adminToken));

  it('issues one credit note when two are asked at the same moment, without restocking (D5)', async () => {
    const sale = (await sell({ items: [{ product_id: tea, qty: 2 }] })).body.invoice;
    const before = stock(tea);
    const [a, b] = await Promise.all([credit(sale.id), credit(sale.id)]);
    expect([a.status, b.status].sort()).toEqual([201, 400]);
    const refused = a.status === 400 ? a : b;
    const issued = a.status === 201 ? a : b;
    expect(refused.body).toEqual({
      error: `Invoice already returned via ${issued.body.invoice.invoice_number}.`,
      code: 'ALREADY_RETURNED',
      credit_note_number: issued.body.invoice.invoice_number,
    });
    expect(issued.body.invoice).toMatchObject({ invoice_type_code: '381', related_invoice_number: sale.invoice_number, grand_total: sale.grand_total });
    expect(issued.body.invoice.items).toHaveLength(1);
    expect(stock(tea)).toBe(before);
  });

  it('keeps the old messages and adds codes', async () => {
    expect((await credit(99999)).body).toEqual({ error: 'Original invoice not found.', code: 'INVOICE_NOT_FOUND' });
    const sale = (await sell({})).body.invoice;
    const note = (await credit(sale.id)).body.invoice;
    expect((await credit(note.id)).body).toEqual({
      error: 'Credit note can only be issued for a sales invoice.',
      code: 'NOT_A_SALES_INVOICE',
    });
  });
});

describe('held carts', () => {
  const hold = (body: Record<string, unknown>) => request(t.app).post('/api/carts/hold').set(bearer(adminToken)).send(body);

  it('holds a cart and lists it newest first, as before', async () => {
    const first = await hold({ label: ' طاولة 1 ', items: [{ product_id: tea, qty: 2 }] });
    expect(first.status).toBe(201);
    const second = await hold({ items: [{ product_id: rice, qty: '1' }], discount: '2' });
    expect(second.body.heldCarts[0]).toMatchObject({ label: expect.stringMatching(/^طلب معلق #\d{4}$/), discount: 2, invoice_subtype: '0200000' });
    expect(JSON.parse(second.body.heldCarts[0].items_json)).toEqual([{ product_id: rice, qty: 1 }]);
    expect(second.body.heldCarts[1].label).toBe('طاولة 1');
  });

  it('refuses broken data with 400 (it used to fail with 500)', async () => {
    expect((await hold({ items: [{ product_id: 'x', qty: -5 }, 'garbage'] })).body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'items' });
    expect((await hold({ items: [], discount: 'abc' })).body).toMatchObject({ field: 'discount', reason: 'INVALID_NUMBER' });
    expect((await hold({ items: [], label: 'ب'.repeat(61) })).body).toMatchObject({ field: 'label', reason: 'TOO_LONG' });
    expect((await hold({ items: [], invoice_subtype: 'xyz' })).body).toMatchObject({ field: 'invoice_subtype', reason: 'INVALID_CHOICE' });
  });

  it('releases a cart; an unknown one changes nothing, as before', async () => {
    const list = (await hold({ items: [] })).body.heldCarts as Array<{ id: number }>;
    const res = await request(t.app).delete(`/api/carts/hold/${list[0].id}`).set(bearer(adminToken));
    expect(res.body.heldCarts.some((c: { id: number }) => c.id === list[0].id)).toBe(false);
    expect((await request(t.app).delete('/api/carts/hold/99999').set(bearer(adminToken))).status).toBe(200);
  });
});

describe('access', () => {
  it('checks pos.access, pos.discount, sales.return and pos.hold', async () => {
    const { token: cashier } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local');
    expect((await sell({}, cashier)).status).toBe(201);
    expect((await sell({ discount_total: 1 }, cashier)).body).toEqual({
      error: 'You do not have permission to apply discounts.',
      code: 'DISCOUNT_NOT_ALLOWED',
    });
    const sale = (await sell({}, cashier)).body.invoice;
    expect((await request(t.app).post(`/api/invoices/${sale.id}/credit-note`).set(bearer(cashier))).status).toBe(403);
    const { token: accountant } = await createUserWithRole(t.app, adminToken, 'accountant', 'acc@test.local');
    expect((await sell({}, accountant)).status).toBe(403);
    expect((await request(t.app).post('/api/carts/hold').set(bearer(accountant)).send({ items: [] })).status).toBe(403);
  });
});

describe('the ledger', () => {
  it('still equals the balance after all of the above', () => {
    for (const id of [tea, rice]) expect(ledger(id)).toBe(stock(id));
  });
});
