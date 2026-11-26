import type { InvoiceItem } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Public invoice data access (R2.4b), moved from src/server/db.ts. Anyone
 * holding the link (receipt QR) can open it, so only an allowlist is read: no
 * internal ids leave this file and the customer's VAT number is never read.
 */
const PUBLIC_INVOICE_COLUMNS = [
  'uuid',
  'invoice_number',
  'invoice_type_code',
  'invoice_subtype',
  'payment_method',
  'cash_amount',
  'card_amount',
  'customer_name',
  'subtotal',
  'discount_total',
  'vat_total',
  'grand_total',
  'related_invoice_number',
  'created_at',
] as const;

const PUBLIC_ITEM_COLUMNS = [
  'sku',
  'name_ar',
  'name_en',
  'unit_ar',
  'qty',
  'unit_price',
  'discount',
  'tax_rate',
  'tax_category',
  'line_subtotal',
  'line_vat',
  'line_total',
] as const;

export type PublicInvoiceItem = Pick<InvoiceItem, (typeof PUBLIC_ITEM_COLUMNS)[number]>;

export async function findByUuid(q: Executor, uuid: string) {
  const row = await q
    .selectFrom('invoices')
    .select(['id', ...PUBLIC_INVOICE_COLUMNS])
    .where('uuid', '=', uuid)
    .executeTakeFirst();
  if (!row) return undefined;

  const items = await q
    .selectFrom('invoice_items')
    .select(PUBLIC_ITEM_COLUMNS)
    .where('invoice_id', '=', row.id)
    .orderBy('id', 'asc')
    .execute();
  // The internal id was only needed for the lines; it is not part of the public view.
  const { id: _internalId, ...invoice } = row;
  return { ...invoice, items };
}
