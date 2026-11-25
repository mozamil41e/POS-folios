import { describe, expect, it } from 'vitest';
import { DOCUMENT_TYPES, INVOICE_KINDS } from '../../shared/constants.ts';
import { lineAmounts, roundMoney, splitVatInclusive, sumMoney, vatOf } from '../../shared/money.ts';

// R2.2: one rounding rule for every amount, shared by the server and the UI.
describe('roundMoney (R2.2)', () => {
  it('rounds half away from zero where toFixed gets it wrong', () => {
    // Why the helper exists: binary floats make toFixed round these down.
    expect(Number((1.005).toFixed(2))).toBe(1);
    expect(Number((0.015).toFixed(2))).toBe(0.01);

    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    expect(roundMoney(0.015)).toBe(0.02);
    expect(roundMoney(3.35 * 0.3)).toBe(1.01); // 1.0049999999999999 in binary
  });

  it('removes float noise and keeps clean values unchanged', () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(10)).toBe(10);
    expect(roundMoney(11.74 * 0.15)).toBe(1.76); // 1.761
    expect(roundMoney(1234567.895)).toBe(1234567.9);
    for (let cents = 0; cents <= 200_000; cents += 7) {
      expect(roundMoney(cents / 100)).toBe(cents / 100);
    }
  });

  it('rounds negative amounts symmetrically and never returns -0', () => {
    expect(roundMoney(-1.005)).toBe(-1.01);
    expect(roundMoney(-2.674)).toBe(-2.67);
    expect(Object.is(roundMoney(-0.001), 0)).toBe(true);
  });

  it('refuses values that are not finite numbers', () => {
    expect(() => roundMoney(Number.NaN)).toThrow(RangeError);
    expect(() => roundMoney(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('VAT and line helpers (R2.2)', () => {
  it('sums and rounds once', () => {
    expect(sumMoney([0.1, 0.2, 0.3])).toBe(0.6);
    expect(sumMoney([])).toBe(0);
  });

  it('computes VAT on a net amount', () => {
    expect(vatOf(11.74, 15)).toBe(1.76);
    expect(vatOf(0.1, 15)).toBe(0.02);
    expect(vatOf(100, 0)).toBe(0);
  });

  it('builds a line like the checkout does: rounded subtotal, VAT on it, total', () => {
    expect(lineAmounts(11.74, 2, 15)).toEqual({ subtotal: 23.48, vat: 3.52, total: 27 });
    expect(lineAmounts(0.1, 1, 15)).toEqual({ subtotal: 0.1, vat: 0.02, total: 0.12 });
  });

  it('splits a VAT-inclusive price so that net + VAT equals it exactly (for R5)', () => {
    expect(splitVatInclusive(115, 15)).toEqual({ net: 100, vat: 15 });
    const thirty = splitVatInclusive(30, 15);
    expect(thirty).toEqual({ net: 26.09, vat: 3.91 });
    expect(roundMoney(thirty.net + thirty.vat)).toBe(30);
  });
});

describe('domain constants (R2.2)', () => {
  it('keep the stored codes until R3 (D14)', () => {
    expect(DOCUMENT_TYPES).toEqual({ SALES_INVOICE: '388', CREDIT_NOTE: '381' });
    expect(INVOICE_KINDS).toEqual({ SIMPLIFIED: '0200000', TAX: '0100000' });
  });
});
