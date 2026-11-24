import { useEffect, useState } from 'react';
import { BarChart3, Settings2, Users } from 'lucide-react';
import type {
  AuthUser,
  Customer,
  FontSizeLevel,
  Invoice,
  Language,
  ManagedUser,
  OrganizationSettings,
  PermissionKey,
  Product,
  Purchase,
  RoleRecord,
  StockMovement,
  Supplier,
  Voucher,
  VoucherChannel,
  VoucherType,
} from '../types';
import { hasPermission } from '../permissions';
import { ReportsCenterView } from './ReportsCenterView';
import { UsersPermissionsView } from './UsersPermissionsView';

export type ReportsSettingsSubTab = 'reports' | 'settings' | 'users';

interface InvoicesSettingsViewProps {
  lang: Language;
  currentUser: AuthUser;
  requestedTab?: ReportsSettingsSubTab;
  onRequestedTabHandled?: () => void;
  settings: OrganizationSettings;
  invoices: Invoice[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: Purchase[];
  movements: StockMovement[];
  vouchers: Voucher[];
  users: ManagedUser[];
  roles: RoleRecord[];
  onCreateVoucher: (payload: {
    voucher_type: VoucherType;
    payment_channel: VoucherChannel;
    party_name: string;
    category: string;
    amount: number;
    notes: string;
    voucher_date: string;
  }) => Promise<boolean>;
  onVoidVoucher: (id: number, reason: string) => Promise<boolean>;
  onStockMovement: (payload: {
    product_id: number;
    type: 'purchase' | 'adjustment' | 'return';
    qty: number;
    notes: string;
    reference_no?: string;
  }) => Promise<boolean>;
  onUpdateSettings: (payload: Partial<OrganizationSettings>) => Promise<boolean>;
  onCreateUser: (payload: {
    full_name: string;
    email: string;
    phone: string;
    password: string;
    role_id: number;
    is_active: boolean;
  }) => Promise<boolean>;
  onUpdateUser: (
    id: number,
    payload: {
      full_name: string;
      email: string;
      phone: string;
      password?: string;
      role_id: number;
      is_active: boolean;
    }
  ) => Promise<boolean>;
  onDeleteUser: (id: number) => Promise<boolean>;
  onCreateRole: (payload: {
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
  }) => Promise<RoleRecord | null>;
  onUpdateRole: (
    id: number,
    payload: {
      name_ar: string;
      name_en: string;
      description_ar: string;
      description_en: string;
      permissions: PermissionKey[];
    }
  ) => Promise<boolean>;
  onDeleteRole: (id: number) => Promise<boolean>;
  onNotify: (msg: string, tone?: 'success' | 'error') => void;
}

export function InvoicesSettingsView({
  lang,
  currentUser,
  requestedTab,
  onRequestedTabHandled,
  settings,
  invoices,
  products,
  customers,
  suppliers,
  purchases,
  movements,
  vouchers,
  users,
  roles,
  onCreateVoucher,
  onVoidVoucher,
  onStockMovement,
  onUpdateSettings,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onCreateRole,
  onUpdateRole,
  onDeleteRole,
  onNotify,
}: InvoicesSettingsViewProps) {
  const isAr = lang === 'ar';

  const canReports = hasPermission(currentUser, 'reports.view');
  const canSettings = hasPermission(currentUser, 'settings.manage');
  const canUsers = hasPermission(currentUser, 'users.manage');

  const defaultAllowedTab: ReportsSettingsSubTab = canReports
    ? 'reports'
    : canSettings
    ? 'settings'
    : 'users';

  const [tab, setTab] = useState<ReportsSettingsSubTab>(defaultAllowedTab);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (requestedTab) {
      if (
        (requestedTab === 'reports' && canReports) ||
        (requestedTab === 'settings' && canSettings) ||
        (requestedTab === 'users' && canUsers)
      ) {
        setTab(requestedTab);
      }
      onRequestedTabHandled?.();
    }
  }, [requestedTab, canReports, canSettings, canUsers, onRequestedTabHandled]);

  useEffect(() => {
    if (
      (tab === 'reports' && !canReports) ||
      (tab === 'settings' && !canSettings) ||
      (tab === 'users' && !canUsers)
    ) {
      setTab(defaultAllowedTab);
    }
  }, [tab, canReports, canSettings, canUsers, defaultAllowedTab]);

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
      font_size: (settings.font_size || 'medium') as FontSizeLevel,
      table_page_size: settings.table_page_size || 10,
    });
  }, [settings]);

  const effectiveBaseUrl =
    form.public_base_url.trim().replace(/\/+$/, '') || window.location.origin;

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
            {isAr ? 'التقارير والإعدادات العامة' : 'Financial Reports & General Settings'}
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mt-1">
            <span>
              {isAr ? 'التقارير المالية والمحاسبية والتشغيلية' : 'Financial, accounting & operational reports'}
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

        <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg self-start">
          {canReports && (
            <button
              type="button"
              onClick={() => setTab('reports')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'reports'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5" />
              {isAr ? 'التقارير' : 'Reports'}
            </button>
          )}
          {canSettings && (
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
              {isAr ? 'الإعدادات والطابعة' : 'Settings & Printer'}
            </button>
          )}
          {canUsers && (
            <button
              type="button"
              onClick={() => setTab('users')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                tab === 'users'
                  ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <Users className="w-3.5 h-3.5" />
              {isAr ? 'المستخدمون والصلاحيات' : 'Users & Permissions'}
            </button>
          )}
        </div>
      </div>

      {tab === 'reports' && canReports ? (
        <ReportsCenterView
          lang={lang}
          currentUser={currentUser}
          settings={settings}
          invoices={invoices}
          products={products}
          customers={customers}
          suppliers={suppliers}
          purchases={purchases}
          movements={movements}
          vouchers={vouchers}
          onCreateVoucher={onCreateVoucher}
          onVoidVoucher={onVoidVoucher}
          onStockMovement={onStockMovement}
          onNotify={onNotify}
        />
      ) : tab === 'users' && canUsers ? (
        <UsersPermissionsView
          lang={lang}
          currentUser={currentUser}
          users={users}
          roles={roles}
          pageSize={settings.table_page_size || 10}
          onCreateUser={onCreateUser}
          onUpdateUser={onUpdateUser}
          onDeleteUser={onDeleteUser}
          onCreateRole={onCreateRole}
          onUpdateRole={onUpdateRole}
          onDeleteRole={onDeleteRole}
        />
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

          {/* Right Column: what the receipt QR does (D1) */}
          <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {isAr ? 'رمز QR في الإيصال' : 'Receipt QR code'}
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'يحتوي رمز QR المطبوع على الإيصال رابط صفحة الفاتورة العامة. عند مسحه بكاميرا هاتف العميل تُفتح الفاتورة بتفاصيلها ويمكن طباعتها من الهاتف.'
                : "The QR code printed on the receipt holds the link to the public invoice page. Scanning it with the customer's phone camera opens the invoice, which can be printed from the phone."}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'يُبنى الرابط من حقل «الرابط الأساسي العام (Base URL)» أعلاه، أو من نطاق الموقع إذا تُرك فارغاً.'
                : 'The link uses the "Public Base URL" field above, or the site domain when it is empty.'}
            </p>
          </div>
        </form>
      )}
    </div>
  );
}
