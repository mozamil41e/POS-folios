import { describe, expect, it } from 'vitest';
import { parseCustomer, parseSupplier } from '../../shared/schemas/parties.ts';
import type { Customer } from '../../shared/types.ts';

// R2.4b: the customer and supplier rules shared by the server and the UI.
const problems = (parsed: { ok: boolean; problems?: { field: string; reason: string }[] }) =>
  parsed.ok ? [] : (parsed.problems ?? []).map((p) => `${p.field}:${p.reason}`);

describe('parseCustomer', () => {
  it('trims, falls back to the Arabic name, and accepts an empty VAT number (cash customer)', () => {
    expect(parseCustomer({ name_ar: ' عميل ', phone: ' ٠٥٠ ١٢٣ ' })).toEqual({
      ok: true,
      value: { name_ar: 'عميل', name_en: 'عميل', vat_number: '', cr_number: '', phone: '٠٥٠ ١٢٣', address_ar: '' },
    });
  });

  it('reports the problems in the old order', () => {
    expect(problems(parseCustomer({ name_ar: '', vat_number: '12345', phone: 'call me', address_ar: 'x'.repeat(301) }))).toEqual([
      'name_ar:REQUIRED',
      'vat_number:INVALID_VAT',
      'phone:INVALID_PHONE',
      'address_ar:TOO_LONG',
    ]);
  });

  it('keeps the current value of every field not sent (null counts as not sent)', () => {
    const existing: Customer = {
      id: 1,
      name_ar: 'قديم',
      name_en: 'Old',
      vat_number: '300000000000003',
      cr_number: '1',
      address_ar: 'أ',
      phone: '1',
      created_at: '',
    };
    expect(parseCustomer({ phone: null, cr_number: '2' }, existing)).toEqual({
      ok: true,
      value: { name_ar: 'قديم', name_en: 'Old', vat_number: '300000000000003', cr_number: '2', phone: '1', address_ar: 'أ' },
    });
  });
});

describe('parseSupplier', () => {
  it('checks the email first and does not change its case', () => {
    expect(problems(parseSupplier({ name_ar: '', email: 'x@' }))).toEqual(['email:INVALID_EMAIL', 'name_ar:REQUIRED']);
    const ok = parseSupplier({ name_ar: 'مورد', email: 'Orders@Meat.Example' });
    expect(ok.ok ? ok.value.email : null).toBe('Orders@Meat.Example');
  });
});
