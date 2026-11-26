import crypto from 'node:crypto';
import { DOCUMENT_TYPES, INVOICE_KINDS } from '../../../../shared/constants.ts';
import { discountedTotals, lineAmounts } from '../../../../shared/money.ts';
import type { Raw } from '../../../../shared/schemas/common.ts';
import {
  CART_EMPTY_ERROR,
  SPLIT_ERROR,
  parseCheckoutHeader,
  parseHeldCart,
  parseSaleLine,
  paymentAmounts,
} from '../../../../shared/schemas/sales.ts';
import type { AuthUser, InvoiceItem } from '../../../../shared/types.ts';
import { isValidVatNumber } from '../../../../shared/validation.ts';
import type { PageRequest } from '../../../../shared/schemas/pagination.ts';
import { kysely, type Executor } from '../../db/kysely.ts';
import { nextDocumentNumber } from '../../db/sequences.ts';
import { withTransaction } from '../../db/transaction.ts';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.ts';
import { rememberKey, requestHash, savedResourceId, type IdempotencyScope } from '../../shared/idempotency.ts';
import { valueOrThrow } from '../../shared/validation.ts';
import { customers } from '../customers/repository.ts';
import { findActiveProduct, issueStock } from '../inventory/service.ts';
import * as repo from './repository.ts';

/**
 * Sales at the till (R2.4b): checkout, credit notes and held carts. Same
 * rules, totals, numbers, codes and messages as the legacy routes (R1.5,
 * R1.8, R1.10, D5, D12); see shared/schemas/sales.ts for what changed.
 * A sale or credit note is one transaction: number, lines, stock, movements.
 *
 * The messages of the line errors are their codes, as before; they now also
 * say which line (`line`, `field`, `reason`, and `available` for stock).
 */
export interface Saved {
  id: number;
  invoiceNumber: string;
  /** True when an Idempotency-Key matched an earlier sale: nothing new was saved. */
  replayed?: boolean;
}

/** The endpoint an Idempotency-Key belongs to (R2.5a). */
const CHECKOUT_ENDPOINT = 'POST /api/invoices';

async function replayed(q: Executor, invoiceId: number): Promise<Saved> {
  const invoice = await repo.invoices.findById(q, invoiceId);
  return { id: invoiceId, invoiceNumber: invoice?.invoice_number ?? '', replayed: true };
}

const CASH_CUSTOMER = 'عميل نقدي / Cash Customer';

export const lists = {
  invoices: () => repo.invoices.list(kysely),
  heldCarts: () => repo.heldCarts.list(kysely),
};

// ------------------------------------------------------------------ checkout

/**
 * Checked in the legacy order: document type, discount permission, cart,
 * customer, B2B, lines. With an Idempotency-Key (R2.5a), a request already
 * saved under that key returns the first invoice and saves nothing.
 */
