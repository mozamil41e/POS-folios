import { useMemo, useState } from 'react';
import { ArrowDownUp, Edit3, PackagePlus, Search, X } from 'lucide-react';
import type { Language, Product, StockMovement } from '../types';
import { formatDateTime, formatMoney, translations } from '../i18n';
import { TablePagination, useTablePagination } from './TablePagination';

interface InventoryViewProps {
  lang: Language;
  products: Product[];
  movements: StockMovement[];
  pageSize?: number;
  onCreateProduct: (payload: Record<string, unknown>) => Promise<void>;
  onUpdateProduct: (id: number, payload: Record<string, unknown>) => Promise<void>;
  onStockMovement: (payload: {
    product_id: number;
    type: 'purchase' | 'adjustment' | 'return';
    qty: number;
    notes: string;
  }) => Promise<void>;
}

export function InventoryView({
  lang,
  products,
  movements,
  pageSize = 10,
  onCreateProduct,
  onUpdateProduct,
  onStockMovement,
}: InventoryViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';

  const [tab, setTab] = useState<'catalog' | 'movements'>('catalog');
  const [search, setSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');

  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [showProductForm, setShowProductForm] = useState(false);
  const [movementTarget, setMovementTarget] = useState<Product | null>(null);
  const [moveType, setMoveType] = useState<'purchase' | 'adjustment' | 'return'>('purchase');
  const [moveQty, setMoveQty] = useState<string>('10');
  const [moveNotes, setMoveNotes] = useState<string>('');

  const [formState, setFormState] = useState({
    sku: '',
    name_ar: '',
    name_en: '',
    category_ar: 'المواد الغذائية',
    category_en: 'Groceries',
    unit_ar: 'حبة',
    unit_en: 'Pcs',
    cost_price: '10',
    sell_price: '13.04',
    tax_rate: '15',
    stock_qty: '25',
    min_stock_alert: '10',
    expiry_date: '',
  });

  const stats = useMemo(() => {
    const totalSkus = products.length;
    const stockCostValue = products.reduce(
      (sum, p) => sum + p.cost_price * p.stock_qty,
      0
    );
    const lowCount = products.filter(
      (p) => p.stock_qty > 0 && p.stock_qty <= p.min_stock_alert
    ).length;
    const outCount = products.filter((p) => p.stock_qty <= 0).length;
    return { totalSkus, stockCostValue, lowCount, outCount };
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (stockFilter === 'low' && !(p.stock_qty > 0 && p.stock_qty <= p.min_stock_alert)) {
        return false;
      }
      if (stockFilter === 'out' && p.stock_qty > 0) {
        return false;
      }
      if (!q) return true;
      return (
        p.name_ar.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q)
      );
    });
  }, [products, search, stockFilter]);

  const catalogPagination = useTablePagination(
    filteredProducts,
    pageSize,
    `${search}|${stockFilter}`
  );
  const movementsPagination = useTablePagination(movements, pageSize);

  const openNewProductModal = () => {
    setEditingProduct(null);
    setFormState({
      sku: `6281007${String(Math.floor(100000 + Math.random() * 899999))}`,
      name_ar: '',
      name_en: '',
      category_ar: 'المواد الغذائية',
      category_en: 'Groceries',
      unit_ar: 'عبوة',
      unit_en: 'Pack',
      cost_price: '10.00',
      sell_price: '13.04',
      tax_rate: '15',
      stock_qty: '25',
      min_stock_alert: '10',
      expiry_date: '',
    });
    setShowProductForm(true);
  };

  const openEditProductModal = (p: Product) => {
    setEditingProduct(p);
    setFormState({
      sku: p.sku,
      name_ar: p.name_ar,
      name_en: p.name_en,
      category_ar: p.category_ar,
      category_en: p.category_en,
      unit_ar: p.unit_ar,
      unit_en: p.unit_en,
      cost_price: String(p.cost_price),
      sell_price: String(p.sell_price),
      tax_rate: String(p.tax_rate),
      stock_qty: String(p.stock_qty),
      min_stock_alert: String(p.min_stock_alert),
      expiry_date: p.expiry_date ?? '',
    });
    setShowProductForm(true);
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      ...formState,
      cost_price: Number(formState.cost_price),
      sell_price: Number(formState.sell_price),
      tax_rate: Number(formState.tax_rate),
      tax_category: Number(formState.tax_rate) === 0 ? 'Z' : 'S',
      stock_qty: Number(formState.stock_qty),
      min_stock_alert: Number(formState.min_stock_alert),
      expiry_date: formState.expiry_date || null,
    };

    if (editingProduct) {
      await onUpdateProduct(editingProduct.id, payload);
    } else {
      await onCreateProduct(payload);
    }
    setShowProductForm(false);
  };

  const handleMovementSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementTarget) return;
    const qty = Number(moveQty);
    if (!qty) return;
    await onStockMovement({
      product_id: movementTarget.id,
      type: moveType,
      qty,
      notes: moveNotes,
    });
    setMovementTarget(null);
    setMoveNotes('');
  };

  return (
    <div className="space-y-6">
      {/* Header & CTA */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t.invTitle}</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{t.invSubtitle}</p>
        </div>
        <button
          type="button"
          onClick={openNewProductModal}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 self-start"
        >
          <PackagePlus className="w-4 h-4" />
          {t.addProduct}
        </button>
      </div>

      {/* Clean Single-Elevation KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl divide-y lg:divide-y-0 lg:divide-x lg:rtl:divide-x-reverse divide-slate-200 dark:divide-slate-800">
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.totalSkus}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {stats.totalSkus}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.inventoryValue}</div>
          <div className="text-2xl font-bold font-mono text-slate-900 dark:text-white mt-1 tabular-nums">
            {formatMoney(stats.stockCostValue, lang)}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.lowStockCount}</div>
          <div className="text-2xl font-bold font-mono text-amber-600 dark:text-amber-400 mt-1 tabular-nums">
            {stats.lowCount}
          </div>
        </div>
        <div className="p-4">
          <div className="text-xs text-slate-500 dark:text-slate-400">{t.outOfStockCount}</div>
          <div className="text-2xl font-bold font-mono text-red-600 dark:text-red-400 mt-1 tabular-nums">
            {stats.outCount}
          </div>
        </div>
      </div>

      {/* Tabs & Filters Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('catalog')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'catalog'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.catalogTab}
          </button>
          <button
            type="button"
            onClick={() => setTab('movements')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === 'movements'
                ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300'
            }`}
          >
            {t.movementsTab}
          </button>
        </div>

        {tab === 'catalog' && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchProducts}
                className="ps-9 pe-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg w-60"
              />
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
              {(['all', 'low', 'out'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setStockFilter(key)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                    stockFilter === key
                      ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  {key === 'all' ? t.filterAll : key === 'low' ? t.filterLow : t.filterOut}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Main Table */}
      {tab === 'catalog' ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">{t.skuCol}</th>
                <th className="py-3 px-4 text-start font-medium">{t.productCol}</th>
                <th className="py-3 px-4 text-start font-medium">{t.categoryCol}</th>
                <th className="py-3 px-4 text-end font-medium">{t.costCol}</th>
                <th className="py-3 px-4 text-end font-medium">{t.priceCol}</th>
                <th className="py-3 px-4 text-end font-medium">{t.stockCol}</th>
                <th className="py-3 px-4 text-start font-medium">{t.statusCol}</th>
                <th className="py-3 px-4 text-end font-medium">{t.actionsCol}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {catalogPagination.pagedItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400">
                    {isAr ? 'لا توجد أصناف مطابقة للبحث' : 'No matching products found'}
                  </td>
                </tr>
              ) : (
                catalogPagination.pagedItems.map((p) => {
                const priceIncl = Number((p.sell_price * (1 + p.tax_rate / 100)).toFixed(2));
                const isOut = p.stock_qty <= 0;
                const isLow = p.stock_qty > 0 && p.stock_qty <= p.min_stock_alert;

                return (
                  <tr
                    key={p.id}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {p.sku}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        {isAr ? p.name_ar : p.name_en}
                      </div>
                      {p.expiry_date && (
                        <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {isAr ? 'انتهاء:' : 'Exp:'} {p.expiry_date}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">
                      {isAr ? p.category_ar : p.category_en}
                    </td>
                    <td className="py-3 px-4 text-end font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {p.cost_price.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-semibold tabular-nums text-slate-900 dark:text-white">
                      {priceIncl.toFixed(2)}
                    </td>
                    <td className="py-3 px-4 text-end font-mono font-bold tabular-nums">
                      {p.stock_qty}
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`font-medium ${
                          isOut
                            ? 'text-red-600 dark:text-red-400'
                            : isLow
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }`}
                      >
                        {isOut ? t.outOfStock : isLow ? t.lowStock : t.available}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-end">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setMovementTarget(p);
                            setMoveType('purchase');
                            setMoveQty('10');
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 whitespace-nowrap"
                        >
                          <ArrowDownUp className="w-3 h-3" />
                          {t.restockAction}
                        </button>
                        <button
                          type="button"
                          onClick={() => openEditProductModal(p)}
                          className="p-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300"
                          title={t.editAction}
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
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
            currentPage={catalogPagination.currentPage}
            totalPages={catalogPagination.totalPages}
            totalItems={catalogPagination.totalItems}
            startItem={catalogPagination.startItem}
            endItem={catalogPagination.endItem}
            onPageChange={catalogPagination.setPage}
          />
        </div>
      ) : (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
          <table className="w-full text-xs text-start">
            <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
              <tr>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'التاريخ' : 'Date'}</th>
                <th className="py-3 px-4 text-start font-medium">{t.productCol}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'نوع الحركة' : 'Type'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'التغير' : 'Delta'}</th>
                <th className="py-3 px-4 text-end font-medium">{isAr ? 'الرصيد بعد' : 'Balance'}</th>
                <th className="py-3 px-4 text-start font-medium">{isAr ? 'المرجع' : 'Reference'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {movementsPagination.pagedItems.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-500">
                    {formatDateTime(m.created_at, lang)}
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                    {isAr ? m.product_name_ar : m.product_name_en}
                    <span className="text-slate-400 font-mono ms-2">{m.sku}</span>
                  </td>
                  <td className="py-3 px-4">
                    {m.type === 'sale'
                      ? isAr ? 'مبيعات POS' : 'POS Sale'
                      : m.type === 'purchase'
                      ? isAr ? 'توريد مشتريات' : 'Purchase'
                      : m.type === 'return'
                      ? isAr ? 'مرتجع' : 'Return'
                      : isAr ? 'تسوية جرد' : 'Adjustment'}
                  </td>
                  <td
                    className={`py-3 px-4 text-end font-mono font-bold tabular-nums ${
                      m.qty_delta > 0
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {m.qty_delta > 0 ? `+${m.qty_delta}` : m.qty_delta}
                  </td>
                  <td className="py-3 px-4 text-end font-mono tabular-nums">
                    {m.balance_after}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-500">
                    {m.reference_no}
                    {m.notes ? ` · ${m.notes}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePagination
            lang={lang}
            currentPage={movementsPagination.currentPage}
            totalPages={movementsPagination.totalPages}
            totalItems={movementsPagination.totalItems}
            startItem={movementsPagination.startItem}
            endItem={movementsPagination.endItem}
            onPageChange={movementsPagination.setPage}
          />
        </div>
      )}

      {/* Add / Edit Product Modal */}
      {showProductForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleSaveProduct}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-xl p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-base font-bold">
                {editingProduct
                  ? isAr ? 'تعديل بيانات الصنف' : 'Edit Product'
                  : isAr ? 'إضافة صنف جديد للمخزون' : 'Add New Product'}
              </h3>
              <button type="button" onClick={() => setShowProductForm(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-500 mb-1">SKU / Barcode</label>
                <input
                  required
                  type="text"
                  value={formState.sku}
                  onChange={(e) => setFormState({ ...formState, sku: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'التصنيف' : 'Category'}
                </label>
                <input
                  required
                  type="text"
                  value={formState.category_ar}
                  onChange={(e) =>
                    setFormState({
                      ...formState,
                      category_ar: e.target.value,
                      category_en: e.target.value,
                    })
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الاسم بالعربية' : 'Arabic Name'}
                </label>
                <input
                  required
                  type="text"
                  value={formState.name_ar}
                  onChange={(e) => setFormState({ ...formState, name_ar: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الاسم بالإنجليزية' : 'English Name'}
                </label>
                <input
                  type="text"
                  value={formState.name_en}
                  onChange={(e) => setFormState({ ...formState, name_en: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'سعر التكلفة' : 'Cost Price'}
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formState.cost_price}
                  onChange={(e) => setFormState({ ...formState, cost_price: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'سعر البيع (قبل الضريبة)' : 'Sell Price (Excl. VAT)'}
                </label>
                <input
                  required
                  type="number"
                  step="0.01"
                  value={formState.sell_price}
                  onChange={(e) => setFormState({ ...formState, sell_price: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              {!editingProduct && (
                <div>
                  <label className="block text-slate-500 mb-1">
                    {isAr ? 'الرصيد الافتتاحي' : 'Initial Stock'}
                  </label>
                  <input
                    required
                    type="number"
                    value={formState.stock_qty}
                    onChange={(e) => setFormState({ ...formState, stock_qty: e.target.value })}
                    className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                  />
                </div>
              )}
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'حد التنبيه الأدنى' : 'Low Stock Alert'}
                </label>
                <input
                  required
                  type="number"
                  value={formState.min_stock_alert}
                  onChange={(e) =>
                    setFormState({ ...formState, min_stock_alert: e.target.value })
                  }
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'نسبة الضريبة %' : 'VAT Rate %'}
                </label>
                <select
                  value={formState.tax_rate}
                  onChange={(e) => setFormState({ ...formState, tax_rate: e.target.value })}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="15">15% (S)</option>
                  <option value="0">0% (Z)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'تاريخ الانتهاء (اختياري)' : 'Expiry Date (Optional)'}
                </label>
                <input
                  type="date"
                  value={formState.expiry_date}
                  onChange={(e) => setFormState({ ...formState, expiry_date: e.target.value })}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setShowProductForm(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-5 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
              >
                {isAr ? 'حفظ الصنف' : 'Save Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Restock / Adjust Modal */}
      {movementTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <form
            onSubmit={handleMovementSubmit}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl w-full max-w-md p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold">
                {isAr ? 'تحديث مخزون:' : 'Adjust Stock:'}{' '}
                {isAr ? movementTarget.name_ar : movementTarget.name_en}
              </h3>
              <button type="button" onClick={() => setMovementTarget(null)}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between text-slate-500">
                <span>{isAr ? 'الرصيد الحالي:' : 'Current Balance:'}</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">
                  {movementTarget.stock_qty}
                </span>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'نوع العملية' : 'Operation Type'}
                </label>
                <select
                  value={moveType}
                  onChange={(e) =>
                    setMoveType(e.target.value as 'purchase' | 'adjustment' | 'return')
                  }
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                >
                  <option value="purchase">{isAr ? 'توريد / فاتورة شراء (+)' : 'Purchase Restock (+)'}</option>
                  <option value="return">{isAr ? 'مرتجع (+)' : 'Customer Return (+)'}</option>
                  <option value="adjustment">{isAr ? 'تسوية جرد (+/-)' : 'Stock Adjustment (+/-)'}</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'الكمية' : 'Quantity'}
                </label>
                <input
                  required
                  type="number"
                  value={moveQty}
                  onChange={(e) => setMoveQty(e.target.value)}
                  className="w-full font-mono px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>

              <div>
                <label className="block text-slate-500 mb-1">
                  {isAr ? 'ملاحظات' : 'Notes'}
                </label>
                <input
                  type="text"
                  value={moveNotes}
                  onChange={(e) => setMoveNotes(e.target.value)}
                  placeholder={isAr ? 'رقم فاتورة المورد أو سبب الجرد...' : 'Supplier invoice # or reason...'}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setMovementTarget(null)}
                className="px-4 py-2 text-xs text-slate-600 dark:text-slate-300"
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg"
              >
                {isAr ? 'تأكيد الحركة' : 'Apply Movement'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
