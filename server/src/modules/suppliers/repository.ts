import type { SupplierInput } from '../../../../shared/schemas/parties.ts';
import type { Supplier } from '../../../../shared/types.ts';
import type { Executor } from '../../db/kysely.ts';

/**
 * Suppliers data access (R2.4b), moved from src/server/db.ts. Named columns,
 * never SELECT *. Suppliers are never deleted: purchases keep their id.
 */
const COLUMNS = ['id', 'name_ar', 'name_en', 'vat_number', 'cr_number', 'phone', 'email', 'address_ar', 'created_at'] as const;

export const suppliers = {
  /** Newest first, as before. */
  async list(q: Executor): Promise<Supplier[]> {
    return q.selectFrom('suppliers').select(COLUMNS).orderBy('id', 'desc').execute();
  },

  async findById(q: Executor, id: number): Promise<Supplier | undefined> {
    return q.selectFrom('suppliers').select(COLUMNS).where('id', '=', id).executeTakeFirst();
  },

  async insert(q: Executor, values: SupplierInput & { created_at: string }): Promise<number> {
    const result = await q.insertInto('suppliers').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async update(q: Executor, id: number, values: SupplierInput): Promise<void> {
    await q.updateTable('suppliers').set(values).where('id', '=', id).execute();
  },
};