export async function checkout(raw: Raw, actor: AuthUser, idempotencyKey: string | null = null): Promise<Saved> {
  const scope: IdempotencyScope | null = idempotencyKey
    ? { userId: actor.id, key: idempotencyKey, endpoint: CHECKOUT_ENDPOINT, hash: requestHash(raw) }
    : null;
  if (scope) {
    const earlier = await savedResourceId(kysely, scope);
    if (earlier !== undefined) return replayed(kysely, earlier);
  }

  // Sales invoices only (R1.5, SEC-09); credit notes go through creditNote().
  if (raw.invoice_type_code !== undefined && raw.invoice_type_code !== DOCUMENT_TYPES.SALES_INVOICE) {
    throw new AppError(400, 'INVALID_DOCUMENT_TYPE', 'Only sales invoices can be issued here.');
  }
  const header = valueOrThrow(parseCheckoutHeader(raw));
  if (header.discount_total > 0 && !actor.permissions.includes('pos.discount')) {
    throw new ForbiddenError('DISCOUNT_NOT_ALLOWED', 'You do not have permission to apply discounts.');
  }
  if (header.items.length === 0) throw new ValidationError('items', 'REQUIRED', CART_EMPTY_ERROR);

  // An unknown customer is an error (it used to fall back to the cash customer).
  let customerName = CASH_CUSTOMER;
  let customerVat = '';
  if (header.customer_id !== null) {
    const customer = await customers.findById(kysely, header.customer_id);
    if (!customer) throw new AppError(400, 'CUSTOMER_NOT_FOUND', 'Customer not found.');
    customerName = customer.name_ar;
    customerVat = customer.vat_number.trim();
  }
  // A standard tax invoice (B2B) needs a registered customer with a valid VAT number (D12).
  if (header.invoice_subtype === INVOICE_KINDS.TAX) {
    if (header.customer_id === null) {
      throw new AppError(400, 'CUSTOMER_REQUIRED', 'A tax invoice (B2B) requires a registered customer.');
    }
    if (!isValidVatNumber(customerVat)) {
      throw new AppError(
        400,
        'CUSTOMER_VAT_INVALID',
        'A tax invoice (B2B) requires the customer to have a valid 15-digit VAT number.'
      );
    }
  }

  return withTransaction(async (trx) => {
    // Checked again inside the transaction: of two identical requests sent
    // together, the second finds the first one's key here.
    if (scope) {
      const earlier = await savedResourceId(trx, scope);
      if (earlier !== undefined) return replayed(trx, earlier);
    }
    const createdAt = new Date().toISOString();
    const invoiceNumber = await nextDocumentNumber(trx, 'INV');

    // Line by line, as before: prices and VAT from the database, stock taken now.
    const lines: Array<Omit<InvoiceItem, 'id' | 'invoice_id'>> = [];
    for (const [index, entry] of header.items.entries()) {
      const line = index + 1;
      const parsed = parseSaleLine(entry);
      if (!parsed.ok) {
        const problem = parsed.problems[0];
        throw new AppError(400, 'INVALID_QTY', 'INVALID_QTY', { line, field: problem.field, reason: problem.reason });
      }
      const { product_id, qty } = parsed.value;
      const product = await findActiveProduct(trx, product_id);
      if (!product) throw new AppError(400, 'PRODUCT_NOT_FOUND', 'PRODUCT_NOT_FOUND', { line, field: 'product_id' });
      if (product.stock_qty < qty) {
        throw new AppError(400, 'INSUFFICIENT_STOCK', `INSUFFICIENT_STOCK:${product.name_ar}`, {
          line,
          field: 'qty',
          product_id: product.id,
          available: product.stock_qty,
        });
      }
      await issueStock(trx, { product_id: product.id, qty }, invoiceNumber, 'بيع عبر نقطة البيع', createdAt);

      const amounts = lineAmounts(product.sell_price, qty, product.tax_rate);
      lines.push({
        product_id: product.id,
        sku: product.sku,
        name_ar: product.name_ar,
        name_en: product.name_en,
        unit_ar: product.unit_ar,
        qty,
        unit_price: product.sell_price,
        discount: 0,
        tax_rate: product.tax_rate,
        tax_category: product.tax_category,
        line_subtotal: amounts.subtotal,
        line_vat: amounts.vat,
        line_total: amounts.total,
      });
    }

    const totals = discountedTotals(
      lines.map((l) => ({ subtotal: l.line_subtotal, vat: l.line_vat })),
      header.discount_total
    );
    const paid = paymentAmounts(header.payment_method, header.split_cash, totals.total);
    if (!paid) throw new AppError(400, 'INVALID_SPLIT', SPLIT_ERROR, { field: 'cash_amount', grand_total: totals.total });

    const id = await repo.invoices.insert(trx, {
      // Random, unguessable id for the public invoice link and the receipt QR (D1).
      uuid: crypto.randomUUID(),
      invoice_number: invoiceNumber,
      invoice_type_code: DOCUMENT_TYPES.SALES_INVOICE,
      invoice_subtype: header.invoice_subtype,
      payment_method: header.payment_method,
      ...paid,
      customer_id: header.customer_id,
      customer_name: customerName,
      customer_vat: customerVat,
      subtotal: totals.subtotal,
      discount_total: totals.discount,
      vat_total: totals.vat,
      grand_total: totals.total,
      related_invoice_number: null,
      created_at: createdAt,
    });
    for (const line of lines) await repo.invoices.insertItem(trx, { ...line, invoice_id: id });
    if (scope) await rememberKey(trx, scope, id);
    return { id, invoiceNumber };
  });
}

// --------------------------------------------------------------- credit note

/**
 * Reverses a whole sales invoice, once (R1.11). D5 (owner): it reverses revenue
 * and VAT only and never puts stock back: a returned dish cannot become raw
 * ingredients again. A sealed item that really goes back on the shelf is
 * recorded by hand as a 'return' stock movement (inventory.adjust).
 */
export async function creditNote(sourceId: number): Promise<Saved> {
  return withTransaction(async (trx) => {
    const source = await repo.invoices.findById(trx, sourceId);
    if (!source) throw new NotFoundError('INVOICE_NOT_FOUND', 'Original invoice not found.');
    if (source.invoice_type_code !== DOCUMENT_TYPES.SALES_INVOICE) {
      throw new AppError(400, 'NOT_A_SALES_INVOICE', 'Credit note can only be issued for a sales invoice.');
    }
    // Inside the transaction: of two requests at the same moment, one wins.
    const existing = await repo.invoices.creditNoteFor(trx, source.invoice_number);
    if (existing) {
      throw new AppError(400, 'ALREADY_RETURNED', `Invoice already returned via ${existing}.`, {
        credit_note_number: existing,
      });
    }

    const items = await repo.invoices.items(trx, sourceId);
    // Credit notes have their own sequence (R1.8).
    const invoiceNumber = await nextDocumentNumber(trx, 'CN');
    const { id: _sourceId, ...copy } = source;
    const id = await repo.invoices.insert(trx, {
      ...copy,
      uuid: crypto.randomUUID(),
      invoice_number: invoiceNumber,
      invoice_type_code: DOCUMENT_TYPES.CREDIT_NOTE,
      related_invoice_number: source.invoice_number,
      created_at: new Date().toISOString(),
    });
    for (const { id: _itemId, invoice_id: _invoiceId, ...item } of items) {
      await repo.invoices.insertItem(trx, { ...item, invoice_id: id });
    }
    return { id, invoiceNumber };
  });
}

// --------------------------------------------------------------- held carts

/** Returns the held cart's id (v1, R2.5c; the current route ignores it). */
export async function holdCart(raw: Raw): Promise<number> {
  const cart = valueOrThrow(parseHeldCart(raw));
  return withTransaction((trx) => repo.heldCarts.insert(trx, cart, new Date().toISOString()));
}

export async function releaseCart(id: number): Promise<void> {
  await withTransaction((trx) => repo.heldCarts.delete(trx, id));
}

/** API v1 reads (R2.5b): one page of a list, its total, one item. */
export const reads = {
  page: (page: PageRequest) => repo.invoices.list(kysely, page.pageSize, page.offset),
  count: () => repo.invoices.count(kysely),
  one: (id: number) => repo.invoices.findWithItems(kysely, id),
};
