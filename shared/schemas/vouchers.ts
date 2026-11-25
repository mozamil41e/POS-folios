import { z } from 'zod';
import { isValidIsoDate } from '../dates';
import { roundMoney } from '../money';
import type { VoucherChannel, VoucherType } from '../types';
import { INPUT_LIMITS, isMissing, problemsOf, rule, toNumberInput, type Parsed, type Raw } from './common';

/**
 * Cash voucher (receipt / payment) input rules (R2.4b). Same checks and
 * messages as the legacy route, plus the owner's decisions:
 *   (a) an invalid date is refused (it used to become today silently); a
 *       voucher sent without a date is dated today in Riyadh;
 *   (a) a date after today is refused: a voucher records money that moved;
 *   and, following earlier decisions, an unknown type or channel is refused
 *   (a misspelt type used to become a receipt) and the texts have lengths.
 */
export const VOUCHER_KINDS = ['receipt', 'payment'] as const satisfies readonly VoucherType[];
export const VOUCHER_CHANNELS = ['cash', 'bank'] as const satisfies readonly VoucherChannel[];

export const PARTY_REQUIRED_ERROR = 'Party or description name is required.';
export const AMOUNT_ERROR = 'Voucher amount must be greater than zero.';
export const VOID_REASON_ERROR = 'A reason of 3 to 300 characters is required to void a voucher.';
export const VOID_REASON_MIN = 3;
export const VOID_REASON_MAX = 300;

/** The category a voucher gets when none is chosen (as before). */
export const DEFAULT_VOUCHER_CATEGORY: Record<VoucherType, string> = {
  receipt: 'إيرادات أخرى',
  payment: 'مصروفات تشغيلية',
};

export interface VoucherInput {
  voucher_type: VoucherType;
  payment_channel: VoucherChannel;
  party_name: string;
  category: string;
  amount: number;
  notes: string;
  voucher_date: string;
}

const tooLong = (field: string, max: number) => rule('TOO_LONG', `${field} must be at most ${max} characters.`);
const text = (field: string, max: number) => z.string().refine((s) => s.length <= max, tooLong(field, max));

// Checked by hand so every failure keeps the legacy message.
const amount = z.unknown().transform((value, ctx): number => {
  const n = toNumberInput(value);
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_ERROR, params: { reason: 'INVALID_NUMBER' } });
    return z.NEVER;
  }
  // 0.001 used to pass and be stored as 0.00.
  if (roundMoney(n) <= 0) {
    ctx.addIssue({ code: 'custom', message: AMOUNT_ERROR, params: { reason: 'MUST_BE_POSITIVE' } });
    return z.NEVER;
  }
  return roundMoney(n);
});

const voucherDate = (today: string) =>
  z
    .string()
    .refine(isValidIsoDate, rule('INVALID_DATE', 'voucher_date must be a valid date (YYYY-MM-DD).'))
    .refine((d) => !isValidIsoDate(d) || d <= today, rule('FUTURE_DATE', 'voucher_date cannot be after today.'));

// Order of the fields = order of the checks: the legacy two first.
const voucherFields = (today: string) =>
  z.object({
    party_name: text('party_name', INPUT_LIMITS.name).refine((s) => s.length > 0, rule('REQUIRED', PARTY_REQUIRED_ERROR)),
    amount,
    voucher_type: z.enum(VOUCHER_KINDS, { error: `voucher_type must be one of: ${VOUCHER_KINDS.join(', ')}.` }),
    payment_channel: z.enum(VOUCHER_CHANNELS, { error: `payment_channel must be one of: ${VOUCHER_CHANNELS.join(', ')}.` }),
    voucher_date: voucherDate(today),
    category: text('category', INPUT_LIMITS.category),
    notes: text('notes', INPUT_LIMITS.notes),
  });

const trimmed = (value: unknown) => (isMissing(value) ? '' : String(value).trim());

/** `today` is the Riyadh date (riyadhToday() in shared/dates.ts), passed in for testing. */
export function parseVoucher(raw: Raw, today: string): Parsed<VoucherInput> {
  const date = trimmed(raw.voucher_date);
  const parsed = voucherFields(today).safeParse({
    party_name: trimmed(raw.party_name),
    amount: isMissing(raw.amount) ? 0 : raw.amount,
    voucher_type: isMissing(raw.voucher_type) ? 'receipt' : raw.voucher_type,
    payment_channel: isMissing(raw.payment_channel) ? 'cash' : raw.payment_channel,
    voucher_date: date || today,
    category: trimmed(raw.category),
    notes: trimmed(raw.notes),
  });
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const value = parsed.data;
  return { ok: true, value: { ...value, category: value.category || DEFAULT_VOUCHER_CATEGORY[value.voucher_type] } };
}

/** The reason for voiding: 3 to 300 characters after trimming. */
export function parseVoidReason(raw: Raw): Parsed<string> {
  const reason = trimmed(raw.reason);
  if (reason.length >= VOID_REASON_MIN && reason.length <= VOID_REASON_MAX) return { ok: true, value: reason };
  return {
    ok: false,
    problems: [{ field: 'reason', reason: reason.length === 0 ? 'REQUIRED' : reason.length < VOID_REASON_MIN ? 'TOO_SHORT' : 'TOO_LONG', message: VOID_REASON_ERROR }],
  };
}
