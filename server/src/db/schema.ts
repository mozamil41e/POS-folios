/**
 * Kysely table types (R2.3), generated from the SQLite schema that
 * initDatabase() builds (src/server/db.ts), including the additive ALTERs.
 * tests/api/data-layer.test.ts checks TABLE_COLUMNS against the real
 * database, so a column added in db.ts without updating this file fails CI.
 * Until the MariaDB migrations (R3) this file is maintained by hand.
 *
 * Generated<T>: the database fills it (autoincrement id or DEFAULT), so it
 * is optional on insert. Money is REAL (number) until DECIMAL in R3.
 */
import type { Generated } from 'kysely';

export interface CategoriesTable {
  id: Generated<number>;
  name_ar: string;
  name_en: string;
  name_key: string;
  sort_order: Generated<number>;
  created_at: string;
  updated_at: string;
}

export interface CustomersTable {
  id: Generated<number>;
  name_ar: string;
  name_en: string;
  vat_number: Generated<string>;
  cr_number: Generated<string>;
  address_ar: Generated<string>;
  phone: Generated<string>;
  created_at: string;
}

export interface DocumentSequencesTable {
  doc_type: string;
  period_year: number;
  last_value: Generated<number>;
}

export interface HeldCartsTable {
  id: Generated<number>;
  label: string;
  items_json: string;
  discount: Generated<number>;
  customer_id: number | null;
  invoice_subtype: Generated<string>;
  created_at: string;
}

export interface IdempotencyKeysTable {
  user_id: number;
  idem_key: string;
  endpoint: string;
  request_hash: string;
  resource_id: number;
  created_at: string;
}

