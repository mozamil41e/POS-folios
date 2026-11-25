import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Globe, LogOut, Moon, Sun, User } from 'lucide-react';
import type {
  AuthUser,
  BootstrapPayload,
  Category,
  Invoice,
  InvoiceSubtype,
  Language,
  OrganizationSettings,
  PaymentMethod,
  PermissionKey,
  Purchase,
  PurchasePaymentStatus,
  RoleRecord,
  Voucher,
  VoucherChannel,
  VoucherType,
} from '../shared/types';
import { translations } from './i18n';
import { describeApiError, type ApiErrorBody } from './api-errors';
import { canViewCost, hasAnyPermission, hasPermission } from '../shared/permissions';
import { AuthView } from './components/AuthView';
import { PosTerminalView } from './components/PosTerminalView';
import { SalesView } from './components/SalesView';
import { InventoryView } from './components/InventoryView';
import { PurchasesView } from './components/PurchasesView';
import {
  InvoicesSettingsView,
  type ReportsSettingsSubTab,
} from './components/InvoicesSettingsView';
import { InvoiceReceiptModal } from './components/InvoiceReceiptModal';
import { PublicInvoicePage } from './components/PublicInvoicePage';

type ActiveSection = 'pos' | 'sales' | 'inventory' | 'purchases' | 'invoices';

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
      onAuthUserUpdated={(nextUser) => {
        setAuthUser(nextUser);
      }}
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
  onAuthUserUpdated: (user: AuthUser) => void;
  onSessionExpired: () => void;
}

