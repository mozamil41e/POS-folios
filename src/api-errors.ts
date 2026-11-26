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
  /** The 1-based line of a purchase or sale with a problem (R2.4b). */
  line?: number;
  /** The credit note that already reverses an invoice (R2.4b). */
  credit_note_number?: string;
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
  supplier_id: { ar: 'المورد', en: 'Supplier' },
  items: { ar: 'بنود الفاتورة', en: 'Invoice lines' },
  payment_status: { ar: 'حالة الدفع', en: 'Payment status' },
  paid_amount: { ar: 'المبلغ المدفوع', en: 'Amount paid' },
  amount: { ar: 'المبلغ', en: 'Amount' },
  product_id: { ar: 'الصنف', en: 'Product' },
  unit_cost: { ar: 'سعر الوحدة', en: 'Unit cost' },
  party_name: { ar: 'اسم الطرف أو البيان', en: 'Party or description' },
  voucher_date: { ar: 'تاريخ السند', en: 'Voucher date' },
  voucher_type: { ar: 'نوع السند', en: 'Voucher type' },
  payment_channel: { ar: 'طريقة الدفع', en: 'Payment channel' },
  category: { ar: 'التصنيف', en: 'Category' },
  reason: { ar: 'السبب', en: 'Reason' },
  discount_total: { ar: 'الخصم', en: 'Discount' },
  discount: { ar: 'الخصم', en: 'Discount' },
  cash_amount: { ar: 'المبلغ النقدي', en: 'Cash amount' },
  payment_method: { ar: 'طريقة الدفع', en: 'Payment method' },
  invoice_subtype: { ar: 'نوع الفاتورة', en: 'Invoice type' },
  label: { ar: 'اسم الطلب المعلق', en: 'Held order name' },
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
  FUTURE_DATE: { ar: 'لا يمكن أن يكون بعد اليوم', en: 'cannot be after today' },
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
    // Sales (R2.4b; the codes are those of R1.5–R1.11)
    case 'INVALID_SPLIT':
      return isAr
        ? 'الدفع المقسّم يحتاج جزءاً نقدياً أكبر من صفر وأقل من الإجمالي. إن كان المبلغ كله نقداً أو كله شبكة فاختر نقدي أو شبكة'
        : 'A split payment needs a cash part above 0 and below the total. If it is all cash or all card, choose cash or card';
    case 'INVALID_QTY': {
      const reason = body.reason ? REASONS[body.reason] : undefined;
      if (typeof body.line !== 'number' || !reason) return null;
      return isAr ? `البند ${body.line} - الكمية: ${reason.ar}` : `Line ${body.line}: Quantity ${reason.en}`;
    }
    case 'DISCOUNT_NOT_ALLOWED':
      return isAr ? 'ليست لديك صلاحية الخصم' : 'You are not allowed to give discounts';
    case 'INVALID_DOCUMENT_TYPE':
      return isAr ? 'لا تُصدر هنا إلا فواتير البيع' : 'Only sales invoices can be issued here';
    case 'CUSTOMER_REQUIRED':
      return isAr ? 'الفاتورة الضريبية تحتاج عميلاً مسجلاً' : 'A tax invoice needs a registered customer';
    case 'CUSTOMER_VAT_INVALID':
      return isAr
        ? 'الفاتورة الضريبية تتطلب رقماً ضريبياً صحيحاً للعميل (15 رقماً يبدأ وينتهي بـ 3)'
        : 'A tax invoice needs the customer to have a valid 15-digit VAT number';
    case 'INVOICE_NOT_FOUND':
      return isAr ? 'الفاتورة الأصلية غير موجودة' : 'Original invoice not found';
    case 'NOT_A_SALES_INVOICE':
      return isAr ? 'الإشعار الدائن يصدر لفاتورة بيع فقط' : 'A credit note can only be issued for a sales invoice';
    case 'ALREADY_RETURNED':
      return body.credit_note_number
        ? isAr
          ? `هذه الفاتورة مرتجعة مسبقاً بالإشعار ${body.credit_note_number}`
          : `This invoice was already returned by ${body.credit_note_number}`
        : null;
    // Cash vouchers (R1.8 codes, Arabic texts since R2.4b)
    case 'VOID_REASON_REQUIRED':
      return isAr ? 'اكتب سبب الإلغاء (من 3 إلى 300 حرف)' : 'Enter a reason for voiding (3 to 300 characters)';
    case 'ALREADY_VOID':
      return isAr ? 'هذا السند ملغى مسبقاً' : 'This voucher is already void';
    case 'VOUCHER_DELETE_NOT_ALLOWED':
      return isAr ? 'لا تُحذف السندات. ألغِ السند مع ذكر السبب' : 'Vouchers cannot be deleted. Void it with a reason';
    case 'NOT_FOUND':
      return isAr ? 'العنصر المطلوب غير موجود' : 'The requested item was not found';
    // Purchases (R2.4b): the line number and the field of the problem.
    case 'INVALID_PURCHASE_LINE': {
      const label = body.field ? FIELD_LABELS[body.field] : undefined;
      const reason = body.reason ? REASONS[body.reason] : undefined;
      if (typeof body.line !== 'number' || !label || !reason) return null;
      return isAr ? `البند ${body.line} - ${label.ar}: ${reason.ar}` : `Line ${body.line}: ${label.en} ${reason.en}`;
    }
    case 'PRODUCT_NOT_FOUND':
      if (typeof body.line === 'number') {
        return isAr
          ? `البند ${body.line}: الصنف غير موجود أو موقوف`
          : `Line ${body.line}: the product does not exist or is inactive`;
      }
      return isAr ? 'الصنف غير موجود أو موقوف' : 'The product does not exist or is inactive';
    case 'PURCHASE_NOT_FOUND':
      return isAr ? 'فاتورة الشراء غير موجودة' : 'Purchase invoice not found';
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
