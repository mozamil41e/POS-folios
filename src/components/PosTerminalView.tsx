import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  CreditCard,
  Minus,
  PauseCircle,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  UserPlus,
  Wallet,
} from 'lucide-react';
import type {
  Customer,
  HeldCart,
  InvoiceSubtype,
  Language,
  PaymentMethod,
  Product,
} from '../types';
import { formatMoney, translations } from '../i18n';

export interface CartLine {
  product: Product;
  qty: number;
}

interface PosTerminalViewProps {
  lang: Language;
  products: Product[];
  customers: Customer[];
  heldCarts: HeldCart[];
  onCheckout: (payload: {
    items: Array<{ product_id: number; qty: number }>;
    invoice_subtype: InvoiceSubtype;
    payment_method: PaymentMethod;
    cash_amount: number;
    discount_total: number;
    customer_id: number | null;
  }) => Promise<void>;
  onHoldCart: (payload: {
    label: string;
    items: Array<{ product_id: number; qty: number }>;
    discount: number;
    customer_id: number | null;
    invoice_subtype: InvoiceSubtype;
  }) => Promise<void>;
  onDeleteHeldCart: (id: number) => Promise<void>;
  onCreateCustomer: (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    address_ar: string;
    phone: string;
  }) => Promise<number>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function PosTerminalView({
  lang,
  products,
  customers,
  heldCarts,
  onCheckout,
  onHoldCart,
  onDeleteHeldCart,
  onCreateCustomer,
  onNotify,
}: PosTerminalViewProps) {
  const t = translations[lang];
  const isAr = lang === 'ar';
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [barcodeInput, setBarcodeInput] = useState('');
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [invoiceSubtype, setInvoiceSubtype] = useState<InvoiceSubtype>('0200000');
  const [customerId, setCustomerId] = useState<number | null>(
    customers[0]?.id ?? null
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [discountInput, setDiscountInput] = useState<string>('0');
  const [submitting, setSubmitting] = useState(false);
  const [showHeldDrawer, setShowHeldDrawer] = useState(false);
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name_ar: '',
    name_en: '',
    vat_number: '',
    cr_number: '',
    address_ar: '',
    phone: '',
  });

  // Keyboard shortcut F2 to focus barcode input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, { ar: string; en: string }>();
    for (const p of products) {
      if (!map.has(p.category_ar)) {
        map.set(p.category_ar, { ar: p.category_ar, en: p.category_en });
      }
    }
    return Array.from(map.entries()).map(([key, val]) => ({
      key,
      label: isAr ? val.ar : val.en,
    }));
  }, [products, isAr]);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const catMatch =
        selectedCategory === 'all' || p.category_ar === selectedCategory;
      if (!catMatch) return false;
      if (!q) return true;
      return (
        p.name_ar.toLowerCase().includes(q) ||
        p.name_en.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q) ||
        p.category_ar.toLowerCase().includes(q)
      );
    });
  }, [products, search, selectedCategory]);

  const addProductToCart = (product: Product) => {
    if (product.stock_qty <= 0) {
      onNotify(
        isAr
          ? `الصنف "${product.name_ar}" غير متوفر في المخزون`
          : `"${product.name_en}" is out of stock`,
        'error'
      );
      return;
    }

    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        if (existing.qty + 1 > product.stock_qty) {
          onNotify(
            isAr
              ? `الحد الأقصى المتوفر في المخزون هو ${product.stock_qty}`
              : `Maximum available stock is ${product.stock_qty}`,
            'error'
          );
          return prev;
        }
        return prev.map((l) =>
          l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l
        );
      }
      return [...prev, { product, qty: 1 }];
    });
  };

  const updateCartQty = (productId: number, delta: number) => {
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.product.id !== productId) return line;
          const nextQty = line.qty + delta;
          if (nextQty <= 0) return null;
          if (nextQty > line.product.stock_qty) {
            onNotify(
              isAr
                ? `المخزون المتاح ${line.product.stock_qty} فقط`
                : `Only ${line.product.stock_qty} available in stock`,
              'error'
            );
            return line;
          }
          return { ...line, qty: nextQty };
        })
        .filter((x): x is CartLine => x !== null)
    );
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;
    const match = products.find((p) => p.sku === code);
    if (match) {
      addProductToCart(match);
      setBarcodeInput('');
    } else {
      onNotify(
        isAr ? `لم يتم العثور على باركود: ${code}` : `Barcode not found: ${code}`,
        'error'
      );
    }
  };

  const totals = useMemo(() => {
    const rawSubtotal = cart.reduce(
      (sum, line) => sum + line.product.sell_price * line.qty,
      0
    );
    const rawVat = cart.reduce(
      (sum, line) =>
        sum + line.product.sell_price * line.qty * (line.product.tax_rate / 100),
      0
    );
    const discount = Math.min(
      rawSubtotal,
      Math.max(0, Number(discountInput) || 0)
    );
    const ratio = rawSubtotal > 0 ? (rawSubtotal - discount) / rawSubtotal : 1;
    const subtotal = Number((rawSubtotal - discount).toFixed(2));
    const vat = Number((rawVat * ratio).toFixed(2));
    const grandTotal = Number((subtotal + vat).toFixed(2));

    return { subtotal, discount, vat, grandTotal };
  }, [cart, discountInput]);

  const cashReceivedNum = Number(cashTendered) || 0;
  const changeDue =
    paymentMethod === 'cash' && cashReceivedNum > totals.grandTotal
      ? Number((cashReceivedNum - totals.grandTotal).toFixed(2))
      : 0;

  const handleCompleteCheckout = async () => {
    if (cart.length === 0 || submitting) return;
    if (invoiceSubtype === '0100000' && !customerId) {
      onNotify(
        isAr
          ? 'يرجى اختيار عميل مسجل لإصدار الفاتورة الضريبية B2B'
          : 'Select a B2B customer for a Standard Tax Invoice',
        'error'
      );
      return;
    }

    setSubmitting(true);
    try {
      await onCheckout({
        items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty })),
        invoice_subtype: invoiceSubtype,
        payment_method: paymentMethod,
        cash_amount:
          paymentMethod === 'split'
            ? Math.min(totals.grandTotal, Math.max(0, Number(cashTendered) || 0))
            : paymentMethod === 'cash'
            ? totals.grandTotal
            : 0,
        discount_total: totals.discount,
        customer_id: invoiceSubtype === '0100000' ? customerId : null,
      });
      setCart([]);
      setDiscountInput('0');
      setCashTendered('');
    } finally {
      setSubmitting(false);
    }
  };

  const handleHoldCurrentCart = async () => {
    if (cart.length === 0) return;
    await onHoldCart({
      label: isAr
        ? `سلة معلقة (${cart.length} أصناف)`
        : `Held Order (${cart.length} items)`,
      items: cart.map((c) => ({ product_id: c.product.id, qty: c.qty })),
      discount: Number(discountInput) || 0,
      customer_id: customerId,
      invoice_subtype: invoiceSubtype,
    });
    setCart([]);
    setDiscountInput('0');
    onNotify(isAr ? 'تم تعليق الفاتورة بنجاح' : 'Order placed on hold');
  };

  const handleResumeHeldCart = async (hc: HeldCart) => {
    const parsed = JSON.parse(hc.items_json) as Array<{
      product_id: number;
      qty: number;
    }>;
    const restored: CartLine[] = [];
    for (const item of parsed) {
      const prod = products.find((p) => p.id === item.product_id);
      if (prod && prod.stock_qty > 0) {
        restored.push({
          product: prod,
          qty: Math.min(item.qty, prod.stock_qty),
        });
      }
    }
    setCart(restored);
    setDiscountInput(String(hc.discount || 0));
    setInvoiceSubtype(hc.invoice_subtype);
    if (hc.customer_id) setCustomerId(hc.customer_id);
    await onDeleteHeldCart(hc.id);
    setShowHeldDrawer(false);
  };

  const handleSaveNewCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomer.name_ar.trim()) return;
    const id = await onCreateCustomer(newCustomer);
    setCustomerId(id);
    setShowNewCustomer(false);
    setNewCustomer({
      name_ar: '',
      name_en: '',
      vat_number: '',
      cr_number: '',
      address_ar: '',
      phone: '',
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Main Catalog & Scanner Column */}
      <div className="lg:col-span-8 space-y-4">
        {/* Scanner & Search Bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
          <div className="flex flex-col md:flex-row gap-3">
            <form onSubmit={handleBarcodeSubmit} className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Barcode className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
                <input
                  ref={barcodeRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder={t.barcodePlaceholder}
                  className="w-full ps-9 pe-3 py-2.5 text-sm font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
                />
              </div>
              <button
                type="submit"
                className="px-4 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {t.addByBarcode}
              </button>
            </form>

            <div className="relative md:w-64">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t.searchProducts}
                className="w-full ps-9 pe-3 py-2.5 text-sm bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30 focus:border-emerald-700"
              />
            </div>
          </div>

          {/* Category Filter Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                selectedCategory === 'all'
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t.allCategories}
            </button>
            {categories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(cat.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  selectedCategory === cat.key
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>
        </div>

        {/* Product Grid */}
        {filteredProducts.length === 0 ? (
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center">
            <p className="text-sm text-slate-500">
              {isAr ? 'لا توجد أصناف مطابقة للبحث' : 'No matching products found'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredProducts.map((product) => {
              const priceInclVat = Number(
                (product.sell_price * (1 + product.tax_rate / 100)).toFixed(2)
              );
              const isOut = product.stock_qty <= 0;
              const isLow =
                product.stock_qty > 0 &&
                product.stock_qty <= product.min_stock_alert;

              return (
                <button
                  key={product.id}
                  type="button"
                  disabled={isOut}
                  onClick={() => addProductToCart(product)}
                  className={`group text-start bg-white dark:bg-slate-900 border rounded-xl p-3.5 transition-all flex flex-col justify-between min-h-[126px] ${
                    isOut
                      ? 'border-slate-200 dark:border-slate-800 opacity-55 cursor-not-allowed'
                      : 'border-slate-200 dark:border-slate-800 hover:border-emerald-700 dark:hover:border-emerald-500 active:scale-[0.99]'
                  }`}
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="font-mono truncate">{product.sku}</span>
                      <span aria-hidden="true">·</span>
                      <span className="truncate">
                        {isAr ? product.unit_ar : product.unit_en}
                      </span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-snug line-clamp-2">
                      {isAr ? product.name_ar : product.name_en}
                    </h3>
                  </div>

                  <div className="pt-3 mt-2 border-t border-slate-100 dark:border-slate-800 flex items-baseline justify-between gap-2 tabular-nums">
                    <span className="text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                      {formatMoney(priceInclVat, lang)}
                    </span>
                    <span
                      className={`text-[11px] font-medium whitespace-nowrap ${
                        isOut
                          ? 'text-red-600 dark:text-red-400'
                          : isLow
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {isOut
                        ? t.outOfStock
                        : `${product.stock_qty} ${isLow ? `(${t.lowStock})` : ''}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Checkout & Cart Sidebar */}
      <div className="lg:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4 lg:sticky lg:top-20">
        {/* Cart Header */}
        <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-4 h-4 text-emerald-700 dark:text-emerald-400" />
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              {t.currentOrder}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {heldCarts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowHeldDrawer(!showHeldDrawer)}
                className="text-xs font-medium text-amber-700 dark:text-amber-400 hover:underline whitespace-nowrap shrink-0"
              >
                {t.heldOrders} ({heldCarts.length})
              </button>
            )}
            {cart.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleHoldCurrentCart}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white whitespace-nowrap shrink-0"
                >
                  <PauseCircle className="w-3.5 h-3.5" />
                  {t.holdCart}
                </button>
                <button
                  type="button"
                  onClick={() => setCart([])}
                  className="text-xs font-medium text-red-600 dark:text-red-400 hover:underline whitespace-nowrap shrink-0"
                >
                  {t.clearCart}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Held Carts List */}
        {showHeldDrawer && heldCarts.length > 0 && (
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2">
            <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.heldOrders}
            </div>
            {heldCarts.map((hc) => (
              <div
                key={hc.id}
                className="flex items-center justify-between gap-2 text-xs py-1 border-b border-slate-200 dark:border-slate-800 last:border-0"
              >
                <span className="truncate">{hc.label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleResumeHeldCart(hc)}
                    className="text-emerald-700 dark:text-emerald-400 font-semibold hover:underline"
                  >
                    {t.resumeOrder}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteHeldCart(hc.id)}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Invoice Type (B2C vs B2B) */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
            <button
              type="button"
              onClick={() => setInvoiceSubtype('0200000')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                invoiceSubtype === '0200000'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.b2cSimplified}
            </button>
            <button
              type="button"
              onClick={() => setInvoiceSubtype('0100000')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                invoiceSubtype === '0100000'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.b2bStandard}
            </button>
          </div>

          {invoiceSubtype === '0100000' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-2">
                <select
                  value={customerId ?? ''}
                  onChange={(e) => setCustomerId(Number(e.target.value) || null)}
                  className="flex-1 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-2"
                >
                  <option value="">{t.selectCustomer}</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {isAr ? c.name_ar : c.name_en} ({c.vat_number})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(!showNewCustomer)}
                  className="p-2 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  title={t.addCustomer}
                >
                  <UserPlus className="w-4 h-4" />
                </button>
              </div>

              {showNewCustomer && (
                <form
                  onSubmit={handleSaveNewCustomer}
                  className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-3 space-y-2"
                >
                  <input
                    required
                    type="text"
                    placeholder={isAr ? 'اسم المنشأة (عربي)' : 'Company Name (AR)'}
                    value={newCustomer.name_ar}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, name_ar: e.target.value })
                    }
                    className="w-full text-xs px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  />
                  <input
                    required
                    type="text"
                    placeholder={isAr ? 'الرقم الضريبي (15 خانة)' : 'VAT Number (15 digits)'}
                    value={newCustomer.vat_number}
                    onChange={(e) =>
                      setNewCustomer({ ...newCustomer, vat_number: e.target.value })
                    }
                    className="w-full text-xs font-mono px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewCustomer(false)}
                      className="text-xs px-2.5 py-1 text-slate-500"
                    >
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                    <button
                      type="submit"
                      className="text-xs px-3 py-1 bg-emerald-700 text-white rounded font-medium"
                    >
                      {isAr ? 'حفظ' : 'Save'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>

        {/* Cart Line Items */}
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
          {cart.length === 0 ? (
            <div className="py-10 text-center space-y-1">
              <div className="text-sm font-medium text-slate-600 dark:text-slate-300">
                {t.emptyCartTitle}
              </div>
              <p className="text-xs text-slate-400 px-4">{t.emptyCartHint}</p>
            </div>
          ) : (
            cart.map((line) => {
              const lineTotalInclVat =
                line.product.sell_price *
                line.qty *
                (1 + line.product.tax_rate / 100);
              return (
                <div
                  key={line.product.id}
                  className="py-2.5 flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {isAr ? line.product.name_ar : line.product.name_en}
                    </div>
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      {line.product.sell_price.toFixed(2)} × {line.qty}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => updateCartQty(line.product.id, -1)}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Minus className="w-3 h-3" />
                    </button>
                    <span className="w-6 text-center text-xs font-mono font-semibold tabular-nums">
                      {line.qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateCartQty(line.product.id, 1)}
                      className="w-7 h-7 flex items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="text-xs font-mono font-bold text-slate-900 dark:text-white w-20 text-end tabular-nums">
                    {lineTotalInclVat.toFixed(2)}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Discount & Payment Method */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <label className="text-xs text-slate-600 dark:text-slate-400">
              {t.discount}
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={discountInput}
              onChange={(e) => setDiscountInput(e.target.value)}
              className="w-24 text-end text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 tabular-nums"
            />
          </div>

          <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-950 rounded-lg">
            <button
              type="button"
              onClick={() => setPaymentMethod('cash')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                paymentMethod === 'cash'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              {t.cash}
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('card')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md flex items-center justify-center gap-1 transition-colors whitespace-nowrap ${
                paymentMethod === 'card'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              {t.card}
            </button>
            <button
              type="button"
              onClick={() => setPaymentMethod('split')}
              className={`py-1.5 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                paymentMethod === 'split'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400'
              }`}
            >
              {t.split}
            </button>
          </div>

          {(paymentMethod === 'cash' || paymentMethod === 'split') && (
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs text-slate-600 dark:text-slate-400">
                {t.cashPaid}
              </label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder={totals.grandTotal.toFixed(2)}
                value={cashTendered}
                onChange={(e) => setCashTendered(e.target.value)}
                className="w-28 text-end text-xs font-mono px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 tabular-nums"
              />
            </div>
          )}

          {changeDue > 0 && (
            <div className="flex justify-between text-xs font-semibold text-emerald-700 dark:text-emerald-400 tabular-nums">
              <span>{t.changeDue}</span>
              <span className="font-mono">{formatMoney(changeDue, lang)}</span>
            </div>
          )}
        </div>

        {/* Totals Summary */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs tabular-nums">
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <span>{t.subtotal}</span>
            <span className="font-mono">{formatMoney(totals.subtotal, lang)}</span>
          </div>
          <div className="flex justify-between text-slate-500 dark:text-slate-400">
            <span>{t.vatAmount}</span>
            <span className="font-mono">{formatMoney(totals.vat, lang)}</span>
          </div>
          <div className="flex justify-between text-base font-bold text-slate-900 dark:text-white pt-2 border-t border-slate-100 dark:border-slate-800">
            <span>{t.grandTotal}</span>
            <span className="font-mono text-emerald-700 dark:text-emerald-400">
              {formatMoney(totals.grandTotal, lang)}
            </span>
          </div>
        </div>

        <button
          type="button"
          disabled={cart.length === 0 || submitting}
          onClick={handleCompleteCheckout}
          className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 dark:disabled:bg-slate-800 disabled:text-slate-500 text-white text-sm font-semibold rounded-xl transition-colors whitespace-nowrap"
        >
          {submitting ? t.processing : t.checkoutBtn}
        </button>
      </div>
    </div>
  );
}
