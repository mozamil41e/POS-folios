import type { PartyInput } from '../../../../shared/schemas/parties.ts';
import type { Customer } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Customers data access (R2.4b), moved from src/server/db.ts. Named columns,
 * never SELECT *. Customers are never deleted: invoices keep their id.
 */
const COLUMNS = ['id', 'name_ar', 'name_en', 'vat_number', 'cr_number', 'address_ar', 'phone', 'created_at'] as const;

export const customers = {
  /** Oldest first, as before. */
  async list(q: Executor): Promise<Customer[]> {
    return q.selectFrom('customers').select(COLUMNS).orderBy('id', 'asc').execute();
  },

  async findById(q: Executor, id: number): Promise<Customer | undefined> {
    return q.selectFrom('customers').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  },

  async insert(q: Executor, values: PartyInput & { created_at: string }): Promise<number> {
    const result = await q.insertInto('customers').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async update(q: Executor, id: number, values: PartyInput): Promise<void> {
    await q.updateTable('customers').set(values).where('id', '=', id).execute();
  },
};
