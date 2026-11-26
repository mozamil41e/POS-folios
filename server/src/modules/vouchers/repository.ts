import { VOUCHER_CHANNELS, VOUCHER_KINDS, type VoucherInput } from '../../../../shared/schemas/vouchers.ts';
import type { Voucher } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Cash vouchers data access (R2.4b), moved from src/server/db.ts. Named
 * columns, never SELECT *. Vouchers are never deleted: they are voided.
 */
const COLUMNS = [
  'id',
  'voucher_number',
  'voucher_type',
  'payment_channel',
  'party_name',
  'category',
  'amount',
  'notes',
  'voucher_date',
  'created_at',
  'status',
  'void_reason',
  'voided_at',
  'voided_by',
] as const;

type Row = { voucher_type: string; payment_channel: string; status: string };

/** Stored values are always valid; the fallbacks are the legacy defaults. */
function typed<T extends Row>(row: T): Omit<T, keyof Row> & Pick<Voucher, keyof Row> {
  return {
    ...row,
    voucher_type: VOUCHER_KINDS.find((k) => k === row.voucher_type) ?? 'receipt',
    payment_channel: VOUCHER_CHANNELS.find((c) => c === row.payment_channel) ?? 'cash',
    status: row.status === 'void' ? 'void' : 'active',
  };
}

export const vouchers = {
  /** The latest 300 by date (the limit goes with server-side reports in R6). */
  async list(q: Executor, limit = 300, offset = 0): Promise<Voucher[]> {
    const rows = await q
      .selectFrom('vouchers')
      .select(COLUMNS)
      .orderBy('voucher_date', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();
    return rows.map(typed);
  },

  async count(q: Executor): Promise<number> {
    const row = await q.selectFrom('vouchers').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst();
    return Number(row?.n ?? 0);
  },

  async findById(q: Executor, id: number): Promise<Voucher | undefined> {
    const row = await q.selectFrom('vouchers').select(COLUMNS).where('id', '=', id).executeTakeFirst();
    return row ? typed(row) : undefined;
  },

  async insert(q: Executor, values: VoucherInput & { voucher_number: string; created_at: string }): Promise<number> {
    const result = await q.insertInto('vouchers').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async void(q: Executor, id: number, reason: string, at: string, by: number): Promise<void> {
    await q
      .updateTable('vouchers')
      .set({ status: 'void', void_reason: reason, voided_at: at, voided_by: by })
      .where('id', '=', id)
      .execute();
  },
};
