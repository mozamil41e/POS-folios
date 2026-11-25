import type { Insertable, Kysely, Updateable } from 'kysely';
import { categoryKey } from '../../../../src/server/db.ts';
import type { Category, Product, StockMovement } from '../../../../shared/types.ts';
import type { Database, ProductsTable } from '../../db/schema.ts';

/**
 * Inventory data access (R2.4a): products, categories and stock movements
 * through Kysely. Every function takes the executor, so a service passes the
 * transaction (`trx`) when the writes must succeed or fail together.
 * The only place in the module that knows SQL.
 */
export type Executor = Kysely<Database>;

const now = () => new Date().toISOString();

// ------------------------------------------------------------------ products

export const products = {
  async findById(q: Executor, id: number): Promise<Product | undefined> {
    return (await q.selectFrom('products').selectAll().where('id', '=', id).executeTakeFirst()) as Product | undefined;
  },

  async findActiveById(q: Executor, id: number): Promise<Product | undefined> {
    return (await q.selectFrom('products').selectAll().where('id', '=', id).where('active', '=', 1).executeTakeFirst()) as
      | Product
      | undefined;
  },

  async skuTaken(q: Executor, sku: string, exceptId = 0): Promise<boolean> {
    const row = await q.selectFrom('products').select('id').where('sku', '=', sku).where('id', '!=', exceptId).executeTakeFirst();
    return Boolean(row);
  },

  /** Which of these SKUs already exist (active or hidden: the column is unique). */
  async existingSkus(q: Executor, skus: readonly string[]): Promise<Set<string>> {
    if (skus.length === 0) return new Set();
    const rows = await q.selectFrom('products').select('sku').where('sku', 'in', [...skus]).execute();
    return new Set(rows.map((r) => r.sku));
  },

  async insert(q: Executor, values: Insertable<ProductsTable>): Promise<number> {
    const result = await q.insertInto('products').values(values).executeTakeFirstOrThrow();
    return Number(result.insertId);
  },

  async update(q: Executor, id: number, values: Updateable<ProductsTable>): Promise<void> {
    await q.updateTable('products').set(values).where('id', '=', id).execute();
  },

  /** Soft delete: the row stays for invoices and history. */
  async deactivate(q: Executor, id: number): Promise<void> {
    await q.updateTable('products').set({ active: 0 }).where('id', '=', id).execute();
  },

  async setStock(q: Executor, id: number, stockQty: number): Promise<void> {
    await q.updateTable('products').set({ stock_qty: stockQty, updated_at: now() }).where('id', '=', id).execute();
  },

  async listActive(q: Executor): Promise<Product[]> {
    return (await q.selectFrom('products').selectAll().where('active', '=', 1).orderBy('id', 'asc').execute()) as Product[];
  },
};

// --------------------------------------------------------- stock movements

export interface NewMovement {
  product_id: number;
  type: StockMovement['type'];
  qty_delta: number;
  balance_after: number;
  reference_no: string;
  notes: string;
  created_at: string;
}

export const movements = {
  async insert(q: Executor, movement: NewMovement): Promise<void> {
    await q.insertInto('stock_movements').values(movement).execute();
  },

  async recent(q: Executor, limit = 80): Promise<StockMovement[]> {
    return (await q
      .selectFrom('stock_movements as sm')
      .innerJoin('products as p', 'p.id', 'sm.product_id')
      .selectAll('sm')
      .select(['p.name_ar as product_name_ar', 'p.name_en as product_name_en', 'p.sku as sku'])
      .orderBy('sm.id', 'desc')
      .limit(limit)
      .execute()) as StockMovement[];
  },
};

// --------------------------------------------------------------- categories

export const categories = {
  /** In POS tab order, with the number of active products. */
  async list(q: Executor): Promise<Category[]> {
    const rows = await q
      .selectFrom('categories as c')
      .select(['c.id', 'c.name_ar', 'c.name_en', 'c.sort_order', 'c.created_at', 'c.updated_at'])
      .select((eb) =>
        eb
          .selectFrom('products as p')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('p.category_id', '=', 'c.id')
          .where('p.active', '=', 1)
          .as('product_count')
      )
      .orderBy('c.sort_order', 'asc')
      .orderBy('c.id', 'asc')
      .execute();
    return rows.map((r) => ({ ...r, product_count: Number(r.product_count ?? 0) }));
  },

  async findById(q: Executor, id: number): Promise<Category | undefined> {
    return (await this.list(q)).find((c) => c.id === id);
  },

  async nameTaken(q: Executor, nameAr: string, exceptId = 0): Promise<boolean> {
    const row = await q
      .selectFrom('categories')
      .select('id')
      .where('name_key', '=', categoryKey(nameAr))
      .where('id', '!=', exceptId)
      .executeTakeFirst();
    return Boolean(row);
  },

  /** The category with this Arabic name, created (last in order) when missing. */
  async findOrCreate(q: Executor, nameAr: string, nameEn = ''): Promise<{ category: Category; created: boolean }> {
    const cleanAr = nameAr.trim().replace(/\s+/g, ' ');
    const existing = await q.selectFrom('categories').select('id').where('name_key', '=', categoryKey(cleanAr)).executeTakeFirst();
    if (existing) return { category: (await this.findById(q, existing.id))!, created: false };
    const next = await q
      .selectFrom('categories')
      .select((eb) => eb.fn.coalesce(eb.fn.max('sort_order'), eb.val(0)).as('max'))
      .executeTakeFirst();
    const stamp = now();
    const result = await q
      .insertInto('categories')
      .values({
        name_ar: cleanAr,
        name_en: nameEn.trim() || cleanAr,
        name_key: categoryKey(cleanAr),
        sort_order: Number(next?.max ?? 0) + 1,
        created_at: stamp,
        updated_at: stamp,
      })
      .executeTakeFirstOrThrow();
    return { category: (await this.findById(q, Number(result.insertId)))!, created: true };
  },

  /** A rename reaches every product of the category (their display copy). */
  async rename(q: Executor, id: number, nameAr: string, nameEn: string): Promise<void> {
    const stamp = now();
    await q
      .updateTable('categories')
      .set({ name_ar: nameAr, name_en: nameEn, name_key: categoryKey(nameAr), updated_at: stamp })
      .where('id', '=', id)
      .execute();
    await q
      .updateTable('products')
      .set({ category_ar: nameAr, category_en: nameEn, updated_at: stamp })
      .where('category_id', '=', id)
      .execute();
  },

  async reorder(q: Executor, ids: readonly number[]): Promise<void> {
    for (const [index, id] of ids.entries()) {
      await q.updateTable('categories').set({ sort_order: index + 1 }).where('id', '=', id).execute();
    }
  },

  /** Hidden (deleted) products keep the old name as text; their link is cleared. */
  async delete(q: Executor, id: number): Promise<void> {
    await q.updateTable('products').set({ category_id: null }).where('category_id', '=', id).execute();
    await q.deleteFrom('categories').where('id', '=', id).execute();
  },
};
