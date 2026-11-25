import { describe, expect, it } from 'vitest';
import { describeApiError } from '../../src/api-errors.ts';

// R1.10: the server sends stable codes; the UI shows them in the user's language.
describe('describeApiError (R1.10)', () => {
  it('names the field and the problem for invalid input, in Arabic and English', () => {
    const body = { error: 'sell_price must be greater than 0.', code: 'VALIDATION_FAILED', field: 'sell_price', reason: 'MUST_BE_POSITIVE' };
    expect(describeApiError(body, 'ar')).toBe('سعر البيع: يجب أن يكون أكبر من صفر');
    expect(describeApiError(body, 'en')).toBe('Selling price must be greater than 0');
  });

  it('explains an invalid VAT number', () => {
    const body = { code: 'VALIDATION_FAILED', field: 'vat_number', reason: 'INVALID_VAT' };
    expect(describeApiError(body, 'ar')).toBe('الرقم الضريبي: يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3');
  });

  it('shows how much stock is available when an adjustment is refused', () => {
    const body = { code: 'INSUFFICIENT_STOCK', field: 'qty', available: 4 };
    expect(describeApiError(body, 'ar')).toBe('الكمية أكبر من المتوفر في المخزون (المتاح 4)');
    expect(describeApiError(body, 'en')).toBe('Not enough stock (only 4 available)');
  });

  it('translates a duplicate SKU', () => {
    expect(describeApiError({ code: 'SKU_EXISTS' }, 'ar')).toBe('هذا الباركود مستخدم لصنف آخر');
  });

  it('explains category errors (R1.11c)', () => {
    expect(describeApiError({ code: 'CATEGORY_EXISTS' }, 'ar')).toBe('يوجد تصنيف بهذا الاسم');
    expect(describeApiError({ code: 'CATEGORY_IN_USE', count: 3 }, 'ar')).toBe(
      'لا يمكن حذف التصنيف: عليه 3 صنف. انقلها إلى تصنيف آخر أولاً'
    );
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'category_id', reason: 'NOT_FOUND' }, 'ar')).toBe('التصنيف: غير موجود');
  });

  it('explains account name and email problems (R2.4b)', () => {
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'full_name', reason: 'TOO_SHORT' }, 'ar')).toBe(
      'الاسم الكامل: أقصر من المسموح'
    );
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'email', reason: 'INVALID_EMAIL' }, 'en')).toBe(
      'Email is not a valid email address'
    );
  });

  it('explains users and roles errors (R2.4b)', () => {
    expect(describeApiError({ code: 'EMAIL_EXISTS' }, 'ar')).toBe('هذا البريد مستخدم لحساب آخر');
    expect(describeApiError({ code: 'LAST_ADMIN' }, 'en')).toMatch(/last user administrator/);
    expect(describeApiError({ code: 'ROLE_IN_USE', count: 2 }, 'ar')).toBe(
      'لا يمكن حذف الدور: عليه 2 مستخدم. انقلهم إلى دور آخر أولاً'
    );
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'phone', reason: 'TOO_LONG' }, 'ar')).toBe(
      'رقم الجوال: أطول من المسموح'
    );
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'role_id', reason: 'NOT_FOUND' }, 'en')).toBe(
      'Role was not found'
    );
  });

  it('explains settings errors (R2.4b)', () => {
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'public_base_url', reason: 'INVALID_URL' }, 'ar')).toBe(
      'رابط الفاتورة العامة: رابط غير صحيح، يبدأ بـ https:// أو http://'
    );
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'thermal_width_mm', reason: 'INVALID_CHOICE' }, 'en')).toBe(
      'Paper width is not an allowed value'
    );
  });

  it('explains customer and supplier errors (R2.4b)', () => {
    expect(describeApiError({ code: 'CUSTOMER_NOT_FOUND' }, 'ar')).toBe('العميل غير موجود');
    expect(describeApiError({ code: 'SUPPLIER_NOT_FOUND' }, 'en')).toBe('Supplier not found');
  });

  it('returns null for unknown codes so the server message is used', () => {
    expect(describeApiError({ code: 'SOMETHING_NEW', error: 'x' }, 'ar')).toBeNull();
    expect(describeApiError({ code: 'VALIDATION_FAILED', field: 'unknown_field', reason: 'REQUIRED' }, 'ar')).toBeNull();
    expect(describeApiError(null, 'ar')).toBeNull();
  });
});
