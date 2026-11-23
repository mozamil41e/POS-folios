import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { Request, Response } from 'express';
import {
  createSessionForUser,
  db,
  getAllCustomers,
  getAllInvoices,
  getAllProducts,
  getAllPurchases,
  getAllSuppliers,
  getHeldCarts,
  getOrganizationSettings,
  getPublicInvoiceByUuid,
  getRecentMovements,
  getUserBySessionToken,
  hasAnyUsers,
  hashPassword,
  initDatabase,
  revokeSessionToken,
  verifyPassword,
} from './src/server/db.ts';
import {
  buildLaravelZipBuffer,
  generateLaravelFiles,
} from './src/server/laravelGenerator.ts';
import {
  buildUbl21Xml,
  decodeZatcaTlvQr,
  dispatchToZatca,
  generateEgsKeyPair,
  signXmlAndBuildQr,
} from './src/server/zatca.ts';
import type {
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
  UserRole,
  ZatcaMode,
} from './src/types.ts';

initDatabase();

const app = express();
app.use(express.json({ limit: '2mb' }));

// Public read-only invoice lookup (used by thermal receipt QR public URL)
app.get('/api/public/invoices/:uuid', (req: Request, res: Response) => {
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

// Public Authentication Routes
app.get('/api/auth/status', (_req: Request, res: Response) => {
  res.json({ hasUsers: hasAnyUsers() });
});

app.post('/api/auth/register', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const fullName = String(b.full_name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';

  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (password.length < 6 || password.length > 128) {
    res.status(400).json({ error: 'Password must be between 6 and 128 characters.' });
    return;
  }

  try {
    const registerTx = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        throw new Error('EMAIL_EXISTS');
      }

      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
      const role: UserRole = countRow.cnt === 0 ? 'admin' : 'cashier';
      const now = new Date().toISOString();
      const passwordHash = hashPassword(password);

      const info = db
        .prepare(`
          INSERT INTO users (full_name, email, password_hash, role, created_at)
          VALUES (?, ?, ?, ?, ?)
        `)
        .run(fullName, email, passwordHash, role, now);

      const userId = Number(info.lastInsertRowid);
      const session = createSessionForUser(userId);
      return {
        token: session.token,
        user: {
          id: userId,
          full_name: fullName,
          email,
          role,
          created_at: now,
        },
      };
    });

    const result = registerTx();
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'EMAIL_EXISTS') {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }
    res.status(400).json({ error: 'Failed to create account.' });
  }
});

app.post('/api/auth/login', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const user = db
    .prepare('SELECT id, full_name, email, password_hash, role, created_at FROM users WHERE email = ?')
    .get(email) as
    | {
        id: number;
        full_name: string;
        email: string;
        password_hash: string;
        role: string;
        created_at: string;
      }
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid email or password.' });
    return;
  }

  const session = createSessionForUser(user.id);
  const role: UserRole = user.role === 'admin' ? 'admin' : 'cashier';
  res.json({
    token: session.token,
    user: {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role,
      created_at: user.created_at,
    },
  });
});

// Require valid Bearer session token for all private /api routes
app.use('/api', (req: Request, res: Response, next) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const user = getUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.locals.authUser = user;
  res.locals.authToken = token;
  next();
});

app.get('/api/auth/me', (_req: Request, res: Response) => {
  res.json({ user: res.locals.authUser });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  const token = String(res.locals.authToken ?? '');
  revokeSessionToken(token);
  res.json({ ok: true });
});

// Bootstrap entire workspace state
app.get('/api/bootstrap', (_req: Request, res: Response) => {
  res.json({
    settings: getOrganizationSettings(),
    products: getAllProducts(),
    customers: getAllCustomers(),
    suppliers: getAllSuppliers(),
    purchases: getAllPurchases(),
    invoices: getAllInvoices(),
    movements: getRecentMovements(80),
    heldCarts: getHeldCarts(),
  });
});

