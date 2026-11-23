import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  ExternalLink,
  Printer,
  RotateCcw,
  Search,
  Settings2,
} from 'lucide-react';
import type { FontSizeLevel, Invoice, Language, OrganizationSettings } from '../types';
import { formatDateTime, formatMoney } from '../i18n';
import { buildPublicInvoiceUrl } from './InvoiceReceiptModal';
import { TablePagination, useTablePagination } from './TablePagination';

interface InvoicesSettingsViewProps {
  lang: Language;
  settings: OrganizationSettings;
  invoices: Invoice[];
  onOpenReceipt: (invoice: Invoice) => void;
  onCreditNote: (invoiceId: number) => Promise<void>;
  onUpdateSettings: (payload: Partial<OrganizationSettings>) => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function InvoicesSettingsView({
  lang,
  settings,
  invoices,
  onOpenReceipt,
  onCreditNote,
  onUpdateSettings,
  onNotify,
}: InvoicesSettingsViewProps) {
  const isAr = lang === 'ar';

  const [tab, setTab] = useState<'invoices' | 'settings'>('invoices');
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    name_ar: settings.name_ar,
    name_en: settings.name_en,
    vat_number: settings.vat_number,
    cr_number: settings.cr_number,
    street_ar: settings.street_ar,
    city_ar: settings.city_ar,
    public_base_url: settings.public_base_url,
    thermal_width_mm: settings.thermal_width_mm || 80,
    auto_print_receipt: settings.auto_print_receipt === 1,
    zatca_enabled: settings.zatca_enabled === 1,
    font_size: (settings.font_size || 'medium') as FontSizeLevel,
    table_page_size: settings.table_page_size || 10,
  });

  useEffect(() => {
    setForm({
      name_ar: settings.name_ar,
      name_en: settings.name_en,
      vat_number: settings.vat_number,
      cr_number: settings.cr_number,
      street_ar: settings.street_ar,
      city_ar: settings.city_ar,
      public_base_url: settings.public_base_url,
      thermal_width_mm: settings.thermal_width_mm || 80,
      auto_print_receipt: settings.auto_print_receipt === 1,
      zatca_enabled: settings.zatca_enabled === 1,
      font_size: (settings.font_size || 'medium') as FontSizeLevel,
      table_page_size: settings.table_page_size || 10,
    });
  }, [settings]);

  const metrics = useMemo(() => {
    const salesInvoices = invoices.filter((i) => i.invoice_type_code === '388');
    const totalSales = salesInvoices.reduce((s, i) => s + i.grand_total, 0);
    const totalVat = salesInvoices.reduce((s, i) => s + i.vat_total, 0);
    const todayIso = new Date().toISOString().slice(0, 10);
    const todaySales = salesInvoices
      .filter((i) => i.created_at.startsWith(todayIso))
      .reduce((s, i) => s + i.grand_total, 0);

    return {
      count: invoices.length,
      totalSales,
      totalVat,
      todaySales,
    };
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (inv) =>
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.customer_name.toLowerCase().includes(q) ||
        inv.uuid.toLowerCase().includes(q)
    );
  }, [invoices, search]);

  const invoicesPagination = useTablePagination(
    filteredInvoices,
    settings.table_page_size || 10,
    search
  );

  const effectiveBaseUrl =
    form.public_base_url.trim().replace(/\/+$/, '') || window.location.origin;

  const handleCopyLink = async (inv: Invoice) => {
    const url = buildPublicInvoiceUrl(inv.uuid, settings.public_base_url);
    await navigator.clipboard.writeText(url);
    setCopiedId(inv.id);
    onNotify(isAr ? 'تم نسخ رابط الفاتورة العام' : 'Public invoice URL copied');
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await onUpdateSettings({
        name_ar: form.name_ar,
        name_en: form.name_en,
        vat_number: form.vat_number,
        cr_number: form.cr_number,
        street_ar: form.street_ar,
        city_ar: form.city_ar,
        public_base_url: form.public_base_url.trim().replace(/\/+$/, ''),
        thermal_width_mm: form.thermal_width_mm,
        auto_print_receipt: form.auto_print_receipt ? 1 : 0,
        zatca_enabled: form.zatca_enabled ? 1 : 0,
        font_size: form.font_size,
        table_page_size: form.table_page_size,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">
            {isAr ? 'فواتير المبيعات وإعدادات الطابعة الحرارية' : 'Sales Invoices & Thermal Print Settings'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>
              {isAr ? 'هيئة الزكاة (ZATCA): معطلة' : 'ZATCA Integration: Disabled'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">
              {isAr ? `عرض الورق: ${settings.thermal_width_mm || 80}mm` : `Paper: ${settings.thermal_width_mm || 80}mm`}
            </span>
            <span aria-hidden="true">·</span>
            <span dir="ltr" className="font-mono truncate max-w-xs">
              {effectiveBaseUrl}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('invoices')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'invoices'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {isAr ? 'سجل الفواتير' : 'Invoices Log'}
          </button>
          <button
            type="button"
            onClick={() => setTab('settings')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'settings'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            <Settings2 className="w-3.5 h-3.5" />
            {isAr ? 'الطابعة والرابط العام' : 'Printer & Base URL'}
          </button>
        </div>
      </div>

      {tab === 'invoices' ? (
        <>
          {/* KPI Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'إجمالي المبيعات' : 'Total Sales'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-emerald-700 dark:text-emerald-400">
                {formatMoney(metrics.totalSales, lang)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'مبيعات اليوم' : "Today's Sales"}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-slate-900 dark:text-white">
                {formatMoney(metrics.todaySales, lang)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'إجمالي الضريبة (15%)' : 'Total VAT (15%)'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-slate-900 dark:text-white">
                {formatMoney(metrics.totalVat, lang)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {isAr ? 'عدد الفواتير' : 'Invoices Count'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums mt-1 text-slate-900 dark:text-white">
                {metrics.count}
              </div>
            </div>
          </div>

          {/* Search Bar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 flex items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isAr
                    ? 'ابحث برقم الفاتورة أو اسم العميل...'
                    : 'Search by invoice # or customer...'
                }
                className="w-full ps-9 pe-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
              />
            </div>
          </div>

          {/* Invoices Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">
                    {isAr ? 'رقم الفاتورة' : 'Invoice #'}
                  </th>
                  <th className="py-3 px-4 text-start font-medium">
                    {isAr ? 'التاريخ' : 'Date'}
                  </th>
                  <th className="py-3 px-4 text-start font-medium">
                    {isAr ? 'العميل' : 'Customer'}
                  </th>
                  <th className="py-3 px-4 text-start font-medium">
                    {isAr ? 'الدفع' : 'Payment'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'الإجمالي' : 'Total'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'إجراءات الطباعة والرابط' : 'Print & Public Link'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {invoicesPagination.pagedItems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-400">
                      {isAr ? 'لا توجد فواتير مطابقة للبحث' : 'No matching invoices found'}
                    </td>
                  </tr>
                ) : (
                  invoicesPagination.pagedItems.map((inv) => {
                  const isCredit = inv.invoice_type_code === '381';
                  const payLabel =
                    inv.payment_method === 'card'
                      ? isAr
                        ? 'مدى / شبكة'
                        : 'Card'
                      : inv.payment_method === 'split'
                      ? isAr
                        ? 'مقسم'
                        : 'Split'
                      : isAr
                      ? 'نقدي'
                      : 'Cash';

                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono font-semibold text-slate-900 dark:text-white">
                          {inv.invoice_number}
                        </div>
                        {isCredit && (
                          <div className="text-[11px] text-amber-700 dark:text-amber-400">
                            {isAr ? 'إشعار مرتجع' : 'Credit Note'}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500 tabular-nums">
                        {formatDateTime(inv.created_at, lang)}
                      </td>
                      <td className="py-3 px-4 font-medium text-slate-700 dark:text-slate-200">
                        {inv.customer_name}
                      </td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                        {payLabel}
                      </td>
                      <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(inv.grand_total, lang)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleCopyLink(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            {copiedId === inv.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                            {isAr ? 'نسخ الرابط' : 'Copy URL'}
                          </button>
                          <a
                            href={`/i/${encodeURIComponent(inv.uuid)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {isAr ? 'فتح' : 'Open'}
                          </a>
                          <button
                            type="button"
                            onClick={() => onOpenReceipt(inv)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium whitespace-nowrap"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            {isAr ? 'طباعة حرارية' : 'Thermal Print'}
                          </button>
                          {inv.invoice_type_code === '388' && (
                            <button
                              type="button"
                              onClick={() => void onCreditNote(inv.id)}
                              title={isAr ? 'إصدار مرتجع' : 'Issue Return'}
                              className="p-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
                )}
              </tbody>
            </table>
            <TablePagination
              lang={lang}
              currentPage={invoicesPagination.currentPage}
              totalPages={invoicesPagination.totalPages}
              totalItems={invoicesPagination.totalItems}
              startItem={invoicesPagination.startItem}
              endItem={invoicesPagination.endItem}
              onPageChange={invoicesPagination.setPage}
            />
          </div>
        </>
      ) : (
        /* TAB 2: Thermal Printer, Base URL & Store Settings */
        <form
          onSubmit={handleSaveSettings}
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-5">
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'إعدادات الطابعة الحرارية والرابط العام (QR)' : 'Thermal Printer & Public QR Base URL'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {isAr
                  ? 'يتم تضمين رابط الفاتورة العام تلقائياً داخل رمز QR المطبوع على الإيصال الحراري.'
                  : 'Every printed thermal receipt encodes a public URL pointing to the Base URL below.'}
              </p>
            </div>

            {/* Public Base URL */}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'الرابط الأساسي العام (Base URL)' : 'Public Base URL'}
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      public_base_url: window.location.origin,
                    }))
                  }
                  className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  {isAr ? 'استخدام الرابط الحالي تلقائياً' : 'Use current origin'}
                </button>
              </div>
              <input
                type="url"
                dir="ltr"
                placeholder={window.location.origin}
                value={form.public_base_url}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, public_base_url: e.target.value }))
                }
                className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
              />
              <div className="text-[11px] text-slate-500 dark:text-slate-400">
                {isAr
                  ? 'اتركه فارغاً لاستخدام نطاق التشغيل الحالي تلقائياً، أو أدخل نطاق الاستضافة العام مثل https://pos.example.com'
                  : 'Leave empty to use the active host origin automatically, or enter your production domain.'}
              </div>
              <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5 text-[11px]">
                <span className="text-slate-500 dark:text-slate-400">
                  {isAr ? 'معاينة رابط QR الناتج: ' : 'Generated QR URL preview: '}
                </span>
                <span dir="ltr" className="font-mono text-emerald-700 dark:text-emerald-400 break-all">
                  {effectiveBaseUrl}/i/sample-invoice-uuid
                </span>
              </div>
            </div>

            {/* Font Size & Thermal Paper Width */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'حجم الخط في النظام والفاتورة' : 'System & Receipt Font Size'}
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      ['large', isAr ? 'كبير' : 'Large'],
                      ['medium', isAr ? 'متوسط' : 'Medium'],
                      ['small', isAr ? 'صغير' : 'Small'],
                    ] as Array<[FontSizeLevel, string]>
                  ).map(([level, label]) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => {
                        document.documentElement.dataset.fontSize = level;
                        setForm((prev) => ({ ...prev, font_size: level }));
                      }}
                      className={`py-2 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                        form.font_size === level
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'عرض ورق الطابعة الحرارية' : 'Thermal Paper Roll Width'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[80, 58].map((mm) => (
                    <button
                      key={mm}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({ ...prev, thermal_width_mm: mm }))
                      }
                      className={`py-2 px-3 text-xs font-mono font-semibold rounded-lg border transition-colors ${
                        form.thermal_width_mm === mm
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                      }`}
                    >
                      {mm}mm
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'حجم صفحات الجداول (Pagination)' : 'Table Pagination Size'}
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[5, 10, 20, 50].map((size) => (
                    <button
                      key={size}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({ ...prev, table_page_size: size }))
                      }
                      className={`py-2 px-2 text-xs font-mono font-semibold rounded-lg border transition-colors ${
                        form.table_page_size === size
                          ? 'bg-emerald-700 text-white border-emerald-700'
                          : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      {size}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  {isAr
                    ? 'عدد الصفوف المعروضة في كل صفحة لجميع جداول النظام'
                    : 'Rows displayed per page across all system tables'}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {isAr ? 'الطباعة التلقائية عند البيع' : 'Auto-Print on Checkout'}
                </label>
                <label className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer text-xs">
                  <input
                    type="checkbox"
                    checked={form.auto_print_receipt}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        auto_print_receipt: e.target.checked,
                      }))
                    }
                    className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
                  />
                  <span>
                    {isAr
                      ? 'فتح نافذة الطابعة تلقائياً بعد إتمام الدفع'
                      : 'Trigger thermal print automatically after checkout'}
                  </span>
                </label>
              </div>
            </div>

            {/* Store Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'اسم المتجر (عربي)' : 'Store Name (AR)'}
                </label>
                <input
                  required
                  type="text"
                  value={form.name_ar}
                  onChange={(e) => setForm({ ...form, name_ar: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'اسم المتجر (إنجليزي)' : 'Store Name (EN)'}
                </label>
                <input
                  type="text"
                  value={form.name_en}
                  onChange={(e) => setForm({ ...form, name_en: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'الرقم الضريبي' : 'VAT Number'}
                </label>
                <input
                  required
                  type="text"
                  value={form.vat_number}
                  onChange={(e) => setForm({ ...form, vat_number: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'السجل التجاري' : 'CR Number'}
                </label>
                <input
                  type="text"
                  value={form.cr_number}
                  onChange={(e) => setForm({ ...form, cr_number: e.target.value })}
                  className="w-full px-3 py-2 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'الحي / الشارع' : 'Street'}
                </label>
                <input
                  type="text"
                  value={form.street_ar}
                  onChange={(e) => setForm({ ...form, street_ar: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-600 dark:text-slate-400">
                  {isAr ? 'المدينة' : 'City'}
                </label>
                <input
                  type="text"
                  value={form.city_ar}
                  onChange={(e) => setForm({ ...form, city_ar: e.target.value })}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                disabled={saving}
                className="px-5 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {saving
                  ? isAr
                    ? 'جاري الحفظ...'
                    : 'Saving...'
                  : isAr
                  ? 'حفظ الإعدادات'
                  : 'Save Settings'}
              </button>
            </div>
          </div>

          {/* Right Column: ZATCA Status Card (Disabled) */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'حالة الربط مع هيئة الزكاة (ZATCA)' : 'ZATCA Integration Status'}
              </h3>
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {form.zatca_enabled
                  ? isAr
                    ? 'مفعل'
                    : 'Enabled'
                  : isAr
                  ? 'معطل حالياً'
                  : 'Disabled'}
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'تم تعطيل الربط التلقائي والتوقيع الإلكتروني لهيئة الزكاة والضريبة والجمارك حالياً. تصدر الفواتير محلياً بشكل فوري مع رمز QR يحتوي على الرابط العام للفاتورة للطباعة الحرارية.'
                : 'ZATCA cryptographic signing and API dispatch are currently disabled. Sales invoices are saved locally with a public URL QR code optimized for thermal receipt printing.'}
            </p>

            <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 cursor-pointer text-xs">
              <span className="font-medium text-slate-700 dark:text-slate-200">
                {isAr ? 'تفعيل ربط هيئة الزكاة (اختياري لاحقاً)' : 'Enable ZATCA Compliance (Optional)'}
              </span>
              <input
                type="checkbox"
                checked={form.zatca_enabled}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, zatca_enabled: e.target.checked }))
                }
                className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-700"
              />
            </label>
          </div>
        </form>
      )}
    </div>
  );
}