function PosWorkspace({
  lang,
  darkMode,
  authToken,
  authUser,
  onToggleLang,
  onToggleDarkMode,
  onAuthUserUpdated,
  onSessionExpired,
}: PosWorkspaceProps) {
  const [section, setSection] = useState<ActiveSection>('pos');
  const [requestedSubTab, setRequestedSubTab] = useState<ReportsSettingsSubTab | undefined>(
    undefined
  );
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

  const allowedNavItems = useMemo(() => {
    const items: Array<[ActiveSection, string]> = [];
    if (hasPermission(authUser, 'pos.access')) {
      items.push(['pos', t.navPos]);
    }
    if (hasAnyPermission(authUser, ['sales.view', 'sales.return', 'customers.manage'])) {
      items.push(['sales', t.navSales]);
    }
    if (hasAnyPermission(authUser, ['inventory.view', 'inventory.manage', 'inventory.adjust'])) {
      items.push(['inventory', t.navInventory]);
    }
    if (hasAnyPermission(authUser, ['purchases.view', 'purchases.manage'])) {
      items.push(['purchases', t.navPurchases]);
    }
    if (hasAnyPermission(authUser, ['reports.view', 'settings.manage', 'users.manage'])) {
      items.push(['invoices', t.navInvoices]);
    }
    return items;
  }, [authUser, t]);

  useEffect(() => {
    if (allowedNavItems.length === 0) return;
    if (!allowedNavItems.some(([key]) => key === section)) {
      setSection(allowedNavItems[0][0]);
    }
  }, [allowedNavItems, section]);

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

  /**
   * One contract for every mutation (R1.6, H1): a failure (HTTP error, bad JSON
   * or no network) is reported here and the caller gets null. Screens rely on
   * the boolean/number the handlers return and only clear carts, forms or
   * modals after a confirmed success.
   */
  const callApi = async <T extends object>(
    url: string,
    init: RequestInit,
    fallbackError: string
  ): Promise<T | null> => {
    let res: Response;
    try {
      res = await apiFetch(url, init);
    } catch {
      notify(
        isAr
          ? 'تعذر الاتصال بالخادم، تحقق من الشبكة وحاول مرة أخرى'
          : 'Could not reach the server. Check the connection and try again.',
        'error'
      );
      return null;
    }
    const body = (await res.json().catch(() => null)) as (T & ApiErrorBody) | null;
    if (!res.ok || body === null) {
      // A 401 already ended the session (apiFetch); nothing more to report.
      // Known error codes are shown in the user's language (R1.10).
      if (res.status !== 401) {
        notify(describeApiError(body, lang) || body?.error || fallbackError, 'error');
      }
      return null;
    }
    return body;
  };

  const jsonRequest = (method: 'POST' | 'PUT', payload?: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  const handleCheckout = async (payload: {
    items: Array<{ product_id: number; qty: number }>;
    invoice_subtype: InvoiceSubtype;
    payment_method: PaymentMethod;
    cash_amount: number;
    discount_total: number;
    customer_id: number | null;
  }): Promise<boolean> => {
    const body = await callApi<{
      invoice?: Invoice;
      settings?: OrganizationSettings;
      products?: BootstrapPayload['products'];
      invoices?: BootstrapPayload['invoices'];
      movements?: BootstrapPayload['movements'];
    }>('/api/invoices', jsonRequest('POST', payload), 'Checkout failed');
    if (!body) return false;
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
          ? `تم إصدار الفاتورة ${body.invoice.invoice_number}`
          : `Issued ${body.invoice.invoice_number}`
      );
    }
    return true;
  };

  const handleHoldCart = async (payload: {
    label: string;
    items: Array<{ product_id: number; qty: number }>;
    discount: number;
    customer_id: number | null;
    invoice_subtype: InvoiceSubtype;
  }): Promise<boolean> => {
    const body = await callApi<{ heldCarts?: BootstrapPayload['heldCarts'] }>(
      '/api/carts/hold',
      jsonRequest('POST', payload),
      'Failed to hold the order'
    );
    if (!body) return false;
    if (body.heldCarts) {
      setData((prev) => (prev ? { ...prev, heldCarts: body.heldCarts! } : prev));
    }
    return true;
  };

  const handleDeleteHeldCart = async (id: number): Promise<boolean> => {
    const body = await callApi<{ heldCarts?: BootstrapPayload['heldCarts'] }>(
      `/api/carts/hold/${id}`,
      { method: 'DELETE' },
      'Failed to remove the held order'
    );
    if (!body) return false;
    if (body.heldCarts) {
      setData((prev) => (prev ? { ...prev, heldCarts: body.heldCarts! } : prev));
    }
    return true;
  };

  /** Returns the new customer's id, or 0 when it was not saved. */
  const handleCreateCustomer = async (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    address_ar: string;
    phone: string;
  }): Promise<number> => {
    const body = await callApi<{
      customerId?: number;
      customers?: BootstrapPayload['customers'];
    }>('/api/customers', jsonRequest('POST', payload), 'Failed to add customer');
    if (!body) return 0;
    if (body.customers) {
      setData((prev) => (prev ? { ...prev, customers: body.customers! } : prev));
    }
    notify(isAr ? 'تمت إضافة العميل' : 'Customer added');
    return body.customerId ?? 0;
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
  ): Promise<boolean> => {
    const body = await callApi<{ customers?: BootstrapPayload['customers'] }>(
      `/api/customers/${id}`,
      jsonRequest('PUT', payload),
      'Failed to update customer'
    );
    if (!body) return false;
    if (body.customers) {
      setData((prev) => (prev ? { ...prev, customers: body.customers! } : prev));
    }
    notify(isAr ? 'تم تحديث بيانات العميل' : 'Customer updated');
    return true;
  };

  /** Product and category responses may carry either list; merge what came back. */
  const mergeCatalog = (body: {
    products?: BootstrapPayload['products'];
    categories?: BootstrapPayload['categories'];
    movements?: BootstrapPayload['movements'];
  }) =>
    setData((prev) =>
      prev
        ? {
            ...prev,
            products: body.products ?? prev.products,
            categories: body.categories ?? prev.categories,
            movements: body.movements ?? prev.movements,
          }
        : prev
    );

  const handleCreateProduct = async (payload: Record<string, unknown>): Promise<boolean> => {
    const body = await callApi<{
      products?: BootstrapPayload['products'];
      categories?: BootstrapPayload['categories'];
      movements?: BootstrapPayload['movements'];
    }>('/api/products', jsonRequest('POST', payload), 'Failed to add product');
    if (!body) return false;
    mergeCatalog(body);
    notify(isAr ? 'تمت إضافة الصنف بنجاح' : 'Product added');
    return true;
  };

  const handleUpdateProduct = async (
    id: number,
    payload: Record<string, unknown>
  ): Promise<boolean> => {
    const body = await callApi<{
      products?: BootstrapPayload['products'];
      categories?: BootstrapPayload['categories'];
    }>(`/api/products/${id}`, jsonRequest('PUT', payload), 'Failed to update product');
    if (!body) return false;
    mergeCatalog(body);
    notify(isAr ? 'تم تحديث بيانات الصنف' : 'Product updated');
    return true;
  };

  // Product categories (R1.11c).
  const handleCreateCategory = async (payload: { name_ar: string; name_en: string }): Promise<number> => {
    const body = await callApi<{
      category?: Category;
      categories?: BootstrapPayload['categories'];
    }>('/api/categories', jsonRequest('POST', payload), 'Failed to add category');
    if (!body) return 0;
    mergeCatalog(body);
    notify(isAr ? 'تمت إضافة التصنيف' : 'Category added');
    return body.category?.id ?? 0;
  };

  const handleUpdateCategory = async (
    id: number,
    payload: { name_ar: string; name_en: string }
  ): Promise<boolean> => {
    const body = await callApi<{
      categories?: BootstrapPayload['categories'];
      products?: BootstrapPayload['products'];
    }>(`/api/categories/${id}`, jsonRequest('PUT', payload), 'Failed to update category');
    if (!body) return false;
    mergeCatalog(body);
    notify(isAr ? 'تم تحديث التصنيف وأصنافه' : 'Category and its products updated');
    return true;
  };

  const handleDeleteCategory = async (id: number): Promise<boolean> => {
    const body = await callApi<{ categories?: BootstrapPayload['categories'] }>(
      `/api/categories/${id}`,
      { method: 'DELETE' },
      'Failed to delete category'
    );
    if (!body) return false;
    mergeCatalog(body);
    notify(isAr ? 'تم حذف التصنيف' : 'Category deleted');
    return true;
  };

  const handleReorderCategories = async (ids: number[]): Promise<boolean> => {
    const body = await callApi<{ categories?: BootstrapPayload['categories'] }>(
      '/api/categories/order',
      jsonRequest('POST', { ids }),
      'Failed to reorder categories'
    );
    if (!body) return false;
    mergeCatalog(body);
    return true;
  };

  const handleStockMovement = async (payload: {
    product_id: number;
    type: 'purchase' | 'adjustment' | 'return';
    qty: number;
    notes: string;
    reference_no?: string;
  }): Promise<boolean> => {
    const body = await callApi<{
      products?: BootstrapPayload['products'];
      movements?: BootstrapPayload['movements'];
    }>('/api/inventory/movement', jsonRequest('POST', payload), 'Movement failed');
    if (!body) return false;
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
    return true;
  };

  /** Returns the new supplier's id, or 0 when it was not saved. */
  const handleCreateSupplier = async (payload: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    phone: string;
    email: string;
    address_ar: string;
  }): Promise<number> => {
    const body = await callApi<{
      supplierId?: number;
      suppliers?: BootstrapPayload['suppliers'];
    }>('/api/suppliers', jsonRequest('POST', payload), 'Failed to add supplier');
    if (!body) return 0;
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
  }): Promise<boolean> => {
    const body = await callApi<{
      purchase?: Purchase;
      purchases?: BootstrapPayload['purchases'];
      products?: BootstrapPayload['products'];
      movements?: BootstrapPayload['movements'];
    }>('/api/purchases', jsonRequest('POST', payload), 'Failed to record purchase');
    if (!body) return false;
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
    return true;
  };

  const handlePayPurchase = async (purchaseId: number, amount: number): Promise<boolean> => {
    const body = await callApi<{ purchases?: BootstrapPayload['purchases'] }>(
      `/api/purchases/${purchaseId}/pay`,
      jsonRequest('POST', { amount }),
      'Payment failed'
    );
    if (!body) return false;
    if (body.purchases) {
      setData((prev) => (prev ? { ...prev, purchases: body.purchases! } : prev));
    }
    notify(isAr ? 'تم تسجيل دفعة السداد للمورد' : 'Supplier payment recorded');
    return true;
  };

  const handleCreateVoucher = async (payload: {
    voucher_type: VoucherType;
    payment_channel: VoucherChannel;
    party_name: string;
    category: string;
    amount: number;
    notes: string;
    voucher_date: string;
  }): Promise<boolean> => {
    const body = await callApi<{ vouchers?: Voucher[] }>(
      '/api/vouchers',
      jsonRequest('POST', payload),
      'Failed to save voucher'
    );
    if (!body) return false;
    if (body.vouchers) {
      setData((prev) => (prev ? { ...prev, vouchers: body.vouchers! } : prev));
    }
    notify(isAr ? 'تم حفظ السند بنجاح' : 'Voucher saved');
    return true;
  };

  // Vouchers are voided with a reason, never deleted (R1.8).
  const handleVoidVoucher = async (id: number, reason: string): Promise<boolean> => {
    const body = await callApi<{ vouchers?: Voucher[] }>(
      `/api/vouchers/${id}/void`,
      jsonRequest('POST', { reason }),
      'Failed to void voucher'
    );
    if (!body) return false;
    if (body.vouchers) {
      setData((prev) => (prev ? { ...prev, vouchers: body.vouchers! } : prev));
    }
    notify(isAr ? 'تم إلغاء السند' : 'Voucher voided');
    return true;
  };

  const handleUpdateSettings = async (
    payload: Partial<OrganizationSettings>
  ): Promise<boolean> => {
    const body = await callApi<{ settings?: OrganizationSettings }>(
      '/api/settings',
      jsonRequest('PUT', payload),
      'Failed to update settings'
    );
    if (!body) return false;
    if (body.settings) {
      setData((prev) => (prev ? { ...prev, settings: body.settings! } : prev));
    }
    notify(isAr ? 'تم حفظ الإعدادات' : 'Settings saved');
    return true;
  };

  const handleCreditNote = async (invoiceId: number): Promise<boolean> => {
    const body = await callApi<{
      invoice?: Invoice;
      settings?: OrganizationSettings;
      products?: BootstrapPayload['products'];
      invoices?: Invoice[];
      movements?: BootstrapPayload['movements'];
    }>(`/api/invoices/${invoiceId}/credit-note`, { method: 'POST' }, 'Credit note failed');
    if (!body) return false;
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
      // Show the credit note's receipt; it is printed on demand, never automatically.
      setAutoPrintModal(false);
      setReceiptInvoice(body.invoice);
    }
    return true;
  };

  const handleCreateUser = async (payload: {
    full_name: string;
    email: string;
    phone: string;
    password: string;
    role_id: number;
    is_active: boolean;
  }): Promise<boolean> => {
    const body = await callApi<{
      users?: BootstrapPayload['users'];
      roles?: BootstrapPayload['roles'];
    }>('/api/users', jsonRequest('POST', payload), 'Failed to create user');
    if (!body) return false;
    setData((prev) =>
      prev
        ? {
            ...prev,
            users: body.users ?? prev.users,
            roles: body.roles ?? prev.roles,
          }
        : prev
    );
    notify(isAr ? 'تمت إضافة المستخدم بنجاح' : 'User created successfully');
    return true;
  };

  const handleUpdateUser = async (
    id: number,
    payload: {
      full_name: string;
      email: string;
      phone: string;
      password?: string;
      role_id: number;
      is_active: boolean;
    }
  ): Promise<boolean> => {
    const body = await callApi<{
      users?: BootstrapPayload['users'];
      roles?: BootstrapPayload['roles'];
      currentUser?: AuthUser;
    }>(`/api/users/${id}`, jsonRequest('PUT', payload), 'Failed to update user');
    if (!body) return false;
    setData((prev) =>
      prev
        ? {
            ...prev,
            users: body.users ?? prev.users,
            roles: body.roles ?? prev.roles,
          }
        : prev
    );
    if (body.currentUser) {
      onAuthUserUpdated(body.currentUser);
    }
    notify(isAr ? 'تم تحديث بيانات المستخدم' : 'User updated');
    return true;
  };

  const handleDeleteUser = async (id: number): Promise<boolean> => {
    const body = await callApi<{
      users?: BootstrapPayload['users'];
      roles?: BootstrapPayload['roles'];
    }>(`/api/users/${id}`, { method: 'DELETE' }, 'Failed to delete user');
    if (!body) return false;
    setData((prev) =>
      prev
        ? {
            ...prev,
            users: body.users ?? prev.users,
            roles: body.roles ?? prev.roles,
          }
        : prev
    );
    notify(isAr ? 'تم حذف المستخدم' : 'User deleted');
    return true;
  };

  const handleCreateRole = async (payload: {
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
  }): Promise<RoleRecord | null> => {
    const body = await callApi<{
      role?: RoleRecord;
      roles?: BootstrapPayload['roles'];
    }>('/api/roles', jsonRequest('POST', payload), 'Failed to create role');
    if (!body) return null;
    setData((prev) =>
      prev
        ? {
            ...prev,
            roles: body.roles ?? prev.roles,
          }
        : prev
    );
    notify(isAr ? 'تم إنشاء الدور الوظيفي' : 'Role created');
    return body.role ?? null;
  };

  const handleUpdateRole = async (
    id: number,
    payload: {
      name_ar: string;
      name_en: string;
      description_ar: string;
      description_en: string;
      permissions: PermissionKey[];
    }
  ): Promise<boolean> => {
    const body = await callApi<{
      roles?: BootstrapPayload['roles'];
      users?: BootstrapPayload['users'];
      currentUser?: AuthUser;
    }>(`/api/roles/${id}`, jsonRequest('PUT', payload), 'Failed to update role');
    if (!body) return false;
    setData((prev) =>
      prev
        ? {
            ...prev,
            roles: body.roles ?? prev.roles,
            users: body.users ?? prev.users,
          }
        : prev
    );
    if (body.currentUser) {
      onAuthUserUpdated(body.currentUser);
    }
    notify(isAr ? 'تم حفظ صلاحيات الدور بنجاح' : 'Role permissions saved');
    return true;
  };

  const handleDeleteRole = async (id: number): Promise<boolean> => {
    const body = await callApi<{ roles?: BootstrapPayload['roles'] }>(
      `/api/roles/${id}`,
      { method: 'DELETE' },
      'Failed to delete role'
    );
    if (!body) return false;
    setData((prev) =>
      prev
        ? {
            ...prev,
            roles: body.roles ?? prev.roles,
          }
        : prev
    );
    notify(isAr ? 'تم حذف الدور' : 'Role deleted');
    return true;
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
                if (allowedNavItems.length > 0) {
                  setSection(allowedNavItems[0][0]);
                }
              }}
              className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
            >
              {t.brand}
            </a>

            {/* Zone 2: Single-line Permission-Gated Navigation Links */}
            <nav className="flex items-center gap-4 sm:gap-6 text-sm font-medium overflow-x-auto">
              {allowedNavItems.map(([key, label]) => (
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
            {hasPermission(authUser, 'pos.access') && (
              <div className="shrink-0 hidden sm:block">
                <button
                  type="button"
                  onClick={() => {
                    if (section !== 'pos') {
                      setSection('pos');
                    } else {
                      togglePosFullscreen();
                    }
                  }}
                  className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {section !== 'pos'
                    ? t.navPos
                    : isAr
                    ? 'شاشة البيع فقط'
                    : 'Sell Fullscreen'}
                </button>
              </div>
            )}
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
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  if (hasPermission(authUser, 'users.manage')) {
                    setRequestedSubTab('users');
                    setSection('invoices');
                  }
                }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 whitespace-nowrap shrink-0 ${
                  hasPermission(authUser, 'users.manage')
                    ? 'hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer'
                    : 'cursor-default'
                }`}
              >
                <User className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span className="font-medium">{authUser.full_name}</span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="text-slate-500 dark:text-slate-400">
                  {isAr ? authUser.role_name_ar : authUser.role_name_en}
                </span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="font-mono text-emerald-700 dark:text-emerald-400 tabular-nums">
                  {authUser.permissions.length}
                </span>
              </button>
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
                currentUser={authUser}
                products={data.products ?? []}
                categories={data.categories ?? []}
                customers={data.customers ?? []}
                heldCarts={data.heldCarts ?? []}
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
                currentUser={authUser}
                settings={data.settings}
                products={data.products ?? []}
                customers={data.customers ?? []}
                invoices={data.invoices ?? []}
                canViewCost={canViewCost(authUser)}
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
                currentUser={authUser}
                products={data.products ?? []}
                categories={data.categories ?? []}
                movements={data.movements ?? []}
                pageSize={data.settings.table_page_size || 10}
                canViewCost={canViewCost(authUser)}
                onCreateProduct={handleCreateProduct}
                onUpdateProduct={handleUpdateProduct}
                onStockMovement={handleStockMovement}
                onCreateCategory={handleCreateCategory}
                onUpdateCategory={handleUpdateCategory}
                onDeleteCategory={handleDeleteCategory}
                onReorderCategories={handleReorderCategories}
              />
            )}

            {section === 'purchases' && (
              <PurchasesView
                lang={lang}
                currentUser={authUser}
                products={data.products ?? []}
                suppliers={data.suppliers ?? []}
                purchases={data.purchases ?? []}
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
                currentUser={authUser}
                requestedTab={requestedSubTab}
                onRequestedTabHandled={() => setRequestedSubTab(undefined)}
                settings={data.settings}
                invoices={data.invoices ?? []}
                products={data.products ?? []}
                customers={data.customers ?? []}
                suppliers={data.suppliers ?? []}
                purchases={data.purchases ?? []}
                movements={data.movements ?? []}
                vouchers={data.vouchers ?? []}
                users={data.users ?? []}
                roles={data.roles ?? []}
                onCreateVoucher={handleCreateVoucher}
                onVoidVoucher={handleVoidVoucher}
                onStockMovement={handleStockMovement}
                onUpdateSettings={handleUpdateSettings}
                onCreateUser={handleCreateUser}
                onUpdateUser={handleUpdateUser}
                onDeleteUser={handleDeleteUser}
                onCreateRole={handleCreateRole}
                onUpdateRole={handleUpdateRole}
                onDeleteRole={handleDeleteRole}
                onNotify={notify}
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
          currentUser={authUser}
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
