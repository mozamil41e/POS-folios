import type { Category, Product } from '../../../../shared/types.ts';
import {
  parseCategory,
  parseCategoryOrder,
  parseCategoryRef,
  parseMovement,
  parseOpeningStock,
  parseProduct,
  type CategoryRef,
} from '../../../../shared/schemas/inventory.ts';
import { kysely } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import * as repo from './repository.ts';

/**
 * Inventory rules (R2.4a): products, categories and stock movements. Same
 * behaviour as the legacy routes they replace (R1.10, R1.11c); every write
 * runs in withTransaction(), with only database work inside.
 */
type Raw = Record<string, unknown>;

/** The first problem of a parse, as a 400 VALIDATION_FAILED (shared by the modules since R2.4b). */
export { valueOrThrow };

const skuExists = () => new ConflictError('SKU_EXISTS', 'SKU/Barcode already exists.', { field: 'sku' });
const productNotFound = () => new NotFoundError('PRODUCT_NOT_FOUND', 'Product not found.');
const categoryNotFound = () => new NotFoundError('CATEGORY_NOT_FOUND', 'Category not found.');
const isUniqueViolation = (err: unknown) => err instanceof Error && err.message.includes('UNIQUE');
const timestamp = () => new Date().toISOString();

/**
 * The category a product is saved under: the one chosen by id, one found or
 * created by Arabic name, the product's current one, or "عام / General".
 */
async function resolveCategory(q: repo.Executor, ref: CategoryRef, existing?: Product): Promise<Category> {
  if (ref && 'id' in ref) {
    const category = await repo.categories.findById(q, ref.id);
    if (!category) throw new ValidationError('category_id', 'NOT_FOUND', 'Category not found.');
    return category;
  }
  if (ref) return (await repo.categories.findOrCreate(q, ref.name_ar, ref.name_en)).category;
  if (existing?.category_id) {
    const current = await repo.categories.findById(q, existing.category_id);
    if (current) return current;
  }
  if (existing?.category_ar) return (await repo.categories.findOrCreate(q, existing.category_ar, existing.category_en)).category;
  return (await repo.categories.findOrCreate(q, 'عام', 'General')).category;
}

// ------------------------------------------------------------------ products

export async function createProduct(raw: Raw): Promise<number> {
  const input = valueOrThrow(parseProduct(raw));
  const stockQty = valueOrThrow(parseOpeningStock(raw));
  const ref = valueOrThrow(parseCategoryRef(raw));
  if (await repo.products.skuTaken(kysely, input.sku)) throw skuExists();

  const stamp = timestamp();
  try {
    return await withTransaction(async (trx) => {
      // A category created by name is rolled back together with a failed product.
      const category = await resolveCategory(trx, ref);
      const id = await repo.products.insert(trx, {
        ...input,
        category_id: category.id,
        category_ar: category.name_ar,
        category_en: category.name_en,
        stock_qty: stockQty,
        active: 1,
        created_at: stamp,
        updated_at: stamp,
      });
      if (stockQty > 0) {
        await repo.movements.insert(trx, {
          product_id: id,
          type: 'purchase',
          qty_delta: stockQty,
          balance_after: stockQty,
          reference_no: 'NEW-SKU',
          notes: 'إضافة صنف جديد للمخزون',
          created_at: stamp,
        });
      }
      return id;
    });
  } catch (err) {
    // Two requests creating the same SKU at once: the UNIQUE index decides.
    if (isUniqueViolation(err)) throw skuExists();
    throw err;
  }
}

