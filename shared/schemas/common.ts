import { z } from 'zod';

/**
 * Shared validation building blocks (R2.4a). Every rule carries a stable
 * `reason` code; the server answers 400 VALIDATION_FAILED with { field, reason }
 * and the UI shows the Arabic text for it (src/api-errors.ts). The rules match
 * the hand-written ones of R1.10 exactly, so existing clients see no change.
 */
export const INPUT_REASONS = [
  'REQUIRED',
  'TOO_SHORT',
  'TOO_LONG',
  'INVALID_NUMBER',
  'NOT_INTEGER',
  'MUST_BE_POSITIVE',
  'MUST_NOT_BE_NEGATIVE',
  'TOO_LARGE',
  'INVALID_TAX',
  'INVALID_VAT',
  'INVALID_EMAIL',
  'INVALID_PHONE',
  'INVALID_DATE',
  'INVALID_CHOICE',
  'NOT_FOUND',
  'DUPLICATE_IN_FILE',
  'ALREADY_EXISTS',
] as const;

export type InputReason = (typeof INPUT_REASONS)[number];

export interface FieldProblem {
  field: string;
  reason: InputReason;
  message: string;
}

export const INPUT_LIMITS = {
  sku: 64,
  name: 120,
  category: 60,
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
  maxSortOrder: 100_000,
  maxCategories: 500,
} as const;

export type Raw = Record<string, unknown>;

/**
 * The result of a parse: the clean value, or every problem (one per field).
 * The API reports the first; the CSV import shows them all.
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; problems: FieldProblem[] };

/** Attaches a reason code to a zod refinement. */
export function rule(reason: InputReason, message: string) {
  return { message, params: { reason } };
}

type ZodIssue = z.ZodError['issues'][number];

/** Our reason for a zod issue; plain type errors map to the closest reason. */
export function toProblem(issue: ZodIssue): FieldProblem {
  const field = issue.path.map(String).join('.') || 'body';
  const custom = (issue as { params?: { reason?: InputReason } }).params?.reason;
  if (custom) return { field, reason: custom, message: issue.message };
  if (issue.code === 'invalid_type') {
    const expectsNumber = (issue as { expected?: string }).expected === 'number';
    return {
      field,
      reason: expectsNumber ? 'INVALID_NUMBER' : 'REQUIRED',
      message: expectsNumber ? `${field} must be a number.` : `${field} is required.`,
    };
  }
  return { field, reason: 'INVALID_CHOICE', message: issue.message };
}

/** One problem per field, in schema order (a form shows one message per field). */
export function problemsOf(error: z.ZodError): FieldProblem[] {
  const seen = new Set<string>();
  const out: FieldProblem[] = [];
  for (const issue of error.issues) {
    const problem = toProblem(issue);
    if (seen.has(problem.field)) continue;
    seen.add(problem.field);
    out.push(problem);
  }
  return out;
}

/** Not sent: undefined or null. */
export const isMissing = (value: unknown) => value === undefined || value === null;

/** Not sent for a number: undefined, null or an empty string. */
export const isBlankNumber = (value: unknown) => isMissing(value) || (typeof value === 'string' && value.trim() === '');

// Arabic-Indic digits and the Arabic decimal separator, as typed in Arabic spreadsheets.
const ARABIC_DIGIT = /[٠-٩]/g;
const ARABIC_DECIMAL = /٫/g;

/** Strings become numbers (also with Arabic digits); everything else is left for zod to judge. */
export function toNumberInput(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const normalised = value
    .trim()
    .replace(ARABIC_DIGIT, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(ARABIC_DECIMAL, '.');
  return normalised === '' ? Number.NaN : Number(normalised);
}

/** Digits (Latin or Arabic), spaces, +, - and brackets; same rule as customers and suppliers (R1.10). */
export const PHONE_PATTERN = /^[0-9٠-٩+\-\s()]+$/;

/** Optional phone: '' or at most 30 characters matching PHONE_PATTERN. */
export const phoneField = z.preprocess(
  (v) => (isMissing(v) ? '' : String(v).trim()),
  z
    .string()
    .refine((s) => s.length <= INPUT_LIMITS.phone, rule('TOO_LONG', `phone must be at most ${INPUT_LIMITS.phone} characters.`))
    .refine(
      (s) => s === '' || s.length > INPUT_LIMITS.phone || PHONE_PATTERN.test(s),
      rule('INVALID_PHONE', 'Phone may contain digits, spaces, +, - and brackets only.')
    )
);

/** Text: anything sent becomes a trimmed string; too long → TOO_LONG. */
export function textField(field: string, max: number) {
  return z.preprocess(
    (v) => (isMissing(v) ? '' : String(v).trim()),
    z.string().refine((s) => s.length <= max, rule('TOO_LONG', `${field} must be at most ${max} characters.`))
  );
}

export function requiredTextField(field: string, max: number) {
  return z.preprocess(
    (v) => (isMissing(v) ? '' : String(v).trim()),
    z
      .string()
      .refine((s) => s.length > 0, rule('REQUIRED', `${field} is required.`))
      .refine((s) => s.length <= max, rule('TOO_LONG', `${field} must be at most ${max} characters.`))
  );
}

/** Money: finite, > 0 (positive) or >= 0, at most 1,000,000. */
export function amountField(field: string, positive: boolean) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${field} must be a number.` })
      .refine(
        (v) => (positive ? v > 0 : v >= 0),
        positive
          ? rule('MUST_BE_POSITIVE', `${field} must be greater than 0.`)
          : rule('MUST_NOT_BE_NEGATIVE', `${field} cannot be negative.`)
      )
      .refine((v) => v <= INPUT_LIMITS.maxAmount, rule('TOO_LARGE', `${field} is too large.`))
  );
}

/** Whole number >= 0, at most 1,000,000. */
export function wholeNumberField(field: string) {
  return z.preprocess(
    toNumberInput,
    z
      .number({ error: `${field} must be a number.` })
      .refine(Number.isInteger, rule('NOT_INTEGER', `${field} must be a whole number.`))
      .refine((v) => v >= 0, rule('MUST_NOT_BE_NEGATIVE', `${field} cannot be negative.`))
      .refine((v) => v <= INPUT_LIMITS.maxQty, rule('TOO_LARGE', `${field} is too large.`))
  );
}
