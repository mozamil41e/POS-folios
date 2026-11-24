import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  SEED,
  bearer,
  createTestApp,
  createUserWithRole,
  getBootstrap,
  registerFirstAdmin,
  stockOf,
  type TestApp,
} from '../helpers/app.ts';

type Line = { product_id: number; qty: number; unit_price?: number };

const cashSale = (items: Line[], extra: Record<string, unknown> = {}) => ({
  items,
  invoice_subtype: '0200000',
  payment_method: 'cash',
  cash_amount: 0,
  discount_total: 0,
  customer_id: null,
  ...extra,
});

describe('POST /api/invoices — checkout (characterization)', () => {
  let t: TestApp;
  let adminToken: string;
  let cashierToken: string;

  const sell = (token: string, body: unknown) =>
    request(t.app).post('/api/invoices').set(bearer(token)).send(body as object);

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
    ({ token: cashierToken } = await createUserWithRole(t.app, adminToken, 'cashier', 'cashier@test.local'));
  });
  afterAll(() => t.cleanup());

  it('prices a cash sale from the database (ignoring client prices) and deducts stock', async () => {
    const res = await sell(adminToken, cashSale([{ product_id: SEED.milk.id, qty: 2, unit_price: 0.01 }]));
    expect(res.status).toBe(201);

    const inv = res.body.invoice;
    // Three invoices are seeded (ICV 1-3), so the first sale is number 4.
    expect(inv.invoice_number).toMatch(/^INV-\d{4}-00004$/);
    expect(inv.invoice_type_code).toBe('388');
    expect(inv.payment_method).toBe('cash');
    expect(inv.items).toHaveLength(1);
    expect(inv.items[0].unit_price).toBe(SEED.milk.price);
    // 2 × 11.74 = 23.48; VAT 15% = 3.522 → 3.52; total 27.00
    expect(inv.subtotal).toBe(23.48);
    expect(inv.vat_total).toBe(3.52);
    expect(inv.grand_total).toBe(27);
    expect(inv.cash_amount).toBe(27);
    expect(inv.card_amount).toBe(0);
    expect(inv.zatca_status).toBe('DISABLED');

    const milk = res.body.products.find((p: { id: number }) => p.id === SEED.milk.id);
    expect(milk.stock_qty).toBe(SEED.milk.stock - 2);
    expect(res.body.movements[0]).toMatchObject({
      product_id: SEED.milk.id,
      type: 'sale',
      qty_delta: -2,
      balance_after: SEED.milk.stock - 2,
      reference_no: inv.invoice_number,
    });
  });

  it('spreads an invoice discount proportionally over VAT', async () => {
    const res = await sell(adminToken, cashSale([{ product_id: SEED.milk.id, qty: 2 }], { discount_total: 3.48 }));
    expect(res.status).toBe(201);
    const inv = res.body.invoice;
    // subtotal 23.48 - 3.48 = 20.00; VAT 3.52 × (20 / 23.48) = 2.998 → 3.00
    expect(inv.subtotal).toBe(20);
    expect(inv.discount_total).toBe(3.48);
    expect(inv.vat_total).toBe(3);
    expect(inv.grand_total).toBe(23);
  });

  it('splits cash and card for a split payment', async () => {
    const res = await sell(
      adminToken,
      cashSale([{ product_id: SEED.water.id, qty: 1 }], { payment_method: 'split', cash_amount: 5 })
    );
    expect(res.status).toBe(201);
    const inv = res.body.invoice;
    expect(inv.payment_method).toBe('split');
    expect(inv.cash_amount).toBe(5);
    expect(inv.card_amount).toBe(Number((inv.grand_total - 5).toFixed(2)));
  });

  it('forbids a discount for a user without pos.discount', async () => {
    const res = await sell(cashierToken, cashSale([{ product_id: SEED.milk.id, qty: 1 }], { discount_total: 1 }));
    expect(res.status).toBe(403);
  });

  it('lets a cashier sell without a discount', async () => {
    const res = await sell(cashierToken, cashSale([{ product_id: SEED.water.id, qty: 1 }]));
    expect(res.status).toBe(201);
  });

  it('rolls back the whole sale when one line is out of stock', async () => {
    const before = await getBootstrap(t.app, adminToken);
    const milkBefore = before.products.find((p: { id: number }) => p.id === SEED.milk.id).stock_qty;

    const res = await sell(
      adminToken,
      cashSale([
        { product_id: SEED.milk.id, qty: 1 },
        { product_id: SEED.juiceOutOfStock.id, qty: 1 },
      ])
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^INSUFFICIENT_STOCK/);

    const after = await getBootstrap(t.app, adminToken);
    expect(after.products.find((p: { id: number }) => p.id === SEED.milk.id).stock_qty).toBe(milkBefore);
    expect(after.invoices).toHaveLength(before.invoices.length);
  });

  it('rejects an empty cart, a zero quantity and an unknown product', async () => {
    const empty = await sell(adminToken, cashSale([]));
    expect(empty.status).toBe(400);

    const zero = await sell(adminToken, cashSale([{ product_id: SEED.milk.id, qty: 0 }]));
    expect(zero.status).toBe(400);
    expect(zero.body.error).toBe('INVALID_QTY');

    const unknown = await sell(adminToken, cashSale([{ product_id: 9999, qty: 1 }]));
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('PRODUCT_NOT_FOUND');
  });

  // SEC-09 fixed in R1.5: this route only issues sales invoices (388).
  it('rejects any other document type (credit / debit notes) without touching stock', async () => {
    const before = await stockOf(t.app, adminToken, SEED.water.id);
    for (const type of ['381', '383']) {
      const res = await sell(adminToken, cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_type_code: type }));
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_DOCUMENT_TYPE');
    }
    expect(await stockOf(t.app, adminToken, SEED.water.id)).toBe(before);

    const explicit388 = await sell(adminToken, cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_type_code: '388' }));
    expect(explicit388.status).toBe(201);
  });

  // H2 fixed in R1.5 + D12: a tax invoice (B2B) needs a registered customer
  // with a valid 15-digit VAT number.
  it('rejects a B2B invoice without a customer', async () => {
    const before = await stockOf(t.app, adminToken, SEED.water.id);
    const res = await sell(
      adminToken,
      cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_subtype: '0100000', customer_id: null })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CUSTOMER_REQUIRED');
    expect(await stockOf(t.app, adminToken, SEED.water.id)).toBe(before);
  });

  it('rejects a B2B invoice for a customer without a valid VAT number', async () => {
    const created = await request(t.app)
      .post('/api/customers')
      .set(bearer(adminToken))
      .send({ name_ar: 'شركة بلا رقم ضريبي', name_en: '', vat_number: '12345', cr_number: '', address_ar: '', phone: '' });
    const res = await sell(
      adminToken,
      cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_subtype: '0100000', customer_id: created.body.customerId })
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('CUSTOMER_VAT_INVALID');
  });

  it('issues a B2B invoice for a registered customer with a valid VAT number', async () => {
    // Seeded customer #1 has VAT 310488291000003.
    const res = await sell(
      adminToken,
      cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_subtype: '0100000', customer_id: 1 })
    );
    expect(res.status).toBe(201);
    expect(res.body.invoice.invoice_subtype).toBe('0100000');
    expect(res.body.invoice.customer_vat).toBe('310488291000003');
  });

  it('rejects an unknown customer instead of silently using the cash customer', async () => {
    for (const subtype of ['0200000', '0100000']) {
      const res = await sell(
        adminToken,
        cashSale([{ product_id: SEED.water.id, qty: 1 }], { invoice_subtype: subtype, customer_id: 999_999 })
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
    }
  });
});
