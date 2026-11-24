import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED, bearer, createTestApp, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R1.10 (SEC-19, DB-11), approved by the owner: option (a) for stock below
// zero, VAT 15% or 0% only, VAT numbers checked when given.
let t: TestApp;
let adminToken: string;

const api = {
  post: (url: string, body: Record<string, unknown>) => request(t.app).post(url).set(bearer(adminToken)).send(body),
  put: (url: string, body: Record<string, unknown>) => request(t.app).put(url).set(bearer(adminToken)).send(body),
};

/** Asserts a 400 VALIDATION_FAILED for this field (and reason, when given). */
function expectInvalid(res: request.Response, field: string, reason?: string) {
  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field, ...(reason ? { reason } : {}) });
}

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());

describe('products (R1.10)', () => {
  const product = (overrides: Record<string, unknown> = {}) => ({
    sku: `VAL-${Math.random().toString(36).slice(2, 8)}`,
    name_ar: 'صنف تحقق',
    sell_price: 10,
    cost_price: 6,
    tax_rate: 15,
    stock_qty: 3,
    ...overrides,
  });

  it.each([
    ['sell_price', { sell_price: -5 }, 'MUST_BE_POSITIVE'],
    ['sell_price', { sell_price: 0 }, 'MUST_BE_POSITIVE'],
    ['sell_price', { sell_price: 'abc' }, 'INVALID_NUMBER'],
    ['cost_price', { cost_price: -1 }, 'MUST_NOT_BE_NEGATIVE'],
    ['tax_rate', { tax_rate: 7 }, 'INVALID_TAX'],
    ['tax_category', { tax_rate: 15, tax_category: 'Z' }, 'INVALID_TAX'],
    ['tax_category', { tax_rate: 0, tax_category: 'S' }, 'INVALID_TAX'],
    ['stock_qty', { stock_qty: 2.5 }, 'NOT_INTEGER'],
    ['stock_qty', { stock_qty: -1 }, 'MUST_NOT_BE_NEGATIVE'],
    ['min_stock_alert', { min_stock_alert: -3 }, 'MUST_NOT_BE_NEGATIVE'],
    ['expiry_date', { expiry_date: '2026-02-30' }, 'INVALID_DATE'],
    ['sku', { sku: 'x'.repeat(65) }, 'TOO_LONG'],
    ['name_ar', { name_ar: '   ' }, 'REQUIRED'],
  ])('refuses a new product with an invalid %s (%j)', async (field, overrides, reason) => {
    const res = await api.post('/api/products', product(overrides));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED', field, reason });
  });

  it('accepts 0% with category Z or E, and derives the category from the rate', async () => {
    expect((await api.post('/api/products', product({ tax_rate: 0, tax_category: 'E' }))).body.product.tax_category).toBe('E');
    expect((await api.post('/api/products', product({ tax_rate: 0 }))).body.product.tax_category).toBe('Z');
    expect((await api.post('/api/products', product({ tax_rate: 15 }))).body.product.tax_category).toBe('S');
  });

  it('validates an update the same way and keeps the product unchanged', async () => {
    const before = t.db.prepare('SELECT sell_price, tax_rate FROM products WHERE id = ?').get(SEED.milk.id);
    expectInvalid(await api.put(`/api/products/${SEED.milk.id}`, { sell_price: -1 }), 'sell_price', 'MUST_BE_POSITIVE');
    expectInvalid(await api.put(`/api/products/${SEED.milk.id}`, { tax_rate: 5 }), 'tax_rate', 'INVALID_TAX');
    expectInvalid(await api.put(`/api/products/${SEED.milk.id}`, { tax_category: 'X' }), 'tax_category', 'INVALID_TAX');
    expect(t.db.prepare('SELECT sell_price, tax_rate FROM products WHERE id = ?').get(SEED.milk.id)).toEqual(before);
  });

  it('answers 409 SKU_EXISTS (not 500) when an update reuses another SKU', async () => {
    const other = t.db.prepare('SELECT sku FROM products WHERE id = ?').get(SEED.rice.id) as { sku: string };
    const res = await api.put(`/api/products/${SEED.milk.id}`, { sku: other.sku });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'SKU_EXISTS', field: 'sku' });
  });

  it('updates only the fields sent, and keeps "no expiry" as null', async () => {
    const created = await api.post('/api/products', product({ expiry_date: null }));
    const id = created.body.product.id as number;
    const res = await api.put(`/api/products/${id}`, { sell_price: 12.5 });
    expect(res.status).toBe(200);
    const row = t.db.prepare('SELECT sell_price, name_ar, tax_rate, expiry_date FROM products WHERE id = ?').get(id);
    expect(row).toEqual({ sell_price: 12.5, name_ar: 'صنف تحقق', tax_rate: 15, expiry_date: null });
  });
});

