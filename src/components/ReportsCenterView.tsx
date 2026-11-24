import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Download,
  FileSpreadsheet,
  Package,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  TrendingUp,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import type {
  Customer,
  Invoice,
  Language,
  OrganizationSettings,
  Product,
  Purchase,
  StockMovement,
  Supplier,
  Voucher,
  VoucherChannel,
  VoucherType,
} from '../types';
import { formatDateTime, formatMoney } from '../i18n';
import { TablePagination, useTablePagination } from './TablePagination';

export type ReportCategoryId =
  | 'financial'
  | 'expenses_revenues'
  | 'items'
  | 'customers_suppliers'
  | 'sales'
  | 'returns'
  | 'purchases';

export type ReportId =
  // Financial (8)
  | 'trial_balance'
  | 'financial_position'
  | 'gross_profit'
  | 'net_profit'
  | 'customer_profit'
  | 'drawer_ops'
  | 'balance_sheet'
  | 'vouchers'
  // Expenses & Revenues (2)
  | 'revenues_expenses'
  | 'operating_expenses'
  // Items (7)
  | 'top_selling'
  | 'item_operations'
  | 'product_wastage'
  | 'expiring_products'
  | 'warehouse_stocktake'
  | 'stagnant_items'
  | 'low_stock'
  // Customers & Suppliers (2)
  | 'customers_summary'
  | 'suppliers_payables'
  // Sales (2)
  | 'daily_sales'
  | 'payment_methods'
  // Returns (2)
  | 'sales_returns'
  | 'returned_items'
  // Purchases (2)
  | 'purchases_vat'
  | 'purchases_by_supplier';

