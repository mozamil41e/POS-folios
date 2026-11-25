import { z } from 'zod';
import type { Customer, Supplier } from '../types';
import { isValidVatNumber } from '../validation';
import { EMAIL_PATTERN } from './auth';
import { INPUT_LIMITS, PHONE_PATTERN, isMissing, problemsOf, rule, type Parsed, type Raw } from './common';

/**
 * Customer and supplier input rules (R2.4b), moved from the hand-written
 * src/server/input-rules.ts (R1.10) with the same checks, messages, order and
 * reason codes:
 *   - Arabic name required; the English name falls back to it;
 *   - VAT number optional but valid when given (D12: 15 digits, 3…3);
 *     the same number may appear on several records (owner's option a:
 *     branches of one company share one VAT number);
 *   - phone: digits, spaces, + - ( ); supplier email optional but valid.
 * On an update a field that is not sent keeps its current value.
 */
export interface PartyInput {
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  phone: string;
  address_ar: string;
}

export interface SupplierInput extends PartyInput {
  email: string;
}

/** Room for spaces around a VAT number before it is checked (as before). */
const VAT_TEXT_MAX = INPUT_LIMITS.vatNumber + 15;

const tooLong = (field: string, max: number) =>
  rule('TOO_LONG', `${field} must be at most ${max} characters.`);

const text = (field: string, max: number) => z.string().refine((s) => s.length <= max, tooLong(field, max));

const nameAr = z
  .string()
  .refine((s) => s.length > 0, rule('REQUIRED', 'name_ar is required.'))
  .refine((s) => s.length <= INPUT_LIMITS.name, tooLong('name_ar', INPUT_LIMITS.name));

const vatNumber = text('vat_number', VAT_TEXT_MAX).refine(
  (s) => s === '' || s.length > VAT_TEXT_MAX || isValidVatNumber(s),
  rule('INVALID_VAT', 'VAT number must be 15 digits starting and ending with 3.')
);

const phone = text('phone', INPUT_LIMITS.phone).refine(
  (s) => s === '' || s.length > INPUT_LIMITS.phone || PHONE_PATTERN.test(s),
  rule('INVALID_PHONE', 'Phone may contain digits, spaces, +, - and brackets only.')
);

const email = text('email', INPUT_LIMITS.email).refine(
  (s) => s === '' || s.length > INPUT_LIMITS.email || EMAIL_PATTERN.test(s),
  rule('INVALID_EMAIL', 'Email address is not valid.')
);

const partyShape = {
  name_ar: nameAr,
  name_en: text('name_en', INPUT_LIMITS.name),
  vat_number: vatNumber,
  cr_number: text('cr_number', INPUT_LIMITS.crNumber),
  phone,
  address_ar: text('address_ar', INPUT_LIMITS.address),
};

const customerFields = z.object(partyShape);
// The legacy rule checked the supplier's email before the other fields.
const supplierFields = z.object({ email, ...partyShape });

/** What was sent (trimmed), or the current value when the field was not sent. */
function resolve<K extends string>(raw: Raw, keys: readonly K[], existing?: Partial<Record<K, string>>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const key of keys) out[key] = isMissing(raw[key]) ? (existing?.[key] ?? '') : String(raw[key]).trim();
  return out;
}

const PARTY_KEYS = ['name_ar', 'name_en', 'vat_number', 'cr_number', 'phone', 'address_ar'] as const;

function finish<T extends PartyInput>(parsed: z.ZodSafeParseResult<T>): Parsed<T> {
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  return { ok: true, value: { ...parsed.data, name_en: parsed.data.name_en || parsed.data.name_ar } };
}

export function parseCustomer(raw: Raw, existing?: Customer): Parsed<PartyInput> {
  return finish(customerFields.safeParse(resolve(raw, PARTY_KEYS, existing)));
}

export function parseSupplier(raw: Raw, existing?: Supplier): Parsed<SupplierInput> {
  return finish(supplierFields.safeParse(resolve(raw, [...PARTY_KEYS, 'email'] as const, existing)));
}
