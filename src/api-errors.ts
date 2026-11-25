import type { Language } from '../shared/types';

/**
 * Turns the server's stable error codes into messages for the user (R1.10).
 * The server answers in English with a `code` (and `field`/`reason` for
 * invalid input); the client chooses the language. Unknown codes fall back to
 * the server's own message.
 */
export interface ApiErrorBody {
  error?: string;
  code?: string;
  field?: string;
  reason?: string;
  available?: number;
  /** Products still in a category that cannot be deleted. */
  count?: number;
}

type Bilingual = { ar: string; en: string };

const FIELD_LABELS: Record<string, Bilingual> = {
  sku: { ar: 'الباركود / SKU', en: 'SKU / barcode' },
  name_ar: { ar: 'الاسم بالعربية', en: 'Arabic name' },
  name_en: { ar: 'الاسم بالإنجليزية', en: 'English name' },
  category_ar: { ar: 'الفئة بالعربية', en: 'Arabic category' },
  category_en: { ar: 'الفئة بالإنجليزية', en: 'English category' },
  unit_ar: { ar: 'الوحدة بالعربية', en: 'Arabic unit' },
  unit_en: { ar: 'الوحدة بالإنجليزية', en: 'English unit' },
  cost_price: { ar: 'سعر التكلفة', en: 'Cost price' },
  sell_price: { ar: 'سعر البيع', en: 'Selling price' },
  tax_rate: { ar: 'نسبة الضريبة', en: 'VAT rate' },
  tax_category: { ar: 'فئة الضريبة', en: 'VAT category' },
  stock_qty: { ar: 'الكمية الافتتاحية', en: 'Opening stock' },
  min_stock_alert: { ar: 'حد التنبيه', en: 'Low-stock alert' },
  expiry_date: { ar: 'تاريخ الانتهاء', en: 'Expiry date' },
  vat_number: { ar: 'الرقم الضريبي', en: 'VAT number' },
  cr_number: { ar: 'السجل التجاري', en: 'CR number' },
  phone: { ar: 'رقم الجوال', en: 'Phone' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  full_name: { ar: 'الاسم الكامل', en: 'Full name' },
  role_id: { ar: 'الدور الوظيفي', en: 'Role' },
  street_ar: { ar: 'الشارع', en: 'Street' },
  building_no: { ar: 'رقم المبنى', en: 'Building number' },
  city_ar: { ar: 'المدينة', en: 'City' },
  postal_code: { ar: 'الرمز البريدي', en: 'Postal code' },
  public_base_url: { ar: 'رابط الفاتورة العامة', en: 'Public invoice link' },
  thermal_width_mm: { ar: 'عرض ورق الطابعة', en: 'Paper width' },
  auto_print_receipt: { ar: 'الطباعة التلقائية', en: 'Auto print' },
  font_size: { ar: 'حجم الخط', en: 'Font size' },
  table_page_size: { ar: 'عدد صفوف الجدول', en: 'Rows per page' },
  address_ar: { ar: 'العنوان', en: 'Address' },
  type: { ar: 'نوع الحركة', en: 'Movement type' },
  qty: { ar: 'الكمية', en: 'Quantity' },
  notes: { ar: 'الملاحظات', en: 'Notes' },
  reference_no: { ar: 'رقم المرجع', en: 'Reference' },
  category_id: { ar: 'التصنيف', en: 'Category' },
  ids: { ar: 'ترتيب التصنيفات', en: 'Category order' },
};

const REASONS: Record<string, Bilingual> = {
  REQUIRED: { ar: 'مطلوب', en: 'is required' },
  TOO_SHORT: { ar: 'أقصر من المسموح', en: 'is too short' },
  TOO_LONG: { ar: 'أطول من المسموح', en: 'is too long' },
  INVALID_NUMBER: { ar: 'يجب أن يكون رقماً', en: 'must be a number' },
  NOT_INTEGER: { ar: 'يجب أن يكون عدداً صحيحاً', en: 'must be a whole number' },
  MUST_BE_POSITIVE: { ar: 'يجب أن يكون أكبر من صفر', en: 'must be greater than 0' },
  MUST_NOT_BE_NEGATIVE: { ar: 'لا يمكن أن يكون سالباً', en: 'cannot be negative' },
  TOO_LARGE: { ar: 'أكبر من المسموح', en: 'is too large' },
  INVALID_TAX: { ar: 'المسموح 15% (S) أو 0% (Z أو E) فقط', en: 'must be 15% (S) or 0% (Z or E)' },
  INVALID_VAT: {
    ar: 'يجب أن يكون 15 رقماً يبدأ وينتهي بالرقم 3',
    en: 'must be 15 digits starting and ending with 3',
  },
  INVALID_EMAIL: { ar: 'صيغة البريد غير صحيحة', en: 'is not a valid email address' },
  INVALID_PHONE: { ar: 'أرقام ومسافات و + و - فقط', en: 'may contain digits, spaces, + and - only' },
  INVALID_DATE: { ar: 'تاريخ غير صحيح', en: 'is not a valid date' },
  INVALID_CHOICE: { ar: 'قيمة غير مسموحة', en: 'is not an allowed value' },
  NOT_FOUND: { ar: 'غير موجود', en: 'was not found' },
  DUPLICATE_IN_FILE: { ar: 'مكرر في نفس الملف', en: 'appears twice in the file' },
  ALREADY_EXISTS: { ar: 'موجود مسبقاً في النظام', en: 'already exists in the system' },
  INVALID_URL: { ar: 'رابط غير صحيح، يبدأ بـ https:// أو http://', en: 'must be a link starting with https:// or http://' },
};

/** The Arabic or English text of a validation reason (also used by the import preview). */
export function reasonText(reason: string, lang: Language): string {
  const text = REASONS[reason];
  if (!text) return reason;
  return lang === 'ar' ? text.ar : text.en;
}

export function describeApiError(body: ApiErrorBody | null | undefined, lang: Language): string | null {
  if (!body?.code) return null;
  const isAr = lang === 'ar';

  switch (body.code) {
    case 'VALIDATION_FAILED': {
      const label = body.field ? FIELD_LABELS[body.field] : undefined;
      const reason = body.reason ? REASONS[body.reason] : undefined;
      if (!label || !reason) return null;
      return isAr ? `${label.ar}: ${reason.ar}` : `${label.en} ${reason.en}`;
    }
    case 'SKU_EXISTS':
      return isAr ? 'هذا الباركود مستخدم لصنف آخر' : 'This SKU / barcode is already used by another product';
    case 'CATEGORY_EXISTS':
      return isAr ? 'يوجد تصنيف بهذا الاسم' : 'A category with this name already exists';
    case 'CATEGORY_IN_USE':
      return typeof body.count === 'number'
        ? isAr
          ? `لا يمكن حذف التصنيف: عليه ${body.count} صنف. انقلها إلى تصنيف آخر أولاً`
          : `Cannot delete: ${body.count} product(s) still use this category. Move them first`
        : null;
    case 'IMPORT_INVALID':
      return isAr
        ? 'الملف فيه أخطاء، لم يُستورد أي صنف. راجع المعاينة وصحّح الملف'
        : 'The file has problems; nothing was imported. Check the preview and fix the file';
    // Customers and suppliers (R2.4b); CUSTOMER_NOT_FOUND also comes from the checkout.
    case 'CUSTOMER_NOT_FOUND':
      return isAr ? 'العميل غير موجود' : 'Customer not found';
    case 'SUPPLIER_NOT_FOUND':
      return isAr ? 'المورد غير موجود' : 'Supplier not found';
    // Users and roles (R2.4b)
    case 'PASSWORD_TOO_SHORT':
      return isAr ? 'كلمة المرور يجب أن تكون من 8 إلى 128 حرفاً' : 'The password must be 8 to 128 characters long';
    case 'EMAIL_EXISTS':
      return isAr ? 'هذا البريد مستخدم لحساب آخر' : 'This email is already used by another account';
    case 'USER_NOT_FOUND':
      return isAr ? 'المستخدم غير موجود، ربما حُذف' : 'User not found; it may have been deleted';
    case 'CANNOT_DEACTIVATE_SELF':
      return isAr ? 'لا يمكنك إيقاف حسابك أنت' : 'You cannot deactivate your own account';
    case 'CANNOT_DELETE_SELF':
      return isAr ? 'لا يمكنك حذف حسابك أنت' : 'You cannot delete your own account';
    case 'LAST_ADMIN':
      return isAr
        ? 'لا يمكن تنزيل أو إيقاف آخر مدير للمستخدمين. امنح الصلاحية لحساب آخر أولاً'
        : 'You cannot demote or deactivate the last user administrator. Give another account the permission first';
    case 'ROLE_NOT_FOUND':
      return isAr ? 'الدور غير موجود، ربما حُذف' : 'Role not found; it may have been deleted';
    case 'SYSTEM_ROLE':
      return isAr ? 'لا يمكن حذف دور مدير النظام' : 'The system administrator role cannot be deleted';
    case 'ROLE_IN_USE':
      return typeof body.count === 'number'
        ? isAr
          ? `لا يمكن حذف الدور: عليه ${body.count} مستخدم. انقلهم إلى دور آخر أولاً`
          : `Cannot delete: ${body.count} user(s) still have this role. Move them first`
        : null;
    case 'INSUFFICIENT_STOCK':
      return typeof body.available === 'number'
        ? isAr
          ? `الكمية أكبر من المتوفر في المخزون (المتاح ${body.available})`
          : `Not enough stock (only ${body.available} available)`
        : null;
    default:
      return null;
  }
}
