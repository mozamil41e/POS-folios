import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, createUserWithRole, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

describe('GET /api/bootstrap (characterization)', () => {
  let t: TestApp;
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
    ({ token: cashierToken } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local'));
  });
  afterAll(() => t.cleanup());

  it('requires authentication', async () => {
    const res = await request(t.app).get('/api/bootstrap');
    expect(res.status).toBe(401);
  });

  it('gives an admin the whole seeded workspace including users and roles', async () => {
    const body = await getBootstrap(t.app, adminToken);
    expect(Object.keys(body).sort()).toEqual(
      ['customers', 'heldCarts', 'invoices', 'movements', 'products', 'purchases', 'roles', 'settings', 'suppliers', 'users', 'vouchers'].sort()
    );
    expect(body.products).toHaveLength(14);
    expect(body.customers).toHaveLength(3);
    expect(body.suppliers).toHaveLength(3);
    expect(body.purchases).toHaveLength(2);
    expect(body.invoices).toHaveLength(3);
    expect(body.vouchers).toHaveLength(3);
    expect(body.movements).toHaveLength(14);
    expect(body.heldCarts).toHaveLength(0);
    expect(body.roles.map((r: { slug: string }) => r.slug).sort()).toEqual(['accountant', 'admin', 'cashier', 'manager']);
    expect(body.users).toHaveLength(2);
  });

  // SEC-02 fixed in R1.3: the server only sends what the role may read.
  it('gives a cashier only POS, sales and stock data — no purchases, suppliers, vouchers or costs', async () => {
    const body = await getBootstrap(t.app, cashierToken);
    expect(Object.keys(body).sort()).toEqual(
      ['customers', 'heldCarts', 'invoices', 'movements', 'products', 'settings'].sort()
    );
    expect(body.products.length).toBe(14);
    for (const product of body.products) {
      expect(product).not.toHaveProperty('cost_price');
    }
  });

  // SEC-03 fixed in R1.3: settings never carry secrets; ZATCA credentials only
  // reach zatca.manage holders (until ZATCA is removed in R1.4).
  it('never sends secrets in settings, to any role', async () => {
    for (const token of [adminToken, cashierToken]) {
      const { settings } = await getBootstrap(t.app, token);
      expect(settings).not.toHaveProperty('private_key_pem');
      expect(settings).not.toHaveProperty('ccsid_secret');
      expect(settings).not.toHaveProperty('pcsid_secret');
      expect(settings).toHaveProperty('name_ar');
      expect(settings).toHaveProperty('vat_number');
    }

    const cashierSettings = (await getBootstrap(t.app, cashierToken)).settings;
    expect(cashierSettings).not.toHaveProperty('ccsid_token');
    expect(cashierSettings).not.toHaveProperty('pcsid_token');
    expect(cashierSettings).not.toHaveProperty('csr_pem');

    const adminSettings = (await getBootstrap(t.app, adminToken)).settings;
    expect(adminSettings).toHaveProperty('pcsid_token');
  });
});
