import type { InvoiceSubtype, InvoiceTypeCode, PaymentMethod, StockMovement, VoucherType } from './types';

/**
 * Named domain values (R2.2), instead of magic strings in the code. The stored
 * codes themselves stay as they are until the MariaDB schema renames them
 * (D14: 388/381 and 0100000/0200000 kept until R3).
 */
export const DOCUMENT_TYPES = {
  SALES_INVOICE: '388',
  CREDIT_NOTE: '381',
} as const satisfies Record<string, InvoiceTypeCode>;

/** Simplified (B2C) receipt or tax invoice to a VAT-registered customer (D12). */
export const INVOICE_KINDS = {
  SIMPLIFIED: '0200000',
  TAX: '0100000',
} as const satisfies Record<string, InvoiceSubtype>;

export const PAYMENT_METHODS = {
  CASH: 'cash',
  CARD: 'card',
  SPLIT: 'split',
} as const satisfies Record<string, PaymentMethod>;

export const MOVEMENT_TYPES = {
  SALE: 'sale',
  PURCHASE: 'purchase',
  ADJUSTMENT: 'adjustment',
  RETURN: 'return',
} as const satisfies Record<string, StockMovement['type']>;

export const VOUCHER_TYPES = {
  RECEIPT: 'receipt',
  PAYMENT: 'payment',
} as const satisfies Record<string, VoucherType>;

/** Standard KSA VAT rate in percent; 0 for zero-rated (Z) or exempt (E) items. */
export const STANDARD_VAT_RATE = 15;