describe('customers and suppliers (R1.10)', () => {
  const customer = (overrides: Record<string, unknown> = {}) => ({
    name_ar: 'عميل تحقق',
    name_en: '',
    vat_number: '',
    cr_number: '',
    address_ar: '',
    phone: '',
    ...overrides,
  });

  it('requires a name and a valid VAT number when one is given', async () => {
    expectInvalid(await api.post('/api/customers', customer({ name_ar: '' })), 'name_ar', 'REQUIRED');
    expectInvalid(await api.post('/api/customers', customer({ vat_number: '12345' })), 'vat_number', 'INVALID_VAT');
    expectInvalid(await api.post('/api/customers', customer({ vat_number: '400000000000003' })), 'vat_number', 'INVALID_VAT');
    expectInvalid(await api.post('/api/customers', customer({ phone: 'call me' })), 'phone', 'INVALID_PHONE');
    expect((await api.post('/api/customers', customer())).status).toBe(201); // no VAT number: a cash customer
    expect((await api.post('/api/customers', customer({ vat_number: '300000000000093' }))).status).toBe(201);
  });

  it('validates customer updates and keeps the record unchanged', async () => {
    expectInvalid(await api.put('/api/customers/1', { vat_number: 'abc' }), 'vat_number', 'INVALID_VAT');
    expectInvalid(await api.put('/api/customers/1', { name_ar: '' }), 'name_ar', 'REQUIRED');
    const row = t.db.prepare('SELECT name_ar, vat_number FROM customers WHERE id = 1').get() as { name_ar: string; vat_number: string };
    expect(row.vat_number).toBe('300000000000013');
    expect(row.name_ar).not.toBe('');
  });

  it('validates suppliers, including the email', async () => {
    const supplier = (overrides: Record<string, unknown> = {}) => ({ name_ar: 'مورد تحقق', email: '', ...overrides });
    expectInvalid(await api.post('/api/suppliers', supplier({ email: 'not-an-email' })), 'email', 'INVALID_EMAIL');
    expectInvalid(await api.post('/api/suppliers', supplier({ vat_number: '3' })), 'vat_number', 'INVALID_VAT');
    expectInvalid(await api.post('/api/suppliers', supplier({ address_ar: 'x'.repeat(301) })), 'address_ar', 'TOO_LONG');
    expect((await api.post('/api/suppliers', supplier({ email: 'orders@supplier.example' }))).status).toBe(201);
    expectInvalid(await api.put(`/api/suppliers/${SEED.supplierId}`, { name_ar: ' ' }), 'name_ar', 'REQUIRED');
  });
});

describe('settings VAT number (R1.10)', () => {
  it('refuses a restaurant VAT number in the wrong format', async () => {
    expectInvalid(await api.put('/api/settings', { vat_number: '123' }), 'vat_number', 'INVALID_VAT');
    expect((await api.put('/api/settings', { vat_number: '300000000000003' })).status).toBe(200);
  });
});

describe('stock movements and the ledger (R1.10, DB-11)', () => {
  it('validates the movement input', async () => {
    const move = (body: Record<string, unknown>) => api.post('/api/inventory/movement', body);
    expectInvalid(await move({ product_id: SEED.rice.id, type: 'gift', qty: 1 }), 'type', 'INVALID_CHOICE');
    expectInvalid(await move({ product_id: SEED.rice.id, type: 'purchase', qty: 0 }), 'qty', 'REQUIRED');
    expectInvalid(await move({ product_id: SEED.rice.id, type: 'purchase', qty: 1.5 }), 'qty', 'NOT_INTEGER');
    expect((await move({ product_id: 999_999, type: 'purchase', qty: 1 })).status).toBe(404);
  });

  it('keeps the sum of movements equal to the stock of every product', async () => {
    // Opening stock, restock, sale, wastage, a refused adjustment, a credit note.
    const created = await api.post('/api/products', { sku: 'LEDGER-1', name_ar: 'صنف الدفتر', sell_price: 20, stock_qty: 10 });
    const id = created.body.product.id as number;
    await api.post('/api/inventory/movement', { product_id: id, type: 'purchase', qty: 5 });
    const sale = await api.post('/api/invoices', {
      items: [{ product_id: id, qty: 4 }],
      invoice_subtype: '0200000',
      payment_method: 'cash',
      cash_amount: 0,
      discount_total: 0,
      customer_id: null,
    });
    expect(sale.status).toBe(201);
    await api.post('/api/inventory/movement', { product_id: id, type: 'adjustment', qty: -2 });
    expect((await api.post('/api/inventory/movement', { product_id: id, type: 'adjustment', qty: -50 })).status).toBe(400);
    expect((await api.post(`/api/invoices/${sale.body.invoice.id}/credit-note`, {})).status).toBe(201);

    const mismatches = t.db
      .prepare(
        `SELECT p.id, p.stock_qty, COALESCE(SUM(m.qty_delta), 0) AS ledger
         FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
         GROUP BY p.id HAVING p.stock_qty != ledger`
      )
      .all();
    expect(mismatches).toEqual([]);
    const row = t.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(id) as { stock_qty: number };
    expect(row.stock_qty).toBe(10 + 5 - 4 - 2 + 4); // the credit note returns the 4 sold (until D5 in R5)
  });
});
