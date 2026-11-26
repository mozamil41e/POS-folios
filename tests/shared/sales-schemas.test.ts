import { describe, expect, it } from 'vitest';
import { discountedTotals, lineAmounts } from '../../shared/money.ts';
import { parseCheckoutHeader, parseHeldCart, parseSaleLine, paymentAmounts } from '../../shared/schemas/sales.ts';

// R2.4b: the sale rules shared by the server and the UI.
describe('paymentAmounts', () => {
  it('gives the whole total to cash or card', () => {
    expect(paymentAmounts('cash', 99, 50)).toEqual({ cash_amount: 50, card_amount: 0 });
    expect(paymentAmounts('card', 99, 50)).toEqual({ cash_amount: 0, card_amount: 50 });
  });

  it('needs a split to have both parts (owner decision a)', () => {
    expect(paymentAmounts('split', 20, 50)).toEqual({ cash_amount: 20, card_amount: 30 });
    expect(paymentAmounts('split', 0.004, 50)).toBeNull(); // rounds to 0
    expect([0, 50, 60].map((cash) => paymentAmounts('split', cash, 50))).toEqual([null, null, null]);
  });
});

describe('discountedTotals', () => {
  it('takes the discount off the subtotal and shrinks the VAT in proportion', () => {
    const lines = [lineAmounts(11.74, 2, 15)]; // 23.48 + 3.52
    expect(discountedTotals(lines, 3.48)).toEqual({ subtotal: 20, vat: 3, total: 23, discount: 3.48 });
  });

  it('caps the discount at the subtotal', () => {
    expect(discountedTotals([lineAmounts(10, 1, 15)], 25)).toEqual({ subtotal: 0, vat: 0, total: 0, discount: 10 });
  });

  it('adds lines with different VAT rates', () => {
    const totals = discountedTotals([lineAmounts(10, 3, 15), lineAmounts(4, 2, 0)], 0);
    expect(totals).toEqual({ subtotal: 38, vat: 4.5, total: 42.5, discount: 0 });
  });
});

describe('parseCheckoutHeader', () => {
  it('defaults to a simplified cash sale and reads the cash part only for a split', () => {
    expect(parseCheckoutHeader({ items: [{}], cash_amount: 'x' })).toEqual({
      ok: true,
      value: { invoice_subtype: '0200000', payment_method: 'cash', discount_total: 0, split_cash: 0, customer_id: null, items: [{}] },
    });
    const split = parseCheckoutHeader({ payment_method: 'split', cash_amount: '٥', customer_id: '4', items: [] });
    expect(split.ok ? [split.value.split_cash, split.value.customer_id] : null).toEqual([5, 4]);
  });
});

describe('parseSaleLine and parseHeldCart', () => {
  it('checks the quantity of a line', () => {
    expect(parseSaleLine({ product_id: '3', qty: '2' })).toEqual({ ok: true, value: { product_id: 3, qty: 2 } });
    const bad = parseSaleLine({ product_id: 3, qty: 1.5 });
    expect(bad.ok ? null : bad.problems[0].reason).toBe('NOT_INTEGER');
  });

  it('keeps only product and quantity of each held item', () => {
    expect(parseHeldCart({ label: 'x', items: [{ product_id: 2, qty: '3', price: 99 }] }, 1_700_000_001_234)).toEqual({
      ok: true,
      value: { label: 'x', items: [{ product_id: 2, qty: 3 }], discount: 0, customer_id: null, invoice_subtype: '0200000' },
    });
    const named = parseHeldCart({ items: [] }, 1_700_000_001_234);
    expect(named.ok ? named.value.label : null).toBe('طلب معلق #1234');
  });
});