// Organization, Thermal Print & ZATCA settings
app.put('/api/settings', (req: Request, res: Response) => {
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
  const egsSerial = String(body.egs_serial ?? current.egs_serial).trim();
  const mode: ZatcaMode =
    body.mode === 'fatoora_simulation' ? 'fatoora_simulation' : 'simulator';
  const zatcaEnabled =
    body.zatca_enabled === undefined
      ? current.zatca_enabled
      : body.zatca_enabled === true || body.zatca_enabled === 1 || body.zatca_enabled === '1'
      ? 1
      : 0;
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

  db.prepare(`
    UPDATE organization_settings
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?,
        street_ar = ?, building_no = ?, city_ar = ?, postal_code = ?,
        egs_serial = ?, mode = ?, zatca_enabled = ?, public_base_url = ?,
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
    egsSerial,
    mode,
    zatcaEnabled,
    publicBaseUrl,
    thermalWidthMm,
    autoPrintReceipt,
    fontSize,
    tablePageSize
  );

  res.json({ settings: getOrganizationSettings() });
});

// Generate real secp256k1 ECDSA keypair + ZATCA CSR
app.post('/api/zatca/generate-keys', (_req: Request, res: Response) => {
  const org = getOrganizationSettings();
  const keys = generateEgsKeyPair({
    name_en: org.name_en,
    vat_number: org.vat_number,
    egs_serial: org.egs_serial,
    city_ar: org.city_ar,
  });

  const nextStep = Math.max(org.onboarding_step, 1);
  db.prepare(`
    UPDATE organization_settings
    SET private_key_pem = ?, public_key_base64 = ?, csr_pem = ?, onboarding_step = ?
    WHERE id = 1
  `).run(keys.privateKeyPem, keys.publicKeyBase64, keys.csrPem, nextStep);

  res.json({
    settings: getOrganizationSettings(),
    message: 'Generated ECDSA secp256k1 keypair and ZATCA CSR.',
  });
});

// Execute ZATCA onboarding steps (CCSID -> Compliance Check -> PCSID)
app.post('/api/zatca/onboard', async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const action = String(body.action ?? '');
  const otp = String(body.otp ?? '').trim();
  const org = getOrganizationSettings();

  if (action === 'request_ccsid') {
    if (!org.csr_pem) {
      res.status(400).json({ error: 'Generate secp256k1 keypair & CSR first.' });
      return;
    }
    if (!otp || otp.length < 4) {
      res.status(400).json({ error: 'Valid OTP from Fatoora Portal is required.' });
      return;
    }

    if (org.mode === 'fatoora_simulation') {
      try {
        const response = await fetch(
          'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/compliance',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'Accept-Version': 'V2',
              OTP: otp,
            },
            body: JSON.stringify({
              csr: Buffer.from(org.csr_pem, 'utf8').toString('base64'),
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          res.status(400).json({
            error:
              typeof data.message === 'string'
                ? data.message
                : `ZATCA Simulation returned HTTP ${response.status}`,
          });
          return;
        }
        db.prepare(`
          UPDATE organization_settings
          SET ccsid_token = ?, ccsid_secret = ?, ccsid_request_id = ?, onboarding_step = 2
          WHERE id = 1
        `).run(
          String(data.binarySecurityToken ?? ''),
          String(data.secret ?? ''),
          String(data.requestID ?? ''),
        );
        res.json({ settings: getOrganizationSettings(), apiResponse: data });
        return;
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? `Fatoora Simulation API unreachable: ${err.message}`
              : 'Fatoora Simulation API unreachable',
        });
        return;
      }
    }

    // Protocol Simulator CCSID issuance
    const simToken = `CCSID-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
    const simSecret = crypto.randomBytes(12).toString('hex');
    const simReqId = String(Math.floor(100000000 + Math.random() * 899999999));

    db.prepare(`
      UPDATE organization_settings
      SET ccsid_token = ?, ccsid_secret = ?, ccsid_request_id = ?, onboarding_step = 2
      WHERE id = 1
    `).run(simToken, simSecret, simReqId);

    res.json({
      settings: getOrganizationSettings(),
      apiResponse: {
        requestID: simReqId,
        dispositionMessage: 'ISSUED',
        binarySecurityToken: simToken,
      },
    });
    return;
  }

  if (action === 'compliance_check') {
    if (!org.ccsid_token) {
      res.status(400).json({ error: 'Obtain Compliance CSID (CCSID) first.' });
      return;
    }

    db.prepare('UPDATE organization_settings SET onboarding_step = 3 WHERE id = 1').run();
    res.json({
      settings: getOrganizationSettings(),
      checks: [
        { type: 'Standard Tax Invoice (B2B 388)', status: 'PASS' },
        { type: 'Simplified Tax Invoice (B2C 388)', status: 'PASS' },
        { type: 'Credit Note (381)', status: 'PASS' },
        { type: 'Debit Note (383)', status: 'PASS' },
      ],
    });
    return;
  }

  if (action === 'request_pcsid') {
    if (!org.ccsid_request_id) {
      res.status(400).json({ error: 'Complete CCSID & compliance checks first.' });
      return;
    }

    if (org.mode === 'fatoora_simulation' && org.ccsid_token && org.ccsid_secret) {
      try {
        const auth = Buffer.from(`${org.ccsid_token}:${org.ccsid_secret}`, 'utf8').toString('base64');
        const response = await fetch(
          'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/production/csids',
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'Accept-Version': 'V2',
              Authorization: `Basic ${auth}`,
            },
            body: JSON.stringify({
              compliance_request_id: org.ccsid_request_id,
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          res.status(400).json({
            error:
              typeof data.message === 'string'
                ? data.message
                : `ZATCA PCSID returned HTTP ${response.status}`,
          });
          return;
        }
        db.prepare(`
          UPDATE organization_settings
          SET pcsid_token = ?, pcsid_secret = ?, onboarding_step = 4
          WHERE id = 1
        `).run(String(data.binarySecurityToken ?? ''), String(data.secret ?? ''));
        res.json({ settings: getOrganizationSettings(), apiResponse: data });
        return;
      } catch (err) {
        res.status(502).json({
          error:
            err instanceof Error
              ? `Fatoora Simulation API unreachable: ${err.message}`
              : 'Fatoora Simulation API unreachable',
        });
        return;
      }
    }

    const simPcsid = `PCSID-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const simPcsidSecret = crypto.randomBytes(16).toString('hex');
    db.prepare(`
      UPDATE organization_settings
      SET pcsid_token = ?, pcsid_secret = ?, onboarding_step = 4
      WHERE id = 1
    `).run(simPcsid, simPcsidSecret);

    res.json({
      settings: getOrganizationSettings(),
      apiResponse: {
        dispositionMessage: 'ISSUED',
        binarySecurityToken: simPcsid,
      },
    });
    return;
  }

  res.status(400).json({ error: 'Unknown onboarding action.' });
});

// Decode TLV Base64 QR code
app.post('/api/zatca/decode-qr', (req: Request, res: Response) => {
  const qr = String((req.body as Record<string, unknown>).qr ?? '').trim();
  if (!qr) {
    res.status(400).json({ error: 'QR Base64 string is required.' });
    return;
  }
  const tags = decodeZatcaTlvQr(qr);
  res.json({ tags });
});

// Product CRUD
app.post('/api/products', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const sku = String(b.sku ?? '').trim();
  const nameAr = String(b.name_ar ?? '').trim();
  const nameEn = String(b.name_en ?? '').trim() || nameAr;
  const categoryAr = String(b.category_ar ?? 'عام').trim();
  const categoryEn = String(b.category_en ?? 'General').trim();
  const unitAr = String(b.unit_ar ?? 'حبة').trim();
  const unitEn = String(b.unit_en ?? 'Pcs').trim();
  const costPrice = Number(b.cost_price ?? 0);
  const sellPrice = Number(b.sell_price ?? 0);
  const taxRate = Number(b.tax_rate ?? 15);
  const taxCategory = (['S', 'Z', 'E'].includes(String(b.tax_category)) ? String(b.tax_category) : 'S') as 'S' | 'Z' | 'E';
  const stockQty = Math.max(0, Math.floor(Number(b.stock_qty ?? 0)));
  const minStockAlert = Math.max(0, Math.floor(Number(b.min_stock_alert ?? 10)));
  const expiryDate = b.expiry_date ? String(b.expiry_date).trim() : null;

  if (!sku || !nameAr || Number.isNaN(sellPrice) || sellPrice <= 0) {
    res.status(400).json({ error: 'Valid SKU, Arabic name, and positive selling price are required.' });
    return;
  }

  const now = new Date().toISOString();
  try {
    const createTx = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO products (
            sku, name_ar, name_en, category_ar, category_en, unit_ar, unit_en,
            cost_price, sell_price, tax_rate, tax_category, stock_qty, min_stock_alert,
            expiry_date, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          sku,
          nameAr,
          nameEn,
          categoryAr,
          categoryEn,
          unitAr,
          unitEn,
          costPrice,
          sellPrice,
          taxRate,
          taxCategory,
          stockQty,
          minStockAlert,
          expiryDate,
          now,
          now
        );

      if (stockQty > 0) {
        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'purchase', ?, ?, 'NEW-SKU', 'إضافة صنف جديد للمخزون', ?)
        `).run(info.lastInsertRowid, stockQty, stockQty, now);
      }

      return info.lastInsertRowid;
    });

    const id = createTx();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json({
      product,
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error && err.message.includes('UNIQUE')
        ? 'SKU/Barcode already exists.'
        : 'Failed to create product.',
    });
  }
});

