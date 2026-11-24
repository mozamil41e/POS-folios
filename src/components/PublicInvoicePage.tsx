import { useEffect, useState } from 'react';
import { Globe, Printer } from 'lucide-react';
import type { InvoiceItem, Language } from '../types';
import { formatDateTime, formatMoney } from '../i18n';
import { QrCodeCanvas } from './QrCodeCanvas';

interface PublicInvoiceResponse {
  invoice: {
    uuid: string;
    invoice_number: string;
    invoice_type_code: string;
    invoice_subtype: string;
    payment_method: string;
    cash_amount: number;
    card_amount: number;
    customer_name: string;
    customer_vat: string;
    subtotal: number;
    discount_total: number;
    vat_total: number;
    grand_total: number;
    related_invoice_number: string | null;
    created_at: string;
    items: InvoiceItem[];
  };
  store: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    street_ar: string;
    building_no: string;
    city_ar: string;
    postal_code: string;
    public_base_url: string;
  };
}

export function PublicInvoicePage({ uuid }: { uuid: string }) {
  const [lang, setLang] = useState<Language>('ar');
  const [data, setData] = useState<PublicInvoiceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const isAr = lang === 'ar';

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';
  }, [lang, isAr]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/public/invoices/${encodeURIComponent(uuid)}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('NOT_FOUND');
        }
        return (await res.json()) as PublicInvoiceResponse;
      })
      .then((payload) => {
        if (active) {
          setData(payload);
          setNotFound(false);
        }
      })
      .catch(() => {
        if (active) setNotFound(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [uuid]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6 text-center">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md w-full space-y-3">
          <h1 className="text-lg font-bold text-slate-900">
            {isAr ? 'الفاتورة غير موجودة' : 'Invoice Not Found'}
          </h1>
          <p className="text-xs text-slate-500">
            {isAr
              ? 'تعذر العثور على الفاتورة المطلوبة أو تم حذف الرابط.'
              : 'The requested invoice link could not be found.'}
          </p>
        </div>
      </div>
    );
  }

  const { invoice, store } = data;
  const baseUrl =
    store.public_base_url?.trim().replace(/\/+$/, '') || window.location.origin;
  const publicUrl = `${baseUrl}/i/${encodeURIComponent(invoice.uuid)}`;
  const isCredit = invoice.invoice_type_code === '381';
  const paymentLabel =
    invoice.payment_method === 'card'
      ? isAr
        ? 'مدى / شبكة'
        : 'Mada / Card'
      : invoice.payment_method === 'split'
      ? isAr
        ? 'مقسم (نقدي + شبكة)'
        : 'Split'
      : isAr
      ? 'نقدي'
      : 'Cash';

  return (
    <div className="min-h-screen bg-slate-100 py-6 px-4 text-slate-900">
      <div className="max-w-lg mx-auto space-y-4">
        {/* Top Action Strip */}
        <div className="flex items-center justify-between gap-3 print:hidden">
          <button
            type="button"
            onClick={() => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Globe className="w-3.5 h-3.5" />
            {isAr ? 'English' : 'العربية'}
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-xs font-semibold text-white"
          >
            <Printer className="w-3.5 h-3.5" />
            {isAr ? 'طباعة / حفظ PDF' : 'Print / Save PDF'}
          </button>
        </div>

        {/* Digital Receipt Sheet */}
        {/* print-full-page: printed from the customer's phone at full page width (D1),
            unlike the in-app receipt which prints at thermal width. */}
        <div
          id="printable-invoice"
          className="print-full-page bg-white border border-slate-200 rounded-2xl p-6 space-y-4"
        >
          <div className="text-center border-b border-dashed border-slate-300 pb-4 space-y-1">
            <h1 className="text-lg font-bold text-slate-950">{store.name_ar}</h1>
            <div className="text-xs text-slate-500">{store.name_en}</div>
            <div className="text-xs text-slate-600">
              {store.street_ar} · {store.city_ar}
            </div>
            {store.vat_number && (
              <div className="font-mono text-xs text-slate-600 tabular-nums">
                {isAr ? 'الرقم الضريبي:' : 'VAT ID:'} {store.vat_number}
              </div>
            )}
            {store.cr_number && (
              <div className="font-mono text-xs text-slate-500 tabular-nums">
                {isAr ? 'السجل التجاري:' : 'CR:'} {store.cr_number}
              </div>
            )}
            <div className="pt-2 mt-2 border-t border-slate-100 font-bold text-sm text-slate-900">
              {isCredit
                ? isAr
                  ? 'إشعار مرتجع مبيعات'
                  : 'Sales Credit Note'
                : isAr
                ? 'فاتورة مبيعات إلكترونية'
                : 'Digital Sales Receipt'}
            </div>
          </div>

          <div className="space-y-1.5 text-xs border-b border-dashed border-slate-300 pb-4">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{isAr ? 'رقم الفاتورة:' : 'Invoice #:'}</span>
              <span className="font-mono font-semibold tabular-nums">{invoice.invoice_number}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{isAr ? 'التاريخ والوقت:' : 'Date & Time:'}</span>
              <span className="font-mono tabular-nums">{formatDateTime(invoice.created_at, lang)}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{isAr ? 'طريقة الدفع:' : 'Payment:'}</span>
              <span className="font-medium">{paymentLabel}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">{isAr ? 'العميل:' : 'Customer:'}</span>
              <span className="font-medium">{invoice.customer_name}</span>
            </div>
          </div>

          <div className="border-b border-dashed border-slate-300 pb-4">
            <table className="w-full text-xs text-start">
              <thead>
                <tr className="text-slate-500 border-b border-slate-200">
                  <th className="py-1.5 text-start font-semibold">{isAr ? 'الصنف' : 'Item'}</th>
                  <th className="py-1.5 text-center font-semibold">{isAr ? 'الكمية' : 'Qty'}</th>
                  <th className="py-1.5 text-end font-semibold">{isAr ? 'السعر' : 'Price'}</th>
                  <th className="py-1.5 text-end font-semibold">{isAr ? 'الإجمالي' : 'Total'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {invoice.items.map((item, idx) => (
                  <tr key={idx}>
                    <td className="py-2 pe-2">
                      <div className="font-medium text-slate-900">
                        {isAr ? item.name_ar : item.name_en}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400">{item.sku}</div>
                    </td>
                    <td className="py-2 text-center font-mono tabular-nums">{item.qty}</td>
                    <td className="py-2 text-end font-mono tabular-nums">
                      {item.unit_price.toFixed(2)}
                    </td>
                    <td className="py-2 text-end font-mono font-semibold tabular-nums">
                      {item.line_total.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 text-xs tabular-nums border-b border-dashed border-slate-300 pb-4">
            <div className="flex justify-between text-slate-600">
              <span>{isAr ? 'المجموع قبل الضريبة' : 'Subtotal'}</span>
              <span className="font-mono">{formatMoney(invoice.subtotal, lang)}</span>
            </div>
            {invoice.discount_total > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>{isAr ? 'الخصم' : 'Discount'}</span>
                <span className="font-mono">-{formatMoney(invoice.discount_total, lang)}</span>
              </div>
            )}
            <div className="flex justify-between text-slate-600">
              <span>{isAr ? 'ضريبة القيمة المضافة (15%)' : 'VAT (15%)'}</span>
              <span className="font-mono">{formatMoney(invoice.vat_total, lang)}</span>
            </div>
            <div className="flex justify-between text-base font-bold text-slate-950 pt-2 border-t border-slate-200">
              <span>{isAr ? 'الإجمالي المستحق' : 'Grand Total'}</span>
              <span className="font-mono">{formatMoney(invoice.grand_total, lang)}</span>
            </div>
          </div>

          <div className="pt-2 flex flex-col items-center text-center space-y-2">
            <QrCodeCanvas value={publicUrl} size={140} alt="Public Invoice QR Code" />
            <div dir="ltr" className="font-mono text-[10px] text-slate-400 break-all">
              {publicUrl}
            </div>
            <div className="text-xs text-slate-500">
              {isAr ? 'شكراً لتسوقكم معنا' : 'Thank you for shopping with us'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
