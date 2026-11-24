import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SEED, bearer, createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

describe('purchases (characterization)', () => {
  let t: TestApp;
  let adminToken: string;

  const createPurchase = (body: Record<string, unknown>) =>
    request(t.app).post('/api/purchases').set(bearer(adminToken)).send(body);
  const pay = (id: number, amount: number) =>
    request(t.app).post(`/api/purchases/${id}/pay`).set(bearer(adminToken)).send({ amount });

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it('records a paid purchase, adds stock and updates the cost price', async () => {
    const res = await createPurchase({
      supplier_id: SEED.supplierId,
      supplier_invoice_no: 'SUP-TEST-1',
      payment_status: 'paid',
      paid_amount: 0,
      notes: '',
      items: [{ product_id: SEED.milk.id, qty: 10, unit_cost: 9, tax_rate: 15 }],
    });
    expect(res.status).toBe(201);

    const po = res.body.purchase;
    // Two purchases are seeded, so this is number 3.
    expect(po.purchase_number).toMatch(/^PO-\d{4}-00003$/);
    expect(po.subtotal).toBe(90);
    expect(po.vat_total).toBe(13.5);
    expect(po.grand_total).toBe(103.5);
    expect(po.payment_status).toBe('paid');
    expect(po.paid_amount).toBe(103.5);
    expect(po.items).toHaveLength(1);

    const milk = res.body.products.find((p: { id: number }) => p.id === SEED.milk.id);
    expect(milk.stock_qty).toBe(SEED.milk.stock + 10);
    expect(milk.cost_price).toBe(9);
    expect(res.body.movements[0]).toMatchObject({
      product_id: SEED.milk.id,
      type: 'purchase',
      qty_delta: 10,
      reference_no: po.purchase_number,
    });
  });

  it('tracks partial and full payments on a credit purchase (overpayment is capped)', async () => {
    const res = await createPurchase({
      supplier_id: SEED.supplierId,
      supplier_invoice_no: 'SUP-TEST-2',
      payment_status: 'credit',
      paid_amount: 0,
      notes: '',
      items: [{ product_id: SEED.rice.id, qty: 2, unit_cost: 50, tax_rate: 15 }],
    });
    expect(res.status).toBe(201);
    const po = res.body.purchase;
    expect(po.grand_total).toBe(115);
    expect(po.payment_status).toBe('credit');
    expect(po.paid_amount).toBe(0);

    const partial = await pay(po.id, 50);
    expect(partial.status).toBe(200);
    const afterPartial = partial.body.purchases.find((p: { id: number }) => p.id === po.id);
    expect(afterPartial.payment_status).toBe('partial');
    expect(afterPartial.paid_amount).toBe(50);

    const rest = await pay(po.id, 100);
    const afterRest = rest.body.purchases.find((p: { id: number }) => p.id === po.id);
    expect(afterRest.payment_status).toBe('paid');
    expect(afterRest.paid_amount).toBe(115);
  });

  it('rejects a purchase without a supplier or without lines', async () => {
    const noSupplier = await createPurchase({ items: [{ product_id: SEED.milk.id, qty: 1, unit_cost: 1 }] });
    expect(noSupplier.status).toBe(400);

    const noLines = await createPurchase({ supplier_id: SEED.supplierId, items: [] });
    expect(noLines.status).toBe(400);
  });

  it('rejects an invalid line and leaves stock untouched', async () => {
    const before = (await getBootstrap(t.app, adminToken)).products.find((p: { id: number }) => p.id === SEED.milk.id);
    const res = await createPurchase({
      supplier_id: SEED.supplierId,
      items: [{ product_id: SEED.milk.id, qty: 0, unit_cost: 5, tax_rate: 15 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_PURCHASE_LINE');
    const after = (await getBootstrap(t.app, adminToken)).products.find((p: { id: number }) => p.id === SEED.milk.id);
    expect(after.stock_qty).toBe(before.stock_qty);
  });

  it('rejects a non-positive payment and an unknown purchase', async () => {
    expect((await pay(1, 0)).status).toBe(400);
    expect((await pay(999_999, 10)).status).toBe(404);
  });
});
