import { z } from 'zod';
import {
  INPUT_LIMITS,
  amountField,
  isBlankNumber,
  isMissing,
  problemsOf,
  requiredTextField,
  rule,
  textField,
  toNumberInput,
  wholeNumberField,
  type FieldProblem,
  type Raw,
} from './common';

/**
 * Inventory input rules (R2.4a): products, opening stock, categories and stock
 * movements. Same rules and reason codes as R1.10/R1.11c; used by the server
 * module and the CSV import (one validation for both).
 *
 * Each parse returns either the clean value or every problem (one per field):
 * the API reports the first, the CSV import shows them all.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: FieldProblem[] };

const fail = (problems: FieldProblem[]): { ok: false; problems: FieldProblem[] } => ({ ok: false, problems });

// ----------------------------------------------------------------- products

/** What an existing product contributes when a field is not sent (PUT). */
export interface ProductDefaults {
  sku: string;
  name_ar: string;
  name_en: string;
  unit_ar: string;
  unit_en: string;
  cost_price?: number;
  sell_price: number;
  tax_rate: number;
  tax_category: string;
  min_stock_alert: number;
  expiry_date: string | null;
}

export interface ProductInput {
  sku: string;
  name_ar: string;
  name_en: string;
  unit_ar: string;
  unit_en: string;
  cost_price: number;
  sell_price: number;
  tax_rate: number;
  tax_category: 'S' | 'Z' | 'E';
  min_stock_alert: number;
  expiry_date: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// Field order = the order problems are reported in.
const productFields = z.object({
  name_ar: requiredTextField('name_ar', INPUT_LIMITS.name),
  sku: requiredTextField('sku', INPUT_LIMITS.sku),
  name_en: textField('name_en', INPUT_LIMITS.name),
  unit_ar: textField('unit_ar', INPUT_LIMITS.unit),
  unit_en: textField('unit_en', INPUT_LIMITS.unit),
  cost_price: amountField('cost_price', false),
  sell_price: amountField('sell_price', true),
  tax_rate: z.preprocess(
    toNumberInput,
    z
      .number({ error: 'tax_rate must be a number.' })
      .refine((v) => v === 15 || v === 0, rule('INVALID_TAX', 'VAT rate must be 15 or 0.'))
  ),
  min_stock_alert: wholeNumberField('min_stock_alert'),
  expiry_date: z
    .union([z.string(), z.null()])
    .refine((v) => v === null || isRealDate(v), rule('INVALID_DATE', 'Expiry date must be a valid YYYY-MM-DD date.')),
});

/**
 * A new product, or an update of `existing`: fields not sent keep their value
 * (text: undefined/null; numbers: also ''). KSA VAT: 15% (S), or 0% (Z or E).
 */
export function parseProduct(raw: Raw, existing?: ProductDefaults): Parsed<ProductInput> {
  const text = (key: keyof ProductDefaults, fallback: string) => (isMissing(raw[key]) ? fallback : raw[key]);
  const number = (key: keyof ProductDefaults, fallback: number) => (isBlankNumber(raw[key]) ? fallback : raw[key]);

  let expiry: unknown;
  if (raw.expiry_date === undefined) expiry = existing ? existing.expiry_date || null : null;
  else if (raw.expiry_date === null || raw.expiry_date === '') expiry = null;
  else expiry = String(raw.expiry_date).trim();

  const parsed = productFields.safeParse({
    name_ar: text('name_ar', existing?.name_ar ?? ''),
    sku: text('sku', existing?.sku ?? ''),
    name_en: text('name_en', existing?.name_en ?? ''),
    unit_ar: text('unit_ar', existing?.unit_ar ?? 'حبة'),
    unit_en: text('unit_en', existing?.unit_en ?? 'Pcs'),
    cost_price: number('cost_price', existing?.cost_price ?? 0),
    sell_price: number('sell_price', existing?.sell_price ?? 0),
    tax_rate: number('tax_rate', existing?.tax_rate ?? 15),
    min_stock_alert: number('min_stock_alert', existing?.min_stock_alert ?? 10),
    expiry_date: expiry,
  });
  const problems = parsed.success ? [] : problemsOf(parsed.error);

  // Tax category follows the rate when not sent (or when the rate changed).
  const taxRate = parsed.success ? parsed.data.tax_rate : Number(toNumberInput(raw.tax_rate ?? existing?.tax_rate ?? 15));
  const sent = isMissing(raw.tax_category) || raw.tax_category === '' ? null : String(raw.tax_category);
  const fallback = existing && existing.tax_rate === taxRate ? existing.tax_category : taxRate === 15 ? 'S' : 'Z';
  const taxCategory = sent ?? fallback;
  const taxOk = taxRate === 15 ? taxCategory === 'S' : taxCategory === 'Z' || taxCategory === 'E';
  if (!problems.some((p) => p.field === 'tax_rate') && !taxOk) {
    problems.push({ field: 'tax_category', reason: 'INVALID_TAX', message: 'Tax category S needs 15%; Z or E need 0%.' });
  }
  if (!parsed.success || problems.length > 0) return fail(problems);

  const v = parsed.data;
  return {
    ok: true,
    value: {
      sku: v.sku,
      name_ar: v.name_ar,
      name_en: v.name_en || v.name_ar,
      unit_ar: v.unit_ar || 'حبة',
      unit_en: v.unit_en || 'Pcs',
      cost_price: v.cost_price,
      sell_price: v.sell_price,
      tax_rate: v.tax_rate,
      tax_category: taxCategory as 'S' | 'Z' | 'E',
      min_stock_alert: v.min_stock_alert,
      expiry_date: v.expiry_date,
    },
  };
}

/** Opening stock of a new product: whole number, 0 when not sent. */
export function parseOpeningStock(raw: Raw): Parsed<number> {
  const parsed = z
    .object({ stock_qty: wholeNumberField('stock_qty') })
    .safeParse({ stock_qty: isBlankNumber(raw.stock_qty) ? 0 : raw.stock_qty });
  return parsed.success ? { ok: true, value: parsed.data.stock_qty as number } : fail(problemsOf(parsed.error));
}

// --------------------------------------------------------------- categories

/** How a product names its category: by id (the UI's list) or by Arabic name (older clients, CSV). */
export type CategoryRef = { id: number } | { name_ar: string; name_en: string } | null;

export function parseCategoryRef(raw: Raw): Parsed<CategoryRef> {
  if (!isMissing(raw.category_id) && raw.category_id !== '') {
    const id = Number(raw.category_id);
    if (!Number.isInteger(id) || id <= 0) {
      return fail([{ field: 'category_id', reason: 'INVALID_NUMBER', message: 'category_id must be a category id.' }]);
    }
    return { ok: true, value: { id } };
  }
  const names = z
    .object({
      category_ar: textField('category_ar', INPUT_LIMITS.category),
      category_en: textField('category_en', INPUT_LIMITS.category),
    })
    .safeParse({ category_ar: raw.category_ar, category_en: raw.category_en });
  if (!names.success) return fail(problemsOf(names.error));
  if (!names.data.category_ar) return { ok: true, value: null };
  return { ok: true, value: { name_ar: names.data.category_ar, name_en: names.data.category_en } };
}

export interface CategoryInput {
  name_ar: string;
  name_en: string;
}

const collapseSpaces = (s: string) => s.replace(/\s+/g, ' ');

/** New category, or an update of `existing` (fields not sent keep their value). */
export function parseCategory(raw: Raw, existing?: CategoryInput): Parsed<CategoryInput> {
  const parsed = z
    .object({
      name_ar: requiredTextField('name_ar', INPUT_LIMITS.category),
      name_en: textField('name_en', INPUT_LIMITS.category),
    })
    .safeParse({
      name_ar: isMissing(raw.name_ar) ? (existing?.name_ar ?? '') : raw.name_ar,
      name_en: isMissing(raw.name_en) ? (existing?.name_en ?? '') : raw.name_en,
    });
  if (!parsed.success) return fail(problemsOf(parsed.error));
  const nameAr = collapseSpaces(parsed.data.name_ar);
  return { ok: true, value: { name_ar: nameAr, name_en: collapseSpaces(parsed.data.name_en) || nameAr } };
}

/** The new order of the POS category tabs: every category id, once. */
export function parseCategoryOrder(raw: Raw): Parsed<number[]> {
  const ids = raw.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > INPUT_LIMITS.maxCategories) {
    return fail([{ field: 'ids', reason: 'REQUIRED', message: 'ids must list the categories in their new order.' }]);
  }
  if (!ids.every((id) => Number.isInteger(id) && (id as number) > 0) || new Set(ids).size !== ids.length) {
    return fail([{ field: 'ids', reason: 'INVALID_CHOICE', message: 'ids must be distinct category ids.' }]);
  }
  return { ok: true, value: ids as number[] };
}

