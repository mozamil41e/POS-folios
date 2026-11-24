import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import {
  Check,
  Copy,
  ExternalLink,
  Printer,
  RotateCcw,
  X,
} from 'lucide-react';
import type { Invoice, Language, OrganizationSettings } from '../types';
import { formatDateTime, formatMoney } from '../i18n';
import { QrCodeCanvas } from './QrCodeCanvas';

interface InvoiceReceiptModalProps {
  invoice: Invoice | null;
  settings: OrganizationSettings;
  lang: Language;
  autoPrint?: boolean;
  onClose: () => void;
  onCreditNote: (invoiceId: number) => Promise<void>;
  onNotify?: (msg: string, tone?: 'success' | 'error') => void;
}

type ReceiptFormat = 'thermal80' | 'thermal58' | 'a4';

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function buildPublicInvoiceUrl(invoiceUuid: string, publicBaseUrl?: string): string {
  const configured = (publicBaseUrl ?? '').trim().replace(/\/+$/, '');
  const origin =
    configured || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${origin}/i/${encodeURIComponent(invoiceUuid)}`;
}

export function InvoiceReceiptModal({
  invoice,
  settings,
  lang,
  autoPrint = false,
  onClose,
  onCreditNote,
  onNotify,
}: InvoiceReceiptModalProps) {
  const [format, setFormat] = useState<ReceiptFormat>(
    settings.thermal_width_mm === 58 ? 'thermal58' : 'thermal80'
  );
  const [issuingCredit, setIssuingCredit] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [printing, setPrinting] = useState(false);
  const autoPrintedIdRef = useRef<number | null>(null);

  useEffect(() => {
    setFormat(settings.thermal_width_mm === 58 ? 'thermal58' : 'thermal80');
  }, [settings.thermal_width_mm]);

  const isAr = lang === 'ar';

  const publicUrl = useMemo(() => {
    if (!invoice) return '';
    return buildPublicInvoiceUrl(invoice.uuid, settings.public_base_url);
  }, [invoice, settings.public_base_url]);

  // D1: scanning the receipt QR with a phone camera opens the public invoice page.
  // (A ZATCA Phase-1 TLV QR may be added later, once the accountant confirms it — D7/D8.)
  const qrValue = publicUrl;

  const publicHostLabel = useMemo(() => {
    if (!publicUrl) return '';
    try {
      return new URL(publicUrl).host;
    } catch {
      return publicUrl;
    }
  }, [publicUrl]);

  const paymentLabel = useMemo(() => {
    if (!invoice) return '';
    if (invoice.payment_method === 'card') {
      return isAr ? 'مدى / شبكة' : 'Mada / Card';
    }
    if (invoice.payment_method === 'split') {
      return isAr ? 'نقدي + شبكة' : 'Split (Cash + Card)';
    }
    return isAr ? 'نقدي' : 'Cash';
  }, [invoice, isAr]);

  const handleThermalPrint = useCallback(async () => {
    if (!invoice) return;
    setPrinting(true);
    try {
      const qrDataUrl = await QRCode.toDataURL(qrValue, {
        width: 320,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' },
      });

      const pageWidth =
        format === 'thermal58' ? '58mm' : format === 'thermal80' ? '80mm' : '210mm';
      const contentWidth =
        format === 'thermal58' ? '52mm' : format === 'thermal80' ? '74mm' : '184mm';
      const fontDelta =
        settings.font_size === 'large' ? 1.5 : settings.font_size === 'small' ? -1 : 0;
      const baseFontNum =
        (format === 'thermal58' ? 10 : format === 'thermal80' ? 11.5 : 13) + fontDelta;
      const baseFontSize = `${baseFontNum}px`;
      const qrPx = format === 'thermal58' ? '112px' : format === 'thermal80' ? '138px' : '150px';

      const isB2B = invoice.invoice_subtype === '0100000';
      const isCredit = invoice.invoice_type_code === '381';
      const titleText = isCredit
        ? isAr
          ? 'إشعار مرتجع / Credit Note'
          : 'Credit Note'
        : isB2B
        ? isAr
          ? 'فاتورة ضريبية / Tax Invoice'
          : 'Tax Invoice'
        : isAr
        ? 'فاتورة مبيعات / Sales Receipt'
        : 'Sales Receipt';

      const itemsHtml = (invoice.items ?? [])
        .map(
          (item) => `
          <tr>
            <td class="item-name">
              <div class="bold">${escapeHtml(isAr ? item.name_ar : item.name_en)}</div>
              <div class="muted mono">${escapeHtml(item.sku)}</div>
            </td>
            <td class="center mono">${item.qty}</td>
            <td class="end mono">${item.unit_price.toFixed(2)}</td>
            <td class="end mono bold">${item.line_total.toFixed(2)}</td>
          </tr>
        `
        )
        .join('');

      const html = `<!doctype html>
<html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(invoice.invoice_number)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    @page {
      size: ${pageWidth} auto;
      margin: ${format === 'a4' ? '12mm' : '1.5mm'};
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #000000;
      font-family: 'Cairo', Tahoma, Arial, sans-serif;
      font-size: ${baseFontSize};
      line-height: 1.45;
    }
    .sheet {
      width: ${contentWidth};
      max-width: 100%;
      margin: 0 auto;
      padding: ${format === 'a4' ? '0' : '2mm 1mm'};
    }
    .center { text-align: center; }
    .end { text-align: end; }
    .start { text-align: start; }
    .bold { font-weight: 700; }
    .mono {
      font-family: 'Courier New', ui-monospace, monospace;
      font-variant-numeric: tabular-nums;
    }
    .muted { color: #333333; font-size: 0.85em; }
    .divider { border-top: 1px dashed #000000; margin: 6px 0; }
    .header-title { font-size: 1.25em; font-weight: 800; margin-bottom: 2px; }
    .doc-title {
      font-size: 1.05em;
      font-weight: 700;
      padding: 4px 0;
      border-top: 1px solid #000000;
      border-bottom: 1px solid #000000;
      margin-top: 6px;
    }
    .meta-row {
      display: flex;
      justify-content: space-between;
      gap: 6px;
      margin: 2px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 4px 0;
    }
    th {
      border-bottom: 1px solid #000000;
      padding: 3px 2px;
      font-size: 0.88em;
      font-weight: 700;
    }
    td {
      padding: 4px 2px;
      border-bottom: 1px dotted #999999;
      vertical-align: top;
    }
    .item-name { max-width: ${format === 'thermal58' ? '24mm' : '36mm'}; word-break: break-word; }
    .total-grand {
      font-size: 1.2em;
      font-weight: 800;
      border-top: 1px solid #000000;
      padding-top: 4px;
      margin-top: 4px;
    }
    .qr-wrap {
      margin-top: 8px;
      text-align: center;
    }
    .qr-wrap img {
      width: ${qrPx};
      height: ${qrPx};
      display: block;
      margin: 0 auto 4px;
    }
    .footer-note {
      margin-top: 6px;
      font-size: 0.86em;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div class="center">
      <div class="header-title">${escapeHtml(settings.name_ar)}</div>
      <div class="muted">${escapeHtml(settings.name_en)}</div>
      <div class="muted">${escapeHtml(settings.street_ar)} - ${escapeHtml(settings.city_ar)}</div>
      ${settings.vat_number ? `<div class="mono muted">${isAr ? 'الرقم الضريبي:' : 'VAT:'} ${escapeHtml(settings.vat_number)}</div>` : ''}
      ${settings.cr_number ? `<div class="mono muted">${isAr ? 'السجل التجاري:' : 'CR:'} ${escapeHtml(settings.cr_number)}</div>` : ''}
      <div class="doc-title">${escapeHtml(titleText)}</div>
    </div>

    <div class="divider"></div>
    <div class="meta-row"><span>${isAr ? 'رقم الفاتورة:' : 'Invoice #:'}</span><span class="mono bold">${escapeHtml(invoice.invoice_number)}</span></div>
    <div class="meta-row"><span>${isAr ? 'التاريخ:' : 'Date:'}</span><span class="mono">${escapeHtml(formatDateTime(invoice.created_at, lang))}</span></div>
    <div class="meta-row"><span>${isAr ? 'الدفع:' : 'Payment:'}</span><span>${escapeHtml(paymentLabel)}</span></div>
    <div class="meta-row"><span>${isAr ? 'العميل:' : 'Customer:'}</span><span>${escapeHtml(invoice.customer_name)}</span></div>
    ${invoice.customer_vat ? `<div class="meta-row"><span>${isAr ? 'ضريبي العميل:' : 'Buyer VAT:'}</span><span class="mono">${escapeHtml(invoice.customer_vat)}</span></div>` : ''}
    ${invoice.related_invoice_number ? `<div class="meta-row"><span>${isAr ? 'مرجع الفاتورة:' : 'Ref:'}</span><span class="mono">${escapeHtml(invoice.related_invoice_number)}</span></div>` : ''}

    <div class="divider"></div>
    <table>
      <thead>
        <tr>
          <th class="start">${isAr ? 'الصنف' : 'Item'}</th>
          <th class="center">${isAr ? 'كمية' : 'Qty'}</th>
          <th class="end">${isAr ? 'سعر' : 'Price'}</th>
          <th class="end">${isAr ? 'المجموع' : 'Total'}</th>
        </tr>
      </thead>
      <tbody>${itemsHtml}</tbody>
    </table>

    <div class="divider"></div>
    <div class="meta-row"><span>${isAr ? 'قبل الضريبة' : 'Subtotal'}</span><span class="mono">${escapeHtml(formatMoney(invoice.subtotal, lang))}</span></div>
    ${invoice.discount_total > 0 ? `<div class="meta-row"><span>${isAr ? 'الخصم' : 'Discount'}</span><span class="mono">-${escapeHtml(formatMoney(invoice.discount_total, lang))}</span></div>` : ''}
    <div class="meta-row"><span>${isAr ? 'ضريبة القيمة المضافة (15%)' : 'VAT (15%)'}</span><span class="mono">${escapeHtml(formatMoney(invoice.vat_total, lang))}</span></div>
    <div class="meta-row total-grand"><span>${isAr ? 'الإجمالي المستحق' : 'Grand Total'}</span><span class="mono">${escapeHtml(formatMoney(invoice.grand_total, lang))}</span></div>
    ${invoice.payment_method === 'split' ? `<div class="meta-row muted"><span>${isAr ? 'نقدي / شبكة' : 'Cash / Card'}</span><span class="mono">${invoice.cash_amount.toFixed(2)} / ${invoice.card_amount.toFixed(2)}</span></div>` : ''}

    <div class="divider"></div>
    <div class="qr-wrap">
      <img src="${qrDataUrl}" alt="QR Code" />
      <div class="bold">${isAr ? 'امسح الرمز لعرض الفاتورة إلكترونياً' : 'Scan QR to view digital invoice'}</div>
      <div class="mono muted">${escapeHtml(publicHostLabel)}</div>
    </div>

    <div class="footer-note">
      ${isAr ? 'شكراً لتسوقكم معنا' : 'Thank you for shopping with us'}
    </div>
  </div>
</body>
</html>`;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      iframe.style.opacity = '0';
      iframe.style.pointerEvents = 'none';
      document.body.appendChild(iframe);

      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!doc || !iframe.contentWindow) {
        document.body.removeChild(iframe);
        window.print();
        return;
      }

      doc.open();
      doc.write(html);
      doc.close();

      await new Promise<void>((resolve) => {
        const win = iframe.contentWindow!;
        const timer = setTimeout(resolve, 650);
        win.addEventListener(
          'load',
          () => {
            clearTimeout(timer);
            setTimeout(resolve, 120);
          },
          { once: true }
        );
      });

      iframe.contentWindow.focus();
      iframe.contentWindow.print();

      setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 2000);
    } finally {
      setPrinting(false);
    }
  }, [invoice, qrValue, format, isAr, lang, settings, paymentLabel, publicHostLabel]);

  useEffect(() => {
    if (invoice && autoPrint && autoPrintedIdRef.current !== invoice.id) {
      autoPrintedIdRef.current = invoice.id;
      const timer = setTimeout(() => {
        void handleThermalPrint();
      }, 220);
      return () => clearTimeout(timer);
    }
  }, [invoice, autoPrint, handleThermalPrint]);

  if (!invoice) return null;

  const isB2B = invoice.invoice_subtype === '0100000';
  const isCredit = invoice.invoice_type_code === '381';

  const invoiceTitle = isCredit
    ? isAr
      ? 'إشعار مرتجع / Credit Note'
      : 'Credit Note (381)'
    : isB2B
    ? isAr
      ? 'فاتورة ضريبية / Tax Invoice'
      : 'Standard Tax Invoice (B2B)'
    : isAr
    ? 'فاتورة مبيعات / Sales Receipt'
    : 'Sales Receipt';

  const handleCopyPublicUrl = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopiedUrl(true);
    onNotify?.(isAr ? 'تم نسخ رابط الفاتورة العام' : 'Public invoice URL copied');
    setTimeout(() => setCopiedUrl(false), 1800);
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
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setFormat('thermal80')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                format === 'thermal80'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isAr ? 'حراري 80mm' : '80mm Thermal'}
            </button>
            <button
              type="button"
              onClick={() => setFormat('thermal58')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                format === 'thermal58'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {isAr ? 'حراري 58mm' : '58mm Thermal'}
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
              {isAr ? 'A4' : 'A4'}
            </button>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {invoice.invoice_type_code === '388' && (
              <button
                type="button"
                disabled={issuingCredit}
                onClick={handleIssueCreditNote}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 dark:border-amber-800 text-amber-800 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {isAr ? 'إصدار إشعار مرتجع' : 'Credit Note'}
              </button>
            )}
            <button
              type="button"
              disabled={printing}
              onClick={() => void handleThermalPrint()}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white transition-colors whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Printer className="w-3.5 h-3.5" />
              {printing
                ? isAr
                  ? 'جاري التحضير...'
                  : 'Preparing...'
                : isAr
                ? 'طباعة حرارية'
                : 'Thermal Print'}
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

        {/* Public Invoice URL Bar */}
        <div className="px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className="text-slate-500 dark:text-slate-400 shrink-0 font-medium">
              {isAr ? 'رابط QR العام:' : 'Public QR URL:'}
            </span>
            <span
              dir="ltr"
              className="font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded"
            >
              {publicUrl}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCopyPublicUrl}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {copiedUrl ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
              {copiedUrl ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ الرابط' : 'Copy Link'}
            </button>
            <a
              href={`/i/${encodeURIComponent(invoice.uuid)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
            >
              <ExternalLink className="w-3 h-3" />
              {isAr ? 'معاينة الرابط' : 'Open Link'}
            </a>
          </div>
        </div>

        {/* Printable Invoice Preview Area */}
        <div className="p-6 overflow-y-auto bg-slate-100 dark:bg-slate-950 flex justify-center">
          <div
            id="printable-invoice"
            className={`bg-white text-slate-950 border border-slate-200 rounded-xl p-5 ${
              format === 'thermal58'
                ? 'w-full max-w-[260px] text-[11px]'
                : format === 'thermal80'
                ? 'w-full max-w-[340px] text-xs'
                : 'w-full max-w-[680px] text-sm'
            }`}
          >
            {/* Header */}
            <div className="text-center border-b border-dashed border-slate-300 pb-3.5 space-y-1">
              <div className="text-base font-bold text-slate-950">{settings.name_ar}</div>
              <div className="text-xs text-slate-600">{settings.name_en}</div>
              <div className="text-xs text-slate-600">
                {settings.street_ar} · {settings.city_ar}
              </div>
              {settings.vat_number && (
                <div className="font-mono text-xs text-slate-700 tabular-nums">
                  {isAr ? 'الرقم الضريبي:' : 'VAT ID:'} {settings.vat_number}
                </div>
              )}
              {settings.cr_number && (
                <div className="font-mono text-xs text-slate-500 tabular-nums">
                  {isAr ? 'السجل التجاري:' : 'CR:'} {settings.cr_number}
                </div>
              )}
              <div className="pt-2 font-bold text-slate-950 border-t border-slate-200 mt-2">
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
                <span className="text-slate-500">{isAr ? 'طريقة الدفع:' : 'Payment:'}</span>
                <span className="font-medium">{paymentLabel}</span>
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
            </div>

            {/* Line Items Table */}
            <div className="py-3 border-b border-dashed border-slate-300">
              <table className="w-full text-start">
                <thead>
                  <tr className="text-slate-600 border-b border-slate-200 text-[11px]">
                    <th className="py-1.5 text-start font-semibold">{isAr ? 'الصنف' : 'Item'}</th>
                    <th className="py-1.5 text-center font-semibold">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-1.5 text-end font-semibold">{isAr ? 'السعر' : 'Price'}</th>
                    <th className="py-1.5 text-end font-semibold">{isAr ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(invoice.items ?? []).map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2 pe-2">
                        <div className="font-medium text-slate-950">
                          {isAr ? item.name_ar : item.name_en}
                        </div>
                        <div className="font-mono text-[10px] text-slate-500">{item.sku}</div>
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
              <div className="flex justify-between text-base font-bold text-slate-950 pt-1.5 border-t border-slate-200">
                <span>{isAr ? 'الإجمالي شامل الضريبة' : 'Grand Total'}</span>
                <span className="font-mono">{formatMoney(invoice.grand_total, lang)}</span>
              </div>
            </div>

            {/* QR & Footer */}
            <div className="pt-4 flex flex-col items-center text-center space-y-1.5">
              <QrCodeCanvas
                value={qrValue}
                size={format === 'thermal58' ? 116 : format === 'thermal80' ? 136 : 156}
                alt="Public Invoice URL QR Code"
              />
              <div className="text-[11px] text-slate-800 font-semibold pt-1">
                {isAr ? 'امسح الرمز لعرض الفاتورة إلكترونياً' : 'Scan QR to view digital invoice'}
              </div>
              <div dir="ltr" className="font-mono text-[10px] text-slate-500">
                {publicHostLabel}
              </div>
              <div className="text-[11px] text-slate-500 pt-1">
                {isAr ? 'شكراً لتسوقكم معنا' : 'Thank you for shopping with us'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
