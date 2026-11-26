import { PAYMENT_STATUSES } from '../../../../shared/schemas/purchases.ts';
import type { Purchase, PurchaseItem, PurchasePaymentStatus } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Purchases data access (R2.4b), moved from src/server/db.ts. Named columns,
 * never SELECT *; the lines of a list come in one query (it used to be one
 * query per purchase). Purchases are never deleted.
 */
const PURCHASE_COLUMNS = [
  'id',
  'purchase_number',
  'supplier_id',
  'supplier_name',
  'supplier_vat',
  'supplier_invoice_no',
  'payment_status',
  'paid_amount',
  'subtotal',
  'vat_total',
  'grand_total',
  'notes',
  'received_at',
  'created_at',
] as const;

const ITEM_COLUMNS = [
  'id',
  'purchase_id',
  'product_id',
  'sku',
  'name_ar',
  'name_en',
  'qty',
  'unit_cost',
  'tax_rate',
  'line_subtotal',
  'line_vat',
  'line_total',
] as const;

/** Stored statuses are always valid; anything else reads as paid, the legacy default. */
function paymentStatus(value: string): PurchasePaymentStatus {
  return PAYMENT_STATUSES.find((s) => s === value) ?? 'paid';
}

export interface NewPurchase {
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
}

export type NewPurchaseItem = Omit<PurchaseItem, 'id'> & { purchase_id: number };

export const purchases = {
  /** The latest purchases with their lines, newest first (the limit goes with server-side reports in R6). */
  async list(q: Executor, limit = 100, offset = 0): Promise<Purchase[]> {
    const rows = await q.selectFrom('purchases').select(PURCHASE_COLUMNS).orderBy('id', 'desc').limit(limit).offset(offset).execute();
    if (rows.length === 0) return [];
    const items = await q
      .selectFrom('purchase_items')
      .select(ITEM_COLUMNS)
      .where(
        'purchase_id',
        'in',
        rows.map((r) => r.id)
      )
      .orderBy('id', 'asc')
      .execute();
    const byPurchase = new Map<number, PurchaseItem[]>();
    for (const item of items) {
      const list = byPurchase.get(item.purchase_id) ?? [];
      list.push(item);
      byPurchase.set(item.purchase_id, list);
    }
    return rows.map((r) => ({ ...r, payment_status: paymentStatus(r.payment_status), items: byPurchase.get(r.id) ?? [] }));
  },

  async count(q: Executor): Promise<number> {
    const row = await q.selectFrom('purchases').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return Number(row?.n ?? 0);
  },

  /** One purchase with its lines (v1 reads). */
  async findWithItems(q: Executor, id: number): Promise<Purchase | undefined> {
    const purchase = await this.findById(q, id);
    if (!purchase) return undefined;
    const items = await q.selectFrom('purchase_items').select(ITEM_COLUMNS).where('purchase_id', '=', id).orderBy('id', 'asc').execute();
    return { ...purchase, items };
  },

  async findById(q: Executor, id: number): Promise<Omit<Purchase, 'items'> | undefined> {
    const row = await q.selectFrom('purchases').select(PURCHASE_COLUMNS).where('id', '=', id).executeTakeFirst();
    return row ? { ...row, payment_status: paymentStatus(row.payment_status) } : undefined;
  },

  async insert(q: Executor, values: NewPurchase): Promise<number> {
    const result = await q.insertInto('purchases').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async insertItem(q: Executor, values: NewPurchaseItem): Promise<void> {
    await q.insertInto('purchase_items').values(values).execute();
  },

  async setPayment(q: Executor, id: number, paidAmount: number, status: PurchasePaymentStatus): Promise<void> {
    await q.updateTable('purchases').set({ paid_amount: paidAmount, payment_status: status }).where('id', '=', id).execute();
  },
};