// ---------------------------------------------------------- stock movements

export type MovementType = 'purchase' | 'adjustment' | 'return';

export interface MovementInput {
  product_id: number;
  type: MovementType;
  qty: number;
  notes: string;
  reference_no: string;
}

export function parseMovement(raw: Raw): Parsed<MovementInput> {
  const type = String(raw.type ?? 'purchase');
  if (type !== 'purchase' && type !== 'adjustment' && type !== 'return') {
    return fail([{ field: 'type', reason: 'INVALID_CHOICE', message: 'Movement type must be purchase, adjustment or return.' }]);
  }
  const parsed = z
    .object({
      qty: z.preprocess(
        (v) => toNumberInput(isBlankNumber(v) ? 0 : v),
        z
          .number({ error: 'qty must be a number.' })
          .refine(Number.isInteger, rule('NOT_INTEGER', 'Quantity must be a whole number.'))
          .refine((v) => v !== 0, rule('REQUIRED', 'Quantity must not be zero.'))
          .refine((v) => Math.abs(v) <= INPUT_LIMITS.maxQty, rule('TOO_LARGE', 'Quantity is too large.'))
      ),
      notes: textField('notes', INPUT_LIMITS.notes),
      reference_no: textField('reference_no', INPUT_LIMITS.reference),
    })
    .safeParse({ qty: raw.qty, notes: raw.notes, reference_no: raw.reference_no });
  if (!parsed.success) return fail(problemsOf(parsed.error));
  return {
    ok: true,
    value: {
      product_id: Number(raw.product_id),
      type,
      qty: parsed.data.qty,
      notes: parsed.data.notes,
      reference_no: parsed.data.reference_no || `STK-${Date.now().toString().slice(-6)}`,
    },
  };
}
