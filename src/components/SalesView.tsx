import { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Eye,
  FilePlus2,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
  Search,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import type {
  Customer,
  Invoice,
  InvoiceSubtype,
  Language,
  OrganizationSettings,
  PaymentMethod,
  Product,
} from '../types';
import { formatDateTime, formatMoney, translations } from '../i18n';
import { buildPublicInvoiceUrl } from './InvoiceReceiptModal';
import { TablePagination, useTablePagination } from './TablePagination';

interface SalesViewProps {
  lang: Language;
  settings: OrganizationSettings;
  products: Product[];
  customers: Customer[];
  invoices: Invoice[];
  onCreateSale: (payload: {
    items: Array<{ product_id: number; qty: number }>;
    invoice_subtype: InvoiceSubtype;
    payment_method: PaymentMethod;
    cash_amount: number;
    discount_total: number;
    customer_id: number | null;
  }) => Promise<void>;
  onCreditNote: (invoiceId: number) => Promise<void>;
  onCreateCustomer: (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    address_ar: string;
    phone: string;
  }) => Promise<number>;
  onUpdateCustomer: (
    id: number,
    payload: {
      name_ar: string;
      name_en: string;
      vat_number: string;
      cr_number: string;
      address_ar: string;
      phone: string;
    }
  ) => Promise<void>;
  onOpenReceipt: (invoice: Invoice) => void;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

interface DraftSaleLine {
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  qty: number;
  sell_price: number;
  cost_price: number;
  tax_rate: number;
  max_stock: number;
}

type PeriodFilter = 'all' | 'today' | '7d' | 'month';

export function SalesView({
  lang,
  settings,
  products,
  customers,
  invoices,
  onCreateSale,
  onCreditNote,
  onCreateCustomer,
  onUpdateCustomer,
  onOpenReceipt,
  onNotify,
}: SalesViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [tab, setTab] = useState<'ledger' | 'analytics' | 'customers'>('ledger');
  const [search, setSearch] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | '388' | '381'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentMethod>('all');
  const [copiedId, setCopiedId] = useState<number | null>(null);

  // Modals
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showNewSale, setShowNewSale] = useState(false);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [submittingSale, setSubmittingSale] = useState(false);
  const [submittingCustomer, setSubmittingCustomer] = useState(false);
  const [issuingCreditId, setIssuingCreditId] = useState<number | null>(null);

  // New Sale Form State
  const [saleSubtype, setSaleSubtype] = useState<InvoiceSubtype>('0200000');
  const [saleCustomerId, setSaleCustomerId] = useState<number | ''>('');
  const [salePaymentMethod, setSalePaymentMethod] = useState<PaymentMethod>('cash');
  const [saleCashAmount, setSaleCashAmount] = useState('');
  const [saleDiscount, setSaleDiscount] = useState('0');
  const [pickerProductId, setPickerProductId] = useState<number>(
    products.find((p) => p.stock_qty > 0)?.id ?? products[0]?.id ?? 0
  );
  const [draftLines, setDraftLines] = useState<DraftSaleLine[]>([]);

  // Customer Form State
  const [customerForm, setCustomerForm] = useState({
    name_ar: '',
    name_en: '',
    vat_number: '',
    cr_number: '',
    address_ar: '',
    phone: '',
  });

  const productCostMap = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of products) {
      map.set(p.id, p.cost_price);
    }
    return map;
  }, [products]);

  // Map original invoice_number -> credit note invoice_number
  const returnedByMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of invoices) {
      if (inv.invoice_type_code === '381' && inv.related_invoice_number) {
        map.set(inv.related_invoice_number, inv.invoice_number);
      }
    }
    return map;
  }, [invoices]);

  // Core KPI Calculations
  const metrics = useMemo(() => {
    let grossSales = 0;
    let grossVat = 0;
    let returnsTotal = 0;
    let returnsVat = 0;
    let salesCount = 0;
    let returnsCount = 0;
    let cashTotal = 0;
    let cardTotal = 0;
    let totalNetRevenueExVat = 0;
    let totalNetCogs = 0;

    for (const inv of invoices) {
      const sign = inv.invoice_type_code === '381' ? -1 : 1;
      if (inv.invoice_type_code === '388') {
        grossSales += inv.grand_total;
        grossVat += inv.vat_total;
        salesCount += 1;
      } else if (inv.invoice_type_code === '381') {
        returnsTotal += inv.grand_total;
        returnsVat += inv.vat_total;
        returnsCount += 1;
      }

      cashTotal += sign * inv.cash_amount;
      cardTotal += sign * inv.card_amount;
      totalNetRevenueExVat += sign * inv.subtotal;

      for (const item of inv.items ?? []) {
        const unitCost = productCostMap.get(item.product_id) ?? 0;
        totalNetCogs += sign * item.qty * unitCost;
      }
    }

    const netSales = Number((grossSales - returnsTotal).toFixed(2));
    const netVat = Number((grossVat - returnsVat).toFixed(2));
    const grossProfit = Number((totalNetRevenueExVat - totalNetCogs).toFixed(2));
    const profitMargin =
      totalNetRevenueExVat > 0 ? Number(((grossProfit / totalNetRevenueExVat) * 100).toFixed(1)) : 0;

    return {
      netSales,
      grossSales: Number(grossSales.toFixed(2)),
      returnsTotal: Number(returnsTotal.toFixed(2)),
      salesCount,
      returnsCount,
      grossProfit,
      profitMargin,
      cashTotal: Math.max(0, Number(cashTotal.toFixed(2))),
      cardTotal: Math.max(0, Number(cardTotal.toFixed(2))),
      netVat,
    };
  }, [invoices, productCostMap]);

  // Filtered Ledger Invoices
  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthPrefix = now.toISOString().slice(0, 7);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).getTime();

    return invoices.filter((inv) => {
      if (typeFilter !== 'all' && inv.invoice_type_code !== typeFilter) return false;
      if (paymentFilter !== 'all' && inv.payment_method !== paymentFilter) return false;

      if (periodFilter === 'today' && !inv.created_at.startsWith(todayStr)) return false;
      if (periodFilter === 'month' && !inv.created_at.startsWith(monthPrefix)) return false;
      if (periodFilter === '7d' && new Date(inv.created_at).getTime() < sevenDaysAgo) {
        return false;
      }

      if (!q) return true;
      return (
        inv.invoice_number.toLowerCase().includes(q) ||
        inv.customer_name.toLowerCase().includes(q) ||
        inv.customer_vat.toLowerCase().includes(q) ||
        inv.uuid.toLowerCase().includes(q)
      );
    });
  }, [invoices, search, typeFilter, paymentFilter, periodFilter]);

  // Analytics: Top Selling Products & Daily Sales Summary
  const analytics = useMemo(() => {
    const productStats = new Map<
      number,
      {
        product_id: number;
        sku: string;
        name_ar: string;
        name_en: string;
        netQty: number;
        netRevenueExVat: number;
        netCogs: number;
      }
    >();

    const dailyMap = new Map<
      string,
      { date: string; salesCount: number; returnsCount: number; netSales: number; netVat: number }
    >();

    for (const inv of invoices) {
      const sign = inv.invoice_type_code === '381' ? -1 : 1;
      const dayKey = inv.created_at.slice(0, 10);
      const dayEntry = dailyMap.get(dayKey) ?? {
        date: dayKey,
        salesCount: 0,
        returnsCount: 0,
        netSales: 0,
        netVat: 0,
      };
      if (inv.invoice_type_code === '388') {
        dayEntry.salesCount += 1;
      } else if (inv.invoice_type_code === '381') {
        dayEntry.returnsCount += 1;
      }
      dayEntry.netSales += sign * inv.grand_total;
      dayEntry.netVat += sign * inv.vat_total;
      dailyMap.set(dayKey, dayEntry);

      for (const item of inv.items ?? []) {
        const unitCost = productCostMap.get(item.product_id) ?? 0;
        const curr = productStats.get(item.product_id) ?? {
          product_id: item.product_id,
          sku: item.sku,
          name_ar: item.name_ar,
          name_en: item.name_en,
          netQty: 0,
          netRevenueExVat: 0,
          netCogs: 0,
        };
        curr.netQty += sign * item.qty;
        curr.netRevenueExVat += sign * item.line_subtotal;
        curr.netCogs += sign * item.qty * unitCost;
        productStats.set(item.product_id, curr);
      }
    }

    const topProducts = Array.from(productStats.values())
      .map((p) => {
        const profit = Number((p.netRevenueExVat - p.netCogs).toFixed(2));
        const margin =
          p.netRevenueExVat > 0 ? Number(((profit / p.netRevenueExVat) * 100).toFixed(1)) : 0;
        return { ...p, profit, margin };
      })
      .sort((a, b) => b.netRevenueExVat - a.netRevenueExVat);

    const dailyRows = Array.from(dailyMap.values()).sort((a, b) =>
      b.date.localeCompare(a.date)
    );

    return { topProducts, dailyRows };
  }, [invoices, productCostMap]);

  // Customer aggregates
  const customerRows = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const agg = new Map<number, { count: number; netTotal: number; lastDate: string }>();

    for (const inv of invoices) {
      if (!inv.customer_id) continue;
      const sign = inv.invoice_type_code === '381' ? -1 : 1;
      const curr = agg.get(inv.customer_id) ?? { count: 0, netTotal: 0, lastDate: '' };
      if (inv.invoice_type_code === '388') curr.count += 1;
      curr.netTotal += sign * inv.grand_total;
      if (!curr.lastDate || inv.created_at > curr.lastDate) {
        curr.lastDate = inv.created_at;
      }
      agg.set(inv.customer_id, curr);
    }

    return customers
      .filter((c) => {
        if (!q) return true;
        return (
          c.name_ar.toLowerCase().includes(q) ||
          c.name_en.toLowerCase().includes(q) ||
          c.vat_number.toLowerCase().includes(q) ||
          c.phone.toLowerCase().includes(q)
        );
      })
      .map((c) => {
        const stats = agg.get(c.id) ?? { count: 0, netTotal: 0, lastDate: '' };
        return { ...c, ...stats };
      });
  }, [customers, invoices, customerSearch]);

  const pageSize = settings.table_page_size || 10;
  const ledgerPagination = useTablePagination(
    filteredInvoices,
    pageSize,
    `${search}|${periodFilter}|${typeFilter}|${paymentFilter}`
  );
  const dailyPagination = useTablePagination(analytics.dailyRows, pageSize);
  const topProductsPagination = useTablePagination(analytics.topProducts, pageSize);
  const customersPagination = useTablePagination(customerRows, pageSize, customerSearch);

  // Draft Sale Totals
  const draftTotals = useMemo(() => {
    const rawSub = draftLines.reduce((s, l) => s + l.qty * l.sell_price, 0);
    const rawVat = draftLines.reduce(
      (s, l) => s + l.qty * l.sell_price * (l.tax_rate / 100),
      0
    );
    const rawCogs = draftLines.reduce((s, l) => s + l.qty * l.cost_price, 0);
    const disc = Math.min(Math.max(0, Number(saleDiscount) || 0), rawSub);
    const ratio = rawSub > 0 ? (rawSub - disc) / rawSub : 1;
    const subtotal = Number((rawSub - disc).toFixed(2));
    const vat = Number((rawVat * ratio).toFixed(2));
    const grandTotal = Number((subtotal + vat).toFixed(2));
    const estProfit = Number((subtotal - rawCogs).toFixed(2));
    return { subtotal, vat, grandTotal, estProfit };
  }, [draftLines, saleDiscount]);

  const handleCopyLink = async (inv: Invoice) => {
    const url = buildPublicInvoiceUrl(inv.uuid, settings.public_base_url);
    await navigator.clipboard.writeText(url);
    setCopiedId(inv.id);
    onNotify(isAr ? 'تم نسخ رابط الفاتورة العام' : 'Public invoice URL copied');
    setTimeout(() => setCopiedId(null), 1600);
  };

  const handleExportCsv = () => {
    const headers = [
      'Invoice Number',
      'Type',
      'Date',
      'Customer',
      'Customer VAT',
      'Payment Method',
      'Subtotal',
      'VAT',
      'Grand Total',
    ];
    const rows = filteredInvoices.map((inv) => [
      inv.invoice_number,
      inv.invoice_type_code === '381' ? 'Credit Note (381)' : 'Sale (388)',
      inv.created_at,
      `"${inv.customer_name.replace(/"/g, '""')}"`,
      inv.customer_vat,
      inv.payment_method,
      inv.subtotal.toFixed(2),
      inv.vat_total.toFixed(2),
      inv.grand_total.toFixed(2),
    ]);
    const csv = '\uFEFF' + [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mizan-sales-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const openNewSaleModal = () => {
    const firstInStock = products.find((p) => p.stock_qty > 0);
    setPickerProductId(firstInStock?.id ?? products[0]?.id ?? 0);
    setDraftLines([]);
    setSaleSubtype('0200000');
    setSaleCustomerId('');
    setSalePaymentMethod('cash');
    setSaleCashAmount('');
    setSaleDiscount('0');
    setShowNewSale(true);
  };

  const handleAddDraftLine = () => {
    const prod = products.find((p) => p.id === pickerProductId);
    if (!prod) return;
    if (prod.stock_qty <= 0) {
      onNotify(isAr ? 'هذا الصنف منتهي من المخزون' : 'Product is out of stock', 'error');
      return;
    }
    setDraftLines((prev) => {
      const existing = prev.find((l) => l.product_id === prod.id);
      if (existing) {
        if (existing.qty >= prod.stock_qty) {
          onNotify(
            isAr ? 'تم بلوغ الحد الأقصى للمخزون المتاح' : 'Maximum available stock reached',
            'error'
          );
          return prev;
        }
        return prev.map((l) =>
          l.product_id === prod.id ? { ...l, qty: l.qty + 1 } : l
        );
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          sku: prod.sku,
          name_ar: prod.name_ar,
          name_en: prod.name_en,
          qty: 1,
          sell_price: prod.sell_price,
          cost_price: prod.cost_price,
          tax_rate: prod.tax_rate,
          max_stock: prod.stock_qty,
        },
      ];
    });
  };

  const handleSubmitSale = async (e: React.FormEvent) => {
    e.preventDefault();
    if (draftLines.length === 0) {
      onNotify(isAr ? 'أضف صنفاً واحداً على الأقل' : 'Add at least one item', 'error');
      return;
    }
    if (saleSubtype === '0100000' && !saleCustomerId) {
      onNotify(
        isAr ? 'اختر العميل لإصدار فاتورة ضريبية B2B' : 'Select a B2B customer',
        'error'
      );
      return;
    }

    setSubmittingSale(true);
    try {
      await onCreateSale({
        items: draftLines.map((l) => ({ product_id: l.product_id, qty: l.qty })),
        invoice_subtype: saleSubtype,
        payment_method: salePaymentMethod,
        cash_amount:
          salePaymentMethod === 'split'
            ? Number(saleCashAmount) || 0
            : salePaymentMethod === 'cash'
            ? draftTotals.grandTotal
            : 0,
        discount_total: Number(saleDiscount) || 0,
        customer_id: saleCustomerId ? Number(saleCustomerId) : null,
      });
      setShowNewSale(false);
    } finally {
      setSubmittingSale(false);
    }
  };

  const openAddCustomer = () => {
    setEditingCustomer(null);
    setCustomerForm({
      name_ar: '',
      name_en: '',
      vat_number: '',
      cr_number: '',
      address_ar: '',
      phone: '',
    });
    setShowCustomerModal(true);
  };

  const openEditCustomer = (c: Customer) => {
    setEditingCustomer(c);
    setCustomerForm({
      name_ar: c.name_ar,
      name_en: c.name_en,
      vat_number: c.vat_number,
      cr_number: c.cr_number,
      address_ar: c.address_ar,
      phone: c.phone,
    });
    setShowCustomerModal(true);
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerForm.name_ar.trim()) return;
    setSubmittingCustomer(true);
    try {
      if (editingCustomer) {
        await onUpdateCustomer(editingCustomer.id, customerForm);
      } else {
        const newId = await onCreateCustomer(customerForm);
        if (newId && showNewSale) {
          setSaleCustomerId(newId);
        }
      }
      setShowCustomerModal(false);
    } finally {
      setSubmittingCustomer(false);
    }
  };

  const handleIssueReturn = async (invoiceId: number) => {
    setIssuingCreditId(invoiceId);
    try {
      await onCreditNote(invoiceId);
      setSelectedInvoice(null);
    } finally {
      setIssuingCreditId(null);
    }
  };

  const cashSharePct =
    metrics.cashTotal + metrics.cardTotal > 0
      ? Math.round((metrics.cashTotal / (metrics.cashTotal + metrics.cardTotal)) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.salesTitle}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t.salesSubtitle}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start">
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            {t.exportCsvBtn}
          </button>
          <button
            type="button"
            onClick={openAddCustomer}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            {t.newCustomerBtn}
          </button>
          <button
            type="button"
            onClick={openNewSaleModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            {t.newSaleBtn}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.netSalesMetric}</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
            {formatMoney(metrics.netSales, lang)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
            {metrics.salesCount} {isAr ? 'فاتورة بيع' : 'sales'} · {metrics.returnsCount}{' '}
            {isAr ? 'مرتجع' : 'returns'}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.grossProfitMetric}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {formatMoney(metrics.grossProfit, lang)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {isAr ? `هامش الربح: ${metrics.profitMargin}%` : `Margin: ${metrics.profitMargin}%`}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.cashVsCardMetric}</div>
          <div className="text-base font-bold font-mono text-slate-900 dark:text-white mt-1.5 tabular-nums">
            {formatMoney(metrics.cashTotal, lang)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {isAr ? 'شبكة:' : 'Card:'} {formatMoney(metrics.cardTotal, lang)}
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.netOutputVatMetric}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {formatMoney(metrics.netVat, lang)}
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 font-mono tabular-nums">
            {isAr ? 'مرتجعات:' : 'Returns:'} {formatMoney(metrics.returnsTotal, lang)}
          </div>
        </div>
      </div>

      {/* Sub-Tabs & Filters */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start overflow-x-auto">
          {(
            [
              ['ledger', t.salesLedgerTab],
              ['analytics', t.salesAnalyticsTab],
              ['customers', t.customersTab],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === key
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'ledger' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  isAr ? 'ابحث برقم الفاتورة أو العميل...' : 'Search invoice # or customer...'
                }
                className="ps-9 pe-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-56"
              />
            </div>

            <select
              value={periodFilter}
              onChange={(e) => setPeriodFilter(e.target.value as PeriodFilter)}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="all">{isAr ? 'كل الفترات' : 'All Periods'}</option>
              <option value="today">{isAr ? 'اليوم' : 'Today'}</option>
              <option value="7d">{isAr ? 'آخر 7 أيام' : 'Last 7 Days'}</option>
              <option value="month">{isAr ? 'هذا الشهر' : 'This Month'}</option>
            </select>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as 'all' | '388' | '381')}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="all">{isAr ? 'كل العمليات' : 'All Types'}</option>
              <option value="388">{isAr ? 'فواتير بيع (388)' : 'Sales (388)'}</option>
              <option value="381">{isAr ? 'مرتجعات (381)' : 'Credit Notes (381)'}</option>
            </select>

            <select
              value={paymentFilter}
              onChange={(e) => setPaymentFilter(e.target.value as 'all' | PaymentMethod)}
              className="px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
            >
              <option value="all">{isAr ? 'كل طرق الدفع' : 'All Payments'}</option>
              <option value="cash">{t.cash}</option>
              <option value="card">{t.card}</option>
              <option value="split">{t.split}</option>
            </select>
          </div>
        )}

        {tab === 'customers' && (
          <div className="relative self-start">
            <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
            <input
              type="text"
              value={customerSearch}
              onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder={
                isAr ? 'ابحث باسم العميل أو الجوال أو الرقم الضريبي...' : 'Search customers...'
              }
              className="ps-9 pe-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-64"
            />
          </div>
        )}
      </div>

      {/* Tab 1: Sales Ledger */}
      {tab === 'ledger' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'رقم الفاتورة' : 'Invoice #'}
                </th>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'العميل والنوع' : 'Customer & Profile'}
                </th>
                <th className="py-3 px-4 text-center font-medium">
                  {isAr ? 'الأصناف' : 'Items'}
                </th>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'طريقة الدفع' : 'Payment'}
                </th>
                <th className="py-3 px-4 text-end font-medium">
                  {isAr ? 'الصافي' : 'Subtotal'}
                </th>
                <th className="py-3 px-4 text-end font-medium">
                  {isAr ? 'الضريبة' : 'VAT'}
                </th>
                <th className="py-3 px-4 text-end font-medium">
                  {isAr ? 'الإجمالي' : 'Grand Total'}
                </th>
                <th className="py-3 px-4 text-end font-medium">{t.actionsCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ledgerPagination.pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    {isAr ? 'لا توجد فواتير مبيعات مطابقة' : 'No matching sales invoices'}
                  </td>
                </tr>
              ) : (
                ledgerPagination.pagedItems.map((inv) => {
                  const isCredit = inv.invoice_type_code === '381';
                  const returnedBy = returnedByMap.get(inv.invoice_number);
                  const itemCount = (inv.items ?? []).reduce((s, it) => s + it.qty, 0);
                  const payLabel =
                    inv.payment_method === 'card'
                      ? t.card
                      : inv.payment_method === 'split'
                      ? t.split
                      : t.cash;

                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-slate-900 dark:text-white">
                          {inv.invoice_number}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                          {formatDateTime(inv.created_at, lang)}
                        </div>
                        {isCredit ? (
                          <div className="text-[11px] font-medium text-amber-700 dark:text-amber-400 mt-0.5">
                            {isAr
                              ? `مرتجع للفاتورة ${inv.related_invoice_number ?? ''}`
                              : `Return for ${inv.related_invoice_number ?? ''}`}
                          </div>
                        ) : returnedBy ? (
                          <div className="text-[11px] font-medium text-red-600 dark:text-red-400 mt-0.5">
                            {isAr ? `تم الإرجاع (${returnedBy})` : `Returned (${returnedBy})`}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {inv.customer_name}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                          {inv.invoice_subtype === '0100000'
                            ? t.b2bStandard
                            : t.b2cSimplified}
                          {inv.customer_vat && (
                            <>
                              {' · '}
                              <span className="font-mono tabular-nums">{inv.customer_vat}</span>
                            </>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {itemCount}
                      </td>
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300">
                        <div>{payLabel}</div>
                        {inv.payment_method === 'split' && (
                          <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                            {inv.cash_amount.toFixed(0)} / {inv.card_amount.toFixed(0)}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatMoney(inv.subtotal, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatMoney(inv.vat_total, lang)}
                      </td>
                      <td
                        className={`py-3 px-4 text-end font-mono font-bold tabular-nums ${
                          isCredit
                            ? 'text-amber-700 dark:text-amber-400'
                            : 'text-slate-900 dark:text-white'
                        }`}
                      >
                        {isCredit ? '-' : ''}
                        {formatMoney(inv.grand_total, lang)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setSelectedInvoice(inv)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            {isAr ? 'التفاصيل' : 'Details'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenReceipt(inv)}
                            title={t.printBtn}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-medium whitespace-nowrap"
                          >
                            <Printer className="w-3.5 h-3.5" />
                            {isAr ? 'طباعة' : 'Print'}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleCopyLink(inv)}
                            title={isAr ? 'نسخ رابط الفاتورة العام' : 'Copy Public URL'}
                            className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            {copiedId === inv.id ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                          {inv.invoice_type_code === '388' && !returnedBy && (
                            <button
                              type="button"
                              disabled={issuingCreditId === inv.id}
                              onClick={() => void handleIssueReturn(inv.id)}
                              title={t.creditNoteBtn}
                              className="p-1.5 rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
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
            currentPage={ledgerPagination.currentPage}
            totalPages={ledgerPagination.totalPages}
            totalItems={ledgerPagination.totalItems}
            startItem={ledgerPagination.startItem}
            endItem={ledgerPagination.endItem}
            onPageChange={ledgerPagination.setPage}
          />
        </div>
      )}

      {/* Tab 2: Analytics & Top Products */}
      {tab === 'analytics' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* Payment Mix & Channel Share */}
            <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {isAr ? 'توزيع التحصيل حسب طرق الدفع' : 'Payment Channel Breakdown'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {isAr
                    ? 'مقارنة المبالغ النقدية ومبيعات الشبكة (مدى) بعد خصم المرتجعات'
                    : 'Net cash vs card collections after credit notes'}
                </p>
              </div>

              <div className="space-y-3 pt-1">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {t.cash} ({cashSharePct}%)
                    </span>
                    <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                      {formatMoney(metrics.cashTotal, lang)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-700 dark:bg-emerald-500 transition-all"
                      style={{ width: `${cashSharePct}%` }}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs tabular-nums">
                    <span className="font-medium text-slate-700 dark:text-slate-200">
                      {t.card} ({100 - cashSharePct}%)
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {formatMoney(metrics.cardTotal, lang)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-slate-800 dark:bg-slate-300 transition-all"
                      style={{ width: `${100 - cashSharePct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Daily Sales Summary */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {isAr ? 'ملخص المبيعات اليومية' : 'Daily Sales Summary'}
                </h2>
              </div>
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2.5 px-4 text-start font-medium">
                      {isAr ? 'التاريخ' : 'Date'}
                    </th>
                    <th className="py-2.5 px-4 text-center font-medium">
                      {isAr ? 'فواتير البيع' : 'Sales'}
                    </th>
                    <th className="py-2.5 px-4 text-center font-medium">
                      {isAr ? 'المرتجعات' : 'Returns'}
                    </th>
                    <th className="py-2.5 px-4 text-end font-medium">
                      {isAr ? 'الضريبة' : 'VAT'}
                    </th>
                    <th className="py-2.5 px-4 text-end font-medium">
                      {isAr ? 'صافي المبيعات' : 'Net Sales'}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {dailyPagination.pagedItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        {isAr ? 'لا توجد مبيعات مسجلة بعد' : 'No sales recorded yet'}
                      </td>
                    </tr>
                  ) : (
                    dailyPagination.pagedItems.map((d) => (
                      <tr key={d.date} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-4 font-mono tabular-nums font-medium">
                          {d.date}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono tabular-nums">
                          {d.salesCount}
                        </td>
                        <td className="py-2.5 px-4 text-center font-mono tabular-nums text-amber-600 dark:text-amber-400">
                          {d.returnsCount}
                        </td>
                        <td className="py-2.5 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {formatMoney(d.netVat, lang)}
                        </td>
                        <td className="py-2.5 px-4 text-end font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                          {formatMoney(d.netSales, lang)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <TablePagination
                lang={lang}
                currentPage={dailyPagination.currentPage}
                totalPages={dailyPagination.totalPages}
                totalItems={dailyPagination.totalItems}
                startItem={dailyPagination.startItem}
                endItem={dailyPagination.endItem}
                onPageChange={dailyPagination.setPage}
              />
            </div>
          </div>

          {/* Top Products & Profit Margin Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr
                  ? 'الأصناف الأكثر مبيعاً وربحية (صافي بعد المرتجعات)'
                  : 'Top Selling Products & Gross Margins'}
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                {analytics.topProducts.length} {isAr ? 'صنف' : 'SKUs'}
              </span>
            </div>
            <table className="w-full text-xs text-start">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3 px-4 text-start font-medium">{t.skuCol}</th>
                  <th className="py-3 px-4 text-start font-medium">{t.productCol}</th>
                  <th className="py-3 px-4 text-center font-medium">
                    {isAr ? 'الكمية المباعة' : 'Net Qty'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'المبيعات (قبل الضريبة)' : 'Net Revenue'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'تكلفة البضاعة' : 'COGS'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'مجمل الربح' : 'Gross Profit'}
                  </th>
                  <th className="py-3 px-4 text-end font-medium">
                    {isAr ? 'الهامش %' : 'Margin %'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {topProductsPagination.pagedItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-10 text-center text-slate-400">
                      {isAr ? 'لا توجد بيانات مبيعات للأصناف بعد' : 'No product sales data yet'}
                    </td>
                  </tr>
                ) : (
                  topProductsPagination.pagedItems.map((item) => (
                    <tr
                      key={item.product_id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <td className="py-3 px-4 font-mono text-slate-500">{item.sku}</td>
                      <td className="py-3 px-4 font-semibold text-slate-900 dark:text-white">
                        {isAr ? item.name_ar : item.name_en}
                      </td>
                      <td className="py-3 px-4 text-center font-mono tabular-nums">
                        {item.netQty}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums">
                        {formatMoney(item.netRevenueExVat, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-500">
                        {formatMoney(item.netCogs, lang)}
                      </td>
                      <td
                        className={`py-3 px-4 text-end font-mono font-bold tabular-nums ${
                          item.profit >= 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {formatMoney(item.profit, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums font-semibold">
                        {item.margin}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <TablePagination
              lang={lang}
              currentPage={topProductsPagination.currentPage}
              totalPages={topProductsPagination.totalPages}
              totalItems={topProductsPagination.totalItems}
              startItem={topProductsPagination.startItem}
              endItem={topProductsPagination.endItem}
              onPageChange={topProductsPagination.setPage}
            />
          </div>
        </div>
      )}

      {/* Tab 3: Customers Directory */}
      {tab === 'customers' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'اسم العميل / المنشأة' : 'Customer Name'}
                </th>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'الرقم الضريبي' : 'VAT Number'}
                </th>
                <th className="py-3 px-4 text-start font-medium">
                  {isAr ? 'الجوال والعنوان' : 'Phone & Address'}
                </th>
                <th className="py-3 px-4 text-center font-medium">
                  {isAr ? 'عدد الفواتير' : 'Orders'}
                </th>
                <th className="py-3 px-4 text-end font-medium">
                  {isAr ? 'إجمالي المشتريات' : 'Total Spent'}
                </th>
                <th className="py-3 px-4 text-end font-medium">{t.actionsCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {customersPagination.pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400">
                    {isAr ? 'لا يوجد عملاء مطابقون' : 'No matching customers'}
                  </td>
                </tr>
              ) : (
                customersPagination.pagedItems.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {isAr ? c.name_ar : c.name_en}
                      </div>
                      {c.cr_number && (
                        <div className="text-[11px] font-mono text-slate-400">
                          CR: {c.cr_number}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {c.vat_number || '—'}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      <div className="font-mono tabular-nums">{c.phone || '—'}</div>
                      {c.address_ar && (
                        <div className="text-[11px] text-slate-400 truncate max-w-xs">
                          {c.address_ar}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-mono tabular-nums">
                      {c.count}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(c.netTotal, lang)}
                    </td>
                    <td className="py-3 px-4 text-end">
                      <button
                        type="button"
                        onClick={() => openEditCustomer(c)}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                        {t.editAction}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          <TablePagination
            lang={lang}
            currentPage={customersPagination.currentPage}
            totalPages={customersPagination.totalPages}
            totalItems={customersPagination.totalItems}
            startItem={customersPagination.startItem}
            endItem={customersPagination.endItem}
            onPageChange={customersPagination.setPage}
          />
        </div>
      )}

      {/* Modal 1: New Sales Invoice (Back-office Builder) */}
      {showNewSale && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmitSale}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl p-6 space-y-5 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t.newSaleBtn}
              </h3>
              <button type="button" onClick={() => setShowNewSale(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">{t.invoiceType}</label>
                <select
                  value={saleSubtype}
                  onChange={(e) => {
                    const next = e.target.value as InvoiceSubtype;
                    setSaleSubtype(next);
                    if (next === '0100000' && !saleCustomerId && customers[0]) {
                      setSaleCustomerId(customers[0].id);
                    }
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="0200000">{t.b2cSimplified}</option>
                  <option value="0100000">{t.b2bStandard}</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-slate-500">
                    {isAr ? 'العميل' : 'Customer'}
                  </label>
                  <button
                    type="button"
                    onClick={openAddCustomer}
                    className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                  >
                    {t.addCustomer}
                  </button>
                </div>
                <select
                  required={saleSubtype === '0100000'}
                  value={saleCustomerId}
                  onChange={(e) =>
                    setSaleCustomerId(e.target.value ? Number(e.target.value) : '')
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  {saleSubtype === '0200000' && (
                    <option value="">
                      {isAr ? 'عميل نقدي مباشر' : 'Walk-in Cash Customer'}
                    </option>
                  )}
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isAr ? c.name_ar : c.name_en}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">{t.paymentMethod}</label>
                <select
                  value={salePaymentMethod}
                  onChange={(e) => setSalePaymentMethod(e.target.value as PaymentMethod)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="cash">{t.cash}</option>
                  <option value="card">{t.card}</option>
                  <option value="split">{t.split}</option>
                </select>
              </div>
            </div>

            {salePaymentMethod === 'split' && (
              <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-xs">
                <span>{isAr ? 'المبلغ النقدي المدفوع (والباقي شبكة):' : 'Cash Portion (Remainder Card):'}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  max={draftTotals.grandTotal}
                  value={saleCashAmount}
                  onChange={(e) => setSaleCashAmount(e.target.value)}
                  className="w-32 text-end font-mono px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                />
              </div>
            )}

            {/* Product Picker */}
            <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3">
              <select
                value={pickerProductId}
                onChange={(e) => setPickerProductId(Number(e.target.value))}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id} disabled={p.stock_qty <= 0}>
                    {isAr ? p.name_ar : p.name_en} ({p.sku}) — {formatMoney(p.sell_price, lang)}{' '}
                    [{isAr ? 'متوفر:' : 'Stock:'} {p.stock_qty}]
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleAddDraftLine}
                className="inline-flex items-center gap-1 px-3.5 py-2 text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg whitespace-nowrap shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                {isAr ? 'إضافة صنف' : 'Add Item'}
              </button>
            </div>

            {/* Draft Sale Lines */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t.productCol}</th>
                    <th className="py-2.5 px-3 text-center">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'سعر الوحدة' : 'Unit Price'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الضريبة' : 'VAT'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الإجمالي' : 'Total'}</th>
                    <th className="py-2.5 px-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {draftLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        {isAr ? 'أضف الأصناف لإنشاء فاتورة المبيعات' : 'Add items to build invoice'}
                      </td>
                    </tr>
                  ) : (
                    draftLines.map((line) => {
                      const lSub = line.qty * line.sell_price;
                      const lVat = lSub * (line.tax_rate / 100);
                      return (
                        <tr key={line.product_id}>
                          <td className="py-2.5 px-3 font-medium">
                            {isAr ? line.name_ar : line.name_en}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              min="1"
                              max={line.max_stock}
                              value={line.qty}
                              onChange={(e) => {
                                const val = Math.min(
                                  line.max_stock,
                                  Math.max(1, Math.floor(Number(e.target.value) || 1))
                                );
                                setDraftLines((prev) =>
                                  prev.map((x) =>
                                    x.product_id === line.product_id ? { ...x, qty: val } : x
                                  )
                                );
                              }}
                              className="w-20 text-center font-mono px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 tabular-nums"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono tabular-nums">
                            {line.sell_price.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono tabular-nums text-slate-500">
                            {lVat.toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono font-bold tabular-nums">
                            {(lSub + lVat).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-3 text-end">
                            <button
                              type="button"
                              onClick={() =>
                                setDraftLines((prev) =>
                                  prev.filter((x) => x.product_id !== line.product_id)
                                )
                              }
                              className="text-slate-400 hover:text-red-600"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <label className="text-slate-500">{t.discount}</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={saleDiscount}
                  onChange={(e) => setSaleDiscount(e.target.value)}
                  className="w-28 text-end font-mono px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="flex flex-wrap items-center gap-4 tabular-nums">
                <div>
                  <span className="text-slate-500 me-1">{isAr ? 'الربح:' : 'Profit:'}</span>
                  <span className="font-mono font-semibold text-slate-900 dark:text-white">
                    {formatMoney(draftTotals.estProfit, lang)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 me-1">{isAr ? 'الضريبة:' : 'VAT:'}</span>
                  <span className="font-mono font-semibold">{formatMoney(draftTotals.vat, lang)}</span>
                </div>
                <div className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                  <span className="me-1">{isAr ? 'الإجمالي:' : 'Total:'}</span>
                  <span className="font-mono">{formatMoney(draftTotals.grandTotal, lang)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowNewSale(false)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submittingSale || draftLines.length === 0}
                className="px-5 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg"
              >
                {submittingSale
                  ? t.processing
                  : isAr
                  ? 'اعتماد وإصدار فاتورة المبيعات'
                  : 'Issue Sales Invoice'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal 2: Invoice Details Drawer/Modal */}
      {selectedInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-4 border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold font-mono text-slate-900 dark:text-white">
                  {selectedInvoice.invoice_number}
                </h3>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {selectedInvoice.customer_name} · {formatDateTime(selectedInvoice.created_at, lang)}
                </div>
              </div>
              <button type="button" onClick={() => setSelectedInvoice(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t.productCol}</th>
                    <th className="py-2.5 px-3 text-center">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'السعر' : 'Price'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الضريبة' : 'VAT'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedInvoice.items ?? []).map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-2.5 px-3 font-medium">
                        {isAr ? item.name_ar : item.name_en}
                        <div className="text-[11px] font-mono text-slate-400">{item.sku}</div>
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums">
                        {item.qty}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono tabular-nums">
                        {item.unit_price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono tabular-nums text-slate-500">
                        {item.line_vat.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono font-semibold tabular-nums">
                        {item.line_total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800 tabular-nums">
              <span>
                {isAr ? 'نقدي:' : 'Cash:'}{' '}
                <strong className="font-mono">{formatMoney(selectedInvoice.cash_amount, lang)}</strong>
              </span>
              <span>
                {isAr ? 'شبكة:' : 'Card:'}{' '}
                <strong className="font-mono">{formatMoney(selectedInvoice.card_amount, lang)}</strong>
              </span>
              <span>
                {isAr ? 'الإجمالي:' : 'Total:'}{' '}
                <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                  {formatMoney(selectedInvoice.grand_total, lang)}
                </strong>
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <a
                  href={`/i/${encodeURIComponent(selectedInvoice.uuid)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  {isAr ? 'الرابط العام' : 'Public URL'}
                </a>
                {selectedInvoice.invoice_type_code === '388' &&
                  !returnedByMap.get(selectedInvoice.invoice_number) && (
                    <button
                      type="button"
                      disabled={issuingCreditId === selectedInvoice.id}
                      onClick={() => void handleIssueReturn(selectedInvoice.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/40 whitespace-nowrap"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      {t.creditNoteBtn}
                    </button>
                  )}
              </div>

              <button
                type="button"
                onClick={() => {
                  const target = selectedInvoice;
                  setSelectedInvoice(null);
                  onOpenReceipt(target);
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg whitespace-nowrap"
              >
                <Printer className="w-3.5 h-3.5" />
                {isAr ? 'طباعة حرارية' : 'Thermal Print'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Add / Edit Customer */}
      {showCustomerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveCustomer}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {editingCustomer
                  ? isAr
                    ? 'تعديل بيانات العميل'
                    : 'Edit Customer'
                  : t.newCustomerBtn}
              </h3>
              <button type="button" onClick={() => setShowCustomerModal(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم العميل (عربي)' : 'Customer Name (AR)'}
                </label>
                <input
                  required
                  type="text"
                  value={customerForm.name_ar}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, name_ar: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم العميل (إنجليزي)' : 'Customer Name (EN)'}
                </label>
                <input
                  type="text"
                  value={customerForm.name_en}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, name_en: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الرقم الضريبي' : 'VAT Number'}
                </label>
                <input
                  type="text"
                  value={customerForm.vat_number}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, vat_number: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'السجل التجاري' : 'CR Number'}
                </label>
                <input
                  type="text"
                  value={customerForm.cr_number}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, cr_number: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'رقم الجوال' : 'Phone'}
                </label>
                <input
                  type="text"
                  value={customerForm.phone}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, phone: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'العنوان' : 'Address'}
                </label>
                <input
                  type="text"
                  value={customerForm.address_ar}
                  onChange={(e) =>
                    setCustomerForm({ ...customerForm, address_ar: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowCustomerModal(false)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submittingCustomer}
                className="px-5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg"
              >
                {isAr ? 'حفظ العميل' : 'Save Customer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
