import { ValidationError } from '../../server/src/shared/errors.ts';
import { isValidVatNumber } from '../../shared/validation.ts';
import type { Customer, Product, Supplier } from '../../shared/types.ts';

/**
 * Input rules for the write routes that had none (R1.10, SEC-19), approved by
 * the owner: VAT 15% (S) or 0% (Z/E) only; VAT numbers optional for customers
 * and suppliers but valid when given. Hand-written until zod arrives with the
 * module refactor (R2).
 *
 * Every rule throws InputError, which the routes turn into
 *   400 { error, code: 'VALIDATION_FAILED', field, reason }
 * so the UI can show a translated message for the exact field.
 */
export type InputReason =
  | 'REQUIRED'
  | 'TOO_LONG'
  | 'INVALID_NUMBER'
  | 'NOT_INTEGER'
  | 'MUST_BE_POSITIVE'
  | 'MUST_NOT_BE_NEGATIVE'
  | 'TOO_LARGE'
  | 'INVALID_TAX'
  | 'INVALID_VAT'
  | 'INVALID_EMAIL'
  | 'INVALID_PHONE'
  | 'INVALID_DATE'
  | 'INVALID_CHOICE'
  | 'NOT_FOUND';

/** A ValidationError whose reason is one of the codes above (R2.1). */
export class InputError extends ValidationError {
  declare readonly reason: InputReason;
  constructor(field: string, reason: InputReason, message: string) {
    super(field, reason, message);
  }
}

export const INPUT_LIMITS = {
  sku: 64,
  name: 120,
  category: 60,
  maxSortOrder: 100_000,
  maxCategories: 500,
  unit: 30,
  vatNumber: 15,
  crNumber: 30,
  phone: 30,
  email: 160,
  address: 300,
  notes: 300,
  reference: 60,
  maxAmount: 1_000_000,
  maxQty: 1_000_000,
} as const;

type Raw = Record<string, unknown>;

function text(raw: Raw, field: string, max: number, fallback: string, required = false): string {
  const value = raw[field] === undefined || raw[field] === null ? fallback : String(raw[field]).trim();
  if (required && !value) throw new InputError(field, 'REQUIRED', `${field} is required.`);
  if (value.length > max) throw new InputError(field, 'TOO_LONG', `${field} must be at most ${max} characters.`);
  return value;
}

function numberOf(raw: Raw, field: string, fallback: number): number {
  const value = raw[field] === undefined || raw[field] === null || raw[field] === '' ? fallback : Number(raw[field]);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new InputError(field, 'INVALID_NUMBER', `${field} must be a number.`);
  }
  return value;
}

function amount(raw: Raw, field: string, fallback: number, positive: boolean): number {
  const value = numberOf(raw, field, fallback);
  if (positive && value <= 0) throw new InputError(field, 'MUST_BE_POSITIVE', `${field} must be greater than 0.`);
  if (!positive && value < 0) throw new InputError(field, 'MUST_NOT_BE_NEGATIVE', `${field} cannot be negative.`);
  if (value > INPUT_LIMITS.maxAmount) throw new InputError(field, 'TOO_LARGE', `${field} is too large.`);
  return value;
}

function wholeNumber(raw: Raw, field: string, fallback: number): number {
  const value = numberOf(raw, field, fallback);
  if (!Number.isInteger(value)) throw new InputError(field, 'NOT_INTEGER', `${field} must be a whole number.`);
  if (value < 0) throw new InputError(field, 'MUST_NOT_BE_NEGATIVE', `${field} cannot be negative.`);
  if (value > INPUT_LIMITS.maxQty) throw new InputError(field, 'TOO_LARGE', `${field} is too large.`);
  return value;
}

/** '' (not registered) or a valid KSA VAT number (D12). */
export function optionalVatNumber(raw: Raw, fallback: string): string {
  const value = text(raw, 'vat_number', INPUT_LIMITS.vatNumber + 15, fallback);
  if (value && !isValidVatNumber(value)) {
    throw new InputError('vat_number', 'INVALID_VAT', 'VAT number must be 15 digits starting and ending with 3.');
  }
  return value;
}

