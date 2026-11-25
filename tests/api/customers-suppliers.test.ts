import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4b: the customers and suppliers modules. Same paths, rules, messages and
// responses as before (R1.10), plus 404 codes; a VAT number may repeat
// (owner's option a: branches of one company share one VAT number).
let t: TestApp;
let adminToken: string;
let cashierToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
  cashierToken = (await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local')).token;
});
afterAll(() => t.cleanup());

const send = (method: 'post' | 'put', path: string, body: Record<string, unknown>, token = adminToken) =>
  request(t.app)[method](path).set(bearer(token)).send(body);
const row = (table: 'customers' | 'suppliers', id: number) =>
  t.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, string | number>;

describe('customers', () => {
  let customerId: number;

  it('lets a cashier add a customer and answers with the id and the list', async () => {
    const res = await send(
      'post',
      '/api/customers',
      { name_ar: ' شركة الأفق ', vat_number: ' 300000000000003 ', phone: ' +966 50 000 0000 ', address_ar: 'الرياض' },
      cashierToken
    );
    expect(res.status).toBe(201);
    customerId = res.body.customerId;
    expect(res.body.customers).toEqual([row('customers', customerId)]);
    expect(row('customers', customerId)).toMatchObject({
      name_ar: 'شركة الأفق',
      name_en: 'شركة الأفق', // falls back to the Arabic name
      vat_number: '300000000000003',
      phone: '+966 50 000 0000',
    });
  });

  it('allows the same VAT number on another customer (a branch)', async () => {
    const branch = await send('post', '/api/customers', { name_ar: 'شركة الأفق - فرع جدة', vat_number: '300000000000003' });
    expect(branch.status).toBe(201);
    expect(branch.body.customers.map((c: { id: number }) => c.id)).toEqual([customerId, branch.body.customerId]); // oldest first
  });

  it('keeps every field that is not sent', async () => {
    const before = row('customers', customerId);
    const res = await send('put', `/api/customers/${customerId}`, { cr_number: '1010101010' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('customers');
    expect(row('customers', customerId)).toEqual({ ...before, cr_number: '1010101010' });
  });

  it('answers 404 with the old message and a code', async () => {
    const res = await send('put', '/api/customers/99999', { name_ar: 'لا أحد' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Customer not found.', code: 'CUSTOMER_NOT_FOUND' });
  });

  it('keeps the old messages for invalid input', async () => {
    const res = await send('post', '/api/customers', { name_ar: 'عميل', phone: '0'.repeat(31) });
    expect(res.body).toEqual({
      error: 'phone must be at most 30 characters.',
      code: 'VALIDATION_FAILED',
      field: 'phone',
      reason: 'TOO_LONG',
    });
    const longVat = await send('post', '/api/customers', { name_ar: 'عميل', vat_number: '3'.repeat(31) });
    expect(longVat.body).toMatchObject({ field: 'vat_number', reason: 'TOO_LONG' });
  });

  it('needs customers.manage', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'accountant', 'acc@test.local');
    // The accountant role has customers.manage; a role without it is refused.
    expect((await send('post', '/api/customers', { name_ar: 'عميل' }, token)).status).toBe(201);
    const noCustomers = await send('post', '/api/roles', { name_ar: 'مشاهد', permissions: ['reports.view'] });
    expect(noCustomers.status).toBe(201);
    const viewer = await createUserWithRole(t.app, adminToken, noCustomers.body.role.slug, 'viewer@test.local');
    expect((await send('post', '/api/customers', { name_ar: 'عميل' }, viewer.token)).status).toBe(403);
    expect((await request(t.app).post('/api/customers').send({ name_ar: 'عميل' })).status).toBe(401);
  });
});

describe('suppliers', () => {
  let supplierId: number;

  it('adds a supplier and answers with the id and the list, newest first', async () => {
    const first = await send('post', '/api/suppliers', { name_ar: 'مورد اللحوم', email: 'orders@meat.example' });
    expect(first.status).toBe(201);
    const second = await send('post', '/api/suppliers', { name_ar: 'مورد الخضار', name_en: 'Veg Supplier' });
    supplierId = first.body.supplierId;
    expect(second.body.suppliers.map((s: { id: number }) => s.id)).toEqual([second.body.supplierId, supplierId]);
    expect(row('suppliers', supplierId)).toMatchObject({ name_en: 'مورد اللحوم', email: 'orders@meat.example' });
  });

  it('checks the email before the other fields, as before', async () => {
    const res = await send('post', '/api/suppliers', { name_ar: '', email: 'bad' });
    expect(res.body).toEqual({ error: 'Email address is not valid.', code: 'VALIDATION_FAILED', field: 'email', reason: 'INVALID_EMAIL' });
  });

  it('keeps every field that is not sent, and answers 404 with a code', async () => {
    const before = row('suppliers', supplierId);
    expect((await send('put', `/api/suppliers/${supplierId}`, { phone: '0112345678' })).status).toBe(200);
    expect(row('suppliers', supplierId)).toEqual({ ...before, phone: '0112345678' });

    const missing = await send('put', '/api/suppliers/99999', { name_ar: 'لا أحد' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Supplier not found.', code: 'SUPPLIER_NOT_FOUND' });
  });

  it('needs purchases.manage: a cashier is refused', async () => {
    expect((await send('post', '/api/suppliers', { name_ar: 'مورد' }, cashierToken)).status).toBe(403);
  });

  it('still lets a purchase use the supplier (purchases are still legacy)', async () => {
    const product = await send('post', '/api/products', { sku: 'MEAT-1', name_ar: 'لحم', sell_price: 50, tax_rate: 15 });
    expect(product.status).toBe(201);
    const purchase = await send('post', '/api/purchases', {
      supplier_id: supplierId,
      supplier_invoice_no: 'INV-1',
      payment_status: 'paid',
      paid_amount: 115,
      notes: '',
      items: [{ product_id: product.body.product.id, qty: 2, unit_cost: 50, tax_rate: 15 }],
    });
    expect(purchase.status).toBe(201);
  });
});

describe('bootstrap', () => {
  it('lists customers and suppliers by role, with the same fields as the tables', async () => {
    const admin = (await request(t.app).get('/api/bootstrap').set(bearer(adminToken))).body;
    expect(Object.keys(admin.customers[0]).sort()).toEqual(
      ['address_ar', 'cr_number', 'created_at', 'id', 'name_ar', 'name_en', 'phone', 'vat_number'].sort()
    );
    expect(Object.keys(admin.suppliers[0]).sort()).toEqual(
      ['address_ar', 'cr_number', 'created_at', 'email', 'id', 'name_ar', 'name_en', 'phone', 'vat_number'].sort()
    );
    const cashier = (await request(t.app).get('/api/bootstrap').set(bearer(cashierToken))).body;
    expect(cashier.customers.length).toBeGreaterThan(0);
    expect(cashier).not.toHaveProperty('suppliers');
  });
});
