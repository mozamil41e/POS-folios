import type { Raw } from '../../../../shared/schemas/common.ts';
import { parseCustomer } from '../../../../shared/schemas/parties.ts';
import { kysely } from '../../db/kysely.ts';
import { withTransaction } from '../../db/transaction.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import * as repo from './repository.ts';

/**
 * Customers (R2.4b): the buyers named on B2B (standard tax) invoices. Same
 * rules and messages as before (R1.10). The checkout still reads a customer
 * through the legacy route until the sales module moves.
 */
const customerNotFound = () => new NotFoundError('CUSTOMER_NOT_FOUND', 'Customer not found.');

export const lists = {
  customers: () => repo.customers.list(kysely),
};

export async function createCustomer(raw: Raw): Promise<number> {
  const input = valueOrThrow(parseCustomer(raw));
  return withTransaction((trx) => repo.customers.insert(trx, { ...input, created_at: new Date().toISOString() }));
}

/** Fields not sent keep their value. */
export async function updateCustomer(id: number, raw: Raw): Promise<void> {
  const existing = await repo.customers.findById(kysely, id);
  if (!existing) throw customerNotFound();
  const input = valueOrThrow(parseCustomer(raw, existing));
  await withTransaction((trx) => repo.customers.update(trx, id, input));
}
