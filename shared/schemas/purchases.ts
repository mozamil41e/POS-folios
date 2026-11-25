import { z } from 'zod';
import type { PurchasePaymentStatus } from '../types';
import {
  INPUT_LIMITS,
  amountField,
  isBlankNumber,
  isMissing,
  problemsOf,
  rule,
  toNumberInput,
  type Parsed,
  type Raw,
} from './common';

/**
 * Purchase (supplier invoice) input rules (R2.4b). Same checks and messages as
 * the legacy route, with the owner's decisions:
 *   - a line quantity must be a whole number (2.7 is refused, not cut to 2);
 *   - a "partial" payment gets its status from the amount: nothing paid is
 *     credit, the full amount is paid (the rule the payment route already uses);
 *   - VAT 15% or 0% only (as for products), and an unknown payment status is
 *     refused (it used to be recorded as fully paid).
 */
export const PAYMENT_STATUSES = ['paid', 'credit', 'partial'] as const satisfies readonly PurchasePaymentStatus[];
export const PURCHASE_VAT_RATES = [15, 0] as const;

export const PURCHASE_REQUIRED_ERROR = 'Supplier and at least one line item are required.';
export const PAYMENT_AMOUNT_ERROR = 'Positive payment amount is required.';

/** Amounts within one halala of the total count as fully paid (as before). */
const PAID_TOLERANCE = 0.01;

function parse<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

/** A whole id, or 0 (which matches nothing). */
function toId(value: unknown): number {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

// -------------------------------------------------------------------- header

export interface PurchaseHeader {
  supplier_id: number;
  supplier_invoice_no: string;
  payment_status: PurchasePaymentStatus;
  /** What the "partial" status sent; ignored for paid and credit. */
  partial_amount: number;
  notes: string;
  items: unknown[];
}

const headerFields = z.object({
  supplier_id: z.number().refine((id) => id > 0, rule('REQUIRED', PURCHASE_REQUIRED_ERROR)),
  items: z.array(z.unknown()).refine((items) => items.length > 0, rule('REQUIRED', PURCHASE_REQUIRED_ERROR)),
  // An enum failure becomes INVALID_CHOICE (toProblem in common.ts).
  payment_status: z.enum(PAYMENT_STATUSES, { error: `payment_status must be one of: ${PAYMENT_STATUSES.join(', ')}.` }),
  paid_amount: amountField('paid_amount', false),
});

export function parsePurchaseHeader(raw: Raw): Parsed<PurchaseHeader> {
  const status = isMissing(raw.payment_status) ? 'paid' : raw.payment_status;
  const parsed = parse(headerFields, {
    supplier_id: toId(raw.supplier_id),
    items: Array.isArray(raw.items) ? raw.items : [],
    payment_status: status,
    // Only a partial payment reads the amount; blank means nothing paid yet.
    paid_amount: status === 'partial' && !isBlankNumber(raw.paid_amount) ? raw.paid_amount : 0,
  });
  if (!parsed.ok) return parsed;
  const { paid_amount: partialAmount, ...rest } = parsed.value;
  return {
    ok: true,
    value: {
      ...rest,
      partial_amount: partialAmount,
      supplier_invoice_no: isMissing(raw.supplier_invoice_no) ? '' : String(raw.supplier_invoice_no).trim(),
      notes: isMissing(raw.notes) ? '' : String(raw.notes).trim(),
    },
  };
}

/** What a new purchase records as paid, and its status. */
export function initialPayment(
  status: PurchasePaymentStatus,
  partialAmount: number,
  grandTotal: number
): { paid_amount: number; payment_status: PurchasePaymentStatus } {
  if (status === 'paid') return { paid_amount: grandTotal, payment_status: 'paid' };
  if (status === 'credit') return { paid_amount: 0, payment_status: 'credit' };
  const paid = Math.min(grandTotal, partialAmount);
  return { paid_amount: paid, payment_status: paymentStatusFor(paid, grandTotal) };
}

/** Paid in full (within one halala), nothing paid, or in between. */
export function paymentStatusFor(paid: number, grandTotal: number): PurchasePaymentStatus {
  if (paid >= grandTotal - PAID_TOLERANCE) return 'paid';
  return paid <= 0 ? 'credit' : 'partial';
}

// --------------------------------------------------------------------- lines

export interface PurchaseLineInput {
  product_id: number;
  qty: number;
  unit_cost: number;
  tax_rate: (typeof PURCHASE_VAT_RATES)[number];
}

const lineFields = z.object({
  qty: z.preprocess(
    toNumberInput,
    z
      .number({ error: 'qty must be a number.' })
      .refine(Number.isInteger, rule('NOT_INTEGER', 'qty must be a whole number.'))
      .refine((v) => v > 0, rule('MUST_BE_POSITIVE', 'qty must be greater than 0.'))
      .refine((v) => v <= INPUT_LIMITS.maxQty, rule('TOO_LARGE', 'qty is too large.'))
  ),
  unit_cost: amountField('unit_cost', false),
  tax_rate: z.preprocess(
    toNumberInput,
    z.number().refine((v) => v === 15 || v === 0, rule('INVALID_TAX', 'tax_rate must be 15 or 0.'))
  ),
});

/** One line as sent by the purchases screen; an unknown product id becomes 0. */
export function parsePurchaseLine(entry: unknown): Parsed<PurchaseLineInput> {
  const line: Record<string, unknown> = entry !== null && typeof entry === 'object' ? { ...entry } : {};
  const parsed = parse(lineFields, {
    qty: isBlankNumber(line.qty) ? 0 : line.qty,
    unit_cost: isBlankNumber(line.unit_cost) ? 0 : line.unit_cost,
    tax_rate: isBlankNumber(line.tax_rate) ? 15 : line.tax_rate,
  });
  if (!parsed.ok) return parsed;
  const taxRate = parsed.value.tax_rate === 0 ? 0 : 15;
  return { ok: true, value: { ...parsed.value, tax_rate: taxRate, product_id: toId(line.product_id) } };
}

// ------------------------------------------------------------------ payments

// Checked by hand so that every failure keeps the legacy message.
const amountFields = z.object({
  amount: z.unknown().transform((value, ctx): number => {
    const amount = toNumberInput(value);
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      ctx.addIssue({ code: 'custom', message: PAYMENT_AMOUNT_ERROR, params: { reason: 'INVALID_NUMBER' } });
      return z.NEVER;
    }
    if (amount <= 0) {
      ctx.addIssue({ code: 'custom', message: PAYMENT_AMOUNT_ERROR, params: { reason: 'MUST_BE_POSITIVE' } });
      return z.NEVER;
    }
    return amount;
  }),
});

/** POST /api/purchases/:id/pay: a positive amount (more than is owed is capped by the service). */
export function parsePaymentAmount(raw: Raw): Parsed<number> {
  const parsed = parse(amountFields, { amount: isBlankNumber(raw.amount) ? 0 : raw.amount });
  return parsed.ok ? { ok: true, value: parsed.value.amount } : parsed;
}
