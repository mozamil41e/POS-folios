import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, LogOut, Moon, Sun, User } from 'lucide-react';
import type {
  AuthUser,
  BootstrapPayload,
  Invoice,
  InvoiceSubtype,
  Language,
  OrganizationSettings,
  PaymentMethod,
  Purchase,
  PurchasePaymentStatus,
} from './types';
import { translations } from './i18n';
import { AuthView } from './components/AuthView';
import { PosTerminalView } from './components/PosTerminalView';
import { SalesView } from './components/SalesView';
import { InventoryView } from './components/InventoryView';
import { PurchasesView } from './components/PurchasesView';
import { InvoicesSettingsView } from './components/InvoicesSettingsView';
import { ZatcaCenterView } from './components/ZatcaCenterView';
import { LaravelExporterView } from './components/LaravelExporterView';
import { InvoiceReceiptModal } from './components/InvoiceReceiptModal';
import { PublicInvoicePage } from './components/PublicInvoicePage';

type ActiveSection = 'pos' | 'sales' | 'inventory' | 'purchases' | 'invoices' | 'zatca' | 'laravel';

interface ToastMessage {
  id: number;
  text: string;
  tone: 'success' | 'error';
}

export default function App() {
  const [lang, setLang] = useState<Language>('ar');
  const [darkMode, setDarkMode] = useState(false);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const publicMatch =
    typeof window !== 'undefined'
      ? window.location.pathname.match(/^\/i\/([a-zA-Z0-9-]+)\/?$/)
      : null;

  if (publicMatch) {
    return <PublicInvoicePage uuid={publicMatch[1]} />;
  }

  if (!authToken || !authUser) {
    return (
      <AuthView
        lang={lang}
        darkMode={darkMode}
        onToggleLang={() => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'))}
        onToggleDarkMode={() => setDarkMode((prev) => !prev)}
        onAuthSuccess={(token, user) => {
          setAuthToken(token);
          setAuthUser(user);
        }}
      />
    );
  }

  return (
    <PosWorkspace
      lang={lang}
      darkMode={darkMode}
      authToken={authToken}
      authUser={authUser}
      onToggleLang={() => setLang((prev) => (prev === 'ar' ? 'en' : 'ar'))}
      onToggleDarkMode={() => setDarkMode((prev) => !prev)}
      onSessionExpired={() => {
        setAuthToken(null);
        setAuthUser(null);
      }}
    />
  );
}

interface PosWorkspaceProps {
  lang: Language;
  darkMode: boolean;
  authToken: string;
  authUser: AuthUser;
  onToggleLang: () => void;
  onToggleDarkMode: () => void;
  onSessionExpired: () => void;
}

function PosWorkspace({
  lang,
  darkMode,
  authToken,
  authUser,
  onToggleLang,
  onToggleDarkMode,
  onSessionExpired,
}: PosWorkspaceProps) {
  const [section, setSection] = useState<ActiveSection>('pos');
  const [data, setData] = useState<BootstrapPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [receiptInvoice, setReceiptInvoice] = useState<Invoice | null>(null);
  const [autoPrintModal, setAutoPrintModal] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [posFullscreen, setPosFullscreen] = useState(false);
  const nativeFullscreenEnteredRef = useRef(false);

  const t = translations[lang];
  const isAr = lang === 'ar';
  const zatcaEnabled = data?.settings.zatca_enabled === 1;
  const isSellOnlyFullscreen = section === 'pos' && posFullscreen;

  const togglePosFullscreen = useCallback(() => {
    const next = !posFullscreen;
    setPosFullscreen(next);
    if (next) {
      try {
        const req = document.documentElement.requestFullscreen?.();
        if (req && typeof req.then === 'function') {
          req
            .then(() => {
              nativeFullscreenEnteredRef.current = true;
            })
            .catch(() => {
              nativeFullscreenEnteredRef.current = false;
            });
        }
      } catch {
        nativeFullscreenEnteredRef.current = false;
      }
    } else {
      nativeFullscreenEnteredRef.current = false;
      try {
        if (document.fullscreenElement) {
          void document.exitFullscreen?.();
        }
      } catch {
        // Ignore browser fullscreen exit errors
      }
    }
  }, [posFullscreen]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (nativeFullscreenEnteredRef.current && !document.fullscreenElement) {
        nativeFullscreenEnteredRef.current = false;
        setPosFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      if (nativeFullscreenEnteredRef.current && document.fullscreenElement) {
        nativeFullscreenEnteredRef.current = false;
        try {
          void document.exitFullscreen?.();
        } catch {
          // Ignore browser fullscreen exit errors
        }
      }
    };
  }, []);

  const notify = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setToast({ id, text, tone });
    setTimeout(() => {
      setToast((curr) => (curr?.id === id ? null : curr));
    }, 3400);
  }, []);

  const apiFetch = useCallback(
    async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${authToken}`);
      const res = await fetch(url, { ...init, headers });
      if (res.status === 401) {
        onSessionExpired();
      }
      return res;
    },
    [authToken, onSessionExpired]
  );

  const handleLogout = async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } finally {
      onSessionExpired();
    }
  };

  const handleDownloadLaravelZip = async () => {
    const res = await apiFetch('/api/laravel-export');
    if (!res.ok) {
      notify(isAr ? 'تعذر تحميل حزمة Laravel' : 'Failed to download Laravel ZIP', 'error');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mizan-laravel-livewire-zatca.zip';
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    const level = data?.settings.font_size;
    document.documentElement.dataset.fontSize =
      level === 'small' || level === 'large' ? level : 'medium';
  }, [data?.settings.font_size]);

  const fetchBootstrap = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiFetch('/api/bootstrap');
      if (!res.ok) throw new Error('Failed to load workspace data.');
      const payload = (await res.json()) as BootstrapPayload;
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect to server.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    fetchBootstrap();
  }, [fetchBootstrap]);

  const handleCheckout = async (payload: {
    items: Array<{ product_id: number; qty: number }>;
    invoice_subtype: InvoiceSubtype;
    payment_method: PaymentMethod;
    cash_amount: number;
    discount_total: number;
    customer_id: number | null;
  }) => {
    const res = await apiFetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      invoice?: Invoice;
      settings?: OrganizationSettings;
      products?: BootstrapPayload['products'];
      invoices?: BootstrapPayload['invoices'];
      movements?: BootstrapPayload['movements'];
    };
    if (!res.ok) {
      notify(body.error || 'Checkout failed', 'error');
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: body.settings ?? prev.settings,
            products: body.products ?? prev.products,
            invoices: body.invoices ?? prev.invoices,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );
    if (body.invoice) {
      const shouldAutoPrint = (body.settings?.auto_print_receipt ?? data?.settings.auto_print_receipt) === 1;
      setAutoPrintModal(shouldAutoPrint);
      setReceiptInvoice(body.invoice);
      notify(
        isAr
          ? `تم إصدار الفاتورة ${body.invoice.invoice_number}${
              body.settings?.zatca_enabled === 1 ? ` (${body.invoice.zatca_status})` : ''
            }`
          : `Issued ${body.invoice.invoice_number}${
              body.settings?.zatca_enabled === 1 ? ` (${body.invoice.zatca_status})` : ''
            }`
      );
    }
  };

  const handleHoldCart = async (payload: {
    label: string;
    items: Array<{ product_id: number; qty: number }>;
    discount: number;
    customer_id: number | null;
    invoice_subtype: InvoiceSubtype;
  }) => {
    const res = await apiFetch('/api/carts/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { heldCarts?: BootstrapPayload['heldCarts'] };
    if (res.ok && body.heldCarts) {
      setData((prev) => (prev ? { ...prev, heldCarts: body.heldCarts! } : prev));
    }
  };

  const handleDeleteHeldCart = async (id: number) => {
    const res = await apiFetch(`/api/carts/hold/${id}`, { method: 'DELETE' });
    const body = (await res.json()) as { heldCarts?: BootstrapPayload['heldCarts'] };
    if (res.ok && body.heldCarts) {
      setData((prev) => (prev ? { ...prev, heldCarts: body.heldCarts! } : prev));
    }
  };

  const handleCreateCustomer = async (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    address_ar: string;
    phone: string;
  }): Promise<number> => {
    const res = await apiFetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      customerId: number;
      customers: BootstrapPayload['customers'];
    };
    if (res.ok) {
      setData((prev) => (prev ? { ...prev, customers: body.customers } : prev));
      notify(isAr ? 'تمت إضافة العميل' : 'Customer added');
      return body.customerId;
    }
    return 0;
  };

  const handleUpdateCustomer = async (
    id: number,
    payload: {
      name_ar: string;
      name_en: string;
      vat_number: string;
      cr_number: string;
      address_ar: string;
      phone: string;
    }
  ) => {
    const res = await apiFetch(`/api/customers/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      customers?: BootstrapPayload['customers'];
    };
    if (!res.ok) {
      notify(body.error || 'Failed to update customer', 'error');
      return;
    }
    if (body.customers) {
      setData((prev) => (prev ? { ...prev, customers: body.customers! } : prev));
    }
    notify(isAr ? 'تم تحديث بيانات العميل' : 'Customer updated');
  };

  const handleCreateProduct = async (payload: Record<string, unknown>) => {
    const res = await apiFetch('/api/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      products?: BootstrapPayload['products'];
      movements?: BootstrapPayload['movements'];
    };
    if (!res.ok) {
      notify(body.error || 'Failed to add product', 'error');
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            products: body.products ?? prev.products,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );
    notify(isAr ? 'تمت إضافة الصنف بنجاح' : 'Product added');
  };

  const handleUpdateProduct = async (id: number, payload: Record<string, unknown>) => {
    const res = await apiFetch(`/api/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { products?: BootstrapPayload['products'] };
    if (res.ok && body.products) {
      setData((prev) => (prev ? { ...prev, products: body.products! } : prev));
      notify(isAr ? 'تم تحديث بيانات الصنف' : 'Product updated');
    }
  };

  const handleStockMovement = async (payload: {
    product_id: number;
    type: 'purchase' | 'adjustment' | 'return';
    qty: number;
    notes: string;
  }) => {
    const res = await apiFetch('/api/inventory/movement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      products?: BootstrapPayload['products'];
      movements?: BootstrapPayload['movements'];
    };
    if (!res.ok) {
      notify(body.error || 'Movement failed', 'error');
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            products: body.products ?? prev.products,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );
    notify(isAr ? 'تم تحديث الرصيد المخزني' : 'Stock updated');
  };

  const handleCreateSupplier = async (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    phone: string;
    email: string;
    address_ar: string;
  }): Promise<number> => {
    const res = await apiFetch('/api/suppliers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      supplierId?: number;
      suppliers?: BootstrapPayload['suppliers'];
    };
    if (!res.ok) {
      notify(body.error || 'Failed to add supplier', 'error');
      return 0;
    }
    if (body.suppliers) {
      setData((prev) => (prev ? { ...prev, suppliers: body.suppliers! } : prev));
    }
    notify(isAr ? 'تمت إضافة المورد بنجاح' : 'Supplier added');
    return body.supplierId ?? 0;
  };

  const handleCreatePurchase = async (payload: {
    supplier_id: number;
    supplier_invoice_no: string;
    payment_status: PurchasePaymentStatus;
    paid_amount: number;
    notes: string;
    items: Array<{ product_id: number; qty: number; unit_cost: number; tax_rate: number }>;
  }) => {
    const res = await apiFetch('/api/purchases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as {
      error?: string;
      purchase?: Purchase;
      purchases?: BootstrapPayload['purchases'];
      products?: BootstrapPayload['products'];
      movements?: BootstrapPayload['movements'];
    };
    if (!res.ok) {
      notify(body.error || 'Failed to record purchase', 'error');
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            purchases: body.purchases ?? prev.purchases,
            products: body.products ?? prev.products,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );
    notify(
      isAr
        ? `تم تسجيل فاتورة المشتريات ${body.purchase?.purchase_number ?? ''} وتحديث المخزون`
        : `Purchase ${body.purchase?.purchase_number ?? ''} recorded & stock updated`
    );
  };

  const handlePayPurchase = async (purchaseId: number, amount: number) => {
    const res = await apiFetch(`/api/purchases/${purchaseId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount }),
    });
    const body = (await res.json()) as {
      error?: string;
      purchases?: BootstrapPayload['purchases'];
    };
    if (!res.ok) {
      notify(body.error || 'Payment failed', 'error');
      return;
    }
    if (body.purchases) {
      setData((prev) => (prev ? { ...prev, purchases: body.purchases! } : prev));
    }
    notify(isAr ? 'تم تسجيل دفعة السداد للمورد' : 'Supplier payment recorded');
  };

  const handleUpdateSettings = async (payload: Partial<OrganizationSettings>) => {
    const res = await apiFetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = (await res.json()) as { error?: string; settings?: OrganizationSettings };
    if (!res.ok) {
      notify(body.error || 'Failed to update settings', 'error');
      return;
    }
    if (body.settings) {
      setData((prev) => (prev ? { ...prev, settings: body.settings! } : prev));
      if (body.settings.zatca_enabled !== 1 && section === 'zatca') {
        setSection('invoices');
      } else if (body.settings.zatca_enabled === 1 && section === 'invoices') {
        setSection('zatca');
      }
      notify(isAr ? 'تم حفظ الإعدادات' : 'Settings saved');
    }
  };

  const handleGenerateKeys = async () => {
    const res = await apiFetch('/api/zatca/generate-keys', { method: 'POST' });
    const body = (await res.json()) as { settings?: OrganizationSettings };
    if (res.ok && body.settings) {
      setData((prev) => (prev ? { ...prev, settings: body.settings! } : prev));
      notify(isAr ? 'تم توليد مفاتيح secp256k1 وطلب CSR' : 'Generated secp256k1 keys & CSR');
    }
  };

  const handleOnboardStep = async (
    action: 'request_ccsid' | 'compliance_check' | 'request_pcsid',
    otp?: string
  ) => {
    const res = await apiFetch('/api/zatca/onboard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, otp }),
    });
    const body = (await res.json()) as { error?: string; settings?: OrganizationSettings };
    if (!res.ok) {
      notify(body.error || 'Onboarding step failed', 'error');
      return;
    }
    if (body.settings) {
      setData((prev) => (prev ? { ...prev, settings: body.settings! } : prev));
      notify(isAr ? 'تم تنفيذ خطوة الربط بنجاح' : 'Onboarding step completed');
    }
  };

  const handleRetryInvoice = async (id: number) => {
    const res = await apiFetch(`/api/invoices/${id}/retry`, { method: 'POST' });
    const body = (await res.json()) as { invoices?: Invoice[] };
    if (res.ok && body.invoices) {
      setData((prev) => (prev ? { ...prev, invoices: body.invoices! } : prev));
      notify(isAr ? 'تمت إعادة إرسال الفاتورة لهيئة الزكاة' : 'Invoice re-dispatched to ZATCA');
    }
  };

  const handleCreditNote = async (invoiceId: number) => {
    const res = await apiFetch(`/api/invoices/${invoiceId}/credit-note`, {
      method: 'POST',
    });
    const body = (await res.json()) as {
      error?: string;
      invoice?: Invoice;
      settings?: OrganizationSettings;
      products?: BootstrapPayload['products'];
      invoices?: Invoice[];
      movements?: BootstrapPayload['movements'];
    };
    if (!res.ok) {
      notify(body.error || 'Credit note failed', 'error');
      return;
    }
    setData((prev) =>
      prev
        ? {
            ...prev,
            settings: body.settings ?? prev.settings,
            products: body.products ?? prev.products,
            invoices: body.invoices ?? prev.invoices,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );
    if (body.invoice) {
      notify(
        isAr
          ? `تم إصدار إشعار دائن ${body.invoice.invoice_number}`
          : `Issued Credit Note ${body.invoice.invoice_number}`
      );
      setReceiptInvoice(body.invoice);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      {!isSellOnlyFullscreen && (
        <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800">
          <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-8">
            {/* Zone 1: Single-line Wordmark */}
            <a
              href="#pos"
              onClick={(e) => {
                e.preventDefault();
                setSection('pos');
              }}
              className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
            >
              {t.brand}
            </a>

            {/* Zone 2: 5 single-line Navigation Links */}
            <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium overflow-x-auto">
              {(
                [
                  ['pos', t.navPos],
                  ['sales', t.navSales],
                  ['inventory', t.navInventory],
                  ['purchases', t.navPurchases],
                  zatcaEnabled ? ['zatca', t.navZatca] : ['invoices', t.navInvoices],
                  ['laravel', t.navLaravel],
                ] as Array<[ActiveSection, string]>
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSection(key)}
                  className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                    section === key
                      ? 'border-emerald-700 text-emerald-800 dark:border-emerald-400 dark:text-emerald-300 font-semibold'
                      : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            {/* Zone 3: 1 Primary Action */}
            <div className="shrink-0 hidden sm:block">
              <button
                type="button"
                onClick={() => void handleDownloadLaravelZip()}
                className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {t.downloadLaravel}
              </button>
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main
        className={
          isSellOnlyFullscreen
            ? 'flex-1 w-full mx-auto px-3 sm:px-5 py-3 space-y-4'
            : 'flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-5 space-y-5'
        }
      >
        {/* Workspace Toolbar (Secondary Controls & Store Metadata) */}
        {data && !isSellOnlyFullscreen && (
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800 text-xs">
            <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-400">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {isAr ? data.settings.name_ar : data.settings.name_en}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{data.settings.vat_number}</span>
              <span aria-hidden="true">·</span>
              <span>
                {!zatcaEnabled
                  ? t.modeDirect
                  : data.settings.mode === 'fatoora_simulation'
                  ? t.modeFatoora
                  : t.modeSimulator}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0">
                <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span className="font-medium">{authUser.full_name}</span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {authUser.role === 'admin'
                    ? isAr
                      ? 'مدير النظام'
                      : 'Admin'
                    : isAr
                    ? 'كاشير'
                    : 'Cashier'}
                </span>
              </div>
              <button
                type="button"
                onClick={onToggleLang}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Globe className="w-3.5 h-3.5" />
                {t.langToggle}
              </button>
              <button
                type="button"
                onClick={onToggleDarkMode}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {darkMode ? t.themeLight : t.themeDark}
              </button>
              <button
                type="button"
                onClick={() => void handleLogout()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-white dark:bg-slate-900 text-red-700 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors whitespace-nowrap shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                {isAr ? 'خروج' : 'Logout'}
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-8 h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
            <div className="lg:col-span-4 h-96 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse" />
          </div>
        ) : error || !data ? (
          <div className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900 rounded-xl p-8 text-center space-y-3">
            <div className="text-sm font-semibold text-red-600 dark:text-red-400">
              {error || 'Unable to load application data.'}
            </div>
            <button
              type="button"
              onClick={fetchBootstrap}
              className="px-4 py-2 text-xs font-semibold bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg"
            >
              {isAr ? 'إعادة المحاولة' : 'Retry'}
            </button>
          </div>
        ) : (
          <>
            {section === 'pos' && (
              <PosTerminalView
                lang={lang}
                products={data.products}
                customers={data.customers}
                heldCarts={data.heldCarts}
                zatcaEnabled={zatcaEnabled}
                isFullscreen={isSellOnlyFullscreen}
                onToggleFullscreen={togglePosFullscreen}
                onCheckout={handleCheckout}
                onHoldCart={handleHoldCart}
                onDeleteHeldCart={handleDeleteHeldCart}
                onCreateCustomer={handleCreateCustomer}
                onNotify={notify}
              />
            )}

            {section === 'sales' && (
              <SalesView
                lang={lang}
                settings={data.settings}
                products={data.products}
                customers={data.customers}
                invoices={data.invoices}
                onCreateSale={handleCheckout}
                onCreditNote={handleCreditNote}
                onCreateCustomer={handleCreateCustomer}
                onUpdateCustomer={handleUpdateCustomer}
                onOpenReceipt={(inv) => {
                  setAutoPrintModal(false);
                  setReceiptInvoice(inv);
                }}
                onNotify={notify}
              />
            )}

            {section === 'inventory' && (
              <InventoryView
                lang={lang}
                products={data.products}
                movements={data.movements}
                pageSize={data.settings.table_page_size || 10}
                onCreateProduct={handleCreateProduct}
                onUpdateProduct={handleUpdateProduct}
                onStockMovement={handleStockMovement}
              />
            )}

            {section === 'purchases' && (
              <PurchasesView
                lang={lang}
                products={data.products}
                suppliers={data.suppliers}
                purchases={data.purchases}
                pageSize={data.settings.table_page_size || 10}
                onCreatePurchase={handleCreatePurchase}
                onPayPurchase={handlePayPurchase}
                onCreateSupplier={handleCreateSupplier}
                onNotify={notify}
              />
            )}

            {section === 'invoices' && (
              <InvoicesSettingsView
                lang={lang}
                settings={data.settings}
                invoices={data.invoices}
                onOpenReceipt={(inv) => {
                  setAutoPrintModal(false);
                  setReceiptInvoice(inv);
                }}
                onCreditNote={handleCreditNote}
                onUpdateSettings={handleUpdateSettings}
                onNotify={notify}
              />
            )}

            {section === 'zatca' && zatcaEnabled && (
              <ZatcaCenterView
                lang={lang}
                authToken={authToken}
                settings={data.settings}
                invoices={data.invoices}
                onUpdateSettings={handleUpdateSettings}
                onGenerateKeys={handleGenerateKeys}
                onOnboardStep={handleOnboardStep}
                onRetryInvoice={handleRetryInvoice}
                onOpenReceipt={(inv) => {
                  setAutoPrintModal(false);
                  setReceiptInvoice(inv);
                }}
                onNotify={notify}
              />
            )}

            {section === 'laravel' && (
              <LaravelExporterView
                lang={lang}
                authToken={authToken}
                onDownloadZip={() => void handleDownloadLaravelZip()}
                onNotify={(m) => notify(m)}
              />
            )}
          </>
        )}
      </main>

      {/* Receipt Print Modal */}
      {data && receiptInvoice && (
        <InvoiceReceiptModal
          invoice={receiptInvoice}
          settings={data.settings}
          lang={lang}
          autoPrint={autoPrintModal}
          onClose={() => {
            setReceiptInvoice(null);
            setAutoPrintModal(false);
          }}
          onCreditNote={handleCreditNote}
          onNotify={notify}
        />
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed bottom-5 end-5 z-50 max-w-sm">
          <div
            className={`px-4 py-3 rounded-xl border text-xs font-medium shadow-md ${
              toast.tone === 'error'
                ? 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200'
                : 'bg-slate-900 dark:bg-white border-slate-800 dark:border-slate-200 text-white dark:text-slate-900'
            }`}
          >
            {toast.text}
          </div>
        </div>
      )}
    </div>
  );
}
