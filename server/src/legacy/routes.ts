/**
 * Legacy API routes (R2.1). The route code of the former server.ts, moved
 * here unchanged except for: Express 5 (no asyncHandler wrapper), the router
 * instead of the app.
 * Strangler: R2.4 moves each domain out into server/src/modules/<domain>:
 * products/inventory (R2.4a), then auth (R2.4b: setup, sign-in, sessions)
 * and users/roles (R2.4b); delete this file when empty.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import {
  db,
  getAllCategories,
  getAllCustomers,
  getAllInvoices,
  getAllProducts,
  getAllPurchases,
  getAllSuppliers,
  getAllVouchers,
  getHeldCarts,
  getOrganizationSettings,
  getPublicInvoiceByUuid,
  getRecentMovements,
} from '../../../src/server/db.ts';
import { canViewData, type VisibleDataKey } from '../../../shared/permissions.ts';
import { scopeForUser } from '../../../src/server/visibility.ts';
import { isValidVatNumber } from '../../../shared/validation.ts';
import { nextDocumentNumber } from '../../../src/server/sequences.ts';
import { lists as usersLists } from '../modules/users/service.ts';
import {
  parseCustomerInput,
  parseSupplierInput,
} from '../../../src/server/input-rules.ts';
import {
  noIndex,
  type RateLimiters,
} from '../../../src/server/security.ts';
import type {
  AuthUser,
  Customer,
  FontSizeLevel,
  Invoice,
  InvoiceItem,
  InvoiceSubtype,
  InvoiceTypeCode,
  PaymentMethod,
  Product,
  Purchase,
  PurchasePaymentStatus,
  Supplier,
  VoucherChannel,
  VoucherType,
} from '../../../shared/types.ts';
import { requireAuth, requirePermission } from '../middleware/auth.ts';
import { sendScoped } from '../shared/respond.ts';
import { roundMoney } from '../../../shared/money.ts';
import { DOCUMENT_TYPES, INVOICE_KINDS, PAYMENT_METHODS } from '../../../shared/constants.ts';

export interface LegacyContext {
  limiters: RateLimiters;
}

export function createLegacyRouter({ limiters }: LegacyContext): Router {
  const router = Router();

  // Business errors thrown inside transactions as Error('CODE') or Error('CODE:detail').
  // Only these are reported to the client as 400; anything else is a 500 (R1.5, SEC-10).
  function knownErrorCode(err: unknown, known: ReadonlySet<string>): string | null {
    if (!(err instanceof Error)) return null;
    const code = err.message.split(':')[0];
    return known.has(code) ? code : null;
  }

  // Public read-only invoice lookup (used by thermal receipt QR public URL).
  // Rate limited and not indexed (R1.9); the payload is an allowlist (db.ts).
  router.get('/api/public/invoices/:uuid', noIndex, limiters.publicInvoice, (req: Request, res: Response) => {
    const uuid = String(req.params.uuid ?? '').trim();
    if (!uuid || uuid.length > 80) {
      res.status(400).json({ error: 'Invalid invoice identifier.' });
      return;
    }
    const payload = getPublicInvoiceByUuid(uuid);
    if (!payload) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    res.json(payload);
  });

  // Require valid Bearer session token for all private /api routes
  // (server/src/middleware/auth.ts; the modules use the same checks, R2.4a).
  router.use('/api', requireAuth());

  // Bootstrap the workspace — only the data this user may read (R1.3).
  router.get('/api/bootstrap', async (_req: Request, res: Response) => {
    const authUser = res.locals.authUser as AuthUser;
    const can = (key: VisibleDataKey) => canViewData(authUser, key);
    const canManageUsers = authUser.permissions.includes('users.manage');
    res.json(
      scopeForUser(authUser, {
        settings: getOrganizationSettings(),
        products: can('products') ? getAllProducts() : undefined,
        categories: can('categories') ? getAllCategories() : undefined,
        customers: can('customers') ? getAllCustomers() : undefined,
        suppliers: can('suppliers') ? getAllSuppliers() : undefined,
        purchases: can('purchases') ? getAllPurchases() : undefined,
        invoices: can('invoices') ? getAllInvoices() : undefined,
        movements: can('movements') ? getRecentMovements(80) : undefined,
        heldCarts: can('heldCarts') ? getHeldCarts() : undefined,
        vouchers: can('vouchers') ? getAllVouchers() : undefined,
        ...(canManageUsers ? { users: await usersLists.users(), roles: await usersLists.roles() } : {}),
      })
    );
  });

  router.post('/api/vouchers', requirePermission('vouchers.manage'), (req: Request, res: Response) => {
    const b = req.body as Record<string, unknown>;
    const voucherType: VoucherType = b.voucher_type === 'payment' ? 'payment' : 'receipt';
    const paymentChannel: VoucherChannel = b.payment_channel === 'bank' ? 'bank' : 'cash';
    const partyName = String(b.party_name ?? '').trim();
    const category = String(b.category ?? '').trim();
    const notes = String(b.notes ?? '').trim();
    const amount = Number(b.amount ?? 0);
    const rawDate = String(b.voucher_date ?? '').trim();
    const voucherDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? rawDate
      : new Date().toISOString().slice(0, 10);

    if (!partyName) {
      res.status(400).json({ error: 'Party or description name is required.' });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      res.status(400).json({ error: 'Voucher amount must be greater than zero.' });
      return;
    }

    const now = new Date().toISOString();

    // Number and row are written in one transaction (R1.8): no duplicates, no gaps on failure.
    const voucherId = db.transaction(() => {
      const voucherNumber = nextDocumentNumber(db, voucherType === 'receipt' ? 'RCV' : 'PAY');
      const info = db
        .prepare(`
          INSERT INTO vouchers (
            voucher_number, voucher_type, payment_channel, party_name, category,
            amount, notes, voucher_date, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          voucherNumber,
          voucherType,
          paymentChannel,
          partyName,
          category || (voucherType === 'receipt' ? 'إيرادات أخرى' : 'مصروفات تشغيلية'),
          roundMoney(amount),
          notes,
          voucherDate,
          now
        );
      return Number(info.lastInsertRowid);
    })();

    const vouchers = getAllVouchers();
    res.status(201).json({
      voucher: vouchers.find((v) => v.id === voucherId),
      vouchers,
    });
  });

  // Financial vouchers are never deleted (R1.8, SEC-17): they are voided with a reason.
  router.delete('/api/vouchers/:id', requirePermission('vouchers.manage'), (_req: Request, res: Response) => {
    res.status(405).json({
      error: 'Vouchers cannot be deleted. Void the voucher with a reason instead.',
      code: 'VOUCHER_DELETE_NOT_ALLOWED',
    });
  });

  router.post('/api/vouchers/:id/void', requirePermission('vouchers.manage'), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const authUser = res.locals.authUser as AuthUser;
    const reason = String((req.body as Record<string, unknown>).reason ?? '').trim();

    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: 'Invalid voucher ID.', code: 'INVALID_ID' });
      return;
    }
    if (reason.length < 3 || reason.length > 300) {
      res.status(400).json({
        error: 'A reason of 3 to 300 characters is required to void a voucher.',
        code: 'VOID_REASON_REQUIRED',
      });
      return;
    }

    const voucher = db.prepare('SELECT id, status FROM vouchers WHERE id = ?').get(id) as
      | { id: number; status: string }
      | undefined;
    if (!voucher) {
      res.status(404).json({ error: 'Voucher not found.', code: 'NOT_FOUND' });
      return;
    }
    if (voucher.status === 'void') {
      res.status(409).json({ error: 'This voucher is already void.', code: 'ALREADY_VOID' });
      return;
    }

    db.prepare(`
      UPDATE vouchers SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?
    `).run(reason, new Date().toISOString(), authUser.id, id);

    const vouchers = getAllVouchers();
    res.json({ voucher: vouchers.find((v) => v.id === id), vouchers });
  });

  // Organization (store) and thermal-print settings
  router.put('/api/settings', requirePermission('settings.manage'), (req: Request, res: Response) => {
    const body = req.body as Record<string, unknown>;
    const current = getOrganizationSettings();

    const nameAr = String(body.name_ar ?? current.name_ar).trim();
    const nameEn = String(body.name_en ?? current.name_en).trim();
    const vatNumber = String(body.vat_number ?? current.vat_number).trim();
    const crNumber = String(body.cr_number ?? current.cr_number).trim();
    const streetAr = String(body.street_ar ?? current.street_ar).trim();
    const buildingNo = String(body.building_no ?? current.building_no).trim();
    const cityAr = String(body.city_ar ?? current.city_ar).trim();
    const postalCode = String(body.postal_code ?? current.postal_code).trim();
    const thermalWidthMm =
      body.thermal_width_mm === undefined
        ? current.thermal_width_mm
        : Number(body.thermal_width_mm) === 58
        ? 58
        : 80;
    const autoPrintReceipt =
      body.auto_print_receipt === undefined
        ? current.auto_print_receipt
        : body.auto_print_receipt === true ||
          body.auto_print_receipt === 1 ||
          body.auto_print_receipt === '1'
        ? 1
        : 0;
    const fontSize: FontSizeLevel =
      body.font_size === 'small' || body.font_size === 'large'
        ? body.font_size
        : body.font_size === 'medium'
        ? 'medium'
        : current.font_size === 'small' || current.font_size === 'large'
        ? current.font_size
        : 'medium';
    const rawPageSize = Number(body.table_page_size);
    const allowedPageSizes = [5, 10, 20, 50];
    const tablePageSize =
      body.table_page_size === undefined
        ? current.table_page_size || 10
        : allowedPageSizes.includes(rawPageSize)
        ? rawPageSize
        : 10;

    let publicBaseUrl =
      body.public_base_url === undefined
        ? current.public_base_url
        : String(body.public_base_url).trim().replace(/\/+$/, '');

    if (publicBaseUrl) {
      try {
        const parsed = new URL(publicBaseUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          res.status(400).json({ error: 'Public Base URL must use http:// or https://' });
          return;
        }
        publicBaseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
      } catch {
        res.status(400).json({ error: 'Invalid Public Base URL format.' });
        return;
      }
    }

    if (!nameAr || !vatNumber) {
      res.status(400).json({ error: 'Store name and VAT number are required.' });
      return;
    }
    // R1.10 (owner approved): the restaurant's own VAT number goes on every receipt.
    if (!isValidVatNumber(vatNumber)) {
      res.status(400).json({
        error: 'VAT number must be 15 digits starting and ending with 3.',
        code: 'VALIDATION_FAILED',
        field: 'vat_number',
        reason: 'INVALID_VAT',
      });
      return;
    }

    db.prepare(`
      UPDATE organization_settings
      SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?,
          street_ar = ?, building_no = ?, city_ar = ?, postal_code = ?,
          public_base_url = ?,
          thermal_width_mm = ?, auto_print_receipt = ?, font_size = ?, table_page_size = ?
      WHERE id = 1
    `).run(
      nameAr,
      nameEn,
      vatNumber,
      crNumber,
      streetAr,
      buildingNo,
      cityAr,
      postalCode,
      publicBaseUrl,
      thermalWidthMm,
      autoPrintReceipt,
      fontSize,
      tablePageSize
    );

    sendScoped(res, { settings: getOrganizationSettings() });
  });

  // Products, stock movements and categories moved to server/src/modules/inventory (R2.4a).

  // Suppliers & Purchases CRUD
  router.post('/api/suppliers', requirePermission('purchases.manage'), (req: Request, res: Response) => {
    // R1.10: name required; VAT number optional but valid when given (D12 format).
    const {
      name_ar: nameAr,
      name_en: nameEn,
      vat_number: vatNumber,
      cr_number: crNumber,
      phone,
      email,
      address_ar: addressAr,
    } = parseSupplierInput(req.body as Record<string, unknown>);

    const info = db
      .prepare(`
        INSERT INTO suppliers (name_ar, name_en, vat_number, cr_number, phone, email, address_ar, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(nameAr, nameEn, vatNumber, crNumber, phone, email, addressAr, new Date().toISOString());

    res.status(201).json({
      supplierId: info.lastInsertRowid,
      suppliers: getAllSuppliers(),
    });
  });

  router.put('/api/suppliers/:id', requirePermission('purchases.manage'), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Supplier not found.' });
      return;
    }

    const input = parseSupplierInput(req.body as Record<string, unknown>, existing);
    db.prepare(`
      UPDATE suppliers
      SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, phone = ?, email = ?, address_ar = ?
      WHERE id = ?
    `).run(
      input.name_ar,
      input.name_en,
      input.vat_number,
      input.cr_number,
      input.phone,
      input.email,
      input.address_ar,
      id
    );

    res.json({ suppliers: getAllSuppliers() });
  });

  const PURCHASE_ERROR_CODES: ReadonlySet<string> = new Set([
    'SUPPLIER_NOT_FOUND',
    'PRODUCT_NOT_FOUND',
    'INVALID_PURCHASE_LINE',
  ]);

  router.post('/api/purchases', requirePermission('purchases.manage'), (req: Request, res: Response) => {
    const b = req.body as Record<string, unknown>;
    const supplierId = Number(b.supplier_id);
    const supplierInvoiceNo = String(b.supplier_invoice_no ?? '').trim();
    const paymentStatus: PurchasePaymentStatus =
      b.payment_status === 'credit' || b.payment_status === 'partial'
        ? (b.payment_status as PurchasePaymentStatus)
        : 'paid';
    const notes = String(b.notes ?? '').trim();
    const rawItems = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];

    if (!supplierId || rawItems.length === 0) {
      res.status(400).json({ error: 'Supplier and at least one line item are required.' });
      return;
    }

    try {
      const createPurchaseTx = db.transaction(() => {
        const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as
          | Supplier
          | undefined;
        if (!supplier) {
          throw new Error('SUPPLIER_NOT_FOUND');
        }

        const now = new Date().toISOString();
        // Atomic yearly number (R1.8) instead of COUNT(*)+1.
        const purchaseNumber = nextDocumentNumber(db, 'PO');

        let subtotal = 0;
        let vatTotal = 0;
        const preparedItems: Array<{
          product: Product;
          qty: number;
          unitCost: number;
          taxRate: number;
          lineSub: number;
          lineVat: number;
          lineTotal: number;
        }> = [];

        for (const entry of rawItems) {
          const productId = Number(entry.product_id);
          const qty = Math.floor(Number(entry.qty ?? 0));
          const unitCost = Number(entry.unit_cost ?? 0);
          const taxRate = Number(entry.tax_rate ?? 15);
          if (qty <= 0 || Number.isNaN(unitCost) || unitCost < 0) {
            throw new Error('INVALID_PURCHASE_LINE');
          }

          const product = db
            .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
            .get(productId) as Product | undefined;
          if (!product) {
            throw new Error('PRODUCT_NOT_FOUND');
          }

          const lineSub = roundMoney(qty * unitCost);
          const lineVat = roundMoney(lineSub * (taxRate / 100));
          const lineTotal = roundMoney(lineSub + lineVat);
          subtotal += lineSub;
          vatTotal += lineVat;

          preparedItems.push({
            product,
            qty,
            unitCost,
            taxRate,
            lineSub,
            lineVat,
            lineTotal,
          });
        }

        subtotal = roundMoney(subtotal);
        vatTotal = roundMoney(vatTotal);
        const grandTotal = roundMoney(subtotal + vatTotal);
        const paidAmount =
          paymentStatus === 'paid'
            ? grandTotal
            : paymentStatus === 'partial'
            ? Math.min(grandTotal, Math.max(0, Number(b.paid_amount ?? 0)))
            : 0;

        const poInfo = db
          .prepare(`
            INSERT INTO purchases (
              purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
              payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            purchaseNumber,
            supplier.id,
            supplier.name_ar,
            supplier.vat_number,
            supplierInvoiceNo,
            paymentStatus,
            paidAmount,
            subtotal,
            vatTotal,
            grandTotal,
            notes,
            now,
            now
          );

        const insertItemStmt = db.prepare(`
          INSERT INTO purchase_items (
            purchase_id, product_id, sku, name_ar, name_en, qty, unit_cost, tax_rate,
            line_subtotal, line_vat, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of preparedItems) {
          insertItemStmt.run(
            poInfo.lastInsertRowid,
            item.product.id,
            item.product.sku,
            item.product.name_ar,
            item.product.name_en,
            item.qty,
            item.unitCost,
            item.taxRate,
            item.lineSub,
            item.lineVat,
            item.lineTotal
          );

          const newStock = item.product.stock_qty + item.qty;
          db.prepare(
            'UPDATE products SET stock_qty = ?, cost_price = ?, updated_at = ? WHERE id = ?'
          ).run(newStock, item.unitCost, now, item.product.id);

          db.prepare(`
            INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
            VALUES (?, 'purchase', ?, ?, ?, ?, ?)
          `).run(
            item.product.id,
            item.qty,
            newStock,
            purchaseNumber,
            `فاتورة مشتريات من ${supplier.name_ar}`,
            now
          );
        }

        return Number(poInfo.lastInsertRowid);
      });

      const purchaseId = createPurchaseTx();
      const purchases = getAllPurchases();
      sendScoped(res.status(201), {
        purchase: purchases.find((p) => p.id === purchaseId),
        purchases,
        products: getAllProducts(),
        movements: getRecentMovements(80),
      });
    } catch (err) {
      const code = knownErrorCode(err, PURCHASE_ERROR_CODES);
      if (code) {
        res.status(400).json({ error: code, code });
        return;
      }
      throw err; // unexpected: central error handler answers 500 without internal details
    }
  });

  router.post('/api/purchases/:id/pay', requirePermission('purchases.manage'), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
      | Purchase
      | undefined;
    if (!purchase) {
      res.status(404).json({ error: 'Purchase invoice not found.' });
      return;
    }

    const amount = Number((req.body as Record<string, unknown>).amount ?? 0);
    if (Number.isNaN(amount) || amount <= 0) {
      res.status(400).json({ error: 'Positive payment amount is required.' });
      return;
    }

    const nextPaid = Math.min(purchase.grand_total, roundMoney(purchase.paid_amount + amount));
    const nextStatus: PurchasePaymentStatus =
      nextPaid >= purchase.grand_total - 0.01 ? 'paid' : 'partial';

    db.prepare('UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?').run(
      nextPaid,
      nextStatus,
      id
    );

    sendScoped(res, { purchases: getAllPurchases() });
  });

  // Customers CRUD for B2B
  router.post('/api/customers', requirePermission('customers.manage'), (req: Request, res: Response) => {
    // R1.10: name required; VAT number optional but valid when given (D12 format).
    const {
      name_ar: nameAr,
      name_en: nameEn,
      vat_number: vatNumber,
      cr_number: crNumber,
      address_ar: addressAr,
      phone,
    } = parseCustomerInput(req.body as Record<string, unknown>);

    const now = new Date().toISOString();
    const info = db
      .prepare(`
        INSERT INTO customers (name_ar, name_en, vat_number, cr_number, address_ar, phone, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(nameAr, nameEn, vatNumber, crNumber, addressAr, phone, now);

    res.status(201).json({
      customerId: info.lastInsertRowid,
      customers: getAllCustomers(),
    });
  });

  router.put('/api/customers/:id', requirePermission('customers.manage'), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Customer not found.' });
      return;
    }

    const input = parseCustomerInput(req.body as Record<string, unknown>, existing);
    db.prepare(`
      UPDATE customers
      SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, address_ar = ?, phone = ?
      WHERE id = ?
    `).run(
      input.name_ar,
      input.name_en,
      input.vat_number,
      input.cr_number,
      input.address_ar,
      input.phone,
      id
    );

    res.json({ customers: getAllCustomers() });
  });

  // Held carts
  router.post('/api/carts/hold', requirePermission('pos.hold'), (req: Request, res: Response) => {
    const b = req.body as Record<string, unknown>;
    const label = String(b.label ?? `طلب معلق #${Date.now().toString().slice(-4)}`).trim();
    const itemsJson = JSON.stringify(Array.isArray(b.items) ? b.items : []);
    const discount = Number(b.discount ?? 0);
    const customerId = b.customer_id ? Number(b.customer_id) : null;
    const invoiceSubtype: InvoiceSubtype =
      b.invoice_subtype === INVOICE_KINDS.TAX ? INVOICE_KINDS.TAX : INVOICE_KINDS.SIMPLIFIED;

    db.prepare(`
      INSERT INTO held_carts (label, items_json, discount, customer_id, invoice_subtype, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(label, itemsJson, discount, customerId, invoiceSubtype, new Date().toISOString());

    res.status(201).json({ heldCarts: getHeldCarts() });
  });

  router.delete('/api/carts/hold/:id', requirePermission('pos.hold'), (req: Request, res: Response) => {
    db.prepare('DELETE FROM held_carts WHERE id = ?').run(Number(req.params.id));
    res.json({ heldCarts: getHeldCarts() });
  });

  // Atomic POS checkout: price from the DB, deduct stock, issue the sales invoice (388)
  const CHECKOUT_ERROR_CODES: ReadonlySet<string> = new Set([
    'INVALID_QTY',
    'PRODUCT_NOT_FOUND',
    'INSUFFICIENT_STOCK',
  ]);

  router.post('/api/invoices', requirePermission('pos.access'), async (req: Request, res: Response) => {
    const b = req.body as Record<string, unknown>;
    const authUser = res.locals.authUser as AuthUser;
    const rawItems = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
    const invoiceSubtype: InvoiceSubtype =
      b.invoice_subtype === INVOICE_KINDS.TAX ? INVOICE_KINDS.TAX : INVOICE_KINDS.SIMPLIFIED;

    // Sales invoices only (R1.5, SEC-09). Credit notes are issued through
    // POST /api/invoices/:id/credit-note, which links them to the original sale.
    if (b.invoice_type_code !== undefined && b.invoice_type_code !== DOCUMENT_TYPES.SALES_INVOICE) {
      res.status(400).json({
        error: 'Only sales invoices can be issued here.',
        code: 'INVALID_DOCUMENT_TYPE',
      });
      return;
    }
    const invoiceTypeCode: InvoiceTypeCode = DOCUMENT_TYPES.SALES_INVOICE;
    const paymentMethod: PaymentMethod =
      b.payment_method === PAYMENT_METHODS.CARD || b.payment_method === PAYMENT_METHODS.SPLIT
        ? (b.payment_method as PaymentMethod)
        : PAYMENT_METHODS.CASH;
    const discountTotal = Math.max(0, Number(b.discount_total ?? 0));
    const customerId = b.customer_id ? Number(b.customer_id) : null;

    if (discountTotal > 0 && !authUser.permissions.includes('pos.discount')) {
      res.status(403).json({ error: 'You do not have permission to apply discounts.' });
      return;
    }

    if (rawItems.length === 0) {
      res.status(400).json({ error: 'Cart cannot be empty.' });
      return;
    }

    // Customer: an unknown id is an error (it used to fall back to the cash
    // customer silently). A standard tax invoice (B2B) needs a registered customer
    // with a valid VAT number (D12).
    let customerName = 'عميل نقدي / Cash Customer';
    let customerVat = '';
    if (customerId) {
      const cust = db
        .prepare('SELECT name_ar, vat_number FROM customers WHERE id = ?')
        .get(customerId) as { name_ar: string; vat_number: string } | undefined;
      if (!cust) {
        res.status(400).json({ error: 'Customer not found.', code: 'CUSTOMER_NOT_FOUND' });
        return;
      }
      customerName = cust.name_ar;
      customerVat = cust.vat_number.trim();
    }
    if (invoiceSubtype === INVOICE_KINDS.TAX) {
      if (!customerId) {
        res.status(400).json({
          error: 'A tax invoice (B2B) requires a registered customer.',
          code: 'CUSTOMER_REQUIRED',
        });
        return;
      }
      if (!isValidVatNumber(customerVat)) {
        res.status(400).json({
          error: 'A tax invoice (B2B) requires the customer to have a valid 15-digit VAT number.',
          code: 'CUSTOMER_VAT_INVALID',
        });
        return;
      }
    }

    try {
      const prepared = db.transaction(() => {
        const now = new Date();
        const createdAt = now.toISOString();
        // Random, unguessable id used by the public invoice link / receipt QR (D1).
        const uuid = crypto.randomUUID();
        // Own yearly sequence (R1.8).
        const invoiceNumber = nextDocumentNumber(db, 'INV');

        const lineItems: InvoiceItem[] = [];
        let rawSubtotal = 0;

        for (const entry of rawItems) {
          const productId = Number(entry.product_id);
          const qty = Math.floor(Number(entry.qty ?? 0));
          if (qty <= 0) {
            throw new Error('INVALID_QTY');
          }

          const product = db
            .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
            .get(productId) as Product | undefined;

          if (!product) {
            throw new Error('PRODUCT_NOT_FOUND');
          }
          if (product.stock_qty < qty) {
            throw new Error(`INSUFFICIENT_STOCK:${product.name_ar}`);
          }

          const newStock = product.stock_qty - qty;
          db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
            newStock,
            createdAt,
            product.id
          );

          db.prepare(`
            INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
            VALUES (?, 'sale', ?, ?, ?, 'بيع عبر نقطة البيع', ?)
          `).run(product.id, -qty, newStock, invoiceNumber, createdAt);

          const lineSub = roundMoney(product.sell_price * qty);
          const lineVat = roundMoney(lineSub * (product.tax_rate / 100));
          const lineTotal = roundMoney(lineSub + lineVat);
          rawSubtotal += lineSub;

          lineItems.push({
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
            line_subtotal: lineSub,
            line_vat: lineVat,
            line_total: lineTotal,
          });
        }

        const effectiveDiscount = Math.min(discountTotal, rawSubtotal);
        const discountRatio = rawSubtotal > 0 ? (rawSubtotal - effectiveDiscount) / rawSubtotal : 1;
        const subtotal = roundMoney(rawSubtotal - effectiveDiscount);
        const vatTotal = roundMoney(lineItems.reduce((sum, item) => sum + item.line_vat, 0) * discountRatio);
        const grandTotal = roundMoney(subtotal + vatTotal);

        const cashAmount =
          paymentMethod === 'cash'
            ? grandTotal
            : paymentMethod === 'split'
            ? Math.min(grandTotal, Math.max(0, Number(b.cash_amount ?? 0)))
            : 0;
        const cardAmount =
          paymentMethod === 'card'
            ? grandTotal
            : paymentMethod === 'split'
            ? roundMoney(grandTotal - cashAmount)
            : 0;

        const invResult = db
          .prepare(`
            INSERT INTO invoices (
              uuid, invoice_number, invoice_type_code, invoice_subtype,
              payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
              subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
          `)
          .run(
            uuid,
            invoiceNumber,
            invoiceTypeCode,
            invoiceSubtype,
            paymentMethod,
            cashAmount,
            cardAmount,
            customerId,
            customerName,
            customerVat,
            subtotal,
            effectiveDiscount,
            vatTotal,
            grandTotal,
            createdAt
          );

        const insertItemStmt = db.prepare(`
          INSERT INTO invoice_items (
            invoice_id, product_id, sku, name_ar, name_en, unit_ar,
            qty, unit_price, discount, tax_rate, tax_category,
            line_subtotal, line_vat, line_total
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        for (const item of lineItems) {
          insertItemStmt.run(
            invResult.lastInsertRowid,
            item.product_id,
            item.sku,
            item.name_ar,
            item.name_en,
            item.unit_ar,
            item.qty,
            item.unit_price,
            item.discount,
            item.tax_rate,
            item.tax_category,
            item.line_subtotal,
            item.line_vat,
            item.line_total
          );
        }

        return { invoiceId: Number(invResult.lastInsertRowid) };
      });

      // The invoice and its stock movements are committed once prepared() returns.
      // Rule (R1.5): any follow-up step added here must log its failures instead of
      // reporting a failed checkout, or the cashier would sell the same cart again.
      const result = prepared();

      const invoices = getAllInvoices();
      const createdInvoice = invoices.find((i) => i.id === result.invoiceId);

      sendScoped(res.status(201), {
        invoice: createdInvoice,
        settings: getOrganizationSettings(),
        products: getAllProducts(),
        invoices,
        movements: getRecentMovements(80),
      });
    } catch (err) {
      const code = knownErrorCode(err, CHECKOUT_ERROR_CODES);
      if (code) {
        res.status(400).json({ error: (err as Error).message, code });
        return;
      }
      throw err; // unexpected: central error handler answers 500
    }
  });

  // Issue a credit note (381) for an existing sales invoice and return its items to stock
  router.post('/api/invoices/:id/credit-note', requirePermission('sales.return'), async (req: Request, res: Response) => {
    const sourceId = Number(req.params.id);
    const sourceInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(sourceId) as Invoice | undefined;
    if (!sourceInv) {
      res.status(404).json({ error: 'Original invoice not found.' });
      return;
    }
    if (sourceInv.invoice_type_code !== DOCUMENT_TYPES.SALES_INVOICE) {
      res.status(400).json({ error: 'Credit note can only be issued for a sales invoice.' });
      return;
    }
    const existingCreditNote = db
      .prepare(
        "SELECT invoice_number FROM invoices WHERE invoice_type_code = '381' AND related_invoice_number = ?"
      )
      .get(sourceInv.invoice_number) as { invoice_number: string } | undefined;
    if (existingCreditNote) {
      res.status(400).json({
        error: `Invoice already returned via ${existingCreditNote.invoice_number}.`,
      });
      return;
    }

    const sourceItems = db
      .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
      .all(sourceId) as InvoiceItem[];

    const prepared = db.transaction(() => {
      const now = new Date();
      const createdAt = now.toISOString();
      const uuid = crypto.randomUUID();
      // Credit notes have their own sequence (R1.8): they no longer consume invoice numbers.
      const invoiceNumber = nextDocumentNumber(db, 'CN');

      // D5 (owner): a credit note reverses revenue and VAT only; it never puts
      // stock back. A returned dish cannot become raw chicken or rice again, so
      // its ingredients stay consumed. A sealed item that really goes back on
      // the shelf is recorded by hand as a 'return' stock movement (inventory.adjust).

      const info = db
        .prepare(`
          INSERT INTO invoices (
            uuid, invoice_number, invoice_type_code, invoice_subtype,
            payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
            subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
          ) VALUES (?, ?, '381', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          uuid,
          invoiceNumber,
          sourceInv.invoice_subtype,
          sourceInv.payment_method,
          sourceInv.cash_amount,
          sourceInv.card_amount,
          sourceInv.customer_id,
          sourceInv.customer_name,
          sourceInv.customer_vat,
          sourceInv.subtotal,
          sourceInv.discount_total,
          sourceInv.vat_total,
          sourceInv.grand_total,
          sourceInv.invoice_number,
          createdAt
        );

      const insertItemStmt = db.prepare(`
        INSERT INTO invoice_items (
          invoice_id, product_id, sku, name_ar, name_en, unit_ar,
          qty, unit_price, discount, tax_rate, tax_category,
          line_subtotal, line_vat, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of sourceItems) {
        insertItemStmt.run(
          info.lastInsertRowid,
          item.product_id,
          item.sku,
          item.name_ar,
          item.name_en,
          item.unit_ar,
          item.qty,
          item.unit_price,
          item.discount,
          item.tax_rate,
          item.tax_category,
          item.line_subtotal,
          item.line_vat,
          item.line_total
        );
      }

      return { invoiceId: Number(info.lastInsertRowid) };
    });

    // Committed once prepared() returns (credit note and its lines). Any follow-up
    // step added later must log its failures, not report a failed credit note (R1.5).
    const result = prepared();

    const invoices = getAllInvoices();
    sendScoped(res.status(201), {
      invoice: invoices.find((i) => i.id === result.invoiceId),
      settings: getOrganizationSettings(),
      products: getAllProducts(),
      invoices,
      movements: getRecentMovements(80),
    });
  });

  return router;
}
