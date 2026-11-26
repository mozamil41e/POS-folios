import { z } from 'zod';
import { roundMoney } from '../money';
import type { InvoiceSubtype, PaymentMethod } from '../types';
import { INPUT_LIMITS, amountField, isBlankNumber, isMissing, problemsOf, rule, toNumberInput, type Parsed, type Raw } from './common';

/**
 * Sale (checkout) and held cart input rules (R2.4b). Same checks, messages
 * and codes as the legacy routes, plus the owner's decision on split
 * payments (both parts must be above zero) and, following earlier decisions,
 * whole quantities and unknown choices refused (a misspelt payment method
 * used to become cash). Prices, VAT and totals always come from the database.
 */
export const SALE_PAYMENT_METHODS = ['cash', 'card', 'split'] as const satisfies readonly PaymentMethod[];
export const INVOICE_SUBTYPES = ['0200000', '0100000'] as const satisfies readonly InvoiceSubtype[];

export const CART_EMPTY_ERROR = 'Cart cannot be empty.';
export const SPLIT_ERROR =
  'A split payment needs a cash part and a card part: the cash amount must be above 0 and below the total. Otherwise choose cash or card.';
export const HELD_ITEMS_ERROR = 'Each held item needs a product and a whole quantity above 0.';
export const HELD_LABEL_MAX = 60;

function parse<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const parsed = schema.safeParse(raw);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, problems: problemsOf(parsed.error) };
}

/** A whole id above 0, or 0 (which matches nothing). */
function toId(value: unknown): number {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

const quantity = z.preprocess(
  toNumberInput,
  z
    .number({ error: 'qty must be a number.' })
    .refine(Number.isInteger, rule('NOT_INTEGER', 'qty must be a whole number.'))
    .refine((v) => v > 0, rule('MUST_BE_POSITIVE', 'qty must be greater than 0.'))
    .refine((v) => v <= INPUT_LIMITS.maxQty, rule('TOO_LARGE', 'qty is too large.'))
);

const subtype = z.enum(INVOICE_SUBTYPES, { error: `invoice_subtype must be one of: ${INVOICE_SUBTYPES.join(', ')}.` });

// ------------------------------------------------------------------ checkout

export interface CheckoutHeader {
  invoice_subtype: InvoiceSubtype;
  payment_method: PaymentMethod;
  discount_total: number;
  /** The cash part of a split payment (0 for cash and card). */
  split_cash: number;
  customer_id: number | null;
  items: unknown[];
}

const checkoutFields = z.object({
  invoice_subtype: subtype,
  payment_method: z.enum(SALE_PAYMENT_METHODS, { error: `payment_method must be one of: ${SALE_PAYMENT_METHODS.join(', ')}.` }),
  discount_total: amountField('discount_total', false),
  cash_amount: amountField('cash_amount', false),
});

export function parseCheckoutHeader(raw: Raw): Parsed<CheckoutHeader> {
  const method = isMissing(raw.payment_method) ? 'cash' : raw.payment_method;
  const parsed = parse(checkoutFields, {
    invoice_subtype: isMissing(raw.invoice_subtype) ? '0200000' : raw.invoice_subtype,
    payment_method: method,
    discount_total: isBlankNumber(raw.discount_total) ? 0 : raw.discount_total,
    // Only a split payment reads the cash part (the screen also sends it for cash).
    cash_amount: method === 'split' && !isBlankNumber(raw.cash_amount) ? raw.cash_amount : 0,
  });
  if (!parsed.ok) return parsed;
  const id = toId(raw.customer_id);
  return {
    ok: true,
    value: {
      invoice_subtype: parsed.value.invoice_subtype,
      payment_method: parsed.value.payment_method,
      discount_total: parsed.value.discount_total,
      split_cash: parsed.value.cash_amount,
      customer_id: id > 0 ? id : null,
      items: Array.isArray(raw.items) ? raw.items : [],
    },
  };
}

export interface SaleLineInput {
  product_id: number;
  qty: number;
}

/** One cart line; only the quantity is checked here (the product in the database). */
export function parseSaleLine(entry: unknown): Parsed<SaleLineInput> {
  const line: Record<string, unknown> = entry !== null && typeof entry === 'object' ? { ...entry } : {};
  const parsed = parse(z.object({ qty: quantity }), { qty: isBlankNumber(line.qty) ? 0 : line.qty });
  return parsed.ok ? { ok: true, value: { product_id: toId(line.product_id), qty: parsed.value.qty } } : parsed;
}

/**
 * How the total was paid. Cash and card take the whole total; a split needs a
 * cash part above 0 and below the total (owner's decision a), the card part
 * being the rest. null: an invalid split.
 */
export function paymentAmounts(
  method: PaymentMethod,
  splitCash: number,
  total: number
): { cash_amount: number; card_amount: number } | null {
  if (method === 'cash') return { cash_amount: total, card_amount: 0 };
  if (method === 'card') return { cash_amount: 0, card_amount: total };
  const cash = roundMoney(splitCash);
  if (cash <= 0 || cash >= total) return null;
  return { cash_amount: cash, card_amount: roundMoney(total - cash) };
}

// --------------------------------------------------------------- held carts

export interface HeldCartInput {
  label: string;
  items: SaleLineInput[];
  discount: number;
  customer_id: number | null;
  invoice_subtype: InvoiceSubtype;
}

const heldItem = z.object({ product_id: z.number().int().positive(), qty: quantity });

const heldFields = z.object({
  label: z.string().refine((s) => s.length <= HELD_LABEL_MAX, rule('TOO_LONG', `label must be at most ${HELD_LABEL_MAX} characters.`)),
  items: z.array(z.unknown()).superRefine((items, ctx) => {
    for (const item of items) {
      const line: Record<string, unknown> = item !== null && typeof item === 'object' ? { ...item } : {};
      if (!heldItem.safeParse({ product_id: toId(line.product_id), qty: line.qty }).success) {
        ctx.addIssue({ code: 'custom', message: HELD_ITEMS_ERROR, params: { reason: 'INVALID_CHOICE' } });
        return;
      }
    }
  }),
  discount: amountField('discount', false),
  invoice_subtype: subtype,
});

/** A cart put on hold at the till; it is checked again when it is sold. */
export function parseHeldCart(raw: Raw, now = Date.now()): Parsed<HeldCartInput> {
  const parsed = parse(heldFields, {
    label: isMissing(raw.label) ? `طلب معلق #${now.toString().slice(-4)}` : String(raw.label).trim(),
    items: Array.isArray(raw.items) ? raw.items : [],
    discount: isBlankNumber(raw.discount) ? 0 : raw.discount,
    invoice_subtype: isMissing(raw.invoice_subtype) ? '0200000' : raw.invoice_subtype,
  });
  if (!parsed.ok) return parsed;
  const id = toId(raw.customer_id);
  const items = parsed.value.items.map((item) => {
    const line: Record<string, unknown> = item !== null && typeof item === 'object' ? { ...item } : {};
    return { product_id: toId(line.product_id), qty: Number(toNumberInput(line.qty)) };
  });
  return { ok: true, value: { ...parsed.value, items, customer_id: id > 0 ? id : null } };
}
