import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  SEED,
  bearer,
  createTestApp,
  createUserWithRole,
  getBootstrap,
  registerFirstAdmin,
  type TestApp,
} from '../helpers/app.ts';

const ALL_LISTS = ['customers', 'heldCarts', 'invoices', 'movements', 'products', 'purchases', 'suppliers', 'vouchers'];

// What each default role must receive from /api/bootstrap (R1.3, DATA_VISIBILITY).
const EXPECTED: Record<string, { keys: string[]; cost: boolean }> = {
  admin: { keys: ['settings', ...ALL_LISTS, 'roles', 'users'], cost: true },
  manager: { keys: ['settings', ...ALL_LISTS], cost: true },
  accountant: {
    keys: ['settings', 'customers', 'invoices', 'movements', 'products', 'purchases', 'suppliers', 'vouchers'],
    cost: true,
  },
  cashier: { keys: ['settings', 'customers', 'heldCarts', 'invoices', 'movements', 'products'], cost: false },
};

const SECRET_MARKERS = ['PRIVATE KEY', '"private_key_pem"', '"ccsid_secret"', '"pcsid_secret"'];

describe('read scoping by role (R1.3)', () => {
  let t: TestApp;
  let adminToken: string;
  const tokens: Record<string, string> = {};
  let posOnlyToken: string;

  const cashSale = (productId: number) => ({
    items: [{ product_id: productId, qty: 1 }],
    invoice_subtype: '0200000',
    payment_method: 'cash',
    cash_amount: 0,
    discount_total: 0,
    customer_id: null,
  });

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
    tokens.admin = adminToken;
    for (const slug of ['manager', 'accountant', 'cashier']) {
      tokens[slug] = (await createUserWithRole(t.app, adminToken, slug, `${slug}@test.local`)).token;
    }

    // A custom role that can only use the POS screen.
    const role = await request(t.app)
      .post('/api/roles')
      .set(bearer(adminToken))
      .send({ name_ar: 'كاشير محدود', name_en: 'POS only', permissions: ['pos.access'] });
    const slug = role.body.role.slug as string;
    posOnlyToken = (await createUserWithRole(t.app, adminToken, slug, 'posonly@test.local')).token;
  });
  afterAll(() => t.cleanup());

  it.each(Object.keys(EXPECTED))('sends the %s role exactly its lists', async (roleSlug) => {
    const body = await getBootstrap(t.app, tokens[roleSlug]);
    expect(Object.keys(body).sort()).toEqual([...EXPECTED[roleSlug].keys].sort());
    expect('cost_price' in body.products[0]).toBe(EXPECTED[roleSlug].cost);
  });

  it('gives a POS-only role just settings, products (without cost) and customers', async () => {
    const body = await getBootstrap(t.app, posOnlyToken);
    expect(Object.keys(body).sort()).toEqual(['customers', 'products', 'settings']);
    expect(body.products[0]).not.toHaveProperty('cost_price');
  });

  it('does not leak invoices, movements or costs through the checkout response', async () => {
    const res = await request(t.app).post('/api/invoices').set(bearer(posOnlyToken)).send(cashSale(SEED.water.id));
    expect(res.status).toBe(201);
    expect(res.body.invoice.invoice_number).toMatch(/^INV-/);
    expect(res.body).not.toHaveProperty('invoices');
    expect(res.body).not.toHaveProperty('movements');
    expect(res.body.products[0]).not.toHaveProperty('cost_price');
    expect(res.body.settings).not.toHaveProperty('private_key_pem');
  });

  it('still returns the full lists to an admin after checkout', async () => {
    const res = await request(t.app).post('/api/invoices').set(bearer(adminToken)).send(cashSale(SEED.water.id));
    expect(res.status).toBe(201);
    expect(res.body.invoices.length).toBeGreaterThan(0);
    expect(res.body.movements.length).toBeGreaterThan(0);
    expect(res.body.products[0]).toHaveProperty('cost_price');
  });

  it('sends no secrets in any response that carries settings or workspace data', async () => {
    const bodies: string[] = [];
    const collect = (res: { text: string }) => bodies.push(res.text);

    for (const token of Object.values(tokens).concat(posOnlyToken)) {
      collect(await request(t.app).get('/api/bootstrap').set(bearer(token)));
    }
    collect(await request(t.app).put('/api/settings').set(bearer(adminToken)).send({ table_page_size: 20 }));
    collect(await request(t.app).post('/api/zatca/generate-keys').set(bearer(adminToken)));
    const sale = await request(t.app).post('/api/invoices').set(bearer(adminToken)).send(cashSale(SEED.milk.id));
    collect(sale);
    collect(await request(t.app).post(`/api/invoices/${sale.body.invoice.id}/credit-note`).set(bearer(adminToken)));
    collect(
      await request(t.app)
        .post('/api/products')
        .set(bearer(adminToken))
        .send({ sku: 'VIS-001', name_ar: 'صنف', sell_price: 5, cost_price: 3, stock_qty: 1 })
    );

    expect(bodies.length).toBeGreaterThanOrEqual(10);
    for (const text of bodies) {
      for (const marker of SECRET_MARKERS) {
        expect(text).not.toContain(marker);
      }
    }
  });
});
