import type { AuthUser, PermissionKey } from './types';

export interface PermissionDefinition {
  key: PermissionKey;
  label_ar: string;
  label_en: string;
  desc_ar: string;
  desc_en: string;
}

export interface PermissionGroupDefinition {
  id: string;
  title_ar: string;
  title_en: string;
  permissions: PermissionDefinition[];
}

export const PERMISSION_GROUPS: PermissionGroupDefinition[] = [
  {
    id: 'pos',
    title_ar: 'نقطة البيع (الكاشير)',
    title_en: 'POS Terminal',
    permissions: [
      {
        key: 'pos.access',
        label_ar: 'الوصول لنقطة البيع وإصدار الفواتير',
        label_en: 'Access POS & Issue Sales',
        desc_ar: 'فتح شاشة الكاشير وإتمام عمليات البيع والطباعة',
        desc_en: 'Open cashier screen and complete sales checkout',
      },
      {
        key: 'pos.discount',
        label_ar: 'منح خصومات على الفاتورة',
        label_en: 'Apply Invoice Discounts',
        desc_ar: 'تعديل خانة الخصم في سلة نقطة البيع',
        desc_en: 'Apply manual discounts at POS checkout',
      },
      {
        key: 'pos.hold',
        label_ar: 'تعليق واسترجاع الطلبات',
        label_en: 'Hold & Resume Carts',
        desc_ar: 'حفظ الفواتير المعلقة مؤقتاً واسترجاعها لاحقاً',
        desc_en: 'Park active carts and resume held orders',
      },
    ],
  },
  {
    id: 'sales',
    title_ar: 'المبيعات والعملاء',
    title_en: 'Sales & Customers',
    permissions: [
      {
        key: 'sales.view',
        label_ar: 'عرض سجل المبيعات والفواتير',
        label_en: 'View Sales & Invoices',
        desc_ar: 'تصفح الفواتير المصدرة، الأرباح، وإعادة طباعة الإيصالات',
        desc_en: 'Browse issued invoices, profit analytics, and reprints',
      },
      {
        key: 'sales.return',
        label_ar: 'إصدار المرتجعات والإشعارات الدائنة',
        label_en: 'Issue Returns & Credit Notes',
        desc_ar: 'إرجاع فواتير المبيعات وإعادة الكميات للمخزون',
        desc_en: 'Issue credit notes (381) and restock returned items',
      },
      {
        key: 'customers.manage',
        label_ar: 'إدارة دليل العملاء',
        label_en: 'Manage Customers',
        desc_ar: 'إضافة وتعديل بيانات العملاء والمنشآت الضريبية',
        desc_en: 'Create and update B2C and B2B customer profiles',
      },
    ],
  },
  {
    id: 'inventory',
    title_ar: 'المخزون والأصناف',
    title_en: 'Inventory & Stock',
    permissions: [
      {
        key: 'inventory.view',
        label_ar: 'عرض المخزون وسجل الحركات',
        label_en: 'View Inventory & Movements',
        desc_ar: 'مراقبة الأرصدة المتوفرة، النواقص، وحركات الصنف',
        desc_en: 'Monitor stock quantities, alerts, and movement ledger',
      },
      {
        key: 'inventory.manage',
        label_ar: 'إضافة وتعديل الأصناف والأسعار',
        label_en: 'Create & Edit Products',
        desc_ar: 'إنشاء أصناف جديدة وتعديل الأسعار والتكلفة والباركود',
        desc_en: 'Add new SKUs and edit product pricing and metadata',
      },
      {
        key: 'inventory.adjust',
        label_ar: 'التوريد والجرد وتسجيل الإهلاك',
        label_en: 'Stock Adjustments & Wastage',
        desc_ar: 'تنفيذ حركات التوريد اليدوي والتسوية المخزنية والإهلاك',
        desc_en: 'Perform stock restocks, adjustments, and product wastage',
      },
    ],
  },
  {
    id: 'purchases',
    title_ar: 'المشتريات والموردون',
    title_en: 'Purchases & Suppliers',
    permissions: [
      {
        key: 'purchases.view',
        label_ar: 'عرض فواتير المشتريات والموردين',
        label_en: 'View Purchases & Suppliers',
        desc_ar: 'الاطلاع على فواتير الشراء وذمم الموردين المستحقة',
        desc_en: 'Review purchase invoices and supplier balances',
      },
      {
        key: 'purchases.manage',
        label_ar: 'إنشاء فواتير المشتريات وسداد الموردين',
        label_en: 'Manage Purchases & Pay Suppliers',
        desc_ar: 'تسجيل فواتير شراء جديدة، إضافة موردين، وتسديد الدفعات',
        desc_en: 'Create purchase invoices, add suppliers, and record payments',
      },
    ],
  },
  {
    id: 'reports',
    title_ar: 'التقارير المالية والسندات',
    title_en: 'Reports & Vouchers',
    permissions: [
      {
        key: 'reports.view',
        label_ar: 'عرض مركز التقارير المالية والتشغيلية',
        label_en: 'View Financial & Operational Reports',
        desc_ar: 'الوصول لتقارير الأرباح، الميزانية، الجرد، وتصدير CSV/الطباعة',
        desc_en: 'Access financial statements, inventory reports, and exports',
      },
      {
        key: 'vouchers.manage',
        label_ar: 'إدارة سندات القبض والصرف',
        label_en: 'Manage Receipt & Payment Vouchers',
        desc_ar: 'إضافة وحذف سندات القبض والصرف النقدي والبنكي',
        desc_en: 'Create and delete cash/bank receipt and payment vouchers',
      },
    ],
  },
  {
    id: 'system',
    title_ar: 'الإعدادات والصلاحيات والربط',
    title_en: 'System, Settings & Users',
    permissions: [
      {
        key: 'settings.manage',
        label_ar: 'تعديل إعدادات المتجر والطابعة والنظام',
        label_en: 'Manage Store & Printer Settings',
        desc_ar: 'تعديل بيانات المنشأة، الطابعة الحرارية، حجم الخط، والترقيم',
        desc_en: 'Configure store info, thermal printer, font size, and pagination',
      },
      {
        key: 'zatca.manage',
        label_ar: 'إدارة هيئة الزكاة والضريبة ZATCA',
        label_en: 'Manage ZATCA Compliance',
        desc_ar: 'تهيئة مفاتيح التشفير CSID وإعادة إرسال الفواتير',
        desc_en: 'Manage EGS onboarding keys and ZATCA invoice dispatch',
      },
      {
        key: 'users.manage',
        label_ar: 'إدارة المستخدمين والأدوار والصلاحيات',
        label_en: 'Manage Users, Roles & Permissions',
        desc_ar: 'إضافة المستخدمين، تفعيل/تعطيل الحسابات، وتخصيص صلاحيات الأدوار',
        desc_en: 'Create users, toggle account status, and customize role permissions',
      },
    ],
  },
];

export const ALL_PERMISSION_KEYS: PermissionKey[] = PERMISSION_GROUPS.flatMap((g) =>
  g.permissions.map((p) => p.key)
);

const PERMISSION_SET = new Set<string>(ALL_PERMISSION_KEYS);

export function sanitizePermissions(input: unknown): PermissionKey[] {
  if (!Array.isArray(input)) return [];
  const unique = new Set<PermissionKey>();
  for (const item of input) {
    if (typeof item === 'string' && PERMISSION_SET.has(item)) {
      unique.add(item as PermissionKey);
    }
  }
  return Array.from(unique);
}

export function hasPermission(user: AuthUser | null | undefined, perm: PermissionKey): boolean {
  if (!user || user.is_active === 0) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export function hasAnyPermission(
  user: AuthUser | null | undefined,
  perms: PermissionKey[]
): boolean {
  if (!user || user.is_active === 0) return false;
  return perms.some((p) => user.permissions.includes(p));
}
