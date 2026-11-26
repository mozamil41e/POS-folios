import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.5c, group 3: v1 writes for purchases, vouchers and sales. Same services
// as the current routes; answers carry only the affected document; the v1
// sale requires an Idempotency-Key.
let t: TestApp;
let adminToken: string;
let tea: number;
let supplierId: number;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  tea = (await request(t.app).post('/api/products').set(bearer(adminToken)).send({ sku: 'TEA', name_ar: 'شاي', sell_price: 10, tax_rate: 15, stock_qty: 200 })).body.product.id;
  supplierId = (await request(t.app).post('/api/suppliers').set(bearer(adminToken)).send({ name_ar: 'مورد' })).body.supplierId;
});
afterAll(() => t.cleanup());
afterEach(() => {
  vi.restoreAllMocks();
});

const post = (path: string, body: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  request(t.app).post(path).set(bearer(adminToken)).set(headers).send(body);
const invoices = () => (t.db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n;
const SALE = () => ({ items: [{ product_id: tea, qty: 2 }], payment_method: 'cash', invoice_subtype: '0200000', discount_total: 1 });

describe('purchases (v1)', () => {
  it('records a purchase and a payment, answering with that purchase only', async () => {
    const res = await post('/api/v1/purchases', {
      supplier_id: supplierId,
      payment_status: 'credit',
      items: [{ product_id: tea, qty: 4, unit_cost: 5, tax_rate: 15 }],
    });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toMatchObject({ grand_total: 23, payment_status: 'credit', paid_amount: 0 });
    expect(res.body.data.items).toHaveLength(1);

    const paid = await post(`/api/v1/purchases/${res.body.data.id}/payments`, { amount: 10 });
    expect(paid.body.data).toMatchObject({ paid_amount: 10, payment_status: 'partial' });
    const missing = await post('/api/v1/purchases/99999/payments', { amount: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PURCHASE_NOT_FOUND');
  });
});

describe('vouchers (v1)', () => {
  it('creates and voids a voucher; never deletes it', async () => {
    const res = await post('/api/v1/vouchers', { voucher_type: 'payment', party_name: 'كهرباء', amount: 150 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ voucher_type: 'payment', amount: 150, status: 'active' });
    const id = res.body.data.id as number;

    const removed = await request(t.app).delete(`/api/v1/vouchers/${id}`).set(bearer(adminToken));
    expect(removed.status).toBe(405);
    expect(removed.body.error.code).toBe('VOUCHER_DELETE_NOT_ALLOWED');

    const voided = await post(`/api/v1/vouchers/${id}/void`, { reason: 'مكرر' });
    expect(voided.body.data).toMatchObject({ status: 'void', void_reason: 'مكرر' });
    const again = await post(`/api/v1/vouchers/${id}/void`, { reason: 'مرة أخرى' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_VOID');
  });
});

describe('sales (v1)', () => {
  it('requires an Idempotency-Key and saves nothing without it', async () => {
    const before = invoices();
    const res = await post('/api/v1/invoices', SALE());
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'An Idempotency-Key header is required for a sale.', details: { field: 'Idempotency-Key' } },
    });
    expect(invoices()).toBe(before);
  });

  it('sells with a key, answering with the invoice only, with the same totals as the current route', async () => {
    const current = (await post('/api/invoices', SALE(), { 'Idempotency-Key': 'compare-current-1' })).body.invoice;
    const res = await post('/api/v1/invoices', SALE(), { 'Idempotency-Key': 'compare-v1-0001' });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['data']);
    const pick = (i: Record<string, unknown>) => ({ subtotal: i.subtotal, vat_total: i.vat_total, grand_total: i.grand_total, discount_total: i.discount_total, cash_amount: i.cash_amount });
    expect(pick(res.body.data)).toEqual(pick(current));
    expect(res.body.data.items).toHaveLength(1);
  });

  it('replays a retried sale, also when the retry switches between the current and v1 paths', async () => {
    const first = await post('/api/invoices', SALE(), { 'Idempotency-Key': 'switch-path-0001' });
    const before = invoices();
    const retry = await post('/api/v1/invoices', SALE(), { 'Idempotency-Key': 'switch-path-0001' });
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.data.id).toBe(first.body.invoice.id);
    expect(invoices()).toBe(before);
  });

  it('confirms a saved sale even when reading it back fails (R1.5)', async () => {
    // Imported here, after createTestApp() set this file's database: a top-level
    // import would open the database before that (the shared fallback path).
    const salesService = await import('../../server/src/modules/sales/service.ts');
    vi.spyOn(salesService.reads, 'one').mockRejectedValueOnce(new Error('read failed'));
    const before = invoices();
    const res = await post('/api/v1/invoices', SALE(), { 'Idempotency-Key': 'read-back-fail-1' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ id: expect.any(Number), invoice_number: expect.stringMatching(/^INV-/) });
    expect(invoices()).toBe(before + 1);
  });

  it('issues a credit note once, in the v1 envelope', async () => {
    const sale = (await post('/api/v1/invoices', SALE(), { 'Idempotency-Key': 'credit-note-0001' })).body.data;
    const note = await post(`/api/v1/invoices/${sale.id}/credit-note`);
    expect(note.status).toBe(201);
    expect(note.body.data).toMatchObject({ invoice_type_code: '381', related_invoice_number: sale.invoice_number, grand_total: sale.grand_total });
    const again = await post(`/api/v1/invoices/${sale.id}/credit-note`);
    expect(again.status).toBe(400);
    expect(again.body.error).toMatchObject({ code: 'ALREADY_RETURNED', details: { credit_note_number: note.body.data.invoice_number } });
  });

  it('holds and releases a cart', async () => {
    const held = await post('/api/v1/held-carts', { label: 'طاولة 2', items: [{ product_id: tea, qty: 1 }] });
    expect(held.status).toBe(201);
    expect(held.body.data).toMatchObject({ label: 'طاولة 2' });
    expect(JSON.parse(held.body.data.items_json)).toEqual([{ product_id: tea, qty: 1 }]);
    const released = await request(t.app).delete(`/api/v1/held-carts/${held.body.data.id}`).set(bearer(adminToken));
    expect(released.status).toBe(204);
  });
});
