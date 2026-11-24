import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN,
  bearer,
  createTestApp,
  createUserWithRole,
  registerFirstAdmin,
  roleIdBySlug,
  type TestApp,
} from '../helpers/app.ts';

type Method = 'get' | 'post' | 'put' | 'delete';

// Routes a cashier (pos.access, pos.hold, sales.view, customers.manage,
// inventory.view) must not be able to use.
const CASHIER_FORBIDDEN: Array<[Method, string]> = [
  ['get', '/api/users'],
  ['post', '/api/users'],
  ['put', '/api/users/1'],
  ['delete', '/api/users/1'],
  ['get', '/api/roles'],
  ['post', '/api/roles'],
  ['put', '/api/settings'],
  ['post', '/api/zatca/generate-keys'],
  ['post', '/api/zatca/onboard'],
  ['post', '/api/products'],
  ['put', '/api/products/1'],
  ['delete', '/api/products/1'],
  ['post', '/api/inventory/movement'],
  ['post', '/api/suppliers'],
  ['post', '/api/purchases'],
  ['post', '/api/purchases/1/pay'],
  ['post', '/api/vouchers'],
  ['delete', '/api/vouchers/1'],
  ['post', '/api/invoices/1/credit-note'],
  ['post', '/api/invoices/1/retry'],
];

describe('permissions (characterization)', () => {
  let t: TestApp;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
    ({ token: cashierToken } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local'));
  });
  afterAll(() => t.cleanup());

  it.each(CASHIER_FORBIDDEN)('forbids a cashier: %s %s', async (method, path) => {
    const res = await request(t.app)[method](path).set(bearer(cashierToken)).send({});
    expect(res.status).toBe(403);
  });

  it('rejects anonymous writes with 401', async () => {
    const res = await request(t.app).post('/api/products').send({ sku: 'X', name_ar: 'X', sell_price: 1 });
    expect(res.status).toBe(401);
  });

  it('lets a cashier add a customer and hold a cart', async () => {
    const customer = await request(t.app)
      .post('/api/customers')
      .set(bearer(cashierToken))
      .send({ name_ar: 'عميل اختبار', name_en: 'Test Customer', vat_number: '', cr_number: '', address_ar: '', phone: '' });
    expect(customer.status).toBe(201);

    const held = await request(t.app)
      .post('/api/carts/hold')
      .set(bearer(cashierToken))
      .send({ label: 'Table 1', items: [{ product_id: 1, qty: 1 }], discount: 0, customer_id: null, invoice_subtype: '0200000' });
    expect(held.status).toBe(201);
    expect(held.body.heldCarts).toHaveLength(1);
  });

  it('lets an admin update settings', async () => {
    const res = await request(t.app).put('/api/settings').set(bearer(adminToken)).send({ table_page_size: 20 });
    expect(res.status).toBe(200);
    expect(res.body.settings.table_page_size).toBe(20);
  });

  it('stops an admin from deactivating, demoting or deleting their own account', async () => {
    const me = await request(t.app).get('/api/auth/me').set(bearer(adminToken));
    const adminId = me.body.user.id as number;
    const adminRoleId = await roleIdBySlug(t.app, adminToken, 'admin');
    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    const base = { full_name: ADMIN.full_name, email: ADMIN.email, phone: '' };

    const deactivate = await request(t.app)
      .put(`/api/users/${adminId}`)
      .set(bearer(adminToken))
      .send({ ...base, role_id: adminRoleId, is_active: false });
    expect(deactivate.status).toBe(400);

    const demote = await request(t.app)
      .put(`/api/users/${adminId}`)
      .set(bearer(adminToken))
      .send({ ...base, role_id: cashierRoleId, is_active: true });
    expect(demote.status).toBe(400);

    const remove = await request(t.app).delete(`/api/users/${adminId}`).set(bearer(adminToken));
    expect(remove.status).toBe(400);
  });

  it('revokes the sessions of a user who is deactivated', async () => {
    const { token, userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'temp@test.local', 'temp-pass-123');
    expect((await request(t.app).get('/api/auth/me').set(bearer(token))).status).toBe(200);

    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    const res = await request(t.app)
      .put(`/api/users/${userId}`)
      .set(bearer(adminToken))
      .send({ full_name: 'Temp User', email: 'temp@test.local', phone: '', role_id: cashierRoleId, is_active: false });
    expect(res.status).toBe(200);

    expect((await request(t.app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
    const login = await request(t.app).post('/api/auth/login').send({ email: 'temp@test.local', password: 'temp-pass-123' });
    expect(login.status).toBe(403);
  });
});