interface ReportsCenterViewProps {
  lang: Language;
  settings: OrganizationSettings;
  invoices: Invoice[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: Purchase[];
  movements: StockMovement[];
  vouchers: Voucher[];
  onCreateVoucher: (payload: {
    voucher_type: VoucherType;
    payment_channel: VoucherChannel;
    party_name: string;
    category: string;
    amount: number;
    notes: string;
    voucher_date: string;
  }) => Promise<void>;
  onDeleteVoucher: (id: number) => Promise<void>;
  onStockMovement: (payload: {
    product_id: number;
    type: 'purchase' | 'adjustment' | 'return';
    qty: number;
    notes: string;
    reference_no?: string;
  }) => Promise<void>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

interface ReportColumn {
  key: string;
  label: string;
  align?: 'start' | 'center' | 'end';
  mono?: boolean;
}

interface ReportRow {
  id: string;
  cells: Record<string, string>;
  searchBlob: string;
  voucherId?: number;
  tone?: 'positive' | 'negative' | 'warning';
}

interface ReportKpi {
  label: string;
  value: string;
  tone?: 'emerald' | 'amber' | 'red' | 'slate';
}

interface ReportDataset {
  title: string;
  subtitle: string;
  supportsDateFilter: boolean;
  supportsSearch: boolean;
  supportsVoucherCreate: boolean;
  supportsProductFilter?: boolean;
  supportsExpiryFilter?: boolean;
  supportsWastageCreate?: boolean;
  kpis: ReportKpi[];
  columns: ReportColumn[];
  rows: ReportRow[];
  totals?: Record<string, string>;
}

function escapeHtml(raw: string): string {
  return raw
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function csvEscape(raw: string): string {
  const s = String(raw ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function inDateRange(isoOrDate: string, fromDate: string, toDate: string): boolean {
  const day = isoOrDate.slice(0, 10);
  if (fromDate && day < fromDate) return false;
  if (toDate && day > toDate) return false;
  return true;
}

export function ReportsCenterView({
  lang,
  settings,
  invoices,
  products,
  customers,
  suppliers,
  purchases,
  movements,
  vouchers,
  onCreateVoucher,
  onDeleteVoucher,
  onStockMovement,
  onNotify,
}: ReportsCenterViewProps) {
  const isAr = lang === 'ar';

  const [openCategories, setOpenCategories] = useState<Record<ReportCategoryId, boolean>>({
    financial: true,
    expenses_revenues: false,
    items: true,
    customers_suppliers: false,
    sales: false,
    returns: false,
    purchases: false,
  });

  const [activeReport, setActiveReport] = useState<ReportId | null>(null);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');
  const [selectedProductId, setSelectedProductId] = useState<string>('all');
  const [expiryDaysFilter, setExpiryDaysFilter] = useState<number>(90);
  const [showVoucherModal, setShowVoucherModal] = useState(false);
  const [savingVoucher, setSavingVoucher] = useState(false);
  const [showWastageModal, setShowWastageModal] = useState(false);
  const [savingWastage, setSavingWastage] = useState(false);
  const [wastageForm, setWastageForm] = useState<{
    product_id: string;
    qty: string;
    notes: string;
  }>({
    product_id: products[0] ? String(products[0].id) : '',
    qty: '1',
    notes: '',
  });

  const [voucherForm, setVoucherForm] = useState<{
    voucher_type: VoucherType;
    payment_channel: VoucherChannel;
    party_name: string;
    category: string;
    amount: string;
    notes: string;
    voucher_date: string;
  }>({
    voucher_type: 'receipt',
    payment_channel: 'cash',
    party_name: '',
    category: '',
    amount: '',
    notes: '',
    voucher_date: new Date().toISOString().slice(0, 10),
  });

  const categories = useMemo(
    () => [
      {
        id: 'financial' as ReportCategoryId,
        title: isAr ? 'التقارير المالية' : 'Financial Reports',
        icon: TrendingUp,
        iconBg: 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400',
        reports: [
          {
            id: 'trial_balance' as ReportId,
            label: isAr ? 'تقرير ميزان المراجعة' : 'Trial Balance Report',
          },
          {
            id: 'financial_position' as ReportId,
            label: isAr ? 'الموقف المالي' : 'Financial Position',
          },
          {
            id: 'gross_profit' as ReportId,
            label: isAr ? 'تقرير مجمل الربح' : 'Gross Profit Report',
          },
          {
            id: 'net_profit' as ReportId,
            label: isAr ? 'تقرير صافي الربح عن مدة زمنية' : 'Net Profit Report (Period)',
          },
          {
            id: 'customer_profit' as ReportId,
            label: isAr
              ? 'تقرير أرباح من عملاء خلال فترة زمنية'
              : 'Customer Profit Report (Period)',
          },
          {
            id: 'drawer_ops' as ReportId,
            label: isAr
              ? 'تقرير عمليات درج خلال فترة زمنية'
              : 'Cash Drawer Operations (Period)',
          },
          {
            id: 'balance_sheet' as ReportId,
            label: isAr ? 'تقرير الميزانية' : 'Balance Sheet Report',
          },
          {
            id: 'vouchers' as ReportId,
            label: isAr ? 'تقرير سندات القبض والصرف' : 'Receipt & Payment Vouchers Report',
          },
        ],
      },
      {
        id: 'expenses_revenues' as ReportCategoryId,
        title: isAr ? 'تقارير المصروفات والإيرادات' : 'Expenses & Revenues Reports',
        icon: Wallet,
        iconBg: 'bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-400',
        reports: [
          {
            id: 'revenues_expenses' as ReportId,
            label: isAr
              ? 'تقرير الإيرادات والمصروفات التفصيلي'
              : 'Detailed Revenues & Expenses Statement',
          },
          {
            id: 'operating_expenses' as ReportId,
            label: isAr ? 'تقرير المصروفات التشغيلية' : 'Operating Expenses Report',
          },
        ],
      },
      {
        id: 'items' as ReportCategoryId,
        title: isAr ? 'تقارير الأصناف' : 'Items & Inventory Reports',
        icon: Package,
        iconBg: 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400',
        reports: [
          {
            id: 'top_selling' as ReportId,
            label: isAr ? 'تقرير الأصناف الأكثر مبيعاً' : 'Top Selling Products Report',
          },
          {
            id: 'item_operations' as ReportId,
            label: isAr
              ? 'تقرير عمليات صنف خلال فترة زمنية'
              : 'Product Operations (Period)',
          },
          {
            id: 'product_wastage' as ReportId,
            label: isAr ? 'تقرير إهلاك منتجات' : 'Product Wastage Report',
          },
          {
            id: 'expiring_products' as ReportId,
            label: isAr
              ? 'تقرير أصناف قرب انتهاء صلاحيتها'
              : 'Products Nearing Expiry Report',
          },
          {
            id: 'warehouse_stocktake' as ReportId,
            label: isAr ? 'تقرير جرد المخازن' : 'Warehouse Stocktake Report',
          },
          {
            id: 'stagnant_items' as ReportId,
            label: isAr ? 'تقرير ركود الأصناف' : 'Stagnant Items Report',
          },
          {
            id: 'low_stock' as ReportId,
            label: isAr ? 'تقرير النواقص' : 'Low Stock Shortages Report',
          },
        ],
      },
      {
        id: 'customers_suppliers' as ReportCategoryId,
        title: isAr ? 'تقارير العملاء والموردين' : 'Customers & Suppliers Reports',
        icon: Users,
        iconBg: 'bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-400',
        reports: [
          {
            id: 'customers_summary' as ReportId,
            label: isAr ? 'تقرير مبيعات وكشوفات العملاء' : 'Customers Sales & Statement',
          },
          {
            id: 'suppliers_payables' as ReportId,
            label: isAr ? 'تقرير ذمم ومستحقات الموردين' : 'Suppliers Payables Statement',
          },
        ],
      },
      {
        id: 'sales' as ReportCategoryId,
        title: isAr ? 'تقارير المبيعات' : 'Sales Reports',
        icon: FileSpreadsheet,
        iconBg: 'bg-teal-50 dark:bg-teal-950/50 text-teal-700 dark:text-teal-400',
        reports: [
          {
            id: 'daily_sales' as ReportId,
            label: isAr ? 'تقرير المبيعات اليومي' : 'Daily Sales Summary',
          },
          {
            id: 'payment_methods' as ReportId,
            label: isAr ? 'تقرير المبيعات حسب طرق الدفع' : 'Sales by Payment Method',
          },
        ],
      },
      {
        id: 'returns' as ReportCategoryId,
        title: isAr ? 'تقارير المرتجعات' : 'Returns Reports',
        icon: RotateCcw,
        iconBg: 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400',
        reports: [
          {
            id: 'sales_returns' as ReportId,
            label: isAr ? 'تقرير فواتير المرتجعات' : 'Sales Credit Notes Report',
          },
          {
            id: 'returned_items' as ReportId,
            label: isAr ? 'تقرير الأصناف المرتجعة' : 'Returned Items Breakdown',
          },
        ],
      },
      {
        id: 'purchases' as ReportCategoryId,
        title: isAr ? 'تقارير المشتريات' : 'Purchases Reports',
        icon: ShoppingBag,
        iconBg: 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-400',
        reports: [
          {
            id: 'purchases_vat' as ReportId,
            label: isAr
              ? 'تقرير فواتير المشتريات وضريبة المدخلات'
              : 'Purchase Invoices & Input VAT Report',
          },
          {
            id: 'purchases_by_supplier' as ReportId,
            label: isAr ? 'تقرير المشتريات حسب المورد' : 'Purchases by Supplier Report',
          },
        ],
      },
    ],
    [isAr]
  );

  const productMap = useMemo(() => {
    const map = new Map<number, Product>();
    for (const p of products) map.set(p.id, p);
    return map;
  }, [products]);

  const dataset = useMemo((): ReportDataset | null => {
    if (!activeReport) return null;

    const scopedInvoices = invoices.filter((inv) =>
      inDateRange(inv.created_at, fromDate, toDate)
    );
    const scopedSales = scopedInvoices.filter((i) => i.invoice_type_code === '388');
    const scopedReturns = scopedInvoices.filter((i) => i.invoice_type_code === '381');
    const scopedPurchases = purchases.filter((p) =>
      inDateRange(p.received_at || p.created_at, fromDate, toDate)
    );
    const scopedVouchers = vouchers.filter((v) =>
      inDateRange(v.voucher_date || v.created_at, fromDate, toDate)
    );
    const scopedMovements = movements.filter((m) =>
      inDateRange(m.created_at, fromDate, toDate)
    );

    const calcInvoiceCogs = (inv: Invoice): number =>
      (inv.items ?? []).reduce((sum, item) => {
        const prod = productMap.get(item.product_id);
        return sum + (prod?.cost_price ?? 0) * item.qty;
      }, 0);

    const grossSalesSub = scopedSales.reduce((s, i) => s + i.subtotal, 0);
    const returnsSub = scopedReturns.reduce((s, i) => s + i.subtotal, 0);
    const netSalesSub = grossSalesSub - returnsSub;

    const outputVatSales = scopedSales.reduce((s, i) => s + i.vat_total, 0);
    const outputVatReturns = scopedReturns.reduce((s, i) => s + i.vat_total, 0);
    const netOutputVat = outputVatSales - outputVatReturns;

    const grossCogs = scopedSales.reduce((s, i) => s + calcInvoiceCogs(i), 0);
    const returnedCogs = scopedReturns.reduce((s, i) => s + calcInvoiceCogs(i), 0);
    const netCogs = grossCogs - returnedCogs;
    const grossProfit = netSalesSub - netCogs;

    const receiptVouchers = scopedVouchers.filter((v) => v.voucher_type === 'receipt');
    const paymentVouchers = scopedVouchers.filter((v) => v.voucher_type === 'payment');
    const totalReceipts = receiptVouchers.reduce((s, v) => s + v.amount, 0);
    const totalPayments = paymentVouchers.reduce((s, v) => s + v.amount, 0);

    const purchasesSub = scopedPurchases.reduce((s, p) => s + p.subtotal, 0);
    const purchasesInputVat = scopedPurchases.reduce((s, p) => s + p.vat_total, 0);
    const purchasesGrand = scopedPurchases.reduce((s, p) => s + p.grand_total, 0);
    const purchasesPaid = scopedPurchases.reduce((s, p) => s + p.paid_amount, 0);
    const suppliersPayable = purchasesGrand - purchasesPaid;

    const cashInSales = scopedSales.reduce((s, i) => s + i.cash_amount, 0);
    const cashOutReturns = scopedReturns.reduce((s, i) => s + i.cash_amount, 0);
    const cashInVouchers = receiptVouchers
      .filter((v) => v.payment_channel === 'cash')
      .reduce((s, v) => s + v.amount, 0);
    const cashOutVouchers = paymentVouchers
      .filter((v) => v.payment_channel === 'cash')
      .reduce((s, v) => s + v.amount, 0);
    const cashDrawerNet = cashInSales - cashOutReturns + cashInVouchers - cashOutVouchers;

    const cardInSales = scopedSales.reduce((s, i) => s + i.card_amount, 0);
    const cardOutReturns = scopedReturns.reduce((s, i) => s + i.card_amount, 0);
    const bankInVouchers = receiptVouchers
      .filter((v) => v.payment_channel === 'bank')
      .reduce((s, v) => s + v.amount, 0);
    const bankOutVouchers = paymentVouchers
      .filter((v) => v.payment_channel === 'bank')
      .reduce((s, v) => s + v.amount, 0);
    const bankNet =
      cardInSales - cardOutReturns + bankInVouchers - bankOutVouchers - purchasesPaid;

    const inventoryCostValue = products.reduce(
      (s, p) => s + (p.cost_price ?? 0) * Math.max(0, p.stock_qty),
      0
    );
    const inventoryRetailValue = products.reduce(
      (s, p) => s + p.sell_price * Math.max(0, p.stock_qty),
      0
    );

    const netProfit = grossProfit + totalReceipts - totalPayments;

    const money = (n: number) => formatMoney(n, lang);
    const num = (n: number) => n.toFixed(2);

    switch (activeReport) {
      case 'trial_balance': {
        const accounts: Array<{
          code: string;
          name: string;
          debitMove: number;
          creditMove: number;
        }> = [
          {
            code: '1101',
            name: isAr ? 'الصندوق (درج النقدية)' : 'Cash Drawer',
            debitMove: cashInSales + cashInVouchers,
            creditMove: cashOutReturns + cashOutVouchers,
          },
          {
            code: '1102',
            name: isAr ? 'البنك وحساب مدى / الشبكة' : 'Bank & Mada POS Clearing',
            debitMove: cardInSales + bankInVouchers,
            creditMove: cardOutReturns + bankOutVouchers + purchasesPaid,
          },
          {
            code: '1201',
            name: isAr ? 'ضريبة القيمة المضافة للمدخلات' : 'Input VAT Recoverable',
            debitMove: purchasesInputVat,
            creditMove: 0,
          },
          {
            code: '2101',
            name: isAr ? 'ذمم الموردين الدائنة' : 'Accounts Payable (Suppliers)',
            debitMove: purchasesPaid,
            creditMove: purchasesGrand,
          },
          {
            code: '2201',
            name: isAr ? 'ضريبة القيمة المضافة للمخرجات' : 'Output VAT Payable',
            debitMove: outputVatReturns,
            creditMove: outputVatSales,
          },
          {
            code: '4101',
            name: isAr ? 'إيرادات المبيعات' : 'Sales Revenue',
            debitMove: 0,
            creditMove: grossSalesSub,
          },
          {
            code: '4102',
            name: isAr ? 'مردودات ومرتجعات المبيعات' : 'Sales Returns',
            debitMove: returnsSub,
            creditMove: 0,
          },
          {
            code: '4201',
            name: isAr ? 'إيرادات وسندات قبض أخرى' : 'Other Receipts & Funding',
            debitMove: 0,
            creditMove: totalReceipts,
          },
          {
            code: '5101',
            name: isAr ? 'المشتريات وتكلفة التوريد' : 'Purchases (Excl. VAT)',
            debitMove: purchasesSub,
            creditMove: 0,
          },
          {
            code: '5201',
            name: isAr ? 'المصروفات وسندات الصرف' : 'Operating Expenses & Payments',
            debitMove: totalPayments,
            creditMove: 0,
          },
        ];

        let totalDebitMove = 0;
        let totalCreditMove = 0;
        let totalDebitBal = 0;
        let totalCreditBal = 0;

        const rows: ReportRow[] = accounts.map((acc) => {
          const net = acc.debitMove - acc.creditMove;
          const debitBal = net > 0 ? net : 0;
          const creditBal = net < 0 ? Math.abs(net) : 0;
          totalDebitMove += acc.debitMove;
          totalCreditMove += acc.creditMove;
          totalDebitBal += debitBal;
          totalCreditBal += creditBal;

          return {
            id: acc.code,
            searchBlob: `${acc.code} ${acc.name}`,
            cells: {
              code: acc.code,
              account: acc.name,
              debitMove: num(acc.debitMove),
              creditMove: num(acc.creditMove),
              debitBal: num(debitBal),
              creditBal: num(creditBal),
            },
          };
        });

        const diff = Math.abs(totalDebitBal - totalCreditBal);

        return {
          title: isAr ? 'تقرير ميزان المراجعة' : 'Trial Balance Report',
          subtitle: isAr
            ? 'ملخص الأرصدة المدينة والدائنة لجميع الحسابات وفق قيود المبيعات والمشتريات والسندات'
            : 'Balanced Debit & Credit summary across ledger accounts from sales, purchases, and vouchers',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي الأرصدة المدينة' : 'Total Debit Balance', value: money(totalDebitBal), tone: 'emerald' },
            { label: isAr ? 'إجمالي الأرصدة الدائنة' : 'Total Credit Balance', value: money(totalCreditBal), tone: 'slate' },
            { label: isAr ? 'إجمالي الحركة المدين/الدائن' : 'Period Movement', value: money(totalDebitMove), tone: 'slate' },
            {
              label: isAr ? 'حالة التوازن' : 'Balance Variance',
              value: diff < 0.05 ? (isAr ? 'متزن (0.00)' : 'Balanced (0.00)') : money(diff),
              tone: diff < 0.05 ? 'emerald' : 'red',
            },
          ],
          columns: [
            { key: 'code', label: isAr ? 'رمز الحساب' : 'Code', align: 'start', mono: true },
            { key: 'account', label: isAr ? 'اسم الحساب' : 'Account Name', align: 'start' },
            { key: 'debitMove', label: isAr ? 'حركة مدين' : 'Debit Move', align: 'end', mono: true },
            { key: 'creditMove', label: isAr ? 'حركة دائن' : 'Credit Move', align: 'end', mono: true },
            { key: 'debitBal', label: isAr ? 'رصيد مدين' : 'Debit Balance', align: 'end', mono: true },
            { key: 'creditBal', label: isAr ? 'رصيد دائن' : 'Credit Balance', align: 'end', mono: true },
          ],
          rows,
          totals: {
            code: '',
            account: isAr ? 'الإجمالي العام لميزان المراجعة' : 'Trial Balance Totals',
            debitMove: num(totalDebitMove),
            creditMove: num(totalCreditMove),
            debitBal: num(totalDebitBal),
            creditBal: num(totalCreditBal),
          },
        };
      }

      case 'financial_position': {
        const currentAssets = Math.max(0, cashDrawerNet) + Math.max(0, bankNet) + inventoryCostValue + purchasesInputVat;
        const bankOverdraft = bankNet < 0 ? Math.abs(bankNet) : 0;
        const cashOverdraft = cashDrawerNet < 0 ? Math.abs(cashDrawerNet) : 0;
        const totalLiabilities = suppliersPayable + Math.max(0, netOutputVat) + bankOverdraft + cashOverdraft;
        const netPosition = currentAssets - totalLiabilities;
        const liquidityRatio =
          totalLiabilities > 0 ? (currentAssets / totalLiabilities).toFixed(2) : '∞';

        const positionItems = [
          {
            group: isAr ? 'الأصول المتداولة' : 'Current Assets',
            item: isAr ? 'النقدية في الصندوق (الدرج)' : 'Cash in Drawer',
            amount: cashDrawerNet,
            share: currentAssets > 0 ? `${((Math.max(0, cashDrawerNet) / currentAssets) * 100).toFixed(1)}%` : '0%',
            tone: cashDrawerNet >= 0 ? ('positive' as const) : ('negative' as const),
          },
          {
            group: isAr ? 'الأصول المتداولة' : 'Current Assets',
            item: isAr ? 'رصيد البنك / مدى (صافي التسويات)' : 'Bank & Mada Clearing Balance',
            amount: bankNet,
            share: currentAssets > 0 ? `${((Math.max(0, bankNet) / currentAssets) * 100).toFixed(1)}%` : '0%',
            tone: bankNet >= 0 ? ('positive' as const) : ('warning' as const),
          },
          {
            group: isAr ? 'الأصول المتداولة' : 'Current Assets',
            item: isAr ? 'قيمة المخزون السلعي (بالتكلفة)' : 'Merchandise Inventory (at Cost)',
            amount: inventoryCostValue,
            share: currentAssets > 0 ? `${((inventoryCostValue / currentAssets) * 100).toFixed(1)}%` : '0%',
            tone: 'positive' as const,
          },
          {
            group: isAr ? 'الأصول المتداولة' : 'Current Assets',
            item: isAr ? 'ضريبة المدخلات القابلة للاسترداد' : 'Recoverable Input VAT',
            amount: purchasesInputVat,
            share: currentAssets > 0 ? `${((purchasesInputVat / currentAssets) * 100).toFixed(1)}%` : '0%',
            tone: 'positive' as const,
          },
          {
            group: isAr ? 'الالتزامات المتداولة' : 'Current Liabilities',
            item: isAr ? 'مستحقات وذمم الموردين' : 'Supplier Accounts Payable',
            amount: -suppliersPayable,
            share: totalLiabilities > 0 ? `${((suppliersPayable / totalLiabilities) * 100).toFixed(1)}%` : '0%',
            tone: suppliersPayable > 0 ? ('warning' as const) : undefined,
          },
          {
            group: isAr ? 'الالتزامات المتداولة' : 'Current Liabilities',
            item: isAr ? 'صافي ضريبة المخرجات المستحقة' : 'Net Output VAT Payable',
            amount: -Math.max(0, netOutputVat),
            share: totalLiabilities > 0 ? `${((Math.max(0, netOutputVat) / totalLiabilities) * 100).toFixed(1)}%` : '0%',
            tone: netOutputVat > 0 ? ('warning' as const) : undefined,
          },
        ];

        return {
          title: isAr ? 'الموقف المالي' : 'Financial Position',
          subtitle: isAr
            ? 'تقييم فوري للسيولة النقدية والمخزون مقابل الالتزامات الضريبية ومستحقات الموردين'
            : 'Real-time liquidity, inventory asset value, and short-term payable obligations',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي الأصول المتداولة' : 'Total Current Assets', value: money(currentAssets), tone: 'emerald' },
            { label: isAr ? 'إجمالي الالتزامات' : 'Total Liabilities', value: money(totalLiabilities), tone: 'amber' },
            { label: isAr ? 'صافي الموقف المالي' : 'Net Financial Position', value: money(netPosition), tone: netPosition >= 0 ? 'emerald' : 'red' },
            { label: isAr ? 'نسبة التغطية والسيولة' : 'Current Ratio', value: `${liquidityRatio}x`, tone: 'slate' },
          ],
          columns: [
            { key: 'group', label: isAr ? 'التصنيف' : 'Category', align: 'start' },
            { key: 'item', label: isAr ? 'البند المالي' : 'Financial Line Item', align: 'start' },
            { key: 'share', label: isAr ? 'النسبة من الفئة' : 'Category Share', align: 'center', mono: true },
            { key: 'amount', label: isAr ? 'القيمة' : 'Value', align: 'end', mono: true },
          ],
          rows: positionItems.map((p, idx) => ({
            id: `pos-${idx}`,
            searchBlob: `${p.group} ${p.item}`,
            tone: p.tone,
            cells: {
              group: p.group,
              item: p.item,
              share: p.share,
              amount: money(p.amount),
            },
          })),
          totals: {
            group: '',
            item: isAr ? 'صافي رأس المال العامل والموقف المالي' : 'Net Financial Position',
            share: '',
            amount: money(netPosition),
          },
        };
      }

      case 'gross_profit': {
        const rows: ReportRow[] = scopedInvoices.map((inv) => {
          const sign = inv.invoice_type_code === '381' ? -1 : 1;
          const revenue = inv.subtotal * sign;
          const cogs = calcInvoiceCogs(inv) * sign;
          const gp = revenue - cogs;
          const margin = revenue !== 0 ? (gp / Math.abs(revenue)) * 100 : 0;

          return {
            id: String(inv.id),
            searchBlob: `${inv.invoice_number} ${inv.customer_name}`,
            tone: sign < 0 ? 'warning' : gp >= 0 ? 'positive' : 'negative',
            cells: {
              invNo: inv.invoice_number,
              date: formatDateTime(inv.created_at, lang),
              customer: inv.customer_name,
              revenue: num(revenue),
              cogs: num(cogs),
              gp: num(gp),
              margin: `${margin.toFixed(1)}%`,
            },
          };
        });

        const avgMargin = netSalesSub > 0 ? (grossProfit / netSalesSub) * 100 : 0;

        return {
          title: isAr ? 'تقرير مجمل الربح' : 'Gross Profit Report',
          subtitle: isAr
            ? 'تحليل هامش مجمل الربح لكل فاتورة بعد خصم تكلفة البضاعة المباعة والمرتجعات'
            : 'Invoice-level gross profit and margin analysis net of COGS and credit notes',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'صافي المبيعات (بدون ضريبة)' : 'Net Sales (Excl. VAT)', value: money(netSalesSub), tone: 'slate' },
            { label: isAr ? 'تكلفة البضاعة المباعة' : 'Cost of Goods Sold', value: money(netCogs), tone: 'amber' },
            { label: isAr ? 'مجمل الربح' : 'Gross Profit', value: money(grossProfit), tone: grossProfit >= 0 ? 'emerald' : 'red' },
            { label: isAr ? 'هامش مجمل الربح' : 'Gross Margin %', value: `${avgMargin.toFixed(1)}%`, tone: 'emerald' },
          ],
          columns: [
            { key: 'invNo', label: isAr ? 'رقم الفاتورة' : 'Invoice #', align: 'start', mono: true },
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'customer', label: isAr ? 'العميل' : 'Customer', align: 'start' },
            { key: 'revenue', label: isAr ? 'صافي البيع' : 'Net Revenue', align: 'end', mono: true },
            { key: 'cogs', label: isAr ? 'التكلفة COGS' : 'COGS', align: 'end', mono: true },
            { key: 'gp', label: isAr ? 'مجمل الربح' : 'Gross Profit', align: 'end', mono: true },
            { key: 'margin', label: isAr ? 'الهامش %' : 'Margin %', align: 'end', mono: true },
          ],
          rows,
          totals: {
            invNo: '',
            date: '',
            customer: isAr ? 'إجمالي الفترة' : 'Period Totals',
            revenue: num(netSalesSub),
            cogs: num(netCogs),
            gp: num(grossProfit),
            margin: `${avgMargin.toFixed(1)}%`,
          },
        };
      }

      case 'net_profit': {
        const lines: Array<{
          code: string;
          label: string;
          amount: number;
          percent: string;
          tone?: 'positive' | 'negative' | 'warning';
        }> = [
          {
            code: '01',
            label: isAr ? 'إجمالي المبيعات (بدون ضريبة القيمة المضافة)' : 'Gross Sales Revenue (Excl. VAT)',
            amount: grossSalesSub,
            percent: '100.0%',
            tone: 'positive',
          },
          {
            code: '02',
            label: isAr ? '(-) مرتجعات المبيعات (الإشعارات الدائنة)' : '(-) Sales Returns (Credit Notes)',
            amount: -returnsSub,
            percent: grossSalesSub > 0 ? `-${((returnsSub / grossSalesSub) * 100).toFixed(1)}%` : '0.0%',
            tone: 'warning',
          },
          {
            code: '03',
            label: isAr ? '= صافي إيرادات المبيعات' : '= Net Sales Revenue',
            amount: netSalesSub,
            percent: netSalesSub > 0 ? '100.0%' : '0.0%',
            tone: 'positive',
          },
          {
            code: '04',
            label: isAr ? '(-) تكلفة البضاعة المباعة (COGS)' : '(-) Cost of Goods Sold (COGS)',
            amount: -netCogs,
            percent: netSalesSub > 0 ? `-${((netCogs / netSalesSub) * 100).toFixed(1)}%` : '0.0%',
            tone: 'negative',
          },
          {
            code: '05',
            label: isAr ? '= مجمل الربح التشغيلي' : '= Gross Profit',
            amount: grossProfit,
            percent: netSalesSub > 0 ? `${((grossProfit / netSalesSub) * 100).toFixed(1)}%` : '0.0%',
            tone: grossProfit >= 0 ? 'positive' : 'negative',
          },
          {
            code: '06',
            label: isAr ? '(+) إيرادات أخرى وسندات قبض' : '(+) Other Revenues & Receipt Vouchers',
            amount: totalReceipts,
            percent: netSalesSub > 0 ? `+${((totalReceipts / netSalesSub) * 100).toFixed(1)}%` : '—',
            tone: 'positive',
          },
          {
            code: '07',
            label: isAr ? '(-) مصروفات تشغيلية وسندات صرف' : '(-) Operating Expenses & Payment Vouchers',
            amount: -totalPayments,
            percent: netSalesSub > 0 ? `-${((totalPayments / netSalesSub) * 100).toFixed(1)}%` : '—',
            tone: totalPayments > 0 ? 'negative' : undefined,
          },
          {
            code: '08',
            label: isAr ? '= صافي الربح النهائي للفترة' : '= Net Profit for Period',
            amount: netProfit,
            percent: netSalesSub > 0 ? `${((netProfit / netSalesSub) * 100).toFixed(1)}%` : '—',
            tone: netProfit >= 0 ? 'positive' : 'negative',
          },
        ];

        const netMargin = netSalesSub > 0 ? (netProfit / netSalesSub) * 100 : 0;

        return {
          title: isAr ? 'تقرير صافي الربح عن مدة زمنية' : 'Net Profit Report (Period)',
          subtitle: isAr
            ? 'قائمة الدخل الكاملة للفترة المحددة شاملة صافي المبيعات والتكلفة والمصروفات والإيرادات'
            : 'Complete income statement for the selected period across revenue, COGS, and expenses',
          supportsDateFilter: true,
          supportsSearch: false,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'صافي المبيعات' : 'Net Sales', value: money(netSalesSub), tone: 'slate' },
            { label: isAr ? 'مجمل الربح' : 'Gross Profit', value: money(grossProfit), tone: 'emerald' },
            { label: isAr ? 'المصروفات التشغيلية' : 'Operating Expenses', value: money(totalPayments), tone: 'amber' },
            { label: isAr ? 'صافي الربح للفترة' : 'Net Profit', value: `${money(netProfit)} (${netMargin.toFixed(1)}%)`, tone: netProfit >= 0 ? 'emerald' : 'red' },
          ],
          columns: [
            { key: 'code', label: '#', align: 'center', mono: true },
            { key: 'label', label: isAr ? 'البند المحاسبي (قائمة الدخل)' : 'Income Statement Line', align: 'start' },
            { key: 'percent', label: isAr ? 'النسبة' : '% of Net Sales', align: 'center', mono: true },
            { key: 'amount', label: isAr ? 'المبلغ' : 'Amount', align: 'end', mono: true },
          ],
          rows: lines.map((l) => ({
            id: l.code,
            searchBlob: l.label,
            tone: l.tone,
            cells: {
              code: l.code,
              label: l.label,
              percent: l.percent,
              amount: money(l.amount),
            },
          })),
        };
      }

      case 'customer_profit': {
        const map = new Map<
          string,
          { name: string; count: number; netSales: number; cogs: number; vat: number }
        >();

        for (const inv of scopedInvoices) {
          const sign = inv.invoice_type_code === '381' ? -1 : 1;
          const key = inv.customer_id ? `c-${inv.customer_id}` : `n-${inv.customer_name}`;
          const prev = map.get(key) ?? {
            name: inv.customer_name,
            count: 0,
            netSales: 0,
            cogs: 0,
            vat: 0,
          };
          prev.count += sign > 0 ? 1 : 0;
          prev.netSales += inv.subtotal * sign;
          prev.cogs += calcInvoiceCogs(inv) * sign;
          prev.vat += inv.vat_total * sign;
          map.set(key, prev);
        }

        const list = Array.from(map.entries())
          .map(([id, v]) => ({
            id,
            ...v,
            profit: v.netSales - v.cogs,
          }))
          .sort((a, b) => b.profit - a.profit);

        const topCust = list[0];

        return {
          title: isAr ? 'تقرير أرباح من عملاء خلال فترة زمنية' : 'Customer Profit Report (Period)',
          subtitle: isAr
            ? 'قياس ربحية المبيعات لكل عميل مع التكلفة والهامش خلال الفترة المحددة'
            : 'Profitability and margin contribution segmented by customer within the chosen date range',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'عدد العملاء النشطين' : 'Active Customers', value: String(list.length), tone: 'slate' },
            { label: isAr ? 'إجمالي صافي المبيعات' : 'Total Net Sales', value: money(netSalesSub), tone: 'slate' },
            { label: isAr ? 'إجمالي ربح العملاء' : 'Total Customer Profit', value: money(grossProfit), tone: 'emerald' },
            {
              label: isAr ? 'العميل الأعلى ربحية' : 'Top Profitable Customer',
              value: topCust ? `${topCust.name.slice(0, 18)} (${num(topCust.profit)})` : '—',
              tone: 'emerald',
            },
          ],
          columns: [
            { key: 'name', label: isAr ? 'العميل' : 'Customer', align: 'start' },
            { key: 'count', label: isAr ? 'الفواتير' : 'Invoices', align: 'center', mono: true },
            { key: 'netSales', label: isAr ? 'صافي المبيعات' : 'Net Sales', align: 'end', mono: true },
            { key: 'cogs', label: isAr ? 'التكلفة' : 'Cost (COGS)', align: 'end', mono: true },
            { key: 'profit', label: isAr ? 'الربح' : 'Profit', align: 'end', mono: true },
            { key: 'margin', label: isAr ? 'الهامش %' : 'Margin %', align: 'end', mono: true },
          ],
          rows: list.map((c) => {
            const margin = c.netSales > 0 ? (c.profit / c.netSales) * 100 : 0;
            return {
              id: c.id,
              searchBlob: c.name,
              tone: c.profit >= 0 ? 'positive' : 'negative',
              cells: {
                name: c.name,
                count: String(c.count),
                netSales: num(c.netSales),
                cogs: num(c.cogs),
                profit: num(c.profit),
                margin: `${margin.toFixed(1)}%`,
              },
            };
          }),
          totals: {
            name: isAr ? 'الإجمالي' : 'Totals',
            count: String(scopedSales.length),
            netSales: num(netSalesSub),
            cogs: num(netCogs),
            profit: num(grossProfit),
            margin: netSalesSub > 0 ? `${((grossProfit / netSalesSub) * 100).toFixed(1)}%` : '0.0%',
          },
        };
      }

      case 'drawer_ops': {
        interface DrawerEvent {
          id: string;
          iso: string;
          ref: string;
          opType: string;
          party: string;
          inflow: number;
          outflow: number;
        }
        const events: DrawerEvent[] = [];

        for (const inv of scopedInvoices) {
          if (inv.cash_amount <= 0) continue;
          const isReturn = inv.invoice_type_code === '381';
          events.push({
            id: `inv-${inv.id}`,
            iso: inv.created_at,
            ref: inv.invoice_number,
            opType: isReturn
              ? isAr
                ? 'استرداد مرتجع نقدي'
                : 'Cash Return Refund'
              : isAr
              ? 'قبض مبيعات نقدية'
              : 'Cash POS Sale',
            party: inv.customer_name,
            inflow: isReturn ? 0 : inv.cash_amount,
            outflow: isReturn ? inv.cash_amount : 0,
          });
        }

        for (const v of scopedVouchers) {
          if (v.payment_channel !== 'cash') continue;
          const isReceipt = v.voucher_type === 'receipt';
          events.push({
            id: `vch-${v.id}`,
            iso: v.created_at || `${v.voucher_date}T12:00:00.000Z`,
            ref: v.voucher_number,
            opType: isReceipt
              ? isAr
                ? 'سند قبض (تغذية درج)'
                : 'Cash Receipt Voucher'
              : isAr
              ? 'سند صرف (نقدي من الدرج)'
              : 'Cash Payment Voucher',
            party: v.party_name,
            inflow: isReceipt ? v.amount : 0,
            outflow: isReceipt ? 0 : v.amount,
          });
        }

        events.sort((a, b) => a.iso.localeCompare(b.iso));

        let running = 0;
        const computed = events.map((ev) => {
          running += ev.inflow - ev.outflow;
          return { ...ev, balance: running };
        });
        const totalIn = events.reduce((s, e) => s + e.inflow, 0);
        const totalOut = events.reduce((s, e) => s + e.outflow, 0);

        return {
          title: isAr ? 'تقرير عمليات درج خلال فترة زمنية' : 'Cash Drawer Operations (Period)',
          subtitle: isAr
            ? 'تتبع دقيق لكل حركات الإيداع والسحب النقدي في درج الكاشير مع الرصيد التراكمي'
            : 'Chronological cash drawer inflows, outflows, refunds, and running cash balance',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: true,
          kpis: [
            { label: isAr ? 'إجمالي المقبوضات النقدية' : 'Total Cash Inflows', value: money(totalIn), tone: 'emerald' },
            { label: isAr ? 'إجمالي المصروفات والمرتجعات' : 'Total Cash Outflows', value: money(totalOut), tone: 'amber' },
            { label: isAr ? 'صافي رصيد الدرج' : 'Closing Drawer Balance', value: money(running), tone: running >= 0 ? 'emerald' : 'red' },
            { label: isAr ? 'عدد حركات الدرج' : 'Drawer Operations', value: String(events.length), tone: 'slate' },
          ],
          columns: [
            { key: 'date', label: isAr ? 'التاريخ والوقت' : 'Timestamp', align: 'start', mono: true },
            { key: 'ref', label: isAr ? 'المرجع' : 'Reference', align: 'start', mono: true },
            { key: 'opType', label: isAr ? 'نوع العملية' : 'Operation', align: 'start' },
            { key: 'party', label: isAr ? 'البيان / الطرف' : 'Party / Note', align: 'start' },
            { key: 'inflow', label: isAr ? 'وارد (+)' : 'In (+)', align: 'end', mono: true },
            { key: 'outflow', label: isAr ? 'منصرف (-)' : 'Out (-)', align: 'end', mono: true },
            { key: 'balance', label: isAr ? 'الرصيد التراكمي' : 'Running Balance', align: 'end', mono: true },
          ],
          rows: computed.reverse().map((ev) => ({
            id: ev.id,
            searchBlob: `${ev.ref} ${ev.opType} ${ev.party}`,
            tone: ev.inflow > 0 ? 'positive' : 'warning',
            cells: {
              date: formatDateTime(ev.iso, lang),
              ref: ev.ref,
              opType: ev.opType,
              party: ev.party,
              inflow: ev.inflow > 0 ? num(ev.inflow) : '—',
              outflow: ev.outflow > 0 ? num(ev.outflow) : '—',
              balance: num(ev.balance),
            },
          })),
          totals: {
            date: '',
            ref: '',
            opType: isAr ? 'إجمالي حركات الدرج' : 'Drawer Totals',
            party: '',
            inflow: num(totalIn),
            outflow: num(totalOut),
            balance: num(running),
          },
        };
      }

      case 'balance_sheet': {
        const totalAssets =
          Math.max(0, cashDrawerNet) +
          Math.max(0, bankNet) +
          inventoryCostValue +
          purchasesInputVat;
        const bankOverdraft = bankNet < 0 ? Math.abs(bankNet) : 0;
        const cashOverdraft = cashDrawerNet < 0 ? Math.abs(cashDrawerNet) : 0;
        const totalLiabilities =
          suppliersPayable + Math.max(0, netOutputVat) + bankOverdraft + cashOverdraft;
        const totalEquity = totalAssets - totalLiabilities;
        const retainedBase = totalEquity - netProfit;

        const bsRows = [
          {
            section: isAr ? 'أولاً: الأصول' : 'Assets',
            account: isAr ? 'النقدية بالصندوق (درج الكاشير)' : 'Cash in Drawer',
            amount: Math.max(0, cashDrawerNet),
            tone: 'positive' as const,
          },
          {
            section: isAr ? 'أولاً: الأصول' : 'Assets',
            account: isAr ? 'النقدية بالبنك / شبكة مدى' : 'Bank & POS Terminal',
            amount: Math.max(0, bankNet),
            tone: 'positive' as const,
          },
          {
            section: isAr ? 'أولاً: الأصول' : 'Assets',
            account: isAr ? 'بضاعة آخر المدة (المخزون بالتكلفة)' : 'Ending Inventory (at Cost)',
            amount: inventoryCostValue,
            tone: 'positive' as const,
          },
          {
            section: isAr ? 'أولاً: الأصول' : 'Assets',
            account: isAr ? 'ضريبة مدخلات مستردة' : 'Input VAT Recoverable',
            amount: purchasesInputVat,
            tone: 'positive' as const,
          },
          {
            section: isAr ? 'ثانياً: الالتزامات' : 'Liabilities',
            account: isAr ? 'ذمم الموردين الدائنة' : 'Accounts Payable (Suppliers)',
            amount: suppliersPayable,
            tone: suppliersPayable > 0 ? ('warning' as const) : undefined,
          },
          {
            section: isAr ? 'ثانياً: الالتزامات' : 'Liabilities',
            account: isAr ? 'ضريبة القيمة المضافة المستحقة (مخرجات)' : 'Output VAT Payable',
            amount: Math.max(0, netOutputVat),
            tone: netOutputVat > 0 ? ('warning' as const) : undefined,
          },
          ...(bankOverdraft + cashOverdraft > 0
            ? [
                {
                  section: isAr ? 'ثانياً: الالتزامات' : 'Liabilities',
                  account: isAr ? 'سحب على المكشوف / تسويات خزينة' : 'Treasury Overdraft / Clearing',
                  amount: bankOverdraft + cashOverdraft,
                  tone: 'warning' as const,
                },
              ]
            : []),
          {
            section: isAr ? 'ثالثاً: حقوق الملكية' : "Owner's Equity",
            account: isAr ? 'رأس المال والأرصدة الافتتاحية للمخزون' : 'Opening Capital & Reserves',
            amount: retainedBase,
          },
          {
            section: isAr ? 'ثالثاً: حقوق الملكية' : "Owner's Equity",
            account: isAr ? 'صافي ربح / (خسارة) الفترة' : 'Period Net Profit / (Loss)',
            amount: netProfit,
            tone: netProfit >= 0 ? ('positive' as const) : ('negative' as const),
          },
        ];

        return {
          title: isAr ? 'تقرير الميزانية' : 'Balance Sheet Report',
          subtitle: isAr
            ? 'الميزانية العمومية المهيكلة (الأصول = الالتزامات + حقوق الملكية) بناءً على أرصدة النظام'
            : 'Structured Balance Sheet (Assets = Liabilities + Equity) derived from live system balances',
          supportsDateFilter: false,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي الأصول' : 'Total Assets', value: money(totalAssets), tone: 'emerald' },
            { label: isAr ? 'إجمالي الالتزامات' : 'Total Liabilities', value: money(totalLiabilities), tone: 'amber' },
            { label: isAr ? 'إجمالي حقوق الملكية' : 'Total Equity', value: money(totalEquity), tone: 'slate' },
            {
              label: isAr ? 'توازن المعادلة المحاسبية' : 'Accounting Equation',
              value: money(totalLiabilities + totalEquity),
              tone: 'emerald',
            },
          ],
          columns: [
            { key: 'section', label: isAr ? 'الباب' : 'Section', align: 'start' },
            { key: 'account', label: isAr ? 'البند' : 'Line Item', align: 'start' },
            { key: 'amount', label: isAr ? 'الرصيد' : 'Balance', align: 'end', mono: true },
          ],
          rows: bsRows.map((r, i) => ({
            id: `bs-${i}`,
            searchBlob: `${r.section} ${r.account}`,
            tone: r.tone,
            cells: {
              section: r.section,
              account: r.account,
              amount: money(r.amount),
            },
          })),
          totals: {
            section: '',
            account: isAr
              ? 'إجمالي الأصول = إجمالي الالتزامات وحقوق الملكية'
              : 'Total Assets = Liabilities + Equity',
            amount: money(totalAssets),
          },
        };
      }

      case 'vouchers': {
        return {
          title: isAr ? 'تقرير سندات القبض والصرف' : 'Receipt & Payment Vouchers Report',
          subtitle: isAr
            ? 'سجل كامل لسندات القبض النقدية والبنكية وسندات الصرف والمصروفات مع إمكانية الإضافة الفورية'
            : 'Complete ledger of cash/bank receipt and payment vouchers with instant entry creation',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: true,
          kpis: [
            { label: isAr ? 'إجمالي سندات القبض' : 'Total Receipts', value: money(totalReceipts), tone: 'emerald' },
            { label: isAr ? 'إجمالي سندات الصرف' : 'Total Payments', value: money(totalPayments), tone: 'amber' },
            { label: isAr ? 'صافي السندات' : 'Net Vouchers', value: money(totalReceipts - totalPayments), tone: totalReceipts >= totalPayments ? 'emerald' : 'red' },
            { label: isAr ? 'عدد السندات' : 'Voucher Count', value: String(scopedVouchers.length), tone: 'slate' },
          ],
          columns: [
            { key: 'no', label: isAr ? 'رقم السند' : 'Voucher #', align: 'start', mono: true },
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'type', label: isAr ? 'النوع' : 'Type', align: 'start' },
            { key: 'channel', label: isAr ? 'القناة' : 'Channel', align: 'center' },
            { key: 'party', label: isAr ? 'الجهة / البيان' : 'Party', align: 'start' },
            { key: 'category', label: isAr ? 'التصنيف' : 'Category', align: 'start' },
            { key: 'amount', label: isAr ? 'المبلغ' : 'Amount', align: 'end', mono: true },
          ],
          rows: scopedVouchers.map((v) => ({
            id: `v-${v.id}`,
            voucherId: v.id,
            searchBlob: `${v.voucher_number} ${v.party_name} ${v.category} ${v.notes}`,
            tone: v.voucher_type === 'receipt' ? 'positive' : 'negative',
            cells: {
              no: v.voucher_number,
              date: v.voucher_date,
              type:
                v.voucher_type === 'receipt'
                  ? isAr
                    ? 'سند قبض (+)'
                    : 'Receipt (+)'
                  : isAr
                  ? 'سند صرف (-)'
                  : 'Payment (-)',
              channel:
                v.payment_channel === 'bank'
                  ? isAr
                    ? 'بنك / تحويل'
                    : 'Bank'
                  : isAr
                  ? 'نقدي (الدرج)'
                  : 'Cash',
              party: v.party_name,
              category: v.category,
              amount: num(v.amount),
            },
          })),
          totals: {
            no: '',
            date: '',
            type: isAr ? 'صافي السندات' : 'Net Total',
            channel: '',
            party: '',
            category: '',
            amount: money(totalReceipts - totalPayments),
          },
        };
      }

      case 'revenues_expenses': {
        const revExpRows: ReportRow[] = [
          ...scopedSales.map((s) => ({
            id: `rev-sale-${s.id}`,
            searchBlob: `${s.invoice_number} ${s.customer_name}`,
            tone: 'positive' as const,
            cells: {
              date: s.created_at.slice(0, 10),
              ref: s.invoice_number,
              kind: isAr ? 'إيراد مبيعات' : 'Sales Revenue',
              party: s.customer_name,
              revenue: num(s.subtotal),
              expense: '—',
            },
          })),
          ...receiptVouchers.map((v) => ({
            id: `rev-vch-${v.id}`,
            searchBlob: `${v.voucher_number} ${v.party_name} ${v.category}`,
            tone: 'positive' as const,
            cells: {
              date: v.voucher_date,
              ref: v.voucher_number,
              kind: isAr ? 'إيراد / سند قبض' : 'Receipt Revenue',
              party: v.party_name,
              revenue: num(v.amount),
              expense: '—',
            },
          })),
          ...scopedPurchases.map((p) => ({
            id: `exp-po-${p.id}`,
            searchBlob: `${p.purchase_number} ${p.supplier_name}`,
            tone: 'warning' as const,
            cells: {
              date: (p.received_at || p.created_at).slice(0, 10),
              ref: p.purchase_number,
              kind: isAr ? 'مشتريات مخزون' : 'Inventory Purchase',
              party: p.supplier_name,
              revenue: '—',
              expense: num(p.subtotal),
            },
          })),
          ...paymentVouchers.map((v) => ({
            id: `exp-vch-${v.id}`,
            searchBlob: `${v.voucher_number} ${v.party_name} ${v.category}`,
            tone: 'negative' as const,
            cells: {
              date: v.voucher_date,
              ref: v.voucher_number,
              kind: isAr ? `مصروف: ${v.category}` : `Expense: ${v.category}`,
              party: v.party_name,
              revenue: '—',
              expense: num(v.amount),
            },
          })),
        ].sort((a, b) => b.cells.date.localeCompare(a.cells.date));

        const totalRev = netSalesSub + totalReceipts;
        const totalExp = purchasesSub + totalPayments;

        return {
          title: isAr ? 'تقرير الإيرادات والمصروفات التفصيلي' : 'Detailed Revenues & Expenses Statement',
          subtitle: isAr
            ? 'كشف مقارن لكافة تدفقات الإيرادات مقابل فواتير المشتريات والمصروفات التشغيلية'
            : 'Unified statement comparing sales/receipt inflows against purchases and operating expenses',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: true,
          kpis: [
            { label: isAr ? 'إجمالي الإيرادات' : 'Total Revenues', value: money(totalRev), tone: 'emerald' },
            { label: isAr ? 'المشتريات والمصروفات' : 'Purchases & Expenses', value: money(totalExp), tone: 'amber' },
            { label: isAr ? 'صافي التدفق التشغيلي' : 'Net Operating Cashflow', value: money(totalRev - totalExp), tone: totalRev >= totalExp ? 'emerald' : 'red' },
            { label: isAr ? 'إجمالي الحركات' : 'Entries', value: String(revExpRows.length), tone: 'slate' },
          ],
          columns: [
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'ref', label: isAr ? 'المرجع' : 'Reference', align: 'start', mono: true },
            { key: 'kind', label: isAr ? 'البند' : 'Type', align: 'start' },
            { key: 'party', label: isAr ? 'الطرف / البيان' : 'Party', align: 'start' },
            { key: 'revenue', label: isAr ? 'الإيراد' : 'Revenue', align: 'end', mono: true },
            { key: 'expense', label: isAr ? 'المصروف / الشراء' : 'Expense', align: 'end', mono: true },
          ],
          rows: revExpRows,
          totals: {
            date: '',
            ref: '',
            kind: isAr ? 'الإجمالي' : 'Totals',
            party: '',
            revenue: num(totalRev),
            expense: num(totalExp),
          },
        };
      }

      case 'operating_expenses': {
        return {
          title: isAr ? 'تقرير المصروفات التشغيلية' : 'Operating Expenses Report',
          subtitle: isAr
            ? 'تحليل سندات الصرف والمصروفات الإدارية والتشغيلية خلال الفترة المحددة'
            : 'Breakdown of operating and administrative expense vouchers over the selected period',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: true,
          kpis: [
            { label: isAr ? 'إجمالي المصروفات' : 'Total Expenses', value: money(totalPayments), tone: 'red' },
            { label: isAr ? 'مصروفات نقدية' : 'Cash Expenses', value: money(cashOutVouchers), tone: 'amber' },
            { label: isAr ? 'مصروفات بنكية' : 'Bank Expenses', value: money(bankOutVouchers), tone: 'slate' },
            { label: isAr ? 'عدد سندات الصرف' : 'Expense Vouchers', value: String(paymentVouchers.length), tone: 'slate' },
          ],
          columns: [
            { key: 'no', label: isAr ? 'رقم السند' : 'Voucher #', align: 'start', mono: true },
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'category', label: isAr ? 'بند المصروف' : 'Category', align: 'start' },
            { key: 'party', label: isAr ? 'المستفيد' : 'Beneficiary', align: 'start' },
            { key: 'channel', label: isAr ? 'طريقة الصرف' : 'Channel', align: 'center' },
            { key: 'amount', label: isAr ? 'المبلغ' : 'Amount', align: 'end', mono: true },
          ],
          rows: paymentVouchers.map((v) => ({
            id: `opexp-${v.id}`,
            voucherId: v.id,
            searchBlob: `${v.voucher_number} ${v.category} ${v.party_name} ${v.notes}`,
            tone: 'negative',
            cells: {
              no: v.voucher_number,
              date: v.voucher_date,
              category: v.category,
              party: v.party_name,
              channel: v.payment_channel === 'bank' ? (isAr ? 'بنك' : 'Bank') : isAr ? 'نقدي' : 'Cash',
              amount: num(v.amount),
            },
          })),
          totals: {
            no: '',
            date: '',
            category: isAr ? 'إجمالي المصروفات التشغيلية' : 'Total Operating Expenses',
            party: '',
            channel: '',
            amount: money(totalPayments),
          },
        };
      }

      case 'warehouse_stocktake': {
        const totalUnits = products.reduce((s, p) => s + Math.max(0, p.stock_qty), 0);
        const expectedProfit = inventoryRetailValue - inventoryCostValue;
        return {
          title: isAr ? 'تقرير جرد المخازن' : 'Warehouse Stocktake Report',
          subtitle: isAr
            ? 'كشف الجرد الفعلي لجميع الأصناف بالكميات الحالية وقيمة التكلفة وسعر البيع وتاريخ الصلاحية'
            : 'Complete stocktake sheet with quantities, cost valuation, retail valuation, and expiry dates',
          supportsDateFilter: false,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي الأصناف' : 'Total SKUs', value: String(products.length), tone: 'slate' },
            { label: isAr ? 'إجمالي الوحدات' : 'Total Units', value: String(totalUnits), tone: 'slate' },
            { label: isAr ? 'قيمة الجرد (بالتكلفة)' : 'Stocktake Cost Value', value: money(inventoryCostValue), tone: 'emerald' },
            { label: isAr ? 'الربح المتوقع' : 'Projected Margin', value: money(expectedProfit), tone: 'emerald' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'category', label: isAr ? 'التصنيف' : 'Category', align: 'start' },
            { key: 'unit', label: isAr ? 'الوحدة' : 'Unit', align: 'center' },
            { key: 'qty', label: isAr ? 'الرصيد الدفتري' : 'Stock Qty', align: 'center', mono: true },
            { key: 'cost', label: isAr ? 'التكلفة' : 'Cost', align: 'end', mono: true },
            { key: 'costVal', label: isAr ? 'قيمة الجرد' : 'Cost Value', align: 'end', mono: true },
            { key: 'expiry', label: isAr ? 'الصلاحية' : 'Expiry', align: 'center', mono: true },
          ],
          rows: products.map((p) => ({
            id: `inv-p-${p.id}`,
            searchBlob: `${p.sku} ${p.name_ar} ${p.name_en} ${p.category_ar}`,
            tone: p.stock_qty <= 0 ? 'negative' : p.stock_qty <= p.min_stock_alert ? 'warning' : 'positive',
            cells: {
              sku: p.sku,
              name: isAr ? p.name_ar : p.name_en,
              category: isAr ? p.category_ar : p.category_en,
              unit: isAr ? p.unit_ar : p.unit_en,
              qty: String(p.stock_qty),
              cost: num(p.cost_price ?? 0),
              costVal: num((p.cost_price ?? 0) * p.stock_qty),
              expiry: p.expiry_date || '—',
            },
          })),
          totals: {
            sku: '',
            name: isAr ? 'إجمالي جرد المخازن' : 'Warehouse Totals',
            category: '',
            unit: '',
            qty: String(totalUnits),
            cost: '',
            costVal: num(inventoryCostValue),
            expiry: '',
          },
        };
      }

      case 'item_operations': {
        const productFiltered =
          selectedProductId === 'all'
            ? scopedMovements
            : scopedMovements.filter((m) => String(m.product_id) === selectedProductId);
        const added = productFiltered.filter((m) => m.qty_delta > 0).reduce((s, m) => s + m.qty_delta, 0);
        const deducted = productFiltered.filter((m) => m.qty_delta < 0).reduce((s, m) => s + Math.abs(m.qty_delta), 0);

        const typeLabel = (t: StockMovement['type']) => {
          if (t === 'sale') return isAr ? 'بيع' : 'Sale';
          if (t === 'purchase') return isAr ? 'توريد مشتريات' : 'Purchase';
          if (t === 'return') return isAr ? 'مرتجع' : 'Return';
          return isAr ? 'تسوية / إهلاك' : 'Adjustment';
        };

        return {
          title: isAr ? 'تقرير عمليات صنف خلال فترة زمنية' : 'Product Operations Report (Period)',
          subtitle: isAr
            ? 'كشف تفصيلي لحركات الصنف (مبيعات، مشتريات، مرتجعات، تسويات) خلال الفترة المحددة'
            : 'Detailed item card tracking sales, purchases, returns, and adjustments over a period',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          supportsProductFilter: true,
          kpis: [
            { label: isAr ? 'عدد العمليات' : 'Operations Count', value: String(productFiltered.length), tone: 'slate' },
            { label: isAr ? 'الوارد (+)' : 'Qty In (+)', value: `+${added}`, tone: 'emerald' },
            { label: isAr ? 'المنصرف (-)' : 'Qty Out (-)', value: `-${deducted}`, tone: 'amber' },
            { label: isAr ? 'صافي الحركة' : 'Net Change', value: String(added - deducted), tone: 'slate' },
          ],
          columns: [
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'product', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'type', label: isAr ? 'نوع العملية' : 'Operation', align: 'center' },
            { key: 'delta', label: isAr ? 'الكمية' : 'Delta', align: 'center', mono: true },
            { key: 'after', label: isAr ? 'الرصيد بعد' : 'Balance After', align: 'center', mono: true },
            { key: 'ref', label: isAr ? 'المرجع' : 'Reference', align: 'start', mono: true },
            { key: 'notes', label: isAr ? 'ملاحظات' : 'Notes', align: 'end' },
          ],
          rows: productFiltered.map((m) => ({
            id: `mv-${m.id}`,
            searchBlob: `${m.product_name_ar ?? ''} ${m.product_name_en ?? ''} ${m.sku ?? ''} ${m.reference_no} ${m.notes}`,
            tone: m.qty_delta > 0 ? 'positive' : 'warning',
            cells: {
              date: formatDateTime(m.created_at, lang),
              product: (isAr ? m.product_name_ar : m.product_name_en) || `#${m.product_id}`,
              type: typeLabel(m.type),
              delta: m.qty_delta > 0 ? `+${m.qty_delta}` : String(m.qty_delta),
              after: String(m.balance_after),
              ref: m.reference_no,
              notes: m.notes || '—',
            },
          })),
        };
      }

      case 'product_wastage': {
        const wastageMovements = scopedMovements.filter(
          (m) => m.type === 'adjustment' && m.qty_delta < 0
        );
        let totalWastedUnits = 0;
        let totalLossValue = 0;

        const rows: ReportRow[] = wastageMovements.map((m) => {
          const prod = productMap.get(m.product_id);
          const qty = Math.abs(m.qty_delta);
          const unitCost = prod?.cost_price ?? 0;
          const loss = qty * unitCost;
          totalWastedUnits += qty;
          totalLossValue += loss;

          return {
            id: `wst-${m.id}`,
            searchBlob: `${m.product_name_ar ?? ''} ${m.product_name_en ?? ''} ${m.sku ?? ''} ${m.reference_no} ${m.notes}`,
            tone: 'negative',
            cells: {
              date: formatDateTime(m.created_at, lang),
              ref: m.reference_no,
              sku: m.sku ?? prod?.sku ?? '—',
              product: (isAr ? m.product_name_ar : m.product_name_en) || `#${m.product_id}`,
              qty: String(qty),
              unitCost: num(unitCost),
              loss: num(loss),
              notes: m.notes || '—',
            },
          };
        });

        return {
          title: isAr ? 'تقرير إهلاك منتجات' : 'Product Wastage & Write-Off Report',
          subtitle: isAr
            ? 'حصر المنتجات التالفة والمنتهية وتسويات العجز مع حساب قيمة الخسارة بالتكلفة'
            : 'Track damaged, expired, or written-off inventory units and total cost loss',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          supportsWastageCreate: true,
          kpis: [
            { label: isAr ? 'عمليات الإهلاك' : 'Wastage Entries', value: String(wastageMovements.length), tone: 'slate' },
            { label: isAr ? 'إجمالي الكميات المهلكة' : 'Wasted Units', value: String(totalWastedUnits), tone: 'amber' },
            { label: isAr ? 'خسارة الإهلاك (بالتكلفة)' : 'Cost Loss Value', value: money(totalLossValue), tone: 'red' },
            { label: isAr ? 'نسبة من قيمة المخزون' : '% of Inventory Cost', value: `${inventoryCostValue > 0 ? ((totalLossValue / inventoryCostValue) * 100).toFixed(2) : '0.00'}%`, tone: 'amber' },
          ],
          columns: [
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'ref', label: isAr ? 'المرجع' : 'Ref #', align: 'start', mono: true },
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'product', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'qty', label: isAr ? 'الكمية المهلكة' : 'Wasted Qty', align: 'center', mono: true },
            { key: 'unitCost', label: isAr ? 'تكلفة الوحدة' : 'Unit Cost', align: 'end', mono: true },
            { key: 'loss', label: isAr ? 'قيمة الخسارة' : 'Cost Loss', align: 'end', mono: true },
            { key: 'notes', label: isAr ? 'السبب / ملاحظات' : 'Reason', align: 'end' },
          ],
          rows,
          totals: {
            date: '',
            ref: '',
            sku: '',
            product: isAr ? 'إجمالي الإهلاك' : 'Wastage Totals',
            qty: String(totalWastedUnits),
            unitCost: '',
            loss: num(totalLossValue),
            notes: '',
          },
        };
      }

      case 'expiring_products': {
        const nowMs = Date.now();
        const withExpiry = products
          .filter((p) => Boolean(p.expiry_date))
          .map((p) => {
            const expMs = new Date(`${p.expiry_date}T00:00:00`).getTime();
            const daysLeft = Math.ceil((expMs - nowMs) / 86_400_000);
            return { p, daysLeft };
          })
          .filter((x) => x.daysLeft <= expiryDaysFilter)
          .sort((a, b) => a.daysLeft - b.daysLeft);

        const expiredCount = withExpiry.filter((x) => x.daysLeft <= 0).length;
        const criticalCount = withExpiry.filter((x) => x.daysLeft > 0 && x.daysLeft <= 14).length;
        const atRiskValue = withExpiry.reduce((s, x) => s + x.p.stock_qty * (x.p.cost_price ?? 0), 0);

        return {
          title: isAr ? 'تقرير أصناف قرب انتهاء صلاحيتها' : 'Products Nearing Expiry Report',
          subtitle: isAr
            ? 'مراقبة تواريخ انتهاء الصلاحية للأصناف المتوفرة لتجنب التلف والخسارة'
            : 'Monitor upcoming product expiration dates and inventory value at risk',
          supportsDateFilter: false,
          supportsSearch: true,
          supportsVoucherCreate: false,
          supportsExpiryFilter: true,
          kpis: [
            { label: isAr ? 'أصناف قريبة الانتهاء' : 'Expiring SKUs', value: String(withExpiry.length), tone: 'amber' },
            { label: isAr ? 'منتهية الصلاحية' : 'Already Expired', value: String(expiredCount), tone: expiredCount > 0 ? 'red' : 'slate' },
            { label: isAr ? 'حرج (أقل من 14 يوم)' : 'Critical (≤ 14 Days)', value: String(criticalCount), tone: 'amber' },
            { label: isAr ? 'قيمة المخزون المعرضة للتلف' : 'Cost Value at Risk', value: money(atRiskValue), tone: 'red' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'expiry', label: isAr ? 'تاريخ الانتهاء' : 'Expiry Date', align: 'center', mono: true },
            { key: 'days', label: isAr ? 'الأيام المتبقية' : 'Days Left', align: 'center', mono: true },
            { key: 'qty', label: isAr ? 'الكمية بالمخزن' : 'Stock Qty', align: 'center', mono: true },
            { key: 'value', label: isAr ? 'التكلفة المعرضة' : 'Cost at Risk', align: 'end', mono: true },
            { key: 'status', label: isAr ? 'الحالة' : 'Status', align: 'end' },
          ],
          rows: withExpiry.map(({ p, daysLeft }) => ({
            id: `exp-${p.id}`,
            searchBlob: `${p.sku} ${p.name_ar} ${p.name_en} ${p.expiry_date ?? ''}`,
            tone: daysLeft <= 0 ? 'negative' : daysLeft <= 14 ? 'warning' : 'positive',
            cells: {
              sku: p.sku,
              name: isAr ? p.name_ar : p.name_en,
              expiry: p.expiry_date || '—',
              days: String(daysLeft),
              qty: String(p.stock_qty),
              value: num(p.stock_qty * (p.cost_price ?? 0)),
              status:
                daysLeft <= 0
                  ? isAr
                    ? 'منتهي الصلاحية'
                    : 'Expired'
                  : daysLeft <= 14
                  ? isAr
                    ? 'حرج جداً'
                    : 'Critical'
                  : isAr
                  ? 'قريب الانتهاء'
                  : 'Expiring Soon',
            },
          })),
        };
      }

      case 'stagnant_items': {
        const soldQtyByProduct = new Map<number, number>();
        const lastSoldByProduct = new Map<number, string>();

        for (const inv of scopedSales) {
          for (const item of inv.items ?? []) {
            soldQtyByProduct.set(
              item.product_id,
              (soldQtyByProduct.get(item.product_id) ?? 0) + item.qty
            );
            const prevDate = lastSoldByProduct.get(item.product_id);
            if (!prevDate || inv.created_at > prevDate) {
              lastSoldByProduct.set(item.product_id, inv.created_at);
            }
          }
        }

        const stagnantList = products
          .filter((p) => p.stock_qty > 0 && (soldQtyByProduct.get(p.id) ?? 0) <= 2)
          .map((p) => {
            const sold = soldQtyByProduct.get(p.id) ?? 0;
            const tiedCapital = p.stock_qty * (p.cost_price ?? 0);
            return {
              p,
              sold,
              tiedCapital,
              lastSale: lastSoldByProduct.get(p.id) ?? null,
            };
          })
          .sort((a, b) => a.sold - b.sold || b.tiedCapital - a.tiedCapital);

        const zeroSaleCount = stagnantList.filter((x) => x.sold === 0).length;
        const tiedTotal = stagnantList.reduce((s, x) => s + x.tiedCapital, 0);

        return {
          title: isAr ? 'تقرير ركود الأصناف' : 'Stagnant & Slow-Moving Items Report',
          subtitle: isAr
            ? 'الأصناف ذات المبيعات الصفرية أو البطيئة لحساب رأس المال المجمد في المخزون'
            : 'Products with zero or minimal sales velocity and capital tied up in stock',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي الأصناف الراكدة' : 'Slow / Stagnant SKUs', value: String(stagnantList.length), tone: 'amber' },
            { label: isAr ? 'أصناف بدون أي مبيعات' : 'Zero-Sale SKUs', value: String(zeroSaleCount), tone: 'red' },
            { label: isAr ? 'رأس المال المجمد (بالتكلفة)' : 'Tied-Up Capital', value: money(tiedTotal), tone: 'amber' },
            { label: isAr ? 'نسبة من قيمة المخزون' : '% of Stock Value', value: `${inventoryCostValue > 0 ? ((tiedTotal / inventoryCostValue) * 100).toFixed(1) : '0.0'}%`, tone: 'slate' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'stock', label: isAr ? 'الرصيد المتوفر' : 'Stock Qty', align: 'center', mono: true },
            { key: 'sold', label: isAr ? 'المباع بالفترة' : 'Sold Qty', align: 'center', mono: true },
            { key: 'lastSale', label: isAr ? 'آخر بيع' : 'Last Sale', align: 'center', mono: true },
            { key: 'capital', label: isAr ? 'قيمة المخزون المجمد' : 'Tied Capital', align: 'end', mono: true },
            { key: 'status', label: isAr ? 'التصنيف' : 'Status', align: 'end' },
          ],
          rows: stagnantList.map(({ p, sold, tiedCapital, lastSale }) => ({
            id: `stg-${p.id}`,
            searchBlob: `${p.sku} ${p.name_ar} ${p.name_en}`,
            tone: sold === 0 ? 'negative' : 'warning',
            cells: {
              sku: p.sku,
              name: isAr ? p.name_ar : p.name_en,
              stock: String(p.stock_qty),
              sold: String(sold),
              lastSale: lastSale ? lastSale.slice(0, 10) : isAr ? 'لم يبع' : 'Never',
              capital: num(tiedCapital),
              status:
                sold === 0
                  ? isAr
                    ? 'راكد (0 مبيعات)'
                    : 'Zero Sales'
                  : isAr
                  ? 'بطيء الحركة'
                  : 'Slow Moving',
            },
          })),
          totals: {
            sku: '',
            name: isAr ? 'إجمالي رأس المال المجمد' : 'Total Tied Capital',
            stock: '',
            sold: '',
            lastSale: '',
            capital: num(tiedTotal),
            status: '',
          },
        };
      }

      case 'low_stock': {
        const lowItems = products.filter((p) => p.stock_qty <= p.min_stock_alert);
        const outCount = lowItems.filter((p) => p.stock_qty <= 0).length;
        const reorderCost = lowItems.reduce(
          (s, p) => s + Math.max(0, p.min_stock_alert * 2 - p.stock_qty) * (p.cost_price ?? 0),
          0
        );
        return {
          title: isAr ? 'تقرير النواقص' : 'Low Stock Shortages Report',
          subtitle: isAr
            ? 'الأصناف التي وصلت للحد الأدنى أو نفدت وتحتاج لتوريد مشتريات عاجل'
            : 'Items at or below reorder threshold requiring purchase replenishment',
          supportsDateFilter: false,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'أصناف تحت الحد الأدنى' : 'Low Stock Items', value: String(lowItems.length), tone: 'amber' },
            { label: isAr ? 'أصناف نافدة (0)' : 'Out of Stock', value: String(outCount), tone: 'red' },
            { label: isAr ? 'تكلفة إعادة التعبئة المقدرة' : 'Est. Restock Cost', value: money(reorderCost), tone: 'slate' },
            { label: isAr ? 'نسبة الأصناف الحرجة' : 'Alert Ratio', value: `${products.length > 0 ? ((lowItems.length / products.length) * 100).toFixed(1) : '0'}%`, tone: 'amber' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'stock', label: isAr ? 'الرصيد الحالي' : 'Current', align: 'center', mono: true },
            { key: 'min', label: isAr ? 'حد الطلب' : 'Min Alert', align: 'center', mono: true },
            { key: 'suggested', label: isAr ? 'الكمية المقترحة' : 'Suggested Order', align: 'center', mono: true },
            { key: 'status', label: isAr ? 'الحالة' : 'Status', align: 'end' },
          ],
          rows: lowItems.map((p) => {
            const suggested = Math.max(1, p.min_stock_alert * 2 - p.stock_qty);
            return {
              id: `low-${p.id}`,
              searchBlob: `${p.sku} ${p.name_ar} ${p.name_en}`,
              tone: p.stock_qty <= 0 ? 'negative' : 'warning',
              cells: {
                sku: p.sku,
                name: isAr ? p.name_ar : p.name_en,
                stock: String(p.stock_qty),
                min: String(p.min_stock_alert),
                suggested: String(suggested),
                status:
                  p.stock_qty <= 0
                    ? isAr
                      ? 'نفد المخزون'
                      : 'Out of Stock'
                    : isAr
                    ? 'تحت حد الطلب'
                    : 'Low Stock',
              },
            };
          }),
        };
      }

      case 'customers_summary': {
        const custStats = customers.map((c) => {
          const custInvs = scopedInvoices.filter((i) => i.customer_id === c.id);
          const totalNet = custInvs.reduce(
            (s, i) => s + (i.invoice_type_code === '381' ? -i.grand_total : i.grand_total),
            0
          );
          const count = custInvs.filter((i) => i.invoice_type_code === '388').length;
          return { c, totalNet, count };
        });
        const totalB2b = custStats.reduce((s, x) => s + x.totalNet, 0);
        return {
          title: isAr ? 'تقرير مبيعات وكشوفات العملاء' : 'Customers Sales & Statement',
          subtitle: isAr
            ? 'كشف إجمالي مشتريات العملاء المسجلين وعدد فواتيرهم خلال الفترة'
            : 'Registered customer billing summary and invoice volume for the selected period',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'إجمالي العملاء المسجلين' : 'Registered Customers', value: String(customers.length), tone: 'slate' },
            { label: isAr ? 'مبيعات العملاء المسجلين' : 'B2B / Registered Sales', value: money(totalB2b), tone: 'emerald' },
            { label: isAr ? 'صافي المبيعات الكلي' : 'All Net Sales (Incl. VAT)', value: money(netSalesSub + netOutputVat), tone: 'slate' },
            { label: isAr ? 'متوسط الفاتورة' : 'Avg Invoice', value: money(scopedSales.length > 0 ? (netSalesSub + netOutputVat) / scopedSales.length : 0), tone: 'slate' },
          ],
          columns: [
            { key: 'name', label: isAr ? 'العميل' : 'Customer', align: 'start' },
            { key: 'vat', label: isAr ? 'الرقم الضريبي' : 'VAT #', align: 'start', mono: true },
            { key: 'phone', label: isAr ? 'الجوال' : 'Phone', align: 'start', mono: true },
            { key: 'count', label: isAr ? 'عدد الفواتير' : 'Invoices', align: 'center', mono: true },
            { key: 'total', label: isAr ? 'صافي المشتريات (شامل)' : 'Total (Incl. VAT)', align: 'end', mono: true },
          ],
          rows: custStats.map(({ c, totalNet, count }) => ({
            id: `cust-${c.id}`,
            searchBlob: `${c.name_ar} ${c.name_en} ${c.vat_number} ${c.phone}`,
            cells: {
              name: isAr ? c.name_ar : c.name_en,
              vat: c.vat_number || '—',
              phone: c.phone || '—',
              count: String(count),
              total: num(totalNet),
            },
          })),
        };
      }

      case 'suppliers_payables': {
        const rowsData = suppliers.map((sup) => {
          const supPos = scopedPurchases.filter((p) => p.supplier_id === sup.id);
          const total = supPos.reduce((s, p) => s + p.grand_total, 0);
          const paid = supPos.reduce((s, p) => s + p.paid_amount, 0);
          return { sup, count: supPos.length, total, paid, due: total - paid };
        });
        return {
          title: isAr ? 'تقرير ذمم ومستحقات الموردين' : 'Suppliers Payables Statement',
          subtitle: isAr
            ? 'أرصدة الموردين الدائنة وإجمالي التوريدات والمسدد والمتبقي'
            : 'Supplier account payables, settled amounts, and outstanding balances',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'عدد الموردين' : 'Suppliers', value: String(suppliers.length), tone: 'slate' },
            { label: isAr ? 'إجمالي المشتريات' : 'Total Purchases', value: money(purchasesGrand), tone: 'slate' },
            { label: isAr ? 'المسدد للموردين' : 'Paid to Suppliers', value: money(purchasesPaid), tone: 'emerald' },
            { label: isAr ? 'المستحق (الذمم الدائنة)' : 'Accounts Payable', value: money(suppliersPayable), tone: suppliersPayable > 0 ? 'amber' : 'emerald' },
          ],
          columns: [
            { key: 'name', label: isAr ? 'المورد' : 'Supplier', align: 'start' },
            { key: 'vat', label: isAr ? 'الرقم الضريبي' : 'VAT #', align: 'start', mono: true },
            { key: 'count', label: isAr ? 'الفواتير' : 'POs', align: 'center', mono: true },
            { key: 'total', label: isAr ? 'الإجمالي' : 'Total', align: 'end', mono: true },
            { key: 'paid', label: isAr ? 'المسدد' : 'Paid', align: 'end', mono: true },
            { key: 'due', label: isAr ? 'المتبقي' : 'Balance Due', align: 'end', mono: true },
          ],
          rows: rowsData.map((r) => ({
            id: `sup-${r.sup.id}`,
            searchBlob: `${r.sup.name_ar} ${r.sup.name_en} ${r.sup.vat_number}`,
            tone: r.due > 0 ? 'warning' : 'positive',
            cells: {
              name: isAr ? r.sup.name_ar : r.sup.name_en,
              vat: r.sup.vat_number || '—',
              count: String(r.count),
              total: num(r.total),
              paid: num(r.paid),
              due: num(r.due),
            },
          })),
          totals: {
            name: isAr ? 'الإجمالي' : 'Totals',
            vat: '',
            count: String(scopedPurchases.length),
            total: num(purchasesGrand),
            paid: num(purchasesPaid),
            due: num(suppliersPayable),
          },
        };
      }

      case 'daily_sales': {
        const dayMap = new Map<
          string,
          { count: number; returns: number; netSub: number; vat: number; grand: number }
        >();
        for (const inv of scopedInvoices) {
          const day = inv.created_at.slice(0, 10);
          const sign = inv.invoice_type_code === '381' ? -1 : 1;
          const prev = dayMap.get(day) ?? { count: 0, returns: 0, netSub: 0, vat: 0, grand: 0 };
          if (sign > 0) prev.count += 1;
          else prev.returns += 1;
          prev.netSub += inv.subtotal * sign;
          prev.vat += inv.vat_total * sign;
          prev.grand += inv.grand_total * sign;
          dayMap.set(day, prev);
        }
        const days = Array.from(dayMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
        return {
          title: isAr ? 'تقرير المبيعات اليومي' : 'Daily Sales Summary',
          subtitle: isAr
            ? 'ملخص المبيعات والمرتجعات والضريبة يومياً خلال الفترة المختارة'
            : 'Day-by-day summary of sales volume, returns, VAT, and net receipts',
          supportsDateFilter: true,
          supportsSearch: false,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'أيام البيع' : 'Active Days', value: String(days.length), tone: 'slate' },
            { label: isAr ? 'فواتير البيع' : 'Sales Count', value: String(scopedSales.length), tone: 'slate' },
            { label: isAr ? 'صافي المبيعات (شامل)' : 'Net Sales (Incl. VAT)', value: money(netSalesSub + netOutputVat), tone: 'emerald' },
            { label: isAr ? 'متوسط المبيعات اليومي' : 'Daily Average', value: money(days.length > 0 ? (netSalesSub + netOutputVat) / days.length : 0), tone: 'emerald' },
          ],
          columns: [
            { key: 'day', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'count', label: isAr ? 'المبيعات' : 'Sales', align: 'center', mono: true },
            { key: 'returns', label: isAr ? 'المرتجعات' : 'Returns', align: 'center', mono: true },
            { key: 'netSub', label: isAr ? 'قبل الضريبة' : 'Subtotal', align: 'end', mono: true },
            { key: 'vat', label: isAr ? 'الضريبة' : 'VAT', align: 'end', mono: true },
            { key: 'grand', label: isAr ? 'الصافي (شامل)' : 'Net Total', align: 'end', mono: true },
          ],
          rows: days.map(([day, d]) => ({
            id: day,
            searchBlob: day,
            cells: {
              day,
              count: String(d.count),
              returns: String(d.returns),
              netSub: num(d.netSub),
              vat: num(d.vat),
              grand: num(d.grand),
            },
          })),
          totals: {
            day: isAr ? 'الإجمالي' : 'Totals',
            count: String(scopedSales.length),
            returns: String(scopedReturns.length),
            netSub: num(netSalesSub),
            vat: num(netOutputVat),
            grand: num(netSalesSub + netOutputVat),
          },
        };
      }

      case 'payment_methods': {
        const cashTotal = scopedSales.filter((i) => i.payment_method === 'cash').length;
        const cardTotal = scopedSales.filter((i) => i.payment_method === 'card').length;
        const splitTotal = scopedSales.filter((i) => i.payment_method === 'split').length;
        const netCashCollected = cashInSales - cashOutReturns;
        const netCardCollected = cardInSales - cardOutReturns;
        const grandCollected = netCashCollected + netCardCollected;

        const rows = [
          {
            id: 'pm-cash',
            method: isAr ? 'نقدي (Cash)' : 'Cash',
            invs: cashTotal,
            gross: cashInSales,
            refunds: cashOutReturns,
            net: netCashCollected,
          },
          {
            id: 'pm-card',
            method: isAr ? 'مدى / شبكة (Card)' : 'Mada / Card',
            invs: cardTotal,
            gross: cardInSales,
            refunds: cardOutReturns,
            net: netCardCollected,
          },
          {
            id: 'pm-split-note',
            method: isAr ? 'فواتير الدفع المقسم (موزعة أعلاه)' : 'Split Invoices (allocated above)',
            invs: splitTotal,
            gross: scopedSales.filter((i) => i.payment_method === 'split').reduce((s, i) => s + i.grand_total, 0),
            refunds: scopedReturns.filter((i) => i.payment_method === 'split').reduce((s, i) => s + i.grand_total, 0),
            net: 0,
          },
        ];

        return {
          title: isAr ? 'تقرير المبيعات حسب طرق الدفع' : 'Sales by Payment Method',
          subtitle: isAr
            ? 'توزيع المتحصلات بين النقدي والشبكة/مدى بعد خصم المرتجعات'
            : 'Collection breakdown across Cash, Mada/Card, and Split checkouts',
          supportsDateFilter: true,
          supportsSearch: false,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'صافي النقدي' : 'Net Cash Sales', value: money(netCashCollected), tone: 'emerald' },
            { label: isAr ? 'صافي مدى / الشبكة' : 'Net Card Sales', value: money(netCardCollected), tone: 'slate' },
            { label: isAr ? 'فواتير مقسمة' : 'Split Invoices', value: String(splitTotal), tone: 'slate' },
            { label: isAr ? 'الإجمالي المحصل' : 'Total Collected', value: money(grandCollected), tone: 'emerald' },
          ],
          columns: [
            { key: 'method', label: isAr ? 'طريقة الدفع' : 'Payment Method', align: 'start' },
            { key: 'invs', label: isAr ? 'عدد الفواتير' : 'Invoices', align: 'center', mono: true },
            { key: 'gross', label: isAr ? 'المتحصلات' : 'Gross In', align: 'end', mono: true },
            { key: 'refunds', label: isAr ? 'المرتجعات' : 'Refunds', align: 'end', mono: true },
            { key: 'net', label: isAr ? 'الصافي' : 'Net', align: 'end', mono: true },
          ],
          rows: rows.map((r) => ({
            id: r.id,
            searchBlob: r.method,
            cells: {
              method: r.method,
              invs: String(r.invs),
              gross: num(r.gross),
              refunds: num(r.refunds),
              net: r.id === 'pm-split-note' ? '—' : num(r.net),
            },
          })),
        };
      }

      case 'top_selling': {
        const itemMap = new Map<
          string,
          { sku: string; name: string; qty: number; revenue: number; cogs: number }
        >();
        for (const inv of scopedInvoices) {
          const sign = inv.invoice_type_code === '381' ? -1 : 1;
          for (const item of inv.items ?? []) {
            const prod = productMap.get(item.product_id);
            const prev = itemMap.get(item.sku) ?? {
              sku: item.sku,
              name: isAr ? item.name_ar : item.name_en,
              qty: 0,
              revenue: 0,
              cogs: 0,
            };
            prev.qty += item.qty * sign;
            prev.revenue += item.line_subtotal * sign;
            prev.cogs += (prod?.cost_price ?? 0) * item.qty * sign;
            itemMap.set(item.sku, prev);
          }
        }
        const sorted = Array.from(itemMap.values()).sort((a, b) => b.revenue - a.revenue);
        const totalQty = sorted.reduce((s, x) => s + x.qty, 0);
        return {
          title: isAr ? 'تقرير الأصناف الأكثر مبيعاً' : 'Top Selling Products Report',
          subtitle: isAr
            ? 'ترتيب الأصناف حسب الكميات المباعة وصافي الإيراد والربح المحقق'
            : 'Products ranked by net units sold, revenue contribution, and gross profit',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'أصناف مباعة' : 'Distinct SKUs Sold', value: String(sorted.length), tone: 'slate' },
            { label: isAr ? 'صافي الوحدات المباعة' : 'Net Units Sold', value: String(totalQty), tone: 'emerald' },
            { label: isAr ? 'الأعلى مبيعاً' : 'Top Product', value: sorted[0]?.name.slice(0, 22) || '—', tone: 'emerald' },
            { label: isAr ? 'صافي الإيراد' : 'Net Item Revenue', value: money(sorted.reduce((s, x) => s + x.revenue, 0)), tone: 'slate' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'qty', label: isAr ? 'الكمية الصافية' : 'Net Qty', align: 'center', mono: true },
            { key: 'revenue', label: isAr ? 'صافي المبيعات' : 'Net Revenue', align: 'end', mono: true },
            { key: 'profit', label: isAr ? 'الربح' : 'Profit', align: 'end', mono: true },
          ],
          rows: sorted.map((it) => ({
            id: `top-${it.sku}`,
            searchBlob: `${it.sku} ${it.name}`,
            tone: it.revenue - it.cogs >= 0 ? 'positive' : 'negative',
            cells: {
              sku: it.sku,
              name: it.name,
              qty: String(it.qty),
              revenue: num(it.revenue),
              profit: num(it.revenue - it.cogs),
            },
          })),
        };
      }

      case 'sales_returns': {
        return {
          title: isAr ? 'تقرير فواتير المرتجعات' : 'Sales Credit Notes Report',
          subtitle: isAr
            ? 'تفصيل جميع الإشعارات الدائنة ومرتجعات المبيعات والفواتير الأصلية المرتبطة بها'
            : 'Detailed log of all issued credit notes (381) and referenced original sales invoices',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'عدد المرتجعات' : 'Credit Notes Count', value: String(scopedReturns.length), tone: 'amber' },
            { label: isAr ? 'مرتجعات قبل الضريبة' : 'Returns Subtotal', value: money(returnsSub), tone: 'slate' },
            { label: isAr ? 'ضريبة المرتجعات' : 'Returned VAT', value: money(outputVatReturns), tone: 'slate' },
            { label: isAr ? 'إجمالي المسترد' : 'Total Refunded', value: money(returnsSub + outputVatReturns), tone: 'red' },
          ],
          columns: [
            { key: 'no', label: isAr ? 'رقم الإشعار' : 'Credit Note #', align: 'start', mono: true },
            { key: 'ref', label: isAr ? 'الفاتورة الأصلية' : 'Original Invoice', align: 'start', mono: true },
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'customer', label: isAr ? 'العميل' : 'Customer', align: 'start' },
            { key: 'vat', label: isAr ? 'الضريبة' : 'VAT', align: 'end', mono: true },
            { key: 'total', label: isAr ? 'الإجمالي المسترد' : 'Refunded Total', align: 'end', mono: true },
          ],
          rows: scopedReturns.map((inv) => ({
            id: `ret-${inv.id}`,
            searchBlob: `${inv.invoice_number} ${inv.related_invoice_number ?? ''} ${inv.customer_name}`,
            tone: 'warning',
            cells: {
              no: inv.invoice_number,
              ref: inv.related_invoice_number || '—',
              date: formatDateTime(inv.created_at, lang),
              customer: inv.customer_name,
              vat: num(inv.vat_total),
              total: num(inv.grand_total),
            },
          })),
        };
      }

      case 'returned_items': {
        const retMap = new Map<string, { sku: string; name: string; qty: number; total: number }>();
        for (const inv of scopedReturns) {
          for (const item of inv.items ?? []) {
            const prev = retMap.get(item.sku) ?? {
              sku: item.sku,
              name: isAr ? item.name_ar : item.name_en,
              qty: 0,
              total: 0,
            };
            prev.qty += item.qty;
            prev.total += item.line_total;
            retMap.set(item.sku, prev);
          }
        }
        const list = Array.from(retMap.values()).sort((a, b) => b.total - a.total);
        return {
          title: isAr ? 'تقرير الأصناف المرتجعة' : 'Returned Items Breakdown',
          subtitle: isAr
            ? 'حصر الأصناف والكميات المسترجعة من العملاء لتحليل أسباب المرتجعات'
            : 'SKU-level breakdown of returned product quantities and refunded totals',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'أصناف مرتجعة' : 'Returned SKUs', value: String(list.length), tone: 'amber' },
            { label: isAr ? 'إجمالي الوحدات المرتجعة' : 'Returned Units', value: String(list.reduce((s, x) => s + x.qty, 0)), tone: 'red' },
            { label: isAr ? 'إجمالي قيمة المرتجعات' : 'Returned Value', value: money(list.reduce((s, x) => s + x.total, 0)), tone: 'red' },
            { label: isAr ? 'فواتير المرتجع' : 'Credit Notes', value: String(scopedReturns.length), tone: 'slate' },
          ],
          columns: [
            { key: 'sku', label: 'SKU', align: 'start', mono: true },
            { key: 'name', label: isAr ? 'الصنف' : 'Product', align: 'start' },
            { key: 'qty', label: isAr ? 'الكمية المرتجعة' : 'Returned Qty', align: 'center', mono: true },
            { key: 'total', label: isAr ? 'القيمة المستردة' : 'Refund Value', align: 'end', mono: true },
          ],
          rows: list.map((it) => ({
            id: `ret-it-${it.sku}`,
            searchBlob: `${it.sku} ${it.name}`,
            tone: 'warning',
            cells: {
              sku: it.sku,
              name: it.name,
              qty: String(it.qty),
              total: num(it.total),
            },
          })),
        };
      }

      case 'purchases_vat': {
        return {
          title: isAr ? 'تقرير فواتير المشتريات وضريبة المدخلات' : 'Purchase Invoices & Input VAT Report',
          subtitle: isAr
            ? 'سجل فواتير التوريد والمشتريات مع ضريبة المدخلات وحالة السداد للموردين'
            : 'Supplier purchase invoices, recoverable input VAT, and payment settlement status',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'فواتير الشراء' : 'Purchase Orders', value: String(scopedPurchases.length), tone: 'slate' },
            { label: isAr ? 'صافي المشتريات' : 'Purchases Subtotal', value: money(purchasesSub), tone: 'slate' },
            { label: isAr ? 'ضريبة المدخلات (15%)' : 'Input VAT (15%)', value: money(purchasesInputVat), tone: 'emerald' },
            { label: isAr ? 'إجمالي المشتريات (شامل)' : 'Grand Total', value: money(purchasesGrand), tone: 'slate' },
          ],
          columns: [
            { key: 'no', label: isAr ? 'رقم أمر الشراء' : 'PO #', align: 'start', mono: true },
            { key: 'date', label: isAr ? 'التاريخ' : 'Date', align: 'start', mono: true },
            { key: 'supplier', label: isAr ? 'المورد' : 'Supplier', align: 'start' },
            { key: 'sub', label: isAr ? 'قبل الضريبة' : 'Subtotal', align: 'end', mono: true },
            { key: 'vat', label: isAr ? 'الضريبة' : 'Input VAT', align: 'end', mono: true },
            { key: 'grand', label: isAr ? 'الإجمالي' : 'Grand Total', align: 'end', mono: true },
            { key: 'due', label: isAr ? 'المتبقي' : 'Due', align: 'end', mono: true },
          ],
          rows: scopedPurchases.map((p) => ({
            id: `po-${p.id}`,
            searchBlob: `${p.purchase_number} ${p.supplier_name} ${p.supplier_invoice_no}`,
            tone: p.grand_total - p.paid_amount > 0 ? 'warning' : 'positive',
            cells: {
              no: p.purchase_number,
              date: (p.received_at || p.created_at).slice(0, 10),
              supplier: p.supplier_name,
              sub: num(p.subtotal),
              vat: num(p.vat_total),
              grand: num(p.grand_total),
              due: num(Math.max(0, p.grand_total - p.paid_amount)),
            },
          })),
          totals: {
            no: '',
            date: '',
            supplier: isAr ? 'الإجمالي' : 'Totals',
            sub: num(purchasesSub),
            vat: num(purchasesInputVat),
            grand: num(purchasesGrand),
            due: num(suppliersPayable),
          },
        };
      }

      case 'purchases_by_supplier': {
        const supMap = new Map<
          number,
          { name: string; count: number; sub: number; vat: number; grand: number; paid: number }
        >();
        for (const p of scopedPurchases) {
          const prev = supMap.get(p.supplier_id) ?? {
            name: p.supplier_name,
            count: 0,
            sub: 0,
            vat: 0,
            grand: 0,
            paid: 0,
          };
          prev.count += 1;
          prev.sub += p.subtotal;
          prev.vat += p.vat_total;
          prev.grand += p.grand_total;
          prev.paid += p.paid_amount;
          supMap.set(p.supplier_id, prev);
        }
        const list = Array.from(supMap.entries()).sort((a, b) => b[1].grand - a[1].grand);
        return {
          title: isAr ? 'تقرير المشتريات حسب المورد' : 'Purchases by Supplier Report',
          subtitle: isAr
            ? 'تحليل حجم التوريد لكل مورد وإجمالي الضريبة والمبالغ المتبقية'
            : 'Procurement volume, input VAT, and outstanding balances grouped by supplier',
          supportsDateFilter: true,
          supportsSearch: true,
          supportsVoucherCreate: false,
          kpis: [
            { label: isAr ? 'الموردون النشطون' : 'Active Suppliers', value: String(list.length), tone: 'slate' },
            { label: isAr ? 'إجمالي التوريدات' : 'Total Procured', value: money(purchasesGrand), tone: 'slate' },
            { label: isAr ? 'المسدد' : 'Settled', value: money(purchasesPaid), tone: 'emerald' },
            { label: isAr ? 'الذمم المستحقة' : 'Outstanding', value: money(suppliersPayable), tone: suppliersPayable > 0 ? 'amber' : 'emerald' },
          ],
          columns: [
            { key: 'name', label: isAr ? 'المورد' : 'Supplier', align: 'start' },
            { key: 'count', label: isAr ? 'عدد الفواتير' : 'Invoices', align: 'center', mono: true },
            { key: 'sub', label: isAr ? 'صافي المشتريات' : 'Subtotal', align: 'end', mono: true },
            { key: 'vat', label: isAr ? 'الضريبة' : 'VAT', align: 'end', mono: true },
            { key: 'grand', label: isAr ? 'الإجمالي' : 'Grand Total', align: 'end', mono: true },
            { key: 'due', label: isAr ? 'المتبقي' : 'Due', align: 'end', mono: true },
          ],
          rows: list.map(([id, s]) => ({
            id: `pbs-${id}`,
            searchBlob: s.name,
            cells: {
              name: s.name,
              count: String(s.count),
              sub: num(s.sub),
              vat: num(s.vat),
              grand: num(s.grand),
              due: num(Math.max(0, s.grand - s.paid)),
            },
          })),
        };
      }
    }
  }, [
    activeReport,
    customers,
    expiryDaysFilter,
    fromDate,
    invoices,
    isAr,
    lang,
    movements,
    productMap,
    products,
    purchases,
    selectedProductId,
    suppliers,
    toDate,
    vouchers,
  ]);

  const filteredRows = useMemo(() => {
    if (!dataset) return [];
    const q = search.trim().toLowerCase();
    if (!q) return dataset.rows;
    return dataset.rows.filter((r) => r.searchBlob.toLowerCase().includes(q));
  }, [dataset, search]);

  const pagination = useTablePagination(
    filteredRows,
    settings.table_page_size || 10,
    `${activeReport ?? ''}|${fromDate}|${toDate}|${search}|${selectedProductId}|${expiryDaysFilter}`
  );

  const applyPreset = (preset: 'all' | 'today' | 'week' | 'month') => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    if (preset === 'all') {
      setFromDate('');
      setToDate('');
      return;
    }
    if (preset === 'today') {
      setFromDate(todayStr);
      setToDate(todayStr);
      return;
    }
    if (preset === 'week') {
      const start = new Date(now.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
      setFromDate(start);
      setToDate(todayStr);
      return;
    }
    setFromDate(`${todayStr.slice(0, 7)}-01`);
    setToDate(todayStr);
  };

  const handleExportCsv = () => {
    if (!dataset) return;
    const headers = dataset.columns.map((c) => csvEscape(c.label)).join(',');
    const lines = filteredRows.map((row) =>
      dataset.columns.map((c) => csvEscape(row.cells[c.key] ?? '')).join(',')
    );
    if (dataset.totals) {
      lines.push(
        dataset.columns.map((c) => csvEscape(dataset.totals?.[c.key] ?? '')).join(',')
      );
    }
    const csv = `\uFEFF${[headers, ...lines].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mizan-${activeReport ?? 'report'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    onNotify(isAr ? 'تم تصدير التقرير بصيغة CSV' : 'Report exported to CSV');
  };

  const handlePrintReport = async () => {
    if (!dataset) return;
    const periodLabel =
      fromDate || toDate
        ? `${fromDate || '...'} → ${toDate || '...'}`
        : isAr
        ? 'كامل الفترة'
        : 'All Dates';

    const kpisHtml = dataset.kpis
      .map(
        (k) => `
      <div class="kpi">
        <div class="kpi-label">${escapeHtml(k.label)}</div>
        <div class="kpi-val">${escapeHtml(k.value)}</div>
      </div>`
      )
      .join('');

    const thHtml = dataset.columns
      .map((c) => `<th class="${c.align ?? 'start'}">${escapeHtml(c.label)}</th>`)
      .join('');

    const rowsHtml = filteredRows
      .map(
        (r) => `
      <tr>
        ${dataset.columns
          .map(
            (c) =>
              `<td class="${c.align ?? 'start'} ${c.mono ? 'mono' : ''}">${escapeHtml(r.cells[c.key] ?? '')}</td>`
          )
          .join('')}
      </tr>`
      )
      .join('');

    const totalsHtml = dataset.totals
      ? `<tr class="totals">${dataset.columns
          .map(
            (c) =>
              `<td class="${c.align ?? 'start'} ${c.mono ? 'mono' : ''}">${escapeHtml(dataset.totals?.[c.key] ?? '')}</td>`
          )
          .join('')}</tr>`
      : '';

    const html = `<!doctype html>
<html lang="${isAr ? 'ar' : 'en'}" dir="${isAr ? 'rtl' : 'ltr'}">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(dataset.title)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&display=swap" rel="stylesheet" />
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Cairo', Tahoma, Arial, sans-serif; color: #0f172a; font-size: 12px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
    .store { font-size: 16px; font-weight: 800; }
    .muted { color: #475569; font-size: 11px; margin-top: 2px; }
    .report-title { font-size: 18px; font-weight: 800; margin: 0 0 4px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
    .kpi { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
    .kpi-label { font-size: 10px; color: #475569; }
    .kpi-val { font-size: 13px; font-weight: 700; margin-top: 3px; font-variant-numeric: tabular-nums; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 6px 8px; }
    th { background: #f8fafc; font-weight: 700; font-size: 11px; }
    .start { text-align: start; }
    .center { text-align: center; }
    .end { text-align: end; }
    .mono { font-family: 'Courier New', monospace; font-variant-numeric: tabular-nums; }
    .totals td { background: #f1f5f9; font-weight: 800; }
  </style>
</head>
<body>
  <div class="head">
    <div>
      <div class="store">${escapeHtml(isAr ? settings.name_ar : settings.name_en)}</div>
      <div class="muted">${isAr ? 'الرقم الضريبي:' : 'VAT:'} ${escapeHtml(settings.vat_number)}</div>
    </div>
    <div style="text-align: end;">
      <div class="report-title">${escapeHtml(dataset.title)}</div>
      <div class="muted">${isAr ? 'الفترة:' : 'Period:'} ${escapeHtml(periodLabel)}</div>
    </div>
  </div>
  <div class="kpis">${kpisHtml}</div>
  <table>
    <thead><tr>${thHtml}</tr></thead>
    <tbody>${rowsHtml}${totalsHtml}</tbody>
  </table>
</body>
</html>`;

    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.opacity = '0';
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
      const timer = setTimeout(resolve, 600);
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
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
    }, 1500);
  };

  const handleSubmitVoucher = async (e: React.FormEvent) => {
    e.preventDefault();
    const amt = Number(voucherForm.amount);
    if (!voucherForm.party_name.trim() || !Number.isFinite(amt) || amt <= 0) return;
    setSavingVoucher(true);
    try {
      await onCreateVoucher({
        voucher_type: voucherForm.voucher_type,
        payment_channel: voucherForm.payment_channel,
        party_name: voucherForm.party_name.trim(),
        category: voucherForm.category.trim(),
        amount: amt,
        notes: voucherForm.notes.trim(),
        voucher_date: voucherForm.voucher_date,
      });
      setVoucherForm((prev) => ({
        ...prev,
        party_name: '',
        category: '',
        amount: '',
        notes: '',
      }));
      setShowVoucherModal(false);
    } finally {
      setSavingVoucher(false);
    }
  };

  const handleSubmitWastage = async (e: React.FormEvent) => {
    e.preventDefault();
    const pid = Number(wastageForm.product_id);
    const qty = Math.floor(Number(wastageForm.qty));
    if (!pid || !Number.isFinite(qty) || qty <= 0) return;
    setSavingWastage(true);
    try {
      await onStockMovement({
        product_id: pid,
        type: 'adjustment',
        qty: -qty,
        reference_no: `WST-${Date.now().toString().slice(-6)}`,
        notes: wastageForm.notes.trim() || (isAr ? 'إهلاك / تالف' : 'Product wastage write-off'),
      });
      setWastageForm((prev) => ({ ...prev, qty: '1', notes: '' }));
      setShowWastageModal(false);
    } finally {
      setSavingWastage(false);
    }
  };

  // Directory View (Accordion Matching Reference Layout)
  if (!activeReport || !dataset) {
    return (
      <div className="space-y-3">
        {categories.map((cat) => {
          const isOpen = openCategories[cat.id];
          const Icon = cat.icon;
          const hasOddCount = cat.reports.length % 2 === 1;
          return (
            <section
              key={cat.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
            >
              <button
                type="button"
                onClick={() =>
                  setOpenCategories((prev) => ({ ...prev, [cat.id]: !prev[cat.id] }))
                }
                aria-expanded={isOpen}
                className="w-full px-5 py-3.5 flex items-center justify-between gap-4 text-start hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-center gap-3.5">
                  <span
                    className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${cat.iconBg}`}
                  >
                    <Icon className="w-5 h-5" />
                  </span>
                  <div>
                    <div className="text-sm font-bold text-slate-900 dark:text-white">
                      {cat.title}
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {isAr ? `${cat.reports.length} تقارير` : `${cat.reports.length} reports`}
                    </div>
                  </div>
                </div>

                <ChevronDown
                  className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                    isOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {isOpen && (
                <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {cat.reports.map((rep, idx) => {
                      const isCenteredLast = hasOddCount && idx === cat.reports.length - 1;
                      return (
                        <button
                          key={rep.id}
                          type="button"
                          onClick={() => {
                            setSearch('');
                            setActiveReport(rep.id);
                          }}
                          className={`w-full py-3.5 px-4 rounded-lg bg-slate-50 hover:bg-emerald-50/70 dark:bg-slate-950/70 dark:hover:bg-emerald-950/30 border border-slate-200/80 dark:border-slate-800 hover:border-emerald-600/40 text-sm font-semibold text-slate-800 dark:text-slate-100 text-center transition-colors ${
                            isCenteredLast ? 'md:col-span-2 md:w-[calc(50%-0.375rem)] md:mx-auto' : ''
                          }`}
                        >
                          {rep.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  // Active Report Viewer
  return (
    <div className="space-y-4">
      {/* Report Header & Actions */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => setActiveReport(null)}
            className="mt-0.5 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            {isAr ? <ArrowRight className="w-3.5 h-3.5" /> : <ArrowLeft className="w-3.5 h-3.5" />}
            {isAr ? 'دليل التقارير' : 'All Reports'}
          </button>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {dataset.title}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {dataset.subtitle}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {dataset.supportsVoucherCreate && (
            <button
              type="button"
              onClick={() => setShowVoucherModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {isAr ? 'إضافة سند قبض / صرف' : 'New Voucher'}
            </button>
          )}
          {dataset.supportsWastageCreate && (
            <button
              type="button"
              onClick={() => {
                setWastageForm((prev) => ({
                  ...prev,
                  product_id: prev.product_id || (products[0] ? String(products[0].id) : ''),
                }));
                setShowWastageModal(true);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-rose-700 hover:bg-rose-800 text-white whitespace-nowrap shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              {isAr ? 'تسجيل إهلاك منتج' : 'Record Wastage'}
            </button>
          )}
          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            {isAr ? 'تصدير CSV' : 'Export CSV'}
          </button>
          <button
            type="button"
            onClick={() => void handlePrintReport()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            {isAr ? 'طباعة التقرير' : 'Print Report'}
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      {(dataset.supportsDateFilter ||
        dataset.supportsSearch ||
        dataset.supportsProductFilter ||
        dataset.supportsExpiryFilter) && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {dataset.supportsDateFilter && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 dark:text-slate-400">
                    {isAr ? 'من:' : 'From:'}
                  </span>
                  <input
                    type="date"
                    value={fromDate}
                    onChange={(e) => setFromDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500 dark:text-slate-400">
                    {isAr ? 'إلى:' : 'To:'}
                  </span>
                  <input
                    type="date"
                    value={toDate}
                    onChange={(e) => setToDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
                <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                  {(
                    [
                      ['all', isAr ? 'الكل' : 'All'],
                      ['today', isAr ? 'اليوم' : 'Today'],
                      ['week', isAr ? '7 أيام' : '7 Days'],
                      ['month', isAr ? 'هذا الشهر' : 'Month'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => applyPreset(key)}
                      className="px-2.5 py-1 text-[11px] font-medium rounded-md text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-900 whitespace-nowrap"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}

            {dataset.supportsProductFilter && (
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg max-w-xs"
              >
                <option value="all">{isAr ? 'جميع الأصناف' : 'All Products'}</option>
                {products.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {isAr ? p.name_ar : p.name_en} ({p.sku})
                  </option>
                ))}
              </select>
            )}

            {dataset.supportsExpiryFilter && (
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                {(
                  [
                    [30, isAr ? 'خلال 30 يوم' : 'Within 30d'],
                    [60, isAr ? 'خلال 60 يوم' : 'Within 60d'],
                    [90, isAr ? 'خلال 90 يوم' : 'Within 90d'],
                    [3650, isAr ? 'كل الصلاحيات' : 'All With Expiry'],
                  ] as Array<[number, string]>
                ).map(([days, label]) => (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setExpiryDaysFilter(days)}
                    className={`px-2.5 py-1 text-[11px] font-medium rounded-md whitespace-nowrap transition-colors ${
                      expiryDaysFilter === days
                        ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {dataset.supportsSearch && (
            <div className="relative flex-1 min-w-[220px] max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isAr ? 'بحث داخل التقرير...' : 'Search report rows...'}
                className="w-full ps-9 pe-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-700/30"
              />
            </div>
          )}
        </div>
      )}

      {/* KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {dataset.kpis.map((kpi, idx) => {
          const valColor =
            kpi.tone === 'emerald'
              ? 'text-emerald-700 dark:text-emerald-400'
              : kpi.tone === 'amber'
              ? 'text-amber-700 dark:text-amber-400'
              : kpi.tone === 'red'
              ? 'text-red-700 dark:text-red-400'
              : 'text-slate-900 dark:text-white';
          return (
            <div
              key={idx}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4"
            >
              <div className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</div>
              <div className={`text-lg font-bold font-mono tabular-nums mt-1 ${valColor}`}>
                {kpi.value}
              </div>
            </div>
          );
        })}
      </div>

      {/* Report Data Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400">
            <tr>
              {dataset.columns.map((col) => (
                <th
                  key={col.key}
                  className={`py-3 px-4 font-semibold whitespace-nowrap ${
                    col.align === 'end'
                      ? 'text-end'
                      : col.align === 'center'
                      ? 'text-center'
                      : 'text-start'
                  }`}
                >
                  {col.label}
                </th>
              ))}
              {dataset.supportsVoucherCreate && (
                <th className="py-3 px-4 text-end font-semibold whitespace-nowrap">
                  {isAr ? 'حذف' : 'Delete'}
                </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {pagination.pagedItems.length === 0 ? (
              <tr>
                <td
                  colSpan={dataset.columns.length + (dataset.supportsVoucherCreate ? 1 : 0)}
                  className="py-10 text-center text-slate-400"
                >
                  {isAr ? 'لا توجد بيانات مطابقة للفترة أو البحث' : 'No matching records found'}
                </td>
              </tr>
            ) : (
              pagination.pagedItems.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                >
                  {dataset.columns.map((col, cIdx) => {
                    const isLastCol = cIdx === dataset.columns.length - 1;
                    const toneClass =
                      isLastCol && row.tone === 'positive'
                        ? 'text-emerald-700 dark:text-emerald-400 font-semibold'
                        : isLastCol && row.tone === 'negative'
                        ? 'text-red-700 dark:text-red-400 font-semibold'
                        : isLastCol && row.tone === 'warning'
                        ? 'text-amber-700 dark:text-amber-400 font-semibold'
                        : 'text-slate-800 dark:text-slate-200';

                    return (
                      <td
                        key={col.key}
                        className={`py-3 px-4 ${
                          col.align === 'end'
                            ? 'text-end'
                            : col.align === 'center'
                            ? 'text-center'
                            : 'text-start'
                        } ${col.mono ? 'font-mono tabular-nums' : ''} ${toneClass}`}
                      >
                        {row.cells[col.key] ?? '—'}
                      </td>
                    );
                  })}
                  {dataset.supportsVoucherCreate && (
                    <td className="py-3 px-4 text-end">
                      {row.voucherId ? (
                        <button
                          type="button"
                          onClick={() => void onDeleteVoucher(row.voucherId!)}
                          title={isAr ? 'حذف السند' : 'Delete Voucher'}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      ) : (
                        <span className="text-slate-300 dark:text-slate-700">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {dataset.totals && filteredRows.length > 0 && (
            <tfoot className="bg-slate-50 dark:bg-slate-950/80 border-t-2 border-slate-200 dark:border-slate-800 font-bold text-slate-900 dark:text-white">
              <tr>
                {dataset.columns.map((col) => (
                  <td
                    key={col.key}
                    className={`py-3 px-4 ${
                      col.align === 'end'
                        ? 'text-end'
                        : col.align === 'center'
                        ? 'text-center'
                        : 'text-start'
                    } ${col.mono ? 'font-mono tabular-nums' : ''}`}
                  >
                    {dataset.totals?.[col.key] ?? ''}
                  </td>
                ))}
                {dataset.supportsVoucherCreate && <td />}
              </tr>
            </tfoot>
          )}
        </table>

        <TablePagination
          lang={lang}
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          totalItems={pagination.totalItems}
          startItem={pagination.startItem}
          endItem={pagination.endItem}
          onPageChange={pagination.setPage}
        />
      </div>

      {/* Create Receipt / Payment Voucher Modal */}
      {showVoucherModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'تسجيل سند قبض أو صرف جديد' : 'Record New Receipt / Payment Voucher'}
              </h3>
              <button
                type="button"
                onClick={() => setShowVoucherModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitVoucher} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['receipt', isAr ? 'سند قبض (+)' : 'Receipt (+)'],
                    ['payment', isAr ? 'سند صرف (-)' : 'Payment (-)'],
                  ] as Array<[VoucherType, string]>
                ).map(([type, label]) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setVoucherForm((p) => ({ ...p, voucher_type: type }))}
                    className={`py-2 px-3 rounded-lg border font-semibold transition-colors ${
                      voucherForm.voucher_type === type
                        ? 'bg-emerald-700 text-white border-emerald-700'
                        : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-600 dark:text-slate-400">
                    {isAr ? 'القناة' : 'Channel'}
                  </label>
                  <select
                    value={voucherForm.payment_channel}
                    onChange={(e) =>
                      setVoucherForm((p) => ({
                        ...p,
                        payment_channel: e.target.value as VoucherChannel,
                      }))
                    }
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  >
                    <option value="cash">{isAr ? 'نقدي (درج الكاشير)' : 'Cash Drawer'}</option>
                    <option value="bank">{isAr ? 'بنك / تحويل' : 'Bank Transfer'}</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-slate-600 dark:text-slate-400">
                    {isAr ? 'التاريخ' : 'Date'}
                  </label>
                  <input
                    required
                    type="date"
                    value={voucherForm.voucher_date}
                    onChange={(e) =>
                      setVoucherForm((p) => ({ ...p, voucher_date: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-600 dark:text-slate-400">
                  {isAr ? 'الجهة / اسم المستفيد أو المسدد' : 'Party / Description'}
                </label>
                <input
                  required
                  type="text"
                  value={voucherForm.party_name}
                  onChange={(e) =>
                    setVoucherForm((p) => ({ ...p, party_name: e.target.value }))
                  }
                  placeholder={isAr ? 'مثال: إيجار المحل / تغذية صندوق' : 'e.g. Store Rent / Cash Deposit'}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-slate-600 dark:text-slate-400">
                    {isAr ? 'المبلغ (ر.س)' : 'Amount (SAR)'}
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={voucherForm.amount}
                    onChange={(e) =>
                      setVoucherForm((p) => ({ ...p, amount: e.target.value }))
                    }
                    className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-slate-600 dark:text-slate-400">
                    {isAr ? 'التصنيف' : 'Category'}
                  </label>
                  <input
                    type="text"
                    value={voucherForm.category}
                    onChange={(e) =>
                      setVoucherForm((p) => ({ ...p, category: e.target.value }))
                    }
                    placeholder={isAr ? 'مصروفات تشغيلية / تغذية درج' : 'Operating Expense'}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-slate-600 dark:text-slate-400">
                  {isAr ? 'ملاحظات' : 'Notes'}
                </label>
                <input
                  type="text"
                  value={voucherForm.notes}
                  onChange={(e) => setVoucherForm((p) => ({ ...p, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowVoucherModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingVoucher}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white font-semibold disabled:opacity-50"
                >
                  {savingVoucher ? (isAr ? 'جاري الحفظ...' : 'Saving...') : isAr ? 'حفظ السند' : 'Save Voucher'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Record Product Wastage Modal */}
      {showWastageModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl w-full max-w-md p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {isAr ? 'تسجيل إهلاك / تالف منتج' : 'Record Product Wastage'}
              </h3>
              <button
                type="button"
                onClick={() => setShowWastageModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitWastage} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-600 dark:text-slate-400">
                  {isAr ? 'الصنف' : 'Product'}
                </label>
                <select
                  required
                  value={wastageForm.product_id}
                  onChange={(e) =>
                    setWastageForm((p) => ({ ...p, product_id: e.target.value }))
                  }
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                  {products.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {isAr ? p.name_ar : p.name_en} ({isAr ? 'المتاح:' : 'Stock:'} {p.stock_qty})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-slate-600 dark:text-slate-400">
                  {isAr ? 'الكمية المهلكة' : 'Wasted Quantity'}
                </label>
                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={wastageForm.qty}
                  onChange={(e) => setWastageForm((p) => ({ ...p, qty: e.target.value }))}
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="space-y-1">
                <label className="text-slate-600 dark:text-slate-400">
                  {isAr ? 'سبب الإهلاك / ملاحظات' : 'Wastage Reason'}
                </label>
                <input
                  required
                  type="text"
                  value={wastageForm.notes}
                  onChange={(e) => setWastageForm((p) => ({ ...p, notes: e.target.value }))}
                  placeholder={isAr ? 'مثال: انتهاء صلاحية / تلف تغليف' : 'e.g. Expired / Damaged packaging'}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWastageModal(false)}
                  className="px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={savingWastage}
                  className="px-4 py-2 rounded-lg bg-rose-700 hover:bg-rose-800 text-white font-semibold disabled:opacity-50"
                >
                  {savingWastage
                    ? isAr
                      ? 'جاري الحفظ...'
                      : 'Saving...'
                    : isAr
                    ? 'خصم وتسجيل الإهلاك'
                    : 'Record Wastage'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
