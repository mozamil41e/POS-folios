import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { ADMIN, createTestApp, type TestApp } from '../helpers/app.ts';

// R2.5c: the v1 write contract. Every v1 write route (POST/PATCH/PUT/DELETE
// under /api/v1) is called once here, and each success answers with the
// affected resource in { data } (or 204 without a body) — never the old
// "every list again". New v1 write routes must be added to this walk.
let t: TestApp;
let token = '';

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
});
afterAll(() => t.cleanup());

type Layer = { route?: { path: string; methods: Record<string, boolean> }; handle?: { stack?: Layer[] } };

/** Every method + path the app's routers declare (Express 5). */
function declaredRoutes(app: Express): string[] {
  const out: string[] = [];
  const walk = (stack: Layer[] | undefined) => {
    for (const layer of stack ?? []) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) out.push(`${method.toUpperCase()} ${layer.route.path}`);
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return out;
}

const called = new Set<string>();
const problems: string[] = [];

async function write(method: 'post' | 'patch' | 'put' | 'delete', template: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  called.add(`${method.toUpperCase()} ${template}`);
  const req = request(t.app)[method](path).set(headers);
  if (token) req.set('Authorization', `Bearer ${token}`);
  const res = await (body === undefined ? req : req.send(body as object));
  const keys = Object.keys(res.body ?? {});
  if (res.status === 204) {
    if (res.text !== '') problems.push(`${method} ${path}: 204 with a body`);
  } else if (res.status >= 400) {
    if (!keys.includes('error')) problems.push(`${method} ${path}: ${res.status} without the v1 error envelope`);
  } else if (!keys.every((k) => k === 'data' || k === 'meta') || !keys.includes('data')) {
    problems.push(`${method} ${path}: ${res.status} answered with ${keys.join(', ')}`);
  }
  return res;
}

describe('the v1 write contract', () => {
  it('answers every v1 write with the affected resource only', async () => {
    const setup = await write('post', '/api/v1/auth/setup', '/api/v1/auth/setup', ADMIN);
    token = setup.body.data.token;
    await write('post', '/api/v1/auth/login', '/api/v1/auth/login', { email: ADMIN.email, password: ADMIN.password });

    const roles = (await request(t.app).get('/api/v1/roles').set('Authorization', `Bearer ${token}`)).body.data as Array<{ id: number; slug: string }>;
    const cashierRole = roles.find((r) => r.slug === 'cashier')?.id;
    const user = await write('post', '/api/v1/users', '/api/v1/users', { full_name: 'Cashier', email: 'c@test.local', password: 'cashier-pass-1', role_id: cashierRole });
    await write('patch', '/api/v1/users/:id', `/api/v1/users/${user.body.data.id}`, { phone: '0500' });
    const role = await write('post', '/api/v1/roles', '/api/v1/roles', { name_ar: 'دور تجربة' });
    await write('patch', '/api/v1/roles/:id', `/api/v1/roles/${role.body.data.id}`, { name_ar: 'دور معدل' });
    await write('delete', '/api/v1/roles/:id', `/api/v1/roles/${role.body.data.id}`);
    await write('delete', '/api/v1/users/:id', `/api/v1/users/${user.body.data.id}`);
    await write('patch', '/api/v1/settings', '/api/v1/settings', { name_ar: 'مطعم', vat_number: '300000000000003' });

    const customer = await write('post', '/api/v1/customers', '/api/v1/customers', { name_ar: 'عميل' });
    await write('patch', '/api/v1/customers/:id', `/api/v1/customers/${customer.body.data.id}`, { phone: '0500' });
    const supplier = await write('post', '/api/v1/suppliers', '/api/v1/suppliers', { name_ar: 'مورد' });
    await write('patch', '/api/v1/suppliers/:id', `/api/v1/suppliers/${supplier.body.data.id}`, { phone: '0500' });

    const category = await write('post', '/api/v1/categories', '/api/v1/categories', { name_ar: 'مؤقت' });
    await write('patch', '/api/v1/categories/:id', `/api/v1/categories/${category.body.data.id}`, { name_ar: 'مؤقت 2' });
    const product = await write('post', '/api/v1/products', '/api/v1/products', { sku: 'P-1', name_ar: 'شاي', sell_price: 10, tax_rate: 15, stock_qty: 50 });
    const productId = product.body.data.id as number;
    await write('patch', '/api/v1/products/:id', `/api/v1/products/${productId}`, { sell_price: 11 });
    const ids = ((await request(t.app).get('/api/v1/categories').set('Authorization', `Bearer ${token}`)).body.data as Array<{ id: number }>).map((c) => c.id);
    await write('put', '/api/v1/categories/order', '/api/v1/categories/order', { ids: [...ids].reverse() });
    await write('post', '/api/v1/products/import', '/api/v1/products/import', { csv: 'الباركود,الاسم بالعربية,سعر البيع\nX-1,قهوة,9\n', dryRun: true });
    await write('post', '/api/v1/stock-movements', '/api/v1/stock-movements', { product_id: productId, type: 'adjustment', qty: -1 });

    const purchase = await write('post', '/api/v1/purchases', '/api/v1/purchases', {
      supplier_id: supplier.body.data.id,
      payment_status: 'credit',
      items: [{ product_id: productId, qty: 2, unit_cost: 5, tax_rate: 15 }],
    });
    await write('post', '/api/v1/purchases/:id/payments', `/api/v1/purchases/${purchase.body.data.id}/payments`, { amount: 5 });

    const voucher = await write('post', '/api/v1/vouchers', '/api/v1/vouchers', { party_name: 'كهرباء', amount: 50, voucher_type: 'payment' });
    await write('post', '/api/v1/vouchers/:id/void', `/api/v1/vouchers/${voucher.body.data.id}/void`, { reason: 'مكرر' });
    await write('delete', '/api/v1/vouchers/:id', `/api/v1/vouchers/${voucher.body.data.id}`); // 405, never deleted

    const held = await write('post', '/api/v1/held-carts', '/api/v1/held-carts', { items: [{ product_id: productId, qty: 1 }] });
    await write('delete', '/api/v1/held-carts/:id', `/api/v1/held-carts/${held.body.data.id}`);
    const sale = await write('post', '/api/v1/invoices', '/api/v1/invoices', { items: [{ product_id: productId, qty: 1 }], payment_method: 'cash', invoice_subtype: '0200000' }, { 'Idempotency-Key': 'contract-sale-0001' });
    await write('post', '/api/v1/invoices/:id/credit-note', `/api/v1/invoices/${sale.body.data.id}/credit-note`);

    const spare = await write('post', '/api/v1/products', '/api/v1/products', { sku: 'P-2', name_ar: 'مؤقت', sell_price: 1, tax_rate: 0 });
    await write('delete', '/api/v1/products/:id', `/api/v1/products/${spare.body.data.id}`);
    const empty = await write('post', '/api/v1/categories', '/api/v1/categories', { name_ar: 'فارغ' });
    await write('delete', '/api/v1/categories/:id', `/api/v1/categories/${empty.body.data.id}`);
    await write('post', '/api/v1/auth/logout', '/api/v1/auth/logout');

    expect(problems).toEqual([]);
  });

  it('covers every v1 write route the app declares', () => {
    const declared = declaredRoutes(t.app).filter((r) => / \/api\/v1\//.test(r) && !r.startsWith('GET '));
    // 32 writes (the 34 v1 routes of R2.5c include GET /auth/me and /auth/status).
    expect(declared.length).toBeGreaterThanOrEqual(32);
    expect([...called].sort()).toEqual([...new Set(declared)].sort());
  });
});
