import { useMemo, useState } from 'react';
import {
  Building2,
  Eye,
  FilePlus2,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import type {
  Language,
  Product,
  Purchase,
  PurchasePaymentStatus,
  Supplier,
} from '../types';
import { formatDateTime, formatMoney, translations } from '../i18n';
import { TablePagination, useTablePagination } from './TablePagination';

interface PurchasesViewProps {
  lang: Language;
  products: Product[];
  suppliers: Supplier[];
  purchases: Purchase[];
  pageSize?: number;
  onCreatePurchase: (payload: {
    supplier_id: number;
    supplier_invoice_no: string;
    payment_status: PurchasePaymentStatus;
    paid_amount: number;
    notes: string;
    items: Array<{ product_id: number; qty: number; unit_cost: number; tax_rate: number }>;
  }) => Promise<void>;
  onPayPurchase: (purchaseId: number, amount: number) => Promise<void>;
  onCreateSupplier: (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    phone: string;
    email: string;
    address_ar: string;
  }) => Promise<number>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

interface DraftPurchaseLine {
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  qty: number;
  unit_cost: number;
  tax_rate: number;
}

export function PurchasesView({
  lang,
  products,
  suppliers,
  purchases,
  pageSize = 10,
  onCreatePurchase,
  onPayPurchase,
  onCreateSupplier,
  onNotify,
}: PurchasesViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [tab, setTab] = useState<'invoices' | 'suppliers'>('invoices');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | PurchasePaymentStatus>('all');

  const [showNewPurchase, setShowNewPurchase] = useState(false);
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [selectedPurchase, setSelectedPurchase] = useState<Purchase | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // New purchase form state
  const [supplierId, setSupplierId] = useState<number>(suppliers[0]?.id ?? 0);
  const [supplierInvNo, setSupplierInvNo] = useState('');
  const [paymentStatus, setPaymentStatus] = useState<PurchasePaymentStatus>('paid');
  const [partialPaid, setPartialPaid] = useState('0');
  const [notes, setNotes] = useState('');
  const [draftLines, setDraftLines] = useState<DraftPurchaseLine[]>([]);
  const [pickerProductId, setPickerProductId] = useState<number>(products[0]?.id ?? 0);

  // New supplier form state
  const [supplierForm, setSupplierForm] = useState({
    name_ar: '',
    name_en: '',
    vat_number: '',
    cr_number: '',
    phone: '',
    email: '',
    address_ar: '',
  });

  const stats = useMemo(() => {
    const totalAmount = purchases.reduce((sum, p) => sum + p.grand_total, 0);
    const totalInputVat = purchases.reduce((sum, p) => sum + p.vat_total, 0);
    const totalPayables = purchases.reduce(
      (sum, p) => sum + Math.max(0, p.grand_total - p.paid_amount),
      0
    );
    return {
      totalAmount,
      totalInputVat,
      totalPayables,
      suppliersCount: suppliers.length,
    };
  }, [purchases, suppliers]);

  const filteredPurchases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return purchases.filter((p) => {
      if (statusFilter !== 'all' && p.payment_status !== statusFilter) return false;
      if (!q) return true;
      return (
        p.purchase_number.toLowerCase().includes(q) ||
        p.supplier_name.toLowerCase().includes(q) ||
        p.supplier_invoice_no.toLowerCase().includes(q)
      );
    });
  }, [purchases, search, statusFilter]);

  const purchasesPagination = useTablePagination(
    filteredPurchases,
    pageSize,
    `${search}|${statusFilter}`
  );
  const suppliersPagination = useTablePagination(suppliers, pageSize);

  const draftTotals = useMemo(() => {
    const subtotal = draftLines.reduce((s, l) => s + l.qty * l.unit_cost, 0);
    const vat = draftLines.reduce(
      (s, l) => s + l.qty * l.unit_cost * (l.tax_rate / 100),
      0
    );
    return {
      subtotal: Number(subtotal.toFixed(2)),
      vat: Number(vat.toFixed(2)),
      grandTotal: Number((subtotal + vat).toFixed(2)),
    };
  }, [draftLines]);

  const openNewPurchaseModal = () => {
    if (!supplierId && suppliers.length > 0) {
      setSupplierId(suppliers[0].id);
    }
    if (!pickerProductId && products.length > 0) {
      setPickerProductId(products[0].id);
    }
    setDraftLines([]);
    setSupplierInvNo('');
    setNotes('');
    setPaymentStatus('paid');
    setPartialPaid('0');
    setShowNewPurchase(true);
  };

  const handleAddDraftLine = () => {
    const prod = products.find((p) => p.id === pickerProductId);
    if (!prod) return;
    setDraftLines((prev) => {
      const existing = prev.find((l) => l.product_id === prod.id);
      if (existing) {
        return prev.map((l) =>
          l.product_id === prod.id ? { ...l, qty: l.qty + 10 } : l
        );
      }
      return [
        ...prev,
        {
          product_id: prod.id,
          sku: prod.sku,
          name_ar: prod.name_ar,
          name_en: prod.name_en,
          qty: 10,
          unit_cost: prod.cost_price ?? 0,
          tax_rate: prod.tax_rate,
        },
      ];
    });
  };

  const updateDraftLine = (
    productId: number,
    field: 'qty' | 'unit_cost' | 'tax_rate',
    value: number
  ) => {
    setDraftLines((prev) =>
      prev.map((l) => (l.product_id === productId ? { ...l, [field]: value } : l))
    );
  };

  const handleSubmitPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId || draftLines.length === 0) {
      onNotify(
        isAr
          ? 'اختر المورد وأضف صنفاً واحداً على الأقل'
          : 'Select a supplier and add at least one item',
        'error'
      );
      return;
    }

    setSubmitting(true);
    try {
      await onCreatePurchase({
        supplier_id: supplierId,
        supplier_invoice_no: supplierInvNo,
        payment_status: paymentStatus,
        paid_amount: Number(partialPaid) || 0,
        notes,
        items: draftLines.map((l) => ({
          product_id: l.product_id,
          qty: Math.max(1, Math.floor(l.qty)),
          unit_cost: Math.max(0, l.unit_cost),
          tax_rate: l.tax_rate,
        })),
      });
      setShowNewPurchase(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name_ar.trim()) return;
    const newId = await onCreateSupplier(supplierForm);
    if (newId) setSupplierId(newId);
    setShowNewSupplier(false);
    setSupplierForm({
      name_ar: '',
      name_en: '',
      vat_number: '',
      cr_number: '',
      phone: '',
      email: '',
      address_ar: '',
    });
  };

  const handleSettlePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPurchase) return;
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return;
    await onPayPurchase(selectedPurchase.id, amt);
    setSelectedPurchase(null);
    setPayAmount('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.purTitle}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t.purSubtitle}</p>
        </div>

        <div className="flex items-center gap-2 self-start">
          <button
            type="button"
            onClick={() => setShowNewSupplier(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Building2 className="w-4 h-4" />
            {t.newSupplierBtn}
          </button>
          <button
            type="button"
            onClick={openNewPurchaseModal}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <FilePlus2 className="w-4 h-4" />
            {t.newPurchaseBtn}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.totalPurchasesMetric}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {formatMoney(stats.totalAmount, lang)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.inputVatMetric}</div>
          <div className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-400 mt-1 tabular-nums">
            {formatMoney(stats.totalInputVat, lang)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.payablesMetric}</div>
          <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {formatMoney(stats.totalPayables, lang)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.suppliersCountMetric}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {stats.suppliersCount}
          </div>
        </div>
      </div>

      {/* Tabs & Filters */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('invoices')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'invoices'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.purchasesTab}
          </button>
          <button
            type="button"
            onClick={() => setTab('suppliers')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'suppliers'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.suppliersTab}
          </button>
        </div>

        {tab === 'invoices' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? 'ابحث برقم أمر الشراء أو المورد...' : 'Search PO # or supplier...'}
                className="ps-9 pe-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-60"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
              {(['all', 'paid', 'credit', 'partial'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(st)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    statusFilter === st
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {st === 'all'
                    ? t.filterAll
                    : st === 'paid'
                    ? t.paidLabel
                    : st === 'credit'
                    ? t.creditLabel
                    : t.partialLabel}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Tables */}
      {tab === 'invoices' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'رقم أمر الشراء' : 'PO #'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'المورد' : 'Supplier'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'مرجع المورد' : 'Supplier Inv #'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'الضريبة' : 'VAT'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'الإجمالي' : 'Grand Total'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'المتبقي' : 'Balance Due'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'الحالة' : 'Status'}</th>
                <th className="py-3 px-4 text-end font-medium">{t.actionsCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {purchasesPagination.pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    {isAr ? 'لا توجد فواتير مشتريات مطابقة' : 'No matching purchase invoices'}
                  </td>
                </tr>
              ) : (
                purchasesPagination.pagedItems.map((po) => {
                  const due = Math.max(0, Number((po.grand_total - po.paid_amount).toFixed(2)));
                  return (
                    <tr
                      key={po.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3 px-4">
                        <div className="font-mono font-bold text-slate-900 dark:text-white">
                          {po.purchase_number}
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                          {formatDateTime(po.created_at, lang)}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 dark:text-white">
                          {po.supplier_name}
                        </div>
                        {po.supplier_vat && (
                          <div className="text-[11px] font-mono text-slate-400">
                            {po.supplier_vat}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300">
                        {po.supplier_invoice_no || '—'}
                      </td>
                      <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                        {formatMoney(po.vat_total, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-slate-900 dark:text-white">
                        {formatMoney(po.grand_total, lang)}
                      </td>
                      <td className="py-3 px-4 text-end font-mono font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                        {formatMoney(due, lang)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`font-semibold ${
                            po.payment_status === 'paid'
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : po.payment_status === 'credit'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-amber-600 dark:text-amber-400'
                          }`}
                        >
                          {po.payment_status === 'paid'
                            ? t.paidLabel
                            : po.payment_status === 'credit'
                            ? t.creditLabel
                            : t.partialLabel}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-end">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPurchase(po);
                            setPayAmount(due > 0 ? due.toFixed(2) : '');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          {isAr ? 'التفاصيل' : 'Details'}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <TablePagination
            lang={lang}
            currentPage={purchasesPagination.currentPage}
            totalPages={purchasesPagination.totalPages}
            totalItems={purchasesPagination.totalItems}
            startItem={purchasesPagination.startItem}
            endItem={purchasesPagination.endItem}
            onPageChange={purchasesPagination.setPage}
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'اسم المورد' : 'Supplier Name'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'الرقم الضريبي' : 'VAT Number'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'السجل التجاري' : 'CR Number'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'الهاتف' : 'Phone'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'العنوان' : 'Address'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'إجمالي التوريدات' : 'Total Supplied'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {suppliersPagination.pagedItems.map((s) => {
                const supplied = purchases
                  .filter((p) => p.supplier_id === s.id)
                  .reduce((sum, p) => sum + p.grand_total, 0);
                return (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {isAr ? s.name_ar : s.name_en}
                      </div>
                      <div className="text-[11px] text-slate-400">{s.email}</div>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums">{s.vat_number || '—'}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">{s.cr_number || '—'}</td>
                    <td className="py-3 px-4 font-mono tabular-nums">{s.phone || '—'}</td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {s.address_ar || '—'}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                      {formatMoney(supplied, lang)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <TablePagination
            lang={lang}
            currentPage={suppliersPagination.currentPage}
            totalPages={suppliersPagination.totalPages}
            totalItems={suppliersPagination.totalItems}
            startItem={suppliersPagination.startItem}
            endItem={suppliersPagination.endItem}
            onPageChange={suppliersPagination.setPage}
          />
        </div>
      )}

      {/* New Purchase Invoice Modal */}
      {showNewPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 overflow-y-auto">
          <form
            onSubmit={handleSubmitPurchase}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-3xl p-6 space-y-5 max-h-[92vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold">{t.newPurchaseBtn}</h3>
              <button type="button" onClick={() => setShowNewPurchase(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'المورد' : 'Supplier'}
                </label>
                <select
                  required
                  value={supplierId}
                  onChange={(e) => setSupplierId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {isAr ? s.name_ar : s.name_en}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'رقم فاتورة المورد' : 'Supplier Invoice #'}
                </label>
                <input
                  type="text"
                  value={supplierInvNo}
                  onChange={(e) => setSupplierInvNo(e.target.value)}
                  placeholder="SUP-2026-001"
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'حالة السداد' : 'Payment Status'}
                </label>
                <select
                  value={paymentStatus}
                  onChange={(e) =>
                    setPaymentStatus(e.target.value as PurchasePaymentStatus)
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="paid">{t.paidLabel}</option>
                  <option value="credit">{t.creditLabel}</option>
                  <option value="partial">{t.partialLabel}</option>
                </select>
              </div>
            </div>

            {paymentStatus === 'partial' && (
              <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 text-xs">
                <span>{isAr ? 'المبلغ المدفوع مقدماً (ر.س):' : 'Initial Paid Amount:'}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={partialPaid}
                  onChange={(e) => setPartialPaid(e.target.value)}
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
                  <option key={p.id} value={p.id}>
                    {isAr ? p.name_ar : p.name_en} ({p.sku}) — {isAr ? 'المخزون:' : 'Stock:'}{' '}
                    {p.stock_qty}
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

            {/* Draft Lines Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t.productCol}</th>
                    <th className="py-2.5 px-3 text-center">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'تكلفة الوحدة' : 'Unit Cost'}</th>
                    <th className="py-2.5 px-3 text-center">{isAr ? 'الضريبة %' : 'VAT %'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الإجمالي' : 'Total'}</th>
                    <th className="py-2.5 px-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {draftLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        {isAr ? 'أضف الأصناف المستلمة لتسجيل فاتورة الشراء' : 'Add received products above'}
                      </td>
                    </tr>
                  ) : (
                    draftLines.map((line) => {
                      const lTotal =
                        line.qty * line.unit_cost * (1 + line.tax_rate / 100);
                      return (
                        <tr key={line.product_id}>
                          <td className="py-2.5 px-3 font-medium">
                            {isAr ? line.name_ar : line.name_en}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              min="1"
                              value={line.qty}
                              onChange={(e) =>
                                updateDraftLine(
                                  line.product_id,
                                  'qty',
                                  Math.max(1, Number(e.target.value))
                                )
                              }
                              className="w-20 text-center font-mono px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 tabular-nums"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-end">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.unit_cost}
                              onChange={(e) =>
                                updateDraftLine(
                                  line.product_id,
                                  'unit_cost',
                                  Math.max(0, Number(e.target.value))
                                )
                              }
                              className="w-24 text-end font-mono px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 tabular-nums"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <select
                              value={line.tax_rate}
                              onChange={(e) =>
                                updateDraftLine(
                                  line.product_id,
                                  'tax_rate',
                                  Number(e.target.value)
                                )
                              }
                              className="font-mono px-2 py-1 rounded border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                            >
                              <option value={15}>15%</option>
                              <option value={0}>0%</option>
                            </select>
                          </td>
                          <td className="py-2.5 px-3 text-end font-mono font-bold tabular-nums">
                            {lTotal.toFixed(2)}
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

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={isAr ? 'ملاحظات التوريد (اختياري)...' : 'Delivery notes (optional)...'}
                className="flex-1 text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
              />
              <div className="flex items-center gap-5 text-xs tabular-nums">
                <div>
                  <span className="text-slate-500 me-1">{isAr ? 'الصافي:' : 'Sub:'}</span>
                  <span className="font-mono font-semibold">{formatMoney(draftTotals.subtotal, lang)}</span>
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
                onClick={() => setShowNewPurchase(false)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                disabled={submitting || draftLines.length === 0}
                className="px-5 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white rounded-lg"
              >
                {isAr
                  ? 'اعتماد فاتورة الشراء وتوريد المخزون'
                  : 'Save Purchase & Restock Inventory'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Purchase Invoice Details & Payment Settlement Modal */}
      {selectedPurchase && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold font-mono">{selectedPurchase.purchase_number}</h3>
                <div className="text-xs text-slate-500">{selectedPurchase.supplier_name}</div>
              </div>
              <button type="button" onClick={() => setSelectedPurchase(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
              <table className="w-full text-xs text-start">
                <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <tr>
                    <th className="py-2.5 px-3 text-start">{t.productCol}</th>
                    <th className="py-2.5 px-3 text-center">{isAr ? 'الكمية' : 'Qty'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'التكلفة' : 'Unit Cost'}</th>
                    <th className="py-2.5 px-3 text-end">{isAr ? 'الإجمالي' : 'Total'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(selectedPurchase.items ?? []).map((item, i) => (
                    <tr key={i}>
                      <td className="py-2.5 px-3 font-medium">
                        {isAr ? item.name_ar : item.name_en}
                      </td>
                      <td className="py-2.5 px-3 text-center font-mono tabular-nums">{item.qty}</td>
                      <td className="py-2.5 px-3 text-end font-mono tabular-nums">
                        {item.unit_cost.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3 text-end font-mono font-semibold tabular-nums">
                        {item.line_total.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap justify-between gap-3 text-xs pt-2 border-t border-slate-200 dark:border-slate-800 tabular-nums">
              <span>
                {isAr ? 'الإجمالي:' : 'Total:'}{' '}
                <strong className="font-mono">{formatMoney(selectedPurchase.grand_total, lang)}</strong>
              </span>
              <span>
                {isAr ? 'المدفوع:' : 'Paid:'}{' '}
                <strong className="font-mono text-emerald-700 dark:text-emerald-400">
                  {formatMoney(selectedPurchase.paid_amount, lang)}
                </strong>
              </span>
              <span>
                {isAr ? 'المتبقي:' : 'Due:'}{' '}
                <strong className="font-mono text-amber-600 dark:text-amber-400">
                  {formatMoney(
                    Math.max(0, selectedPurchase.grand_total - selectedPurchase.paid_amount),
                    lang
                  )}
                </strong>
              </span>
            </div>

            {selectedPurchase.payment_status !== 'paid' && (
              <form
                onSubmit={handleSettlePayment}
                className="flex items-center justify-between gap-3 pt-3 border-t border-slate-200 dark:border-slate-800"
              >
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <WalletCards className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
                  <span>{t.settlePayment}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    required
                    type="number"
                    step="0.01"
                    min="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="w-32 text-end text-xs font-mono px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                  <button
                    type="submit"
                    className="px-4 py-1.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
                  >
                    {isAr ? 'تأكيد السداد' : 'Pay'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* New Supplier Modal */}
      {showNewSupplier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveSupplier}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold">{t.newSupplierBtn}</h3>
              <button type="button" onClick={() => setShowNewSupplier(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم المورد (عربي)' : 'Name (AR)'}
                </label>
                <input
                  required
                  type="text"
                  value={supplierForm.name_ar}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, name_ar: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'اسم المورد (إنجليزي)' : 'Name (EN)'}
                </label>
                <input
                  type="text"
                  value={supplierForm.name_en}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, name_en: e.target.value })
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
                  value={supplierForm.vat_number}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, vat_number: e.target.value })
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
                  value={supplierForm.cr_number}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, cr_number: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'رقم الهاتف' : 'Phone'}
                </label>
                <input
                  type="text"
                  value={supplierForm.phone}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, phone: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'البريد الإلكتروني' : 'Email'}
                </label>
                <input
                  type="email"
                  value={supplierForm.email}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, email: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'العنوان' : 'Address'}
                </label>
                <input
                  type="text"
                  value={supplierForm.address_ar}
                  onChange={(e) =>
                    setSupplierForm({ ...supplierForm, address_ar: e.target.value })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowNewSupplier(false)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
              >
                {isAr ? 'حفظ المورد' : 'Save Supplier'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