function phone(raw: Raw, fallback: string): string {
  const value = text(raw, 'phone', INPUT_LIMITS.phone, fallback);
  if (value && !/^[0-9٠-٩+\-\s()]+$/.test(value)) {
    throw new InputError('phone', 'INVALID_PHONE', 'Phone may contain digits, spaces, +, - and brackets only.');
  }
  return value;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------------------------------------------------------------- products

/** KSA VAT: standard 15% (S); zero-rated (Z) or exempt (E) at 0%. */
function taxRule(raw: Raw, existing?: Pick<Product, 'tax_rate' | 'tax_category'>) {
  const taxRate = numberOf(raw, 'tax_rate', existing?.tax_rate ?? 15);
  if (taxRate !== 15 && taxRate !== 0) {
    throw new InputError('tax_rate', 'INVALID_TAX', 'VAT rate must be 15 or 0.');
  }
  const sent = raw.tax_category === undefined || raw.tax_category === null || raw.tax_category === '' ? null : String(raw.tax_category);
  // When the rate changes and no category is sent, follow the rate.
  const fallback = existing && existing.tax_rate === taxRate ? existing.tax_category : taxRate === 15 ? 'S' : 'Z';
  const taxCategory = sent ?? fallback;
  const valid = taxRate === 15 ? taxCategory === 'S' : taxCategory === 'Z' || taxCategory === 'E';
  if (!valid) {
    throw new InputError('tax_category', 'INVALID_TAX', 'Tax category S needs 15%; Z or E need 0%.');
  }
  return { tax_rate: taxRate, tax_category: taxCategory as 'S' | 'Z' | 'E' };
}

function expiryDate(raw: Raw, fallback: string | null): string | null {
  if (raw.expiry_date === undefined) return fallback;
  if (raw.expiry_date === null || raw.expiry_date === '') return null;
  const value = String(raw.expiry_date).trim();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new InputError('expiry_date', 'INVALID_DATE', 'Expiry date must be a valid YYYY-MM-DD date.');
  }
  return value;
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

/** New product, or an update of `existing` (fields not sent keep their value). */
export function parseProductInput(raw: Raw, existing?: Product): ProductInput {
  const nameAr = text(raw, 'name_ar', INPUT_LIMITS.name, existing?.name_ar ?? '', true);
  return {
    sku: text(raw, 'sku', INPUT_LIMITS.sku, existing?.sku ?? '', true),
    name_ar: nameAr,
    name_en: text(raw, 'name_en', INPUT_LIMITS.name, existing?.name_en ?? '') || nameAr,
    unit_ar: text(raw, 'unit_ar', INPUT_LIMITS.unit, existing?.unit_ar ?? 'حبة') || 'حبة',
    unit_en: text(raw, 'unit_en', INPUT_LIMITS.unit, existing?.unit_en ?? 'Pcs') || 'Pcs',
    cost_price: amount(raw, 'cost_price', existing?.cost_price ?? 0, false),
    sell_price: amount(raw, 'sell_price', existing?.sell_price ?? 0, true),
    ...taxRule(raw, existing),
    min_stock_alert: wholeNumber(raw, 'min_stock_alert', existing?.min_stock_alert ?? 10),
    expiry_date: expiryDate(raw, existing ? existing.expiry_date || null : null),
  };
}

/** Opening stock of a new product. */
export function parseOpeningStock(raw: Raw): number {
  return wholeNumber(raw, 'stock_qty', 0);
}

// ------------------------------------------------------ customers, suppliers

export interface PartyInput {
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  phone: string;
  address_ar: string;
}

function partyFields(raw: Raw, existing?: PartyInput): PartyInput {
  const nameAr = text(raw, 'name_ar', INPUT_LIMITS.name, existing?.name_ar ?? '', true);
  return {
    name_ar: nameAr,
    name_en: text(raw, 'name_en', INPUT_LIMITS.name, existing?.name_en ?? '') || nameAr,
    vat_number: optionalVatNumber(raw, existing?.vat_number ?? ''),
    cr_number: text(raw, 'cr_number', INPUT_LIMITS.crNumber, existing?.cr_number ?? ''),
    phone: phone(raw, existing?.phone ?? ''),
    address_ar: text(raw, 'address_ar', INPUT_LIMITS.address, existing?.address_ar ?? ''),
  };
}

export function parseCustomerInput(raw: Raw, existing?: Customer): PartyInput {
  return partyFields(raw, existing);
}

export function parseSupplierInput(raw: Raw, existing?: Supplier): PartyInput & { email: string } {
  const email = text(raw, 'email', INPUT_LIMITS.email, existing?.email ?? '');
  if (email && !EMAIL_PATTERN.test(email)) {
    throw new InputError('email', 'INVALID_EMAIL', 'Email address is not valid.');
  }
  return { ...partyFields(raw, existing), email };
}

// ------------------------------------------------------------ stock movements

export type MovementType = 'purchase' | 'adjustment' | 'return';

export interface MovementInput {
  product_id: number;
  type: MovementType;
  qty: number;
  notes: string;
  reference_no: string;
}

export function parseMovementInput(raw: Raw): MovementInput {
  const type = String(raw.type ?? 'purchase');
  if (type !== 'purchase' && type !== 'adjustment' && type !== 'return') {
    throw new InputError('type', 'INVALID_CHOICE', 'Movement type must be purchase, adjustment or return.');
  }
  const qty = numberOf(raw, 'qty', 0);
  if (!Number.isInteger(qty)) throw new InputError('qty', 'NOT_INTEGER', 'Quantity must be a whole number.');
  if (qty === 0) throw new InputError('qty', 'REQUIRED', 'Quantity must not be zero.');
  if (Math.abs(qty) > INPUT_LIMITS.maxQty) throw new InputError('qty', 'TOO_LARGE', 'Quantity is too large.');
  return {
    product_id: Number(raw.product_id),
    type,
    qty,
    notes: text(raw, 'notes', INPUT_LIMITS.notes, ''),
    reference_no:
      text(raw, 'reference_no', INPUT_LIMITS.reference, '') || `STK-${Date.now().toString().slice(-6)}`,
  };
}

// ----------------------------------------------------------------- categories

export interface CategoryInput {
  name_ar: string;
  name_en: string;
}

/** New category, or an update of `existing` (fields not sent keep their value). */
export function parseCategoryInput(raw: Raw, existing?: CategoryInput): CategoryInput {
  const nameAr = text(raw, 'name_ar', INPUT_LIMITS.category, existing?.name_ar ?? '', true).replace(/\s+/g, ' ');
  return {
    name_ar: nameAr,
    name_en: text(raw, 'name_en', INPUT_LIMITS.category, existing?.name_en ?? '').replace(/\s+/g, ' ') || nameAr,
  };
}

/** The full new order of the category tabs: every category id, once. */
export function parseCategoryOrder(raw: Raw): number[] {
  const ids = raw.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > INPUT_LIMITS.maxCategories) {
    throw new InputError('ids', 'REQUIRED', 'ids must list the categories in their new order.');
  }
  if (!ids.every((id) => Number.isInteger(id) && (id as number) > 0) || new Set(ids).size !== ids.length) {
    throw new InputError('ids', 'INVALID_CHOICE', 'ids must be distinct category ids.');
  }
  return ids as number[];
}

/**
 * How a product names its category: by id (the UI's dropdown), or by Arabic
 * name for older clients (found or created). Null when neither is sent.
 */
export type CategoryRef = { id: number } | { name_ar: string; name_en: string } | null;

export function parseCategoryRef(raw: Raw): CategoryRef {
  if (raw.category_id !== undefined && raw.category_id !== null && raw.category_id !== '') {
    const id = Number(raw.category_id);
    if (!Number.isInteger(id) || id <= 0) {
      throw new InputError('category_id', 'INVALID_NUMBER', 'category_id must be a category id.');
    }
    return { id };
  }
  const nameAr = text(raw, 'category_ar', INPUT_LIMITS.category, '');
  if (!nameAr) return null;
  return { name_ar: nameAr, name_en: text(raw, 'category_en', INPUT_LIMITS.category, '') };
}
