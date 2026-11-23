import { useState } from 'react';
import { Download, FileText, Printer, RotateCcw, X } from 'lucide-react';
import type { Invoice, Language, OrganizationSettings } from '../types';
import { formatDateTime, formatMoney } from '../i18n';
import { QrCodeCanvas } from './QrCodeCanvas';

interface InvoiceReceiptModalProps {
  invoice: Invoice | null;
  settings: OrganizationSettings;
  lang: Language;
  onClose: () => void;
  onCreditNote: (invoiceId: number) => Promise<void>;
}

export function InvoiceReceiptModal({
  invoice,
  settings,
  lang,
  onClose,
  onCreditNote,
}: InvoiceReceiptModalProps) {
  const [format, setFormat] = useState<'thermal' | 'a4'>('thermal');
  const [issuingCredit, setIssuingCredit] = useState(false);

  if (!invoice) return null;

  const isAr = lang === 'ar';
  const isB2B = invoice.invoice_subtype === '0100000';
  const isCredit = invoice.invoice_type_code === '381';

  const invoiceTitle = isCredit
    ? isAr
      ? 'إشعار دائن ضريبي / Credit Note'
      : 'Tax Credit Note (381)'
    : isB2B
    ? isAr
      ? 'فاتورة ضريبية / Tax Invoice'
      : 'Standard Tax Invoice (B2B)'
    : isAr
    ? 'فاتورة ضريبية مبسطة / Simplified Tax Invoice'
    : 'Simplified Tax Invoice (B2C)';

  const handleDownloadXml = () => {
    const blob = new Blob([invoice.xml_content], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${invoice.invoice_number}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleIssueCreditNote = async () => {
    setIssuingCredit(true);
    try {
      await onCreditNote(invoice.id);
      onClose();
    } finally {
      setIssuingCredit(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
        {/* Top Modal Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/80">
          <div className="flex items-center gap-2 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFormat('thermal')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                format === 'thermal'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isAr ? 'إيصال حراري 80mm' : '80mm Thermal'}
            </button>
            <button
              type="button"
              onClick={() => setFormat('a4')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                format === 'a4'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isAr ? 'فاتورة A4 ضريبية' : 'A4 Tax Invoice'}
            </button>
          </div>

          <div className="flex items-center gap-2">
            {invoice.invoice_type_code === '388' && (
              <button
                type="button"
                disabled={issuingCredit}
                onClick={handleIssueCreditNote}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {isAr ? 'إصدار إشعار دائن' : 'Credit Note'}
              </button>
            )}
            <button
              type="button"
              onClick={handleDownloadXml}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              UBL XML
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors whitespace-nowrap shrink-0"
            >
              <Printer className="w-3.5 h-3.5" />
              {isAr ? 'طباعة' : 'Print'}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Invoice Area */}
        <div className="p-6 overflow-y-auto bg-slate-100 dark:bg-slate-950 flex justify-center">
          <div
            id="printable-invoice"
            className={`bg-white text-slate-900 border border-slate-200 rounded-xl p-6 ${
              format === 'thermal' ? 'w-full max-w-[360px] text-xs' : 'w-full max-w-[680px] text-sm'
            }`}
          >
            {/* Header */}
            <div className="text-center border-b border-dashed border-slate-300 pb-4 space-y-1">
              <div className="text-base font-bold text-slate-900">{settings.name_ar}</div>
              <div className="text-xs text-slate-500">{settings.name_en}</div>
              <div className="text-xs text-slate-600">
                {settings.street_ar} · {settings.city_ar}
              </div>
              <div className="font-mono text-xs text-slate-700 tabular-nums">
                {isAr ? 'الرقم الضريبي:' : 'VAT ID:'} {settings.vat_number}
              </div>
              <div className="font-mono text-xs text-slate-500 tabular-nums">
                {isAr ? 'السجل التجاري:' : 'CR:'} {settings.cr_number}
              </div>
              <div className="pt-2 font-bold text-slate-900 border-t border-slate-100 mt-2">
                {invoiceTitle}
              </div>
            </div>

            {/* Metadata Grid */}
            <div className="py-3 border-b border-dashed border-slate-300 space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{isAr ? 'رقم الفاتورة:' : 'Invoice #:'}</span>
                <span className="font-mono font-semibold tabular-nums">{invoice.invoice_number}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{isAr ? 'التاريخ:' : 'Date:'}</span>
                <span className="font-mono tabular-nums">{formatDateTime(invoice.created_at, lang)}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">{isAr ? 'العميل:' : 'Customer:'}</span>
                <span className="font-medium truncate">{invoice.customer_name}</span>
              </div>
              {invoice.customer_vat && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isAr ? 'ضريبي العميل:' : 'Buyer VAT:'}</span>
                  <span className="font-mono tabular-nums">{invoice.customer_vat}</span>
                </div>
              )}
              {invoice.related_invoice_number && (
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{isAr ? 'مرجع الفاتورة:' : 'Ref Invoice:'}</span>
                  <span className="font-mono tabular-nums">{invoice.related_invoice_number}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">ICV / ZATCA:</span>
                <span className="font-mono tabular-nums">
                  #{invoice.icv} · {invoice.zatca_status}
                </span>
              </div>
            </div>

            {/* Line Items Table */}
            <div className="py-3 border-b border-dashed border-slate-300">
              <table className="w-full text-start">
                <thead>
                  <tr className="text-slate-500 border-b border-slate-200 text-[11px]">
                    <th className="py-1.5 text-start font-medium">{isAr ? 'الصنف' : 'Item'}</th>
                    <th className="py-1.5 text-center font-medium">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-1.5 text-end font-medium">{isAr ? 'السعر' : 'Price'}</th>
                    <th className="py-1.5 text-end font-medium">{isAr ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(invoice.items ?? []).map((item, idx) => (
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

            {/* Totals */}
            <div className="py-3 border-b border-dashed border-slate-300 space-y-1.5 tabular-nums">
              <div className="flex justify-between text-slate-600">
                <span>{isAr ? 'الإجمالي قبل الضريبة' : 'Taxable Subtotal'}</span>
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
              <div className="flex justify-between text-base font-bold text-slate-900 pt-1.5 border-t border-slate-200">
                <span>{isAr ? 'الإجمالي شامل الضريبة' : 'Grand Total'}</span>
                <span className="font-mono">{formatMoney(invoice.grand_total, lang)}</span>
              </div>
            </div>

            {/* ZATCA QR & Cryptographic Hash */}
            <div className="pt-4 flex flex-col items-center text-center space-y-2">
              <QrCodeCanvas value={invoice.qr_tlv_base64} size={format === 'thermal' ? 136 : 156} />
              <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
                <FileText className="w-3 h-3" />
                <span>
                  {isAr
                    ? 'فاتورة إلكترونية متوافقة مع هيئة الزكاة والضريبة والجمارك'
                    : 'ZATCA Phase 1 & 2 Compliant E-Invoice'}
                </span>
              </div>
              <div className="w-full font-mono text-[10px] text-slate-400 break-all leading-relaxed pt-1">
                UUID: {invoice.uuid}
                <br />
                Hash: {invoice.invoice_hash.slice(0, 36)}...
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
