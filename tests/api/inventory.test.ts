import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED, bearer, createTestApp, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

describe('products & inventory movements', () => {
  let t: TestApp;
  let adminToken: string;

  const createProduct = (body: Record<string, unknown>) =>
    request(t.app).post('/api/products').set(bearer(adminToken)).send(body);
  const move = (body: Record<string, unknown>) =>
    request(t.app).post('/api/inventory/movement').set(bearer(adminToken)).send(body);

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it('creates a product with opening stock and records the movement', async () => {
    const res = await createProduct({ sku: 'TEST-001', name_ar: 'صنف اختبار', sell_price: 10, cost_price: 7, stock_qty: 5 });
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({ sku: 'TEST-001', stock_qty: 5, sell_price: 10, tax_rate: 15, active: 1 });
    expect(res.body.movements[0]).toMatchObject({ type: 'purchase', qty_delta: 5, reference_no: 'NEW-SKU' });
  });

  it('rejects a duplicate SKU and missing required fields', async () => {
    const duplicate = await createProduct({ sku: 'TEST-001', name_ar: 'مكرر', sell_price: 5 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ code: 'SKU_EXISTS', field: 'sku' });

    const invalid = await createProduct({ sku: '', name_ar: '', sell_price: 0 });
    expect(invalid.status).toBe(400);
  });

  it('adds stock with a purchase movement', async () => {
    const res = await move({ product_id: SEED.rice.id, type: 'purchase', qty: 8, notes: 'manual restock' });
    expect(res.status).toBe(200);
    const rice = res.body.products.find((p: { id: number }) => p.id === SEED.rice.id);
    expect(rice.stock_qty).toBe(SEED.rice.stock + 8);
  });

  // DB-11 fixed in R1.10 (owner's option a): an adjustment below zero is refused,
  // so the ledger can never disagree with the balance.
  it('refuses an adjustment larger than the stock and changes nothing', async () => {
    const before = t.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get() as { n: number };
    const res = await move({ product_id: SEED.coffee.id, type: 'adjustment', qty: -100, notes: 'wastage' });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK', available: SEED.coffee.stock });
    const coffee = t.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(SEED.coffee.id) as { stock_qty: number };
    expect(coffee.stock_qty).toBe(SEED.coffee.stock);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual(before);
  });

  it('allows an adjustment down to exactly zero', async () => {
    const res = await move({ product_id: SEED.coffee.id, type: 'adjustment', qty: -SEED.coffee.stock, notes: 'count' });
    expect(res.status).toBe(200);
    expect(res.body.movements[0]).toMatchObject({ product_id: SEED.coffee.id, qty_delta: -SEED.coffee.stock, balance_after: 0 });
  });

  it('soft-deletes a product (hidden from the list, row kept)', async () => {
    const created = await createProduct({ sku: 'TEST-DEL', name_ar: 'للحذف', sell_price: 3 });
    const id = created.body.product.id as number;
    const res = await request(t.app).delete(`/api/products/${id}`).set(bearer(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.products.some((p: { id: number }) => p.id === id)).toBe(false);
    const row = t.db.prepare('SELECT active FROM products WHERE id = ?').get(id) as { active: number };
    expect(row.active).toBe(0);
  });
});
