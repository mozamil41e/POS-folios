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

  // SEC-03 fixed in R1.3; since R1.4 the settings no longer hold any ZATCA data at all.
  it('never sends secrets or ZATCA data in settings, to any role', async () => {
    for (const token of [adminToken, cashierToken]) {
      const { settings } = await getBootstrap(t.app, token);
      for (const field of [
        'private_key_pem', 'ccsid_secret', 'pcsid_secret', 'ccsid_token', 'pcsid_token',
        'csr_pem', 'last_icv', 'last_pih', 'zatca_enabled', 'mode', 'egs_serial',
      ]) {
        expect(settings).not.toHaveProperty(field);
      }
      expect(settings).toHaveProperty('name_ar');
      expect(settings).toHaveProperty('vat_number');
    }
  });
});