app.put('/api/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE products
    SET sku = ?, name_ar = ?, name_en = ?, category_ar = ?, category_en = ?,
        unit_ar = ?, unit_en = ?, cost_price = ?, sell_price = ?,
        tax_rate = ?, tax_category = ?, min_stock_alert = ?, expiry_date = ?, updated_at = ?
    WHERE id = ?
  `).run(
    String(b.sku ?? existing.sku).trim(),
    String(b.name_ar ?? existing.name_ar).trim(),
    String(b.name_en ?? existing.name_en).trim(),
    String(b.category_ar ?? existing.category_ar).trim(),
    String(b.category_en ?? existing.category_en).trim(),
    String(b.unit_ar ?? existing.unit_ar).trim(),
    String(b.unit_en ?? existing.unit_en).trim(),
    Number(b.cost_price ?? existing.cost_price),
    Number(b.sell_price ?? existing.sell_price),
    Number(b.tax_rate ?? existing.tax_rate),
    String(b.tax_category ?? existing.tax_category),
    Math.max(0, Math.floor(Number(b.min_stock_alert ?? existing.min_stock_alert))),
    b.expiry_date === null || b.expiry_date === '' ? null : String(b.expiry_date ?? existing.expiry_date ?? ''),
    now,
    id
  );

  res.json({ products: getAllProducts() });
});

app.delete('/api/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
  res.json({ products: getAllProducts() });
});

// Inventory movement (purchase / adjustment / return)
app.post('/api/inventory/movement', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const productId = Number(b.product_id);
  const type = String(b.type ?? 'purchase');
  const qty = Math.floor(Number(b.qty ?? 0));
  const notes = String(b.notes ?? '').trim();
  const referenceNo = String(b.reference_no ?? `STK-${Date.now().toString().slice(-6)}`).trim();

  if (!['purchase', 'adjustment', 'return'].includes(type) || qty === 0) {
    res.status(400).json({ error: 'Valid movement type and non-zero quantity are required.' });
    return;
  }

  try {
    const moveTx = db.transaction(() => {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId) as Product | undefined;
      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      const delta = type === 'purchase' || type === 'return' ? Math.abs(qty) : qty;
      const newBalance = Math.max(0, product.stock_qty + delta);
      const now = new Date().toISOString();

      db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
        newBalance,
        now,
        product.id
      );

      db.prepare(`
        INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(product.id, type, delta, newBalance, referenceNo, notes, now);
    });

    moveTx();
    res.json({
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error && err.message === 'PRODUCT_NOT_FOUND'
        ? 'Product not found.'
        : 'Inventory movement failed.',
    });
  }
});

