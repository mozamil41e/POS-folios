import type { Raw } from '../../../../shared/schemas/common.ts';
import { parseSupplier } from '../../../../shared/schemas/parties.ts';
import { kysely } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import * as repo from './repository.ts';

/**
 * Suppliers (R2.4b). Same rules and messages as before (R1.10). Purchases
 * still read a supplier through the legacy route until the purchases module
 * moves (next in R2.4b).
 */
const supplierNotFound = () => new NotFoundError('SUPPLIER_NOT_FOUND', 'Supplier not found.');

export const lists = {
  suppliers: () => repo.suppliers.list(kysely),
};

export async function createSupplier(raw: Raw): Promise<number> {
  const input = valueOrThrow(parseSupplier(raw));
  return withTransaction((trx) => repo.suppliers.insert(trx, { ...input, created_at: new Date().toISOString() }));
}

/** Fields not sent keep their value. */
export async function updateSupplier(id: number, raw: Raw): Promise<void> {
  const existing = await repo.suppliers.findById(kysely, id);
  if (!existing) throw supplierNotFound();
  const input = valueOrThrow(parseSupplier(raw, existing));
  await withTransaction((trx) => repo.suppliers.update(trx, id, input));
}
