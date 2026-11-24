export type Language = 'ar' | 'en';
export type ZatcaMode = 'simulator' | 'fatoora_simulation';
export type InvoiceTypeCode = '388' | '381' | '383';
export type InvoiceSubtype = '0200000' | '0100000';
export type PaymentMethod = 'cash' | 'card' | 'split';
export type ZatcaStatus = 'REPORTED' | 'CLEARED' | 'PENDING' | 'REJECTED' | 'DISABLED';
export type FontSizeLevel = 'small' | 'medium' | 'large';
export type TablePageSize = 5 | 10 | 20 | 50;

export interface OrganizationSettings {
  id: number;
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  street_ar: string;
  building_no: string;
  city_ar: string;
  postal_code: string;
  country_code: string;
  egs_serial: string;
  mode: ZatcaMode;
  zatca_enabled: number;
  public_base_url: string;
  thermal_width_mm: number;
  auto_print_receipt: number;
  font_size: FontSizeLevel;
  table_page_size: number;
  // ZATCA credentials: only sent to zatca.manage holders (removed with ZATCA in R1.4).
  ccsid_token: string;
  ccsid_request_id: string;
  pcsid_token: string;
  public_key_base64: string;
  csr_pem: string;
  last_pih: string;
  // Secrets: server-side only — never included in any API response (R1.3).
  ccsid_secret?: string;
  pcsid_secret?: string;
  private_key_pem?: string;
  onboarding_step: number;
  last_icv: number;
}

export interface Product {
  id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  category_ar: string;
  category_en: string;
  unit_ar: string;
  unit_en: string;
  /** Omitted by the server for users without cost permission (COST_VIEW_PERMISSIONS). */
  cost_price?: number;
  sell_price: number;
  tax_rate: number;
  tax_category: 'S' | 'Z' | 'E';
  stock_qty: number;
  min_stock_alert: number;
  expiry_date: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: number;
  product_id: number;
  product_name_ar?: string;
  product_name_en?: string;
  sku?: string;
  type: 'sale' | 'purchase' | 'return' | 'adjustment';
  qty_delta: number;
  balance_after: number;
  reference_no: string;
  notes: string;
  created_at: string;
}

export interface Customer {
  id: number;
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  address_ar: string;
  phone: string;
  created_at: string;
}

export interface InvoiceItem {
  id?: number;
  invoice_id?: number;
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  unit_ar: string;
  qty: number;
  unit_price: number;
  discount: number;
  tax_rate: number;
  tax_category: 'S' | 'Z' | 'E';
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface Invoice {
  id: number;
  uuid: string;
  invoice_number: string;
  icv: number;
  invoice_type_code: InvoiceTypeCode;
  invoice_subtype: InvoiceSubtype;
  payment_method: PaymentMethod;
  cash_amount: number;
  card_amount: number;
  customer_id: number | null;
  customer_name: string;
  customer_vat: string;
  subtotal: number;
  discount_total: number;
  vat_total: number;
  grand_total: number;
  invoice_hash: string;
  previous_hash: string;
  qr_tlv_base64: string;
  xml_content: string;
  zatca_status: ZatcaStatus;
  zatca_mode: ZatcaMode;
  zatca_response_json: string;
  related_invoice_number: string | null;
  created_at: string;
  items?: InvoiceItem[];
}

export interface HeldCart {
  id: number;
  label: string;
  items_json: string;
  discount: number;
  customer_id: number | null;
  invoice_subtype: InvoiceSubtype;
  created_at: string;
}

export interface DecodedTlvTag {
  tag: number;
  label_ar: string;
  label_en: string;
  value: string;
}

export type PurchasePaymentStatus = 'paid' | 'credit' | 'partial';

export interface Supplier {
  id: number;
  name_ar: string;
  name_en: string;
  vat_number: string;
  cr_number: string;
  phone: string;
  email: string;
  address_ar: string;
  created_at: string;
}

export interface PurchaseItem {
  id?: number;
  purchase_id?: number;
  product_id: number;
  sku: string;
  name_ar: string;
  name_en: string;
  qty: number;
  unit_cost: number;
  tax_rate: number;
  line_subtotal: number;
  line_vat: number;
  line_total: number;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  supplier_id: number;
  supplier_name: string;
  supplier_vat: string;
  supplier_invoice_no: string;
  payment_status: PurchasePaymentStatus;
  paid_amount: number;
  subtotal: number;
  vat_total: number;
  grand_total: number;
  notes: string;
  received_at: string;
  created_at: string;
  items?: PurchaseItem[];
}

export type UserRole = string;

export type PermissionKey =
  | 'pos.access'
  | 'pos.discount'
  | 'pos.hold'
  | 'sales.view'
  | 'sales.return'
  | 'customers.manage'
  | 'inventory.view'
  | 'inventory.manage'
  | 'inventory.adjust'
  | 'purchases.view'
  | 'purchases.manage'
  | 'reports.view'
  | 'vouchers.manage'
  | 'settings.manage'
  | 'zatca.manage'
  | 'users.manage';

export interface RoleRecord {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  permissions: PermissionKey[];
  is_system: number;
  users_count?: number;
  created_at: string;
}

export interface ManagedUser {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  role: UserRole;
  role_id: number;
  role_name_ar: string;
  role_name_en: string;
  permissions_count: number;
  is_active: number;
  last_login_at: string | null;
  created_at: string;
}

export type VoucherType = 'receipt' | 'payment';
export type VoucherChannel = 'cash' | 'bank';

export interface Voucher {
  id: number;
  voucher_number: string;
  voucher_type: VoucherType;
  payment_channel: VoucherChannel;
  party_name: string;
  category: string;
  amount: number;
  notes: string;
  voucher_date: string;
  created_at: string;
  /** Vouchers are voided, never deleted (R1.8). Void vouchers are excluded from all totals. */
  status: 'active' | 'void';
  void_reason: string;
  voided_at: string | null;
  voided_by: number | null;
}

export interface AuthUser {
  id: number;
  full_name: string;
  email: string;
  phone?: string;
  role: UserRole;
  role_id: number;
  role_name_ar: string;
  role_name_en: string;
  permissions: PermissionKey[];
  is_active: number;
  created_at: string;
}

// Every list is optional: the server only sends what the user may read
// (DATA_VISIBILITY in permissions.ts). Product cost_price is also omitted for
// users without cost permission. Pass `?? []` when handing lists to screens.
export interface BootstrapPayload {
  settings: OrganizationSettings;
  products?: Product[];
  customers?: Customer[];
  suppliers?: Supplier[];
  purchases?: Purchase[];
  invoices?: Invoice[];
  movements?: StockMovement[];
  heldCarts?: HeldCart[];
  vouchers?: Voucher[];
  users?: ManagedUser[];
  roles?: RoleRecord[];
}
