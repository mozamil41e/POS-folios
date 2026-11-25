/**
 * Money helpers shared by the server and the UI (R2.2). Amounts are SAR with at
 * most 2 decimals (halalas). The server computes every stored amount with these
 * helpers; the UI uses the same ones, so its estimates match the invoice.
 *
 * One rounding rule everywhere: half away from zero, to 2 decimals.
 * `Number(x.toFixed(2))`, used before, is wrong at the boundary because of
 * binary floats: (1.005).toFixed(2) is "1.00" and 3.35 * 0.3 gives
 * 1.0049999999999999. These helpers first drop that float noise (15
 * significant digits), then round on the decimal value.
 */

/** Moves the decimal point using the decimal string form, so no float error is added. */
function shiftDecimal(value: number, places: number): number {
  const [mantissa, exponent = '0'] = String(value).split('e');
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/** Rounds half away from zero to 2 decimals: 1.005 → 1.01, -2.675 → -2.68. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError(`roundMoney: ${value} is not a finite number`);
  const clean = Number(Math.abs(value).toPrecision(15));
  const rounded = shiftDecimal(Math.round(shiftDecimal(clean, 2)), -2);
  return value < 0 && rounded !== 0 ? -rounded : rounded;
}

/** Adds amounts and rounds once at the end. */
export function sumMoney(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return roundMoney(total);
}

/** VAT on a net (VAT-exclusive) amount, rounded. */
export function vatOf(netAmount: number, ratePercent: number): number {
  return roundMoney((netAmount * ratePercent) / 100);
}

export interface LineAmounts {
  subtotal: number;
  vat: number;
  total: number;
}

/**
 * Amounts of one invoice or purchase line from a VAT-exclusive unit price:
 * subtotal rounded, VAT on the rounded subtotal, total = subtotal + VAT.
 */
export function lineAmounts(unitPrice: number, qty: number, ratePercent: number): LineAmounts {
  const subtotal = roundMoney(unitPrice * qty);
  const vat = vatOf(subtotal, ratePercent);
  return { subtotal, vat, total: roundMoney(subtotal + vat) };
}

/**
 * Splits a VAT-inclusive amount into net and VAT so that net + VAT equals the
 * gross exactly: VAT = gross × rate / (100 + rate), rounded; net = the rest.
 * For menu prices that include VAT (D5, used from R5).
 */
export function splitVatInclusive(grossAmount: number, ratePercent: number): { net: number; vat: number } {
  const gross = roundMoney(grossAmount);
  const vat = roundMoney((gross * ratePercent) / (100 + ratePercent));
  return { net: roundMoney(gross - vat), vat };
}
