import { describe, expect, it } from 'vitest';
import {
  initialPayment,
  parsePaymentAmount,
  parsePurchaseHeader,
  parsePurchaseLine,
  paymentStatusFor,
} from '../../shared/schemas/purchases.ts';

// R2.4b: the purchase rules shared by the server and the UI.
describe('parsePurchaseHeader', () => {
  it('defaults to a paid purchase and trims the texts', () => {
    expect(parsePurchaseHeader({ supplier_id: '3', supplier_invoice_no: ' S-1 ', notes: null, items: [{}] })).toEqual({
      ok: true,
      value: { supplier_id: 3, supplier_invoice_no: 'S-1', notes: '', payment_status: 'paid', partial_amount: 0, items: [{}] },
    });
  });

  it('reads the amount only for a partial payment', () => {
    const partial = parsePurchaseHeader({ supplier_id: 1, items: [{}], payment_status: 'partial', paid_amount: '٥٠' });
    expect(partial.ok ? partial.value.partial_amount : null).toBe(50);
    expect(parsePurchaseHeader({ supplier_id: 1, items: [{}], payment_status: 'credit', paid_amount: 'x' }).ok).toBe(true);
  });
});

describe('initialPayment and paymentStatusFor', () => {
  it('follows the status for paid and credit, and the amount for partial', () => {
    expect(initialPayment('paid', 0, 80)).toEqual({ paid_amount: 80, payment_status: 'paid' });
    expect(initialPayment('credit', 50, 80)).toEqual({ paid_amount: 0, payment_status: 'credit' });
    expect(initialPayment('partial', 0, 80)).toEqual({ paid_amount: 0, payment_status: 'credit' });
    expect(initialPayment('partial', 30, 80)).toEqual({ paid_amount: 30, payment_status: 'partial' });
    expect(initialPayment('partial', 500, 80)).toEqual({ paid_amount: 80, payment_status: 'paid' });
  });

  it('counts one halala short as paid, and a zero total as paid', () => {
    expect(paymentStatusFor(79.99, 80)).toBe('paid');
    expect(paymentStatusFor(79.98, 80)).toBe('partial');
    expect(paymentStatusFor(0, 0)).toBe('paid');
  });
});

describe('parsePurchaseLine', () => {
  it('defaults the VAT rate to 15 and the unit cost to 0', () => {
    expect(parsePurchaseLine({ product_id: '7', qty: '2' })).toEqual({
      ok: true,
      value: { product_id: 7, qty: 2, unit_cost: 0, tax_rate: 15 },
    });
  });

  it('gives the reason of the first problem', () => {
    const reason = (entry: unknown) => {
      const parsed = parsePurchaseLine(entry);
      return parsed.ok ? null : `${parsed.problems[0].field}:${parsed.problems[0].reason}`;
    };
    expect(reason({ qty: 2.5 })).toBe('qty:NOT_INTEGER');
    expect(reason({ qty: 0 })).toBe('qty:MUST_BE_POSITIVE');
    expect(reason({ qty: 1_000_001 })).toBe('qty:TOO_LARGE');
    expect(reason({ qty: 1, unit_cost: -1 })).toBe('unit_cost:MUST_NOT_BE_NEGATIVE');
    expect(reason({ qty: 1, tax_rate: 5 })).toBe('tax_rate:INVALID_TAX');
    expect(reason(null)).toBe('qty:MUST_BE_POSITIVE');
  });
});

describe('parsePaymentAmount', () => {
  it('accepts a positive amount, also with Arabic digits', () => {
    expect(parsePaymentAmount({ amount: '١٢٫٥' })).toEqual({ ok: true, value: 12.5 });
  });

  it('refuses everything else with the old message', () => {
    for (const amount of [undefined, '', 'abc', 0, -3, Infinity, true]) {
      const parsed = parsePaymentAmount({ amount });
      expect(parsed.ok ? null : parsed.problems[0].message).toBe('Positive payment amount is required.');
    }
  });
});