export interface InvoiceItemsTable {
  id: Generated<number>;
  invoice_id: number;
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  unit_ar: string;
  qty: number;
  unit_price: number;
  discount: Generated<number>;
  tax_rate: number;
  tax_category: Generated<string>;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface InvoicesTable {
  id: Generated<number>;
  uuid: string;
  invoice_number: string;
  invoice_type_code: Generated<string>;
  invoice_subtype: Generated<string>;
  payment_method: Generated<string>;
  cash_amount: Generated<number>;
  card_amount: Generated<number>;
  customer_id: number | null;
  customer_name: Generated<string>;
  customer_vat: Generated<string>;
  subtotal: number;
  discount_total: Generated<number>;
  vat_total: number;
  grand_total: number;
  related_invoice_number: string | null;
  created_at: string;
}

export interface LoginAttemptsTable {
  email: string;
  failed_count: Generated<number>;
  window_started_at: string;
  locked_until: string | null;
}

export interface OrganizationSettingsTable {
  id: Generated<number>;
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  street_ar: string;
  building_no: string;
  city_ar: string;
  postal_code: string;
  country_code: Generated<string>;
  public_base_url: Generated<string>;
  thermal_width_mm: Generated<number>;
  auto_print_receipt: Generated<number>;
  font_size: Generated<string>;
  table_page_size: Generated<number>;
}

export interface ProductsTable {
  id: Generated<number>;
  sku: string;
  name_ar: string;
  name_en: string;
  category_ar: string;
  category_en: string;
  unit_ar: string;
  unit_en: string;
  cost_price: number;
  sell_price: number;
  tax_rate: Generated<number>;
  tax_category: Generated<string>;
  stock_qty: Generated<number>;
  min_stock_alert: Generated<number>;
  expiry_date: string | null;
  active: Generated<number>;
  created_at: string;
  updated_at: string;
  category_id: number | null;
}

export interface PurchaseItemsTable {
  id: Generated<number>;
  purchase_id: number;
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  qty: number;
  unit_cost: number;
  tax_rate: Generated<number>;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface PurchasesTable {
  id: Generated<number>;
  purchase_number: string;
  supplier_id: number;
  supplier_name: string;
  supplier_vat: Generated<string>;
  supplier_invoice_no: Generated<string>;
  payment_status: Generated<string>;
  paid_amount: Generated<number>;
  subtotal: number;
  vat_total: number;
  grand_total: number;
  notes: Generated<string>;
  received_at: string;
  created_at: string;
}

export interface RolesTable {
  id: Generated<number>;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: Generated<string>;
  description_en: Generated<string>;
  permissions_json: string;
  is_system: Generated<number>;
  created_at: string;
}

export interface StockMovementsTable {
  id: Generated<number>;
  product_id: number;
  type: string;
  qty_delta: number;
  balance_after: number;
  reference_no: string;
  notes: Generated<string>;
  created_at: string;
}

export interface SuppliersTable {
  id: Generated<number>;
  name_ar: string;
  name_en: string;
  vat_number: Generated<string>;
  cr_number: Generated<string>;
  phone: Generated<string>;
  email: Generated<string>;
  address_ar: Generated<string>;
  created_at: string;
}

export interface UserSessionsTable {
  id: Generated<number>;
  user_id: number;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

export interface UsersTable {
  id: Generated<number>;
  full_name: string;
  email: string;
  phone: Generated<string>;
  password_hash: string;
  role: Generated<string>;
  role_id: number | null;
  is_active: Generated<number>;
  last_login_at: string | null;
  created_at: string;
}

export interface VouchersTable {
  id: Generated<number>;
  voucher_number: string;
  voucher_type: string;
  payment_channel: Generated<string>;
  party_name: string;
  category: Generated<string>;
  amount: number;
  notes: Generated<string>;
  voucher_date: string;
  created_at: string;
  status: Generated<string>;
  void_reason: Generated<string>;
  voided_at: string | null;
  voided_by: number | null;
}

export interface Database {
  categories: CategoriesTable;
  customers: CustomersTable;
  document_sequences: DocumentSequencesTable;
  held_carts: HeldCartsTable;
  idempotency_keys: IdempotencyKeysTable;
  invoice_items: InvoiceItemsTable;
  invoices: InvoicesTable;
  login_attempts: LoginAttemptsTable;
  organization_settings: OrganizationSettingsTable;
  products: ProductsTable;
  purchase_items: PurchaseItemsTable;
  purchases: PurchasesTable;
  roles: RolesTable;
  stock_movements: StockMovementsTable;
  suppliers: SuppliersTable;
  user_sessions: UserSessionsTable;
  users: UsersTable;
  vouchers: VouchersTable;
}

/** Column names per table, in schema order (checked against the database by a test). */
export const TABLE_COLUMNS = {
  categories: ['id', 'name_ar', 'name_en', 'name_key', 'sort_order', 'created_at', 'updated_at'],
  customers: ['id', 'name_ar', 'name_en', 'vat_number', 'cr_number', 'address_ar', 'phone', 'created_at'],
  document_sequences: ['doc_type', 'period_year', 'last_value'],
  held_carts: ['id', 'label', 'items_json', 'discount', 'customer_id', 'invoice_subtype', 'created_at'],
  idempotency_keys: ['user_id', 'idem_key', 'endpoint', 'request_hash', 'resource_id', 'created_at'],
  invoice_items: ['id', 'invoice_id', 'product_id', 'sku', 'name_ar', 'name_en', 'unit_ar', 'qty', 'unit_price', 'discount', 'tax_rate', 'tax_category', 'line_subtotal', 'line_vat', 'line_total'],
  invoices: ['id', 'uuid', 'invoice_number', 'invoice_type_code', 'invoice_subtype', 'payment_method', 'cash_amount', 'card_amount', 'customer_id', 'customer_name', 'customer_vat', 'subtotal', 'discount_total', 'vat_total', 'grand_total', 'related_invoice_number', 'created_at'],
  login_attempts: ['email', 'failed_count', 'window_started_at', 'locked_until'],
  organization_settings: ['id', 'name_ar', 'name_en', 'vat_number', 'cr_number', 'street_ar', 'building_no', 'city_ar', 'postal_code', 'country_code', 'public_base_url', 'thermal_width_mm', 'auto_print_receipt', 'font_size', 'table_page_size'],
  products: ['id', 'sku', 'name_ar', 'name_en', 'category_ar', 'category_en', 'unit_ar', 'unit_en', 'cost_price', 'sell_price', 'tax_rate', 'tax_category', 'stock_qty', 'min_stock_alert', 'expiry_date', 'active', 'created_at', 'updated_at', 'category_id'],
  purchase_items: ['id', 'purchase_id', 'product_id', 'sku', 'name_ar', 'name_en', 'qty', 'unit_cost', 'tax_rate', 'line_subtotal', 'line_vat', 'line_total'],
  purchases: ['id', 'purchase_number', 'supplier_id', 'supplier_name', 'supplier_vat', 'supplier_invoice_no', 'payment_status', 'paid_amount', 'subtotal', 'vat_total', 'grand_total', 'notes', 'received_at', 'created_at'],
  roles: ['id', 'slug', 'name_ar', 'name_en', 'description_ar', 'description_en', 'permissions_json', 'is_system', 'created_at'],
  stock_movements: ['id', 'product_id', 'type', 'qty_delta', 'balance_after', 'reference_no', 'notes', 'created_at'],
  suppliers: ['id', 'name_ar', 'name_en', 'vat_number', 'cr_number', 'phone', 'email', 'address_ar', 'created_at'],
  user_sessions: ['id', 'user_id', 'token_hash', 'expires_at', 'created_at'],
  users: ['id', 'full_name', 'email', 'phone', 'password_hash', 'role', 'role_id', 'is_active', 'last_login_at', 'created_at'],
  vouchers: ['id', 'voucher_number', 'voucher_type', 'payment_channel', 'party_name', 'category', 'amount', 'notes', 'voucher_date', 'created_at', 'status', 'void_reason', 'voided_at', 'voided_by'],
} as const satisfies Record<keyof Database, readonly string[]>;
