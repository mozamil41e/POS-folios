import { INVOICE_SUBTYPES, SALE_PAYMENT_METHODS, type HeldCartInput } from '../../../../shared/schemas/sales.ts';
import type { HeldCart, Invoice, InvoiceItem, InvoiceTypeCode } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Sales data access (R2.4b): invoices and credit notes (one table, told apart
 * by invoice_type_code), their lines, and held carts. Moved from
 * src/server/db.ts; named columns, never SELECT *. Invoices are never
 * deleted: a sale is reversed by a credit note.
 */
const INVOICE_COLUMNS = [
  'id',
  'uuid',
  'invoice_number',
  'invoice_type_code',
  'invoice_subtype',
  'payment_method',
  'cash_amount',
  'card_amount',
  'customer_id',
  'customer_name',
  'customer_vat',
  'subtotal',
  'discount_total',
  'vat_total',
  'grand_total',
  'related_invoice_number',
  'created_at',
] as const;

const ITEM_COLUMNS = [
  'id',
  'invoice_id',
  'product_id',
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

const HELD_COLUMNS = ['id', 'label', 'items_json', 'discount', 'customer_id', 'invoice_subtype', 'created_at'] as const;

const DOCUMENT_CODES: readonly InvoiceTypeCode[] = ['388', '381', '383'];

type CodedRow = { invoice_type_code: string; invoice_subtype: string; payment_method: string };

/** Stored codes are always valid; the fallbacks are the legacy defaults. */
function typed<T extends CodedRow>(row: T): Omit<T, keyof CodedRow> & Pick<Invoice, keyof CodedRow> {
  return {
    ...row,
    invoice_type_code: DOCUMENT_CODES.find((c) => c === row.invoice_type_code) ?? '388',
    invoice_subtype: INVOICE_SUBTYPES.find((s) => s === row.invoice_subtype) ?? '0200000',
    payment_method: SALE_PAYMENT_METHODS.find((m) => m === row.payment_method) ?? 'cash',
  };
}

const TAX_CATEGORIES: ReadonlyArray<InvoiceItem['tax_category']> = ['S', 'Z', 'E'];

/** The stored VAT category of a line (S, Z or E; S is the legacy default). */
function typedItem<T extends { tax_category: string }>(row: T): Omit<T, 'tax_category'> & Pick<InvoiceItem, 'tax_category'> {
  return { ...row, tax_category: TAX_CATEGORIES.find((c) => c === row.tax_category) ?? 'S' };
}

export type NewInvoice = Omit<Invoice, 'id' | 'items'>;
export type NewInvoiceItem = Omit<InvoiceItem, 'id'> & { invoice_id: number };

export const invoices = {
  /** The latest invoices and credit notes with their lines, newest first (the limit goes with server-side reports in R6). */
  async list(q: Executor, limit = 100): Promise<Invoice[]> {
    const rows = await q.selectFrom('invoices').select(INVOICE_COLUMNS).orderBy('id', 'desc').limit(limit).execute();
    if (rows.length === 0) return [];
    const items = await q
      .selectFrom('invoice_items')
      .select(ITEM_COLUMNS)
      .where(
        'invoice_id',
        'in',
        rows.map((r) => r.id)
      )
      .orderBy('id', 'asc')
      .execute();
    const byInvoice = new Map<number, InvoiceItem[]>();
    for (const item of items) {
      const list = byInvoice.get(item.invoice_id) ?? [];
      list.push(typedItem(item));
      byInvoice.set(item.invoice_id, list);
    }
    return rows.map((r) => ({ ...typed(r), items: byInvoice.get(r.id) ?? [] }));
  },

  async findById(q: Executor, id: number): Promise<Omit<Invoice, 'items'> | undefined> {
    const row = await q.selectFrom('invoices').select(INVOICE_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row ? typed(row) : undefined;
  },

  async items(q: Executor, invoiceId: number): Promise<InvoiceItem[]> {
    const rows = await q.selectFrom('invoice_items').select(ITEM_COLUMNS).where('invoice_id', '=', invoiceId).orderBy('id', 'asc').execute();
    return rows.map(typedItem);
  },

  /** The credit note already issued for this sale, if any. */
  async creditNoteFor(q: Executor, invoiceNumber: string): Promise<string | undefined> {
    const row = await q
      .selectFrom('invoices')
      .select('invoice_number')
      .where('invoice_type_code', '=', '381')
      .where('related_invoice_number', '=', invoiceNumber)
      .executeTakeFirst();
    return row?.invoice_number;
  },

  async insert(q: Executor, values: NewInvoice): Promise<number> {
    const result = await q.insertInto('invoices').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async insertItem(q: Executor, values: NewInvoiceItem): Promise<void> {
    await q.insertInto('invoice_items').values(values).execute();
  },
};

export const heldCarts = {
  /** Newest first, as before. */
  async list(q: Executor): Promise<HeldCart[]> {
    const rows = await q.selectFrom('held_carts').select(HELD_COLUMNS).orderBy('id', 'desc').execute();
    return rows.map((r) => ({ ...r, invoice_subtype: INVOICE_SUBTYPES.find((s) => s === r.invoice_subtype) ?? '0200000' }));
  },

  async insert(q: Executor, cart: HeldCartInput, at: string): Promise<void> {
    await q
      .insertInto('held_carts')
      .values({
        label: cart.label,
        items_json: JSON.stringify(cart.items),
        discount: cart.discount,
        customer_id: cart.customer_id,
        invoice_subtype: cart.invoice_subtype,
        created_at: at,
      })
      .execute();
  },

  /** Taken back into the till or dropped; an unknown id changes nothing (as before). */
  async delete(q: Executor, id: number): Promise<void> {
    await q.deleteFrom('held_carts').where('id', '=', id).execute();
  },
};
