import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { idempotencyKeyFrom, requestHash } from '../../server/src/shared/idempotency.ts';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.5a (owner's decision a): an Idempotency-Key on the current checkout. A
// retried sale with the same key returns the first invoice instead of selling
// twice; without a key the checkout behaves exactly as before.
let t: TestApp;
let adminToken: string;
let tea: number;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  tea = (await request(t.app).post('/api/products').set(bearer(adminToken)).send({ sku: 'TEA', name_ar: 'شاي', sell_price: 10, tax_rate: 15, stock_qty: 100 })).body.product.id;
});
afterAll(() => t.cleanup());

const SALE = () => ({ items: [{ product_id: tea, qty: 2 }], payment_method: 'cash', invoice_subtype: '0200000', discount_total: 0 });
const sell = (body: Record<string, unknown>, key?: string, token = adminToken) => {
  const req = request(t.app).post('/api/invoices').set(bearer(token));
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body);
};
const stock = () => (t.db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(tea) as { stock_qty: number }).stock_qty;
const invoices = () => (t.db.prepare('SELECT COUNT(*) AS n FROM invoices').get() as { n: number }).n;
const number = (n: string) => Number(n.split('-')[2]);

describe('a retried sale with the same key', () => {
  it('returns the first invoice, saves nothing new and is marked as replayed', async () => {
    const before = { stock: stock(), invoices: invoices() };
    const first = await sell(SALE(), 'sale-retry-0001');
    expect(first.status).toBe(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const again = await sell(SALE(), 'sale-retry-0001');
    expect(again.status).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.invoice).toEqual(first.body.invoice);
    expect({ stock: stock(), invoices: invoices() }).toEqual({ stock: before.stock - 2, invoices: before.invoices + 1 });

    // No number was used by the replay.
    const next = await sell(SALE(), 'sale-retry-0002');
    expect(number(next.body.invoice.invoice_number)).toBe(number(first.body.invoice.invoice_number) + 1);
  });

  it('recognises the same request whatever the order of its fields', async () => {
    const first = await sell(SALE(), 'sale-order-0001');
    const reordered = { discount_total: 0, invoice_subtype: '0200000', payment_method: 'cash', items: [{ qty: 2, product_id: tea }] };
    const again = await sell(reordered, 'sale-order-0001');
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(again.body.invoice.id).toBe(first.body.invoice.id);
  });

  it('saves one invoice when the same request arrives twice at once', async () => {
    const before = invoices();
    const [a, b] = await Promise.all([sell(SALE(), 'sale-twice-0001'), sell(SALE(), 'sale-twice-0001')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.invoice.id).toBe(b.body.invoice.id);
    expect(invoices()).toBe(before + 1);
  });
});

describe('what a key does not allow', () => {
  it('refuses the same key for a different sale, and saves nothing', async () => {
    await sell(SALE(), 'sale-reuse-0001');
    const before = { stock: stock(), invoices: invoices() };
    const other = await sell({ ...SALE(), items: [{ product_id: tea, qty: 5 }] }, 'sale-reuse-0001');
    expect(other.status).toBe(409);
    expect(other.body).toEqual({
      error: 'This Idempotency-Key was already used for a different request.',
      code: 'IDEMPOTENCY_KEY_REUSED',
      field: 'Idempotency-Key',
    });
    expect({ stock: stock(), invoices: invoices() }).toEqual(before);
  });

  it('keeps keys apart per user', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local');
    const mine = await sell(SALE(), 'sale-shared-0001');
    const theirs = await sell(SALE(), 'sale-shared-0001', token);
    expect(theirs.status).toBe(201);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    expect(theirs.body.invoice.id).not.toBe(mine.body.invoice.id);
  });

  it('refuses a malformed key before anything happens', async () => {
    const before = invoices();
    const res = await sell(SALE(), 'short');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_IDEMPOTENCY_KEY');
    expect(invoices()).toBe(before);
  });

  it('keeps no key for a refused sale, so the corrected sale can use it', async () => {
    const refused = await sell({ ...SALE(), payment_method: 'split', cash_amount: 0 }, 'sale-fix-0001');
    expect(refused.status).toBe(400);
    expect((await sell({ ...SALE(), payment_method: 'split', cash_amount: 0 }, 'sale-fix-0001')).status).toBe(400); // not 409
    const fixed = await sell(SALE(), 'sale-fix-0001');
    expect(fixed.status).toBe(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('lifetime and old behaviour', () => {
  it('forgets a key after 24 hours and purges old keys', async () => {
    const first = await sell(SALE(), 'sale-old-00001');
    t.db.prepare('UPDATE idempotency_keys SET created_at = ? WHERE idem_key = ?').run('2000-01-01T00:00:00.000Z', 'sale-old-00001');
    const later = await sell(SALE(), 'sale-old-00001');
    expect(later.status).toBe(201);
    expect(later.headers['idempotent-replayed']).toBeUndefined();
    expect(later.body.invoice.id).not.toBe(first.body.invoice.id);
    const old = t.db.prepare("SELECT COUNT(*) AS n FROM idempotency_keys WHERE created_at < '2001-01-01'").get() as { n: number };
    expect(old.n).toBe(0);
  });

  it('without a key, every request is a new sale (as before)', async () => {
    const before = invoices();
    await sell(SALE());
    await sell(SALE());
    expect(invoices()).toBe(before + 2);
  });
});

describe('key and hash helpers', () => {
  it('accepts UUIDs and the fallback format, and ignores a blank header', () => {
    expect(idempotencyKeyFrom('3f1c2a9e-7b4d-4c1e-9a2b-1f0e9d8c7b6a')).toBe('3f1c2a9e-7b4d-4c1e-9a2b-1f0e9d8c7b6a');
    expect(idempotencyKeyFrom('sale-0123456789abcdef0123456789abcdef')).toMatch(/^sale-/);
    expect(idempotencyKeyFrom(undefined)).toBeNull();
    expect(idempotencyKeyFrom('   ')).toBeNull();
    expect(() => idempotencyKeyFrom('has spaces in it')).toThrow('Idempotency-Key must be 8 to 100');
    expect(() => idempotencyKeyFrom('x'.repeat(101))).toThrow('Idempotency-Key must be 8 to 100');
  });

  it('hashes equal requests equally, regardless of field order', () => {
    expect(requestHash({ a: 1, b: [{ y: 2, x: 1 }] })).toBe(requestHash({ b: [{ x: 1, y: 2 }], a: 1 }));
    expect(requestHash({ a: 1 })).not.toBe(requestHash({ a: 2 }));
  });
});
