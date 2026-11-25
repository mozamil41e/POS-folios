import { describe, expect, it } from 'vitest';
import { isValidIsoDate, riyadhDate, riyadhYear } from '../../shared/dates.ts';
import { parseVoidReason, parseVoucher } from '../../shared/schemas/vouchers.ts';

// R2.4b: business dates in Asia/Riyadh (UTC+3, no daylight saving).
describe('riyadhDate', () => {
  it('moves to the next day at 21:00 UTC', () => {
    expect(riyadhDate(new Date('2026-11-25T20:59:59.999Z'))).toBe('2026-11-25');
    expect(riyadhDate(new Date('2026-11-25T21:00:00.000Z'))).toBe('2026-11-26');
  });

  it('gives the Riyadh year on New Year night', () => {
    expect(riyadhYear(new Date('2026-12-31T21:30:00.000Z'))).toBe(2027);
    expect(riyadhYear(new Date('2026-12-31T20:30:00.000Z'))).toBe(2026);
  });
});

describe('isValidIsoDate', () => {
  it('accepts real days only, in YYYY-MM-DD', () => {
    expect(['2026-02-28', '2028-02-29', '2026-12-31'].map(isValidIsoDate)).toEqual([true, true, true]);
    expect(['2026-02-29', '2026-02-30', '2026-13-01', '2026-1-5', '26-01-05', 'not-a-date', ''].map(isValidIsoDate)).toEqual([
      false, false, false, false, false, false, false,
    ]);
  });
});

describe('parseVoucher', () => {
  const today = '2026-11-25';

  it('fills today, the defaults and the category by type', () => {
    expect(parseVoucher({ party_name: ' مورد ', amount: '50' }, today)).toEqual({
      ok: true,
      value: {
        voucher_type: 'receipt',
        payment_channel: 'cash',
        party_name: 'مورد',
        category: 'إيرادات أخرى',
        amount: 50,
        notes: '',
        voucher_date: today,
      },
    });
  });

  it('reports the legacy checks first', () => {
    const parsed = parseVoucher({ party_name: '', amount: 0, voucher_type: 'x', voucher_date: '2027-01-01' }, today);
    expect(parsed.ok ? [] : parsed.problems.map((p) => `${p.field}:${p.reason}`)).toEqual([
      'party_name:REQUIRED',
      'amount:MUST_BE_POSITIVE',
      'voucher_type:INVALID_CHOICE',
      'voucher_date:FUTURE_DATE',
    ]);
  });
});

describe('parseVoidReason', () => {
  it('needs 3 to 300 characters after trimming', () => {
    expect(parseVoidReason({ reason: '  مكرر  ' })).toEqual({ ok: true, value: 'مكرر' });
    expect([{}, { reason: 'ab' }, { reason: 'x'.repeat(301) }].map((r) => parseVoidReason(r).ok)).toEqual([false, false, false]);
  });
});
