import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { canViewData, type VisibleDataKey } from '../../shared/permissions.ts';
import type { AuthUser } from '../../shared/types.ts';
import { SEED, bearer, createTestApp, createUserWithRole, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.5b: v1 read endpoints, paged, next to the current routes (bootstrap is
// unchanged). Same lists, same order, same read permissions and cost hiding.
let t: TestApp;
let adminToken: string;
const users: Record<string, { token: string; user: AuthUser }> = {};

const get = (path: string, token = adminToken) => request(t.app).get(path).set(bearer(token));
const count = (table: string) => (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeAll(async () => {
  t = await createTestApp(); // with the demo workspace
  adminToken = await registerFirstAdmin(t.app);
  for (const slug of ['admin', 'manager', 'accountant', 'cashier']) {
    const token = slug === 'admin' ? adminToken : (await createUserWithRole(t.app, adminToken, slug, `${slug}@test.local`)).token;
    users[slug] = { token, user: (await get('/api/auth/me', token)).body.user };
  }
});
afterAll(() => t.cleanup());

// Endpoint → the read rule it uses and the bootstrap list it mirrors.
const LISTS: Array<{ path: string; key: VisibleDataKey; bootstrap: string; paged: boolean }> = [
  { path: '/api/v1/products', key: 'products', bootstrap: 'products', paged: true },
  { path: '/api/v1/categories', key: 'categories', bootstrap: 'categories', paged: false },
  { path: '/api/v1/stock-movements', key: 'movements', bootstrap: 'movements', paged: true },
  { path: '/api/v1/customers', key: 'customers', bootstrap: 'customers', paged: true },
  { path: '/api/v1/suppliers', key: 'suppliers', bootstrap: 'suppliers', paged: true },
  { path: '/api/v1/purchases', key: 'purchases', bootstrap: 'purchases', paged: true },
  { path: '/api/v1/invoices', key: 'invoices', bootstrap: 'invoices', paged: true },
  { path: '/api/v1/vouchers', key: 'vouchers', bootstrap: 'vouchers', paged: true },
  { path: '/api/v1/held-carts', key: 'heldCarts', bootstrap: 'heldCarts', paged: false },
];

describe('lists', () => {
  it('give the same rows and order as the bootstrap for the first page, with the total', async () => {
    const boot = await getBootstrap(t.app, adminToken);
    for (const list of LISTS) {
      const res = await get(`${list.path}?pageSize=200`);
      expect(res.status).toBe(200);
      const expected = (boot[list.bootstrap] as unknown[]).slice(0, 200);
      expect({ path: list.path, data: res.body.data }).toEqual({ path: list.path, data: expected });
      expect(res.body.meta).toMatchObject({ page: 1 });
    }
    expect((await get('/api/v1/products')).body.meta.total).toBe((t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE active = 1').get() as { n: number }).n);
    expect((await get('/api/v1/customers')).body.meta.total).toBe(count('customers'));
  });

  it('page through more than 100 invoices (the bootstrap still stops at 100)', async () => {
    const stocked = await request(t.app)
      .post('/api/products')
      .set(bearer(adminToken))
      .send({ sku: 'PAGING-1', name_ar: 'صنف للصفحات', sell_price: 5, tax_rate: 15, stock_qty: 500 });
    for (let i = 0; i < 120; i++) {
      const sale = await request(t.app)
        .post('/api/invoices')
        .set(bearer(adminToken))
        .send({ items: [{ product_id: stocked.body.product.id, qty: 1 }], payment_method: 'cash', invoice_subtype: '0200000' });
      expect(sale.status).toBe(201);
    }
    const total = count('invoices');
    expect(total).toBeGreaterThan(120);
    const pages = [];
    for (let page = 1; page <= Math.ceil(total / 50); page++) {
      const res = await get(`/api/v1/invoices?page=${page}&pageSize=50`);
      expect(res.body.meta).toEqual({ page, pageSize: 50, total });
      pages.push(...(res.body.data as Array<{ id: number }>).map((i) => i.id));
    }
    expect(pages).toHaveLength(total);
    expect(new Set(pages).size).toBe(total);
    expect(pages).toEqual([...pages].sort((a, b) => b - a)); // newest first
    expect((await getBootstrap(t.app, adminToken)).invoices).toHaveLength(100);
  });

  it('answer a page past the end with no rows, and refuse a bad page in the v1 envelope', async () => {
    const empty = await get('/api/v1/customers?page=999');
    expect(empty.status).toBe(200);
    expect(empty.body.data).toEqual([]);
    const bad = await get('/api/v1/customers?pageSize=500');
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({
      error: { code: 'VALIDATION_FAILED', message: 'pageSize must be at most 200.', details: { field: 'pageSize', reason: 'TOO_LARGE' } },
    });
  });
});

describe('one item', () => {
  it('returns it, with lines for purchases and invoices, or 404 with a code', async () => {
    const boot = await getBootstrap(t.app, adminToken);
    const cases: Array<[string, { id: number }, string]> = [
      ['/api/v1/products', boot.products[0], 'PRODUCT_NOT_FOUND'],
      ['/api/v1/customers', boot.customers[0], 'CUSTOMER_NOT_FOUND'],
      ['/api/v1/suppliers', boot.suppliers[0], 'SUPPLIER_NOT_FOUND'],
      ['/api/v1/purchases', boot.purchases[0], 'PURCHASE_NOT_FOUND'],
      ['/api/v1/invoices', boot.invoices[0], 'INVOICE_NOT_FOUND'],
      ['/api/v1/vouchers', boot.vouchers[0], 'VOUCHER_NOT_FOUND'],
    ];
    for (const [path, item, code] of cases) {
      const res = await get(`${path}/${item.id}`);
      expect({ path, data: res.body.data }).toEqual({ path, data: item });
      const missing = await get(`${path}/999999`);
      expect({ path, status: missing.status, code: missing.body.error?.code }).toEqual({ path, status: 404, code });
    }
  });
});

describe('who may read what', () => {
  it('follows the same read rules as the bootstrap, for every role and list', async () => {
    const seen: string[] = [];
    for (const [slug, { token, user }] of Object.entries(users)) {
      for (const list of LISTS) {
        const res = await get(list.path, token);
        const expected = canViewData(user, list.key) ? 200 : 403;
        seen.push(`${slug} ${list.path} ${res.status === expected ? 'ok' : `got ${res.status}, expected ${expected}`}`);
      }
    }
    expect(seen.filter((line) => !line.endsWith(' ok'))).toEqual([]);
  });

  it('answers 403 and 401 in the v1 envelope', async () => {
    const forbidden = await get('/api/v1/vouchers', users.cashier.token);
    expect(forbidden.body).toEqual({ error: { code: 'FORBIDDEN', message: 'You do not have permission to perform this action.', details: {} } });
    const anonymous = await request(t.app).get('/api/v1/products');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('hides cost prices from a cashier, in the list and for one product', async () => {
    const list = await get('/api/v1/products', users.cashier.token);
    expect(list.body.data.every((p: Record<string, unknown>) => !('cost_price' in p))).toBe(true);
    const one = await get(`/api/v1/products/${SEED.milk.id}`, users.cashier.token);
    expect(one.body.data).not.toHaveProperty('cost_price');
    expect((await get(`/api/v1/products/${SEED.milk.id}`)).body.data).toHaveProperty('cost_price');
  });

  it('gives users and roles to users.manage only, and the settings to everyone signed in', async () => {
    expect((await get('/api/v1/users')).body.data).toEqual((await getBootstrap(t.app, adminToken)).users);
    expect((await get('/api/v1/roles')).body.meta.total).toBe(count('roles'));
    expect((await get('/api/v1/users', users.manager.token)).status).toBe(403);
    const settings = await get('/api/v1/settings', users.cashier.token);
    expect(settings.body.data).toEqual((await getBootstrap(t.app, users.cashier.token)).settings);
  });
});
