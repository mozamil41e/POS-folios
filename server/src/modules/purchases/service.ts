import { lineAmounts, roundMoney, sumMoney } from '../../../../shared/money.ts';
import type { FieldProblem, Raw } from '../../../../shared/schemas/common.ts';
import {
  initialPayment,
  paymentStatusFor,
  parsePaymentAmount,
  parsePurchaseHeader,
  parsePurchaseLine,
  type PurchaseLineInput,
} from '../../../../shared/schemas/purchases.ts';
import type { Product } from '../../../../shared/types.ts';
import type { PageRequest } from '../../../../shared/schemas/pagination.ts';
import { kysely } from '../../db/kysely.ts';
import { nextDocumentNumber } from '../../db/sequences.ts';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, NotFoundError } from '../../shared/errors.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import { findActiveProduct, receiveStock } from '../inventory/service.ts';
import { suppliers } from '../suppliers/repository.ts';
import * as repo from './repository.ts';

/**
 * Purchases from suppliers (R2.4b). Same rules, totals and responses as the
 * legacy route, plus the owner's decisions (see shared/schemas/purchases.ts).
 * A purchase is one transaction: number, lines, stock and movements commit
 * together or not at all. Stock goes through the inventory module.
 *
 * Error codes are unchanged (the legacy route answered { error: CODE, code })
 * and now say which line and field: { line, field, reason }.
 */
const supplierNotFound = () =>
  new AppError(400, 'SUPPLIER_NOT_FOUND', 'SUPPLIER_NOT_FOUND', { field: 'supplier_id' });

const productNotFound = (line: number) =>
  new AppError(400, 'PRODUCT_NOT_FOUND', 'PRODUCT_NOT_FOUND', { line, field: 'product_id' });

const invalidLine = (line: number, problem: FieldProblem) =>
  new AppError(400, 'INVALID_PURCHASE_LINE', 'INVALID_PURCHASE_LINE', { line, field: problem.field, reason: problem.reason });

const purchaseNotFound = () => new NotFoundError('PURCHASE_NOT_FOUND', 'Purchase invoice not found.');

export const lists = {
  purchases: () => repo.purchases.list(kysely),
};

export async function createPurchase(raw: Raw): Promise<number> {
  const header = valueOrThrow(parsePurchaseHeader(raw));
  const now = new Date().toISOString();

  return withTransaction(async (trx) => {
    const supplier = await suppliers.findById(trx, header.supplier_id);
    if (!supplier) throw supplierNotFound();
    // Atomic yearly number (R1.8); rolled back with a failed purchase.
    const purchaseNumber = await nextDocumentNumber(trx, 'PO');

    // Line by line, as before: the first bad line or unknown product stops it.
    const lines: Array<PurchaseLineInput & { product: Product; amounts: ReturnType<typeof lineAmounts> }> = [];
    for (const [index, entry] of header.items.entries()) {
      const parsed = parsePurchaseLine(entry);
      if (!parsed.ok) throw invalidLine(index + 1, parsed.problems[0]);
      const product = await findActiveProduct(trx, parsed.value.product_id);
      if (!product) throw productNotFound(index + 1);
      const { unit_cost, qty, tax_rate } = parsed.value;
      lines.push({ ...parsed.value, product, amounts: lineAmounts(unit_cost, qty, tax_rate) });
    }

    const subtotal = sumMoney(lines.map((l) => l.amounts.subtotal));
    const vatTotal = sumMoney(lines.map((l) => l.amounts.vat));
    const grandTotal = roundMoney(subtotal + vatTotal);
    const payment = initialPayment(header.payment_status, header.partial_amount, grandTotal);

    const purchaseId = await repo.purchases.insert(trx, {
      purchase_number: purchaseNumber,
      supplier_id: supplier.id,
      // A copy of the supplier as it was on the day of the purchase.
      supplier_name: supplier.name_ar,
      supplier_vat: supplier.vat_number,
      supplier_invoice_no: header.supplier_invoice_no,
      ...payment,
      subtotal,
      vat_total: vatTotal,
      grand_total: grandTotal,
      notes: header.notes,
      received_at: now,
      created_at: now,
    });

    for (const line of lines) {
      await repo.purchases.insertItem(trx, {
        purchase_id: purchaseId,
        product_id: line.product.id,
        sku: line.product.sku,
        name_ar: line.product.name_ar,
        name_en: line.product.name_en,
        qty: line.qty,
        unit_cost: line.unit_cost,
        tax_rate: line.tax_rate,
        line_subtotal: line.amounts.subtotal,
        line_vat: line.amounts.vat,
        line_total: line.amounts.total,
      });
    }
    await receiveStock(trx, lines, purchaseNumber, `فاتورة مشتريات من ${supplier.name_ar}`, now);
    return purchaseId;
  });
}

/** A payment to the supplier; more than is owed is capped (as before). */
export async function payPurchase(id: number, raw: Raw): Promise<void> {
  await withTransaction(async (trx) => {
    const purchase = await repo.purchases.findById(trx, id);
    if (!purchase) throw purchaseNotFound();
    const amount = valueOrThrow(parsePaymentAmount(raw));
    const paid = Math.min(purchase.grand_total, roundMoney(purchase.paid_amount + amount));
    // After a positive payment the status is paid or partial, never credit.
    const status = paymentStatusFor(paid, purchase.grand_total) === 'paid' ? 'paid' : 'partial';
    await repo.purchases.setPayment(trx, id, paid, status);
  });
}

/** API v1 reads (R2.5b): one page of a list, its total, one item. */
export const reads = {
  page: (page: PageRequest) => repo.purchases.list(kysely, page.pageSize, page.offset),
  count: () => repo.purchases.count(kysely),
  one: (id: number) => repo.purchases.findWithItems(kysely, id),
};
