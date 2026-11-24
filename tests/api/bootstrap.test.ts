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

  // CURRENT BEHAVIOUR (SEC-02): read permissions are not enforced on the server.
  // R1.3 filters the payload by permission — flip these expectations then.
  it('CURRENT BEHAVIOUR: gives a cashier purchases, suppliers and vouchers as well', async () => {
    const body = await getBootstrap(t.app, cashierToken);
    expect(body.purchases.length).toBeGreaterThan(0);
    expect(body.suppliers.length).toBeGreaterThan(0);
    expect(body.vouchers.length).toBeGreaterThan(0);
    expect(body.products[0]).toHaveProperty('cost_price');
    expect(body).not.toHaveProperty('users');
    expect(body).not.toHaveProperty('roles');
  });

  // CURRENT BEHAVIOUR (SEC-03): settings are SELECT * and include ZATCA secrets.
  // R1.3 (public settings DTO) and R1.4 (ZATCA removal) make this go away.
  it('CURRENT BEHAVIOUR: exposes ZATCA secrets in settings to every role', async () => {
    const body = await getBootstrap(t.app, cashierToken);
    expect(body.settings.private_key_pem).toContain('PRIVATE KEY');
    expect(body.settings.pcsid_secret).not.toBe('');
  });
});