/** Fields not sent keep their value; stock changes only through movements. */
export async function updateProduct(id: number, raw: Raw): Promise<void> {
  const existing = await repo.products.findById(kysely, id);
  if (!existing) throw productNotFound();
  const input = valueOrThrow(parseProduct(raw, existing));
  const ref = valueOrThrow(parseCategoryRef(raw));
  if (await repo.products.skuTaken(kysely, input.sku, id)) throw skuExists();

  try {
    await withTransaction(async (trx) => {
      const category = await resolveCategory(trx, ref, existing);
      await repo.products.update(trx, id, {
        ...input,
        category_id: category.id,
        category_ar: category.name_ar,
        category_en: category.name_en,
        updated_at: timestamp(),
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw skuExists();
    throw err;
  }
}

/** Soft delete (unknown ids are ignored, as before). */
export async function deleteProduct(id: number): Promise<void> {
  await repo.products.deactivate(kysely, id);
}

// --------------------------------------------------------- stock movements

/** DB-11, owner's option (a): stock never goes below zero, so the ledger equals the balance. */
export async function recordMovement(raw: Raw): Promise<void> {
  const movement = valueOrThrow(parseMovement(raw));
  if (!Number.isInteger(movement.product_id)) throw productNotFound();

  await withTransaction(async (trx) => {
    const product = await repo.products.findActiveById(trx, movement.product_id);
    if (!product) throw productNotFound();
    const delta = movement.type === 'purchase' || movement.type === 'return' ? Math.abs(movement.qty) : movement.qty;
    const balance = product.stock_qty + delta;
    if (balance < 0) {
      throw new AppError(400, 'INSUFFICIENT_STOCK', `Not enough stock: only ${product.stock_qty} available.`, {
        field: 'qty',
        available: product.stock_qty,
      });
    }
    await repo.products.setStock(trx, product.id, balance);
    await repo.movements.insert(trx, {
      product_id: product.id,
      type: movement.type,
      qty_delta: delta,
      balance_after: balance,
      reference_no: movement.reference_no,
      notes: movement.notes,
      created_at: timestamp(),
    });
  });
}

// --------------------------------------------------------------- categories

const categoryExists = () =>
  new ConflictError('CATEGORY_EXISTS', 'A category with this name already exists.', { field: 'name_ar' });

export async function createCategory(raw: Raw): Promise<Category> {
  const input = valueOrThrow(parseCategory(raw));
  if (await repo.categories.nameTaken(kysely, input.name_ar)) throw categoryExists();
  return withTransaction(async (trx) => (await repo.categories.findOrCreate(trx, input.name_ar, input.name_en)).category);
}

/** A rename reaches every product of the category. */
export async function updateCategory(id: number, raw: Raw): Promise<void> {
  const existing = await repo.categories.findById(kysely, id);
  if (!existing) throw categoryNotFound();
  const input = valueOrThrow(parseCategory(raw, existing));
  if (await repo.categories.nameTaken(kysely, input.name_ar, id)) throw categoryExists();
  await withTransaction((trx) => repo.categories.rename(trx, id, input.name_ar, input.name_en));
}

export async function reorderCategories(raw: Raw): Promise<void> {
  const ids = valueOrThrow(parseCategoryOrder(raw));
  const known = new Set((await repo.categories.list(kysely)).map((c) => c.id));
  if (ids.length !== known.size || !ids.every((id) => known.has(id))) {
    throw new ValidationError('ids', 'INVALID_CHOICE', 'ids must list every category exactly once.');
  }
  await withTransaction((trx) => repo.categories.reorder(trx, ids));
}

/** Option (a): a category with active products cannot be deleted. */
export async function deleteCategory(id: number): Promise<void> {
  const existing = await repo.categories.findById(kysely, id);
  if (!existing) throw categoryNotFound();
  if (existing.product_count > 0) {
    throw new ConflictError(
      'CATEGORY_IN_USE',
      `This category still has ${existing.product_count} product(s). Move them to another category first.`,
      { count: existing.product_count }
    );
  }
  await withTransaction((trx) => repo.categories.delete(trx, id));
}

// ---------------------------------------------------------- response lists

export const lists = {
  products: () => repo.products.listActive(kysely),
  categories: () => repo.categories.list(kysely),
  movements: () => repo.movements.recent(kysely, 80),
  product: (id: number) => repo.products.findById(kysely, id),
};
