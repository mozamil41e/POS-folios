import { ValidationError } from '../../server/src/shared/errors.ts';
import { INPUT_LIMITS, type InputReason } from '../../shared/schemas/common.ts';
import { isValidVatNumber } from '../../shared/validation.ts';
import type { Customer, Supplier } from '../../shared/types.ts';

/**
 * Hand-written input rules (R1.10, SEC-19) for the routes still in the legacy
 * router: customers and suppliers. VAT numbers are optional but must be valid
 * when given (D12). Products, categories and stock movements moved to the zod
 * rules in shared/schemas/inventory.ts (R2.4a); these follow when their module
 * moves (R2.4b).
 *
 * Every rule throws InputError, which the central error handler answers with
 *   400 { error, code: 'VALIDATION_FAILED', field, reason }
 * so the UI can show a translated message for the exact field.
 */
export type { InputReason };
export { INPUT_LIMITS };

/** A ValidationError whose reason is one of the shared reason codes. */
export class InputError extends ValidationError {
  declare readonly reason: InputReason;
  constructor(field: string, reason: InputReason, message: string) {
    super(field, reason, message);
  }
}

type Raw = Record<string, unknown>;

function text(raw: Raw, field: string, max: number, fallback: string, required = false): string {
  const value = raw[field] === undefined || raw[field] === null ? fallback : String(raw[field]).trim();
  if (required && !value) throw new InputError(field, 'REQUIRED', `${field} is required.`);
  if (value.length > max) throw new InputError(field, 'TOO_LONG', `${field} must be at most ${max} characters.`);
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
