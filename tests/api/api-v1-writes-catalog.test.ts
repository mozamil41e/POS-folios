import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.5c, group 2: v1 writes for customers, suppliers, products, the CSV
// import, stock movements and categories. Same services as the current
// routes; answers carry only the affected resource.
let t: TestApp;
let adminToken: string;
let cashierToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  cashierToken = (await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local')).token;
});
afterAll(() => t.cleanup());

const v1 = (method: 'post' | 'patch' | 'put' | 'delete' | 'get', path: string, body?: Record<string, unknown>, token = adminToken) => {
  const req = request(t.app)[method](path).set(bearer(token));
  return body === undefined ? req : req.send(body);
};

describe('customers and suppliers (v1)', () => {
  it('create and PATCH answer with the record only; fields not sent stay', async () => {
    const created = await v1('post', '/api/v1/customers', { name_ar: 'شركة الأفق', vat_number: '300000000000003', phone: '0500' }, cashierToken);
    expect(created.status).toBe(201);
    expect(Object.keys(created.body)).toEqual(['data']);
    expect(created.body.data).toMatchObject({ name_ar: 'شركة الأفق', name_en: 'شركة الأفق', phone: '0500' });
    const patched = await v1('patch', `/api/v1/customers/${created.body.data.id}`, { cr_number: '1010101010' });
    expect(patched.body.data).toMatchObject({ phone: '0500', cr_number: '1010101010', vat_number: '300000000000003' });

    const supplier = await v1('post', '/api/v1/suppliers', { name_ar: 'مورد اللحوم', email: 'orders@meat.example' });
    expect(supplier.status).toBe(201);
    expect(supplier.body.data).toMatchObject({ name_ar: 'مورد اللحوم', email: 'orders@meat.example' });
  });

  it('keeps the rules, codes and permissions, in the v1 envelope', async () => {
    const bad = await v1('post', '/api/v1/customers', { name_ar: '' });
    expect(bad.body).toEqual({ error: { code: 'VALIDATION_FAILED', message: 'name_ar is required.', details: { field: 'name_ar', reason: 'REQUIRED' } } });
    expect((await v1('patch', '/api/v1/customers/99999', { name_ar: 'x' })).body.error.code).toBe('CUSTOMER_NOT_FOUND');
    expect((await v1('patch', '/api/v1/suppliers/99999', { name_ar: 'x' })).body.error.code).toBe('SUPPLIER_NOT_FOUND');
    const forbidden = await v1('post', '/api/v1/suppliers', { name_ar: 'مورد' }, cashierToken);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');
  });
});

describe('products and stock (v1)', () => {
  let productId: number;

  it('creates a product (opening stock as a movement) and answers with it', async () => {
    const res = await v1('post', '/api/v1/products', { sku: 'TEA-1', name_ar: 'شاي', sell_price: 10, cost_price: 4, tax_rate: 15, stock_qty: 20 });
    expect(res.status).toBe(201);
    expect(Object.keys(res.body)).toEqual(['data']);
    expect(res.body.data).toMatchObject({ sku: 'TEA-1', stock_qty: 20, cost_price: 4, category_ar: 'عام' });
    productId = res.body.data.id;
    const dup = await v1('post', '/api/v1/products', { sku: 'TEA-1', name_ar: 'آخر', sell_price: 1, tax_rate: 0 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'SKU_EXISTS', details: { field: 'sku' } });
  });

  it('PATCH changes only what is sent', async () => {
    const res = await v1('patch', `/api/v1/products/${productId}`, { sell_price: 12 });
    expect(res.body.data).toMatchObject({ sku: 'TEA-1', name_ar: 'شاي', sell_price: 12, stock_qty: 20 });
  });

  it('records a stock movement and answers with it; refuses negative stock', async () => {
    const res = await v1('post', '/api/v1/stock-movements', { product_id: productId, type: 'adjustment', qty: -5, notes: 'تالف' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ product_id: productId, type: 'adjustment', qty_delta: -5, balance_after: 15, sku: 'TEA-1' });
    const tooMuch = await v1('post', '/api/v1/stock-movements', { product_id: productId, type: 'adjustment', qty: -100 });
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 15 } });
    expect((await v1('post', '/api/v1/stock-movements', { product_id: productId, type: 'adjustment', qty: 1 }, cashierToken)).status).toBe(403);
  });

  it('deletes (hides) a product with 204', async () => {
    const extra = await v1('post', '/api/v1/products', { sku: 'GONE-1', name_ar: 'مؤقت', sell_price: 1, tax_rate: 0 });
    expect((await v1('delete', `/api/v1/products/${extra.body.data.id}`)).status).toBe(204);
    expect((await v1('get', `/api/v1/products/${extra.body.data.id}`)).status).toBe(404);
  });

  it('imports a CSV: preview, refusal with the report, then the import', async () => {
    const good = 'الباركود,الاسم بالعربية,سعر البيع\nCSV-1,قهوة,9\n';
    const preview = await v1('post', '/api/v1/products/import', { csv: good, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ dryRun: true, validRows: 1 });

    // As in R2.4a, nothing is imported unless dryRun: false is sent (a preview by default).
    const broken = await v1('post', '/api/v1/products/import', { csv: 'الباركود,الاسم بالعربية,سعر البيع\nCSV-2,,9\n', dryRun: false });
    expect(broken.status).toBe(400);
    expect(broken.body.error.code).toBe('IMPORT_INVALID');
    expect(broken.body.error.details.rowProblems[0]).toMatchObject({ row: 2, field: 'name_ar', reason: 'REQUIRED' });

    const done = await v1('post', '/api/v1/products/import', { csv: good, dryRun: false });
    expect(done.status).toBe(201);
    expect(done.body.data).toMatchObject({ imported: 1 });
  });
});

describe('categories (v1)', () => {
  it('create, rename, reorder and delete', async () => {
    const drinks = await v1('post', '/api/v1/categories', { name_ar: 'مشروبات' });
    expect(drinks.status).toBe(201);
    expect(drinks.body.data).toMatchObject({ name_ar: 'مشروبات', product_count: 0 });
    const renamed = await v1('patch', `/api/v1/categories/${drinks.body.data.id}`, { name_ar: 'مشروبات ساخنة' });
    expect(renamed.body.data.name_ar).toBe('مشروبات ساخنة');

    const all = (await v1('get', '/api/v1/categories')).body.data as Array<{ id: number }>;
    const reversed = all.map((c) => c.id).reverse();
    const ordered = await v1('put', '/api/v1/categories/order', { ids: reversed });
    expect(ordered.body.data.map((c: { id: number }) => c.id)).toEqual(reversed);
    expect(ordered.body.meta.total).toBe(reversed.length);

    expect((await v1('delete', `/api/v1/categories/${drinks.body.data.id}`)).status).toBe(204);
    const general = all.find((c) => c.id !== drinks.body.data.id) as { id: number };
    const inUse = await v1('delete', `/api/v1/categories/${general.id}`);
    expect(inUse.status).toBe(409);
    expect(inUse.body.error.code).toBe('CATEGORY_IN_USE');
  });
});