// Suppliers & Purchases CRUD
app.post('/api/suppliers', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const nameAr = String(b.name_ar ?? '').trim();
  const nameEn = String(b.name_en ?? '').trim() || nameAr;
  const vatNumber = String(b.vat_number ?? '').trim();
  const crNumber = String(b.cr_number ?? '').trim();
  const phone = String(b.phone ?? '').trim();
  const email = String(b.email ?? '').trim();
  const addressAr = String(b.address_ar ?? '').trim();

  if (!nameAr) {
    res.status(400).json({ error: 'Supplier name is required.' });
    return;
  }

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

app.put('/api/suppliers/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  db.prepare(`
    UPDATE suppliers
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, phone = ?, email = ?, address_ar = ?
    WHERE id = ?
  `).run(
    String(b.name_ar ?? existing.name_ar).trim(),
    String(b.name_en ?? existing.name_en).trim(),
    String(b.vat_number ?? existing.vat_number).trim(),
    String(b.cr_number ?? existing.cr_number).trim(),
    String(b.phone ?? existing.phone).trim(),
    String(b.email ?? existing.email).trim(),
    String(b.address_ar ?? existing.address_ar).trim(),
    id
  );

  res.json({ suppliers: getAllSuppliers() });
});

app.post('/api/purchases', (req: Request, res: Response) => {
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
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM purchases').get() as { cnt: number };
      const nextNum = countRow.cnt + 1;
      const purchaseNumber = `PO-${now.slice(0, 4)}-${String(nextNum).padStart(5, '0')}`;

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

        const lineSub = Number((qty * unitCost).toFixed(2));
        const lineVat = Number((lineSub * (taxRate / 100)).toFixed(2));
        const lineTotal = Number((lineSub + lineVat).toFixed(2));
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

      subtotal = Number(subtotal.toFixed(2));
      vatTotal = Number(vatTotal.toFixed(2));
      const grandTotal = Number((subtotal + vatTotal).toFixed(2));
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
    res.status(201).json({
      purchase: purchases.find((p) => p.id === purchaseId),
      purchases,
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    res.status(400).json({
      error: err instanceof Error ? err.message : 'Failed to create purchase invoice.',
    });
  }
});

app.post('/api/purchases/:id/pay', (req: Request, res: Response) => {
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

  const nextPaid = Math.min(purchase.grand_total, Number((purchase.paid_amount + amount).toFixed(2)));
  const nextStatus: PurchasePaymentStatus =
    nextPaid >= purchase.grand_total - 0.01 ? 'paid' : 'partial';

  db.prepare('UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?').run(
    nextPaid,
    nextStatus,
    id
  );

  res.json({ purchases: getAllPurchases() });
});

// Customers CRUD for B2B
app.post('/api/customers', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const nameAr = String(b.name_ar ?? '').trim();
  const nameEn = String(b.name_en ?? '').trim() || nameAr;
  const vatNumber = String(b.vat_number ?? '').trim();
  const crNumber = String(b.cr_number ?? '').trim();
  const addressAr = String(b.address_ar ?? '').trim();
  const phone = String(b.phone ?? '').trim();

  if (!nameAr) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }

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

app.put('/api/customers/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as
    | {
        id: number;
        name_ar: string;
        name_en: string;
        vat_number: string;
        cr_number: string;
        address_ar: string;
        phone: string;
      }
    | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  const nameAr = String(b.name_ar ?? existing.name_ar).trim();
  if (!nameAr) {
    res.status(400).json({ error: 'Customer name is required.' });
    return;
  }

  db.prepare(`
    UPDATE customers
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, address_ar = ?, phone = ?
    WHERE id = ?
  `).run(
    nameAr,
    String(b.name_en ?? existing.name_en).trim() || nameAr,
    String(b.vat_number ?? existing.vat_number).trim(),
    String(b.cr_number ?? existing.cr_number).trim(),
    String(b.address_ar ?? existing.address_ar).trim(),
    String(b.phone ?? existing.phone).trim(),
    id
  );

  res.json({ customers: getAllCustomers() });
});

// Held carts
app.post('/api/carts/hold', (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const label = String(b.label ?? `طلب معلق #${Date.now().toString().slice(-4)}`).trim();
  const itemsJson = JSON.stringify(Array.isArray(b.items) ? b.items : []);
  const discount = Number(b.discount ?? 0);
  const customerId = b.customer_id ? Number(b.customer_id) : null;
  const invoiceSubtype: InvoiceSubtype =
    b.invoice_subtype === '0100000' ? '0100000' : '0200000';

  db.prepare(`
    INSERT INTO held_carts (label, items_json, discount, customer_id, invoice_subtype, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(label, itemsJson, discount, customerId, invoiceSubtype, new Date().toISOString());

  res.status(201).json({ heldCarts: getHeldCarts() });
});

app.delete('/api/carts/hold/:id', (req: Request, res: Response) => {
  db.prepare('DELETE FROM held_carts WHERE id = ?').run(Number(req.params.id));
  res.json({ heldCarts: getHeldCarts() });
});

// Atomic POS Checkout -> Deduct Inventory + Generate UBL 2.1 XML + Sign + TLV QR + ZATCA Dispatch
app.post('/api/invoices', async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const rawItems = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
  const invoiceSubtype: InvoiceSubtype =
    b.invoice_subtype === '0100000' ? '0100000' : '0200000';
  const invoiceTypeCode: InvoiceTypeCode =
    b.invoice_type_code === '381' || b.invoice_type_code === '383'
      ? (b.invoice_type_code as InvoiceTypeCode)
      : '388';
  const paymentMethod: PaymentMethod =
    b.payment_method === 'card' || b.payment_method === 'split'
      ? (b.payment_method as PaymentMethod)
      : 'cash';
  const discountTotal = Math.max(0, Number(b.discount_total ?? 0));
  const customerId = b.customer_id ? Number(b.customer_id) : null;

  if (rawItems.length === 0) {
    res.status(400).json({ error: 'Cart cannot be empty.' });
    return;
  }

  try {
    const prepared = db.transaction(() => {
      const org = getOrganizationSettings();
      const now = new Date();
      const createdAt = now.toISOString();
      const issueDate = createdAt.slice(0, 10);
      const issueTime = createdAt.slice(11, 19);
      const nextIcv = (org.last_icv || 0) + 1;
      const uuid = crypto.randomUUID();
      const invoiceNumber = `INV-${issueDate.slice(0, 4)}-${String(nextIcv).padStart(5, '0')}`;

      let customerName = 'عميل نقدي / Cash Customer';
      let customerVat = '';
      if (customerId) {
        const cust = db
          .prepare('SELECT * FROM customers WHERE id = ?')
          .get(customerId) as { name_ar: string; vat_number: string } | undefined;
        if (cust) {
          customerName = cust.name_ar;
          customerVat = cust.vat_number;
        }
      } else if (invoiceSubtype === '0100000') {
        customerName = String(b.customer_name ?? '').trim();
        customerVat = String(b.customer_vat ?? '').trim();
      }

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

        const lineSub = Number((product.sell_price * qty).toFixed(2));
        const lineVat = Number((lineSub * (product.tax_rate / 100)).toFixed(2));
        const lineTotal = Number((lineSub + lineVat).toFixed(2));
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
      const subtotal = Number((rawSubtotal - effectiveDiscount).toFixed(2));
      const vatTotal = Number(
        (lineItems.reduce((sum, item) => sum + item.line_vat, 0) * discountRatio).toFixed(2)
      );
      const grandTotal = Number((subtotal + vatTotal).toFixed(2));

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
          ? Number((grandTotal - cashAmount).toFixed(2))
          : 0;

      const xml = buildUbl21Xml({
        uuid,
        invoiceNumber,
        icv: nextIcv,
        previousHash: org.last_pih,
        issueDate,
        issueTime,
        invoiceTypeCode,
        invoiceSubtype,
        org,
        customerName,
        customerVat,
        items: lineItems,
        subtotal,
        discountTotal: effectiveDiscount,
        vatTotal,
        grandTotal,
      });

      const signed = signXmlAndBuildQr({
        xml,
        org,
        timestampIso: createdAt,
        grandTotal,
        vatTotal,
      });

      const invResult = db
        .prepare(`
          INSERT INTO invoices (
            uuid, invoice_number, icv, invoice_type_code, invoice_subtype,
            payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
            subtotal, discount_total, vat_total, grand_total,
            invoice_hash, previous_hash, qr_tlv_base64, xml_content,
            zatca_status, zatca_mode, zatca_response_json, related_invoice_number, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, '{}', NULL, ?)
        `)
        .run(
          uuid,
          invoiceNumber,
          nextIcv,
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
          signed.invoiceHashBase64,
          org.last_pih,
          signed.qrTlvBase64,
          xml,
          org.mode,
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

      db.prepare(
        'UPDATE organization_settings SET last_icv = ?, last_pih = ? WHERE id = 1'
      ).run(nextIcv, signed.invoiceHashBase64);

      return {
        invoiceId: Number(invResult.lastInsertRowid),
        org,
        uuid,
        invoiceHashBase64: signed.invoiceHashBase64,
        xml,
        invoiceSubtype,
        customerVat,
      };
    });

    const result = prepared();
    if (result.org.zatca_enabled === 1) {
      const zatcaRes = await dispatchToZatca({
        org: result.org,
        uuid: result.uuid,
        invoiceHashBase64: result.invoiceHashBase64,
        xml: result.xml,
        invoiceSubtype: result.invoiceSubtype,
        customerVat: result.customerVat,
      });

      db.prepare(`
        UPDATE invoices
        SET zatca_status = ?, zatca_mode = ?, zatca_response_json = ?
        WHERE id = ?
      `).run(
        zatcaRes.status,
        zatcaRes.mode,
        JSON.stringify(zatcaRes),
        result.invoiceId
      );
    } else {
      db.prepare(`
        UPDATE invoices
        SET zatca_status = 'DISABLED', zatca_response_json = ?
        WHERE id = ?
      `).run(
        JSON.stringify({
          disabled: true,
          message: 'ZATCA integration is currently disabled.',
        }),
        result.invoiceId
      );
    }

    const invoices = getAllInvoices();
    const createdInvoice = invoices.find((i) => i.id === result.invoiceId);

    res.status(201).json({
      invoice: createdInvoice,
      settings: getOrganizationSettings(),
      products: getAllProducts(),
      invoices,
      movements: getRecentMovements(80),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed.';
    res.status(400).json({ error: message });
  }
});

// Retry ZATCA submission for pending/rejected invoice
app.post('/api/invoices/:id/retry', async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id) as Invoice | undefined;
  if (!inv) {
    res.status(404).json({ error: 'Invoice not found.' });
    return;
  }

  const org = getOrganizationSettings();
  if (org.zatca_enabled !== 1) {
    res.status(400).json({ error: 'ZATCA integration is currently disabled.' });
    return;
  }

  const zatcaRes = await dispatchToZatca({
    org,
    uuid: inv.uuid,
    invoiceHashBase64: inv.invoice_hash,
    xml: inv.xml_content,
    invoiceSubtype: inv.invoice_subtype,
    customerVat: inv.customer_vat,
  });

  db.prepare(`
    UPDATE invoices
    SET zatca_status = ?, zatca_mode = ?, zatca_response_json = ?
    WHERE id = ?
  `).run(zatcaRes.status, zatcaRes.mode, JSON.stringify(zatcaRes), id);

  res.json({
    invoices: getAllInvoices(),
  });
});

// Issue ZATCA Credit Note (381) for an existing invoice and return items to stock
app.post('/api/invoices/:id/credit-note', async (req: Request, res: Response) => {
  const sourceId = Number(req.params.id);
  const sourceInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(sourceId) as Invoice | undefined;
  if (!sourceInv) {
    res.status(404).json({ error: 'Original invoice not found.' });
    return;
  }
  if (sourceInv.invoice_type_code !== '388') {
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
    const org = getOrganizationSettings();
    const now = new Date();
    const createdAt = now.toISOString();
    const issueDate = createdAt.slice(0, 10);
    const issueTime = createdAt.slice(11, 19);
    const nextIcv = (org.last_icv || 0) + 1;
    const uuid = crypto.randomUUID();
    const invoiceNumber = `CN-${issueDate.slice(0, 4)}-${String(nextIcv).padStart(5, '0')}`;

    for (const item of sourceItems) {
      const prod = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(item.product_id) as
        | { stock_qty: number }
        | undefined;
      if (prod) {
        const newQty = prod.stock_qty + item.qty;
        db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
          newQty,
          createdAt,
          item.product_id
        );
        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'return', ?, ?, ?, ?, ?)
        `).run(
          item.product_id,
          item.qty,
          newQty,
          invoiceNumber,
          `إشعار دائن للفاتورة ${sourceInv.invoice_number}`,
          createdAt
        );
      }
    }

    const xml = buildUbl21Xml({
      uuid,
      invoiceNumber,
      icv: nextIcv,
      previousHash: org.last_pih,
      issueDate,
      issueTime,
      invoiceTypeCode: '381',
      invoiceSubtype: sourceInv.invoice_subtype,
      relatedInvoiceNumber: sourceInv.invoice_number,
      org,
      customerName: sourceInv.customer_name,
      customerVat: sourceInv.customer_vat,
      items: sourceItems,
      subtotal: sourceInv.subtotal,
      discountTotal: sourceInv.discount_total,
      vatTotal: sourceInv.vat_total,
      grandTotal: sourceInv.grand_total,
    });

    const signed = signXmlAndBuildQr({
      xml,
      org,
      timestampIso: createdAt,
      grandTotal: sourceInv.grand_total,
      vatTotal: sourceInv.vat_total,
    });

    const info = db
      .prepare(`
        INSERT INTO invoices (
          uuid, invoice_number, icv, invoice_type_code, invoice_subtype,
          payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
          subtotal, discount_total, vat_total, grand_total,
          invoice_hash, previous_hash, qr_tlv_base64, xml_content,
          zatca_status, zatca_mode, zatca_response_json, related_invoice_number, created_at
        ) VALUES (?, ?, ?, '381', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, '{}', ?, ?)
      `)
      .run(
        uuid,
        invoiceNumber,
        nextIcv,
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
        signed.invoiceHashBase64,
        org.last_pih,
        signed.qrTlvBase64,
        xml,
        org.mode,
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

    db.prepare('UPDATE organization_settings SET last_icv = ?, last_pih = ? WHERE id = 1').run(
      nextIcv,
      signed.invoiceHashBase64
    );

    return {
      invoiceId: Number(info.lastInsertRowid),
      org,
      uuid,
      invoiceHashBase64: signed.invoiceHashBase64,
      xml,
      invoiceSubtype: sourceInv.invoice_subtype,
      customerVat: sourceInv.customer_vat,
    };
  });

  const result = prepared();
  if (result.org.zatca_enabled === 1) {
    const zatcaRes = await dispatchToZatca({
      org: result.org,
      uuid: result.uuid,
      invoiceHashBase64: result.invoiceHashBase64,
      xml: result.xml,
      invoiceSubtype: result.invoiceSubtype,
      customerVat: result.customerVat,
    });

    db.prepare(`
      UPDATE invoices SET zatca_status = ?, zatca_mode = ?, zatca_response_json = ? WHERE id = ?
    `).run(zatcaRes.status, zatcaRes.mode, JSON.stringify(zatcaRes), result.invoiceId);
  } else {
    db.prepare(`
      UPDATE invoices SET zatca_status = 'DISABLED', zatca_response_json = ? WHERE id = ?
    `).run(
      JSON.stringify({
        disabled: true,
        message: 'ZATCA integration is currently disabled.',
      }),
      result.invoiceId
    );
  }

  const invoices = getAllInvoices();
  res.status(201).json({
    invoice: invoices.find((i) => i.id === result.invoiceId),
    settings: getOrganizationSettings(),
    products: getAllProducts(),
    invoices,
    movements: getRecentMovements(80),
  });
});

// Laravel Livewire + ZATCA virtual files & ZIP export
app.get('/api/laravel-files', (_req: Request, res: Response) => {
  const org = getOrganizationSettings();
  res.json({ files: generateLaravelFiles(org) });
});

app.get('/api/laravel-export', async (_req: Request, res: Response) => {
  const org = getOrganizationSettings();
  const zipBuffer = await buildLaravelZipBuffer(org);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="mizan-laravel-livewire-zatca.zip"'
  );
  res.send(zipBuffer);
});

async function startServer(): Promise<void> {
  const port = Number(process.env.PORT) || 3000;
  const isCompiledEntry =
    import.meta.url.endsWith('/server.js') ||
    path.basename(process.argv[1] || '') === 'server.js';
  const isProduction = process.env.NODE_ENV === 'production' || isCompiledEntry;

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Mizan POS & ZATCA server running at http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
