export type Language = 'ar' | 'en';
export type ZatcaMode = 'simulator' | 'fatoora_simulation';
export type InvoiceTypeCode = '388' | '381' | '383';
export type InvoiceSubtype = '0200000' | '0100000';
export type PaymentMethod = 'cash' | 'card' | 'split';
export type ZatcaStatus = 'REPORTED' | 'CLEARED' | 'PENDING' | 'REJECTED';

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
  ccsid_token: string;
  ccsid_secret: string;
  ccsid_request_id: string;
  pcsid_token: string;
  pcsid_secret: string;
  private_key_pem: string;
  public_key_base64: string;
  csr_pem: string;
  onboarding_step: number;
  last_icv: number;
  last_pih: string;
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
  cost_price: number;
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

export interface LaravelVirtualFile {
  path: string;
  language: 'php' | 'blade' | 'json' | 'env' | 'markdown';
  category: 'services' | 'livewire' | 'models' | 'database' | 'views' | 'config';
  description_ar: string;
  description_en: string;
  content: string;
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

export interface BootstrapPayload {
  settings: OrganizationSettings;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  purchases: Purchase[];
  invoices: Invoice[];
  movements: StockMovement[];
  heldCarts: HeldCart[];
}
