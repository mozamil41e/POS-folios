import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { ALL_PERMISSION_KEYS } from '../../src/permissions.ts';
import type {
  AuthUser,
  Customer,
  Invoice,
  OrganizationSettings,
  PermissionKey,
  Product,
} from '../../src/types.ts';

// Vitest globals are off, so Testing Library cannot register its own cleanup.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** The seeded "cashier" role (src/server/db.ts): sells, holds carts, manages customers, views stock. */
export const CASHIER_PERMISSIONS: PermissionKey[] = [
  'pos.access',
  'pos.hold',
  'sales.view',
  'customers.manage',
  'inventory.view',
];

export const ALL_PERMISSIONS: PermissionKey[] = [...ALL_PERMISSION_KEYS];

export function makeUser(permissions: PermissionKey[], overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 7,
    full_name: 'Test User',
    email: 'user@example.test',
    role: 'custom',
    role_id: 2,
    role_name_ar: 'دور',
    role_name_en: 'Role',
    permissions,
    is_active: 1,
    created_at: '2026-11-01T08:00:00.000Z',
    ...overrides,
  };
}

export const cashier = () => makeUser(CASHIER_PERMISSIONS);
export const admin = () => makeUser(ALL_PERMISSIONS, { id: 1, role: 'admin' });

export const PRODUCT: Product = {
  id: 11,
  sku: 'DISH-001',
  name_ar: 'دجاج مشوي',
  name_en: 'Grilled Chicken',
  category_ar: 'أطباق',
  category_en: 'Dishes',
  unit_ar: 'طبق',
  unit_en: 'Plate',
  cost_price: 12,
  sell_price: 30,
  tax_rate: 15,
  tax_category: 'S',
  stock_qty: 20,
  min_stock_alert: 2,
  expiry_date: null,
  active: 1,
  created_at: '2026-11-01T08:00:00.000Z',
  updated_at: '2026-11-01T08:00:00.000Z',
};

export const CUSTOMER: Customer = {
  id: 3,
  name_ar: 'شركة الاختبار',
  name_en: 'Test Co',
  vat_number: '300000000000003',
  cr_number: '1010101010',
  address_ar: 'الرياض',
  phone: '0500000000',
  created_at: '2026-11-01T08:00:00.000Z',
};

export const INVOICE: Invoice = {
  id: 21,
  uuid: '00000000-0000-4000-8000-000000000021',
  invoice_number: 'INV-2026-00021',
  invoice_type_code: '388',
  invoice_subtype: '0200000',
  payment_method: 'cash',
  cash_amount: 34.5,
  card_amount: 0,
  customer_id: null,
  customer_name: '',
  customer_vat: '',
  subtotal: 30,
  discount_total: 0,
  vat_total: 4.5,
  grand_total: 34.5,
  related_invoice_number: null,
  created_at: new Date().toISOString(),
  items: [
    {
      product_id: PRODUCT.id,
      sku: PRODUCT.sku,
      name_ar: PRODUCT.name_ar,
      name_en: PRODUCT.name_en,
      unit_ar: PRODUCT.unit_ar,
      qty: 1,
      unit_price: 30,
      discount: 0,
      tax_rate: 15,
      tax_category: 'S',
      line_subtotal: 30,
      line_vat: 4.5,
      line_total: 34.5,
    },
  ],
};

export const SETTINGS: OrganizationSettings = {
  id: 1,
  name_ar: 'مطعم الاختبار',
  name_en: 'Test Restaurant',
  vat_number: '310000000000003',
  cr_number: '1010000000',
  street_ar: 'شارع الاختبار',
  building_no: '1',
  city_ar: 'الرياض',
  postal_code: '12345',
  country_code: 'SA',
  public_base_url: 'https://pos.example.test',
  thermal_width_mm: 80,
  auto_print_receipt: 0,
  font_size: 'medium',
  table_page_size: 10,
};

/** A handler mock that resolves to the given result (true = the server accepted it). */
export function resolves<T>(result: T) {
  return vi.fn<(...args: unknown[]) => Promise<T>>(async () => result);
}

/** A typed no-op mock for callbacks whose calls are only inspected. */
export function callback() {
  return vi.fn<(...args: unknown[]) => void>();
}
