import { riyadhToday } from '../../../../shared/dates.ts';
import type { Raw } from '../../../../shared/schemas/common.ts';
import { parseVoidReason, parseVoucher, VOID_REASON_ERROR } from '../../../../shared/schemas/vouchers.ts';
import type { AuthUser } from '../../../../shared/types.ts';
import type { PageRequest } from '../../../../shared/schemas/pagination.ts';
import { kysely } from '../../db/kysely.ts';
import { nextDocumentNumber } from '../../db/sequences.ts';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, ConflictError, NotFoundError } from '../../shared/errors.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import * as repo from './repository.ts';

/**
 * Cash vouchers (R2.4b): receipts (RCV-) and payments (PAY-) outside sales
 * and purchases. Same rules, numbers, codes and responses as before (R1.8),
 * plus the owner's date rules (see shared/schemas/vouchers.ts). Vouchers are
 * never deleted; a void keeps who, when and why.
 */
export const lists = {
  vouchers: () => repo.vouchers.list(kysely),
};

export async function createVoucher(raw: Raw): Promise<number> {
  const input = valueOrThrow(parseVoucher(raw, riyadhToday()));
  // Number and row in one transaction (R1.8): no duplicates, no gaps on failure.
  return withTransaction(async (trx) => {
    const voucherNumber = await nextDocumentNumber(trx, input.voucher_type === 'receipt' ? 'RCV' : 'PAY');
    return repo.vouchers.insert(trx, { ...input, voucher_number: voucherNumber, created_at: new Date().toISOString() });
  });
}

/** Checked in the legacy order: id, reason, exists, not already void. */
export async function voidVoucher(id: number, raw: Raw, actor: AuthUser): Promise<void> {
  if (!Number.isInteger(id) || id <= 0) throw new AppError(400, 'INVALID_ID', 'Invalid voucher ID.');
  const reason = parseVoidReason(raw);
  if (!reason.ok) throw new AppError(400, 'VOID_REASON_REQUIRED', VOID_REASON_ERROR, { field: 'reason' });

  await withTransaction(async (trx) => {
    const voucher = await repo.vouchers.findById(trx, id);
    if (!voucher) throw new NotFoundError('NOT_FOUND', 'Voucher not found.');
    // Inside the transaction: of two voids at the same moment, one wins.
    if (voucher.status === 'void') throw new ConflictError('ALREADY_VOID', 'This voucher is already void.');
    await repo.vouchers.void(trx, id, reason.value, new Date().toISOString(), actor.id);
  });
}

/** API v1 reads (R2.5b): one page of a list, its total, one item. */
export const reads = {
  page: (page: PageRequest) => repo.vouchers.list(kysely, page.pageSize, page.offset),
  count: () => repo.vouchers.count(kysely),
  one: (id: number) => repo.vouchers.findById(kysely, id),
};
