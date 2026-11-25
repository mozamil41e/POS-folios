import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  AuthUser,
  Category,
  Customer,
  HeldCart,
  Invoice,
  InvoiceItem,
  ManagedUser,
  OrganizationSettings,
  PermissionKey,
  Product,
  Purchase,
  PurchaseItem,
  RoleRecord,
  StockMovement,
  Supplier,
  Voucher,
} from '../../shared/types.ts';
import { ALL_PERMISSION_KEYS, sanitizePermissions } from '../../shared/permissions.ts';
import { syncDocumentSequences } from './sequences.ts';

// MIZAN_DB_PATH lets automated tests use an isolated temporary database.
// When it is not set, the default location (./data/mizan-pos.db) is unchanged.
const DB_PATH = process.env.MIZAN_DB_PATH
  ? path.resolve(process.env.MIZAN_DB_PATH)
  : path.join(path.resolve(process.cwd(), 'data'), 'mizan-pos.db');
const DATA_DIR = path.dirname(DB_PATH);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Single definition of the invoices table, shared by CREATE TABLE and by the
// R1.4 rebuild of older databases (ZATCA columns removed).
function invoicesTableSql(name: string): string {
  return `
    CREATE TABLE IF NOT EXISTS ${name} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      invoice_number TEXT NOT NULL UNIQUE,
      invoice_type_code TEXT NOT NULL DEFAULT '388',
      invoice_subtype TEXT NOT NULL DEFAULT '0200000',
      payment_method TEXT NOT NULL DEFAULT 'cash',
      cash_amount REAL NOT NULL DEFAULT 0,
      card_amount REAL NOT NULL DEFAULT 0,
      customer_id INTEGER,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_vat TEXT NOT NULL DEFAULT '',
      subtotal REAL NOT NULL,
      discount_total REAL NOT NULL DEFAULT 0,
      vat_total REAL NOT NULL,
      grand_total REAL NOT NULL,
      related_invoice_number TEXT,
      created_at TEXT NOT NULL
    );`;
}

const INVOICE_COLUMNS = [
  'id', 'uuid', 'invoice_number', 'invoice_type_code', 'invoice_subtype',
  'payment_method', 'cash_amount', 'card_amount', 'customer_id', 'customer_name', 'customer_vat',
  'subtotal', 'discount_total', 'vat_total', 'grand_total', 'related_invoice_number', 'created_at',
] as const;

const ZATCA_SETTINGS_COLUMNS = [
  'egs_serial', 'mode', 'zatca_enabled', 'ccsid_token', 'ccsid_secret', 'ccsid_request_id',
  'pcsid_token', 'pcsid_secret', 'private_key_pem', 'public_key_base64', 'csr_pem',
  'onboarding_step', 'last_icv', 'last_pih',
] as const;

const ZATCA_INVOICE_COLUMNS = [
  'icv', 'invoice_hash', 'previous_hash', 'qr_tlv_base64', 'xml_content',
  'zatca_status', 'zatca_mode', 'zatca_response_json',
] as const;

function columnsOf(table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((c) => c.name));
}

/** Consistent copy of the whole database next to it (safe while the DB is open). */
export function backupDatabase(label: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = `${DB_PATH}.backup-${label}-${stamp}.db`;
  db.prepare('VACUUM INTO ?').run(target);
  return target;
}

/**
 * R1.4 (D13 option a): removes the ZATCA columns from a database created by an
 * earlier version. Destructive, so it first writes a full backup, then runs in
 * one transaction with foreign keys disabled (so invoice_items are not cascaded
 * when the old invoices table is dropped) and verifies them afterwards.
 * The invoices table is rebuilt because SQLite cannot drop its UNIQUE `icv`
 * column in place. Does nothing on a database that is already clean.
 */
function removeZatcaSchema(): void {
  const settingsCols = columnsOf('organization_settings');
  const invoiceCols = columnsOf('invoices');
  const legacySettings = ZATCA_SETTINGS_COLUMNS.filter((c) => settingsCols.has(c));
  const legacyInvoices = ZATCA_INVOICE_COLUMNS.some((c) => invoiceCols.has(c));
  if (legacySettings.length === 0 && !legacyInvoices) return;

  const backupPath = backupDatabase('pre-zatca-removal');
  console.log(`[migration] removing ZATCA schema; backup written to ${backupPath}`);

  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const column of legacySettings) {
        db.exec(`ALTER TABLE organization_settings DROP COLUMN ${column}`);
      }
      if (legacyInvoices) {
        const columns = INVOICE_COLUMNS.join(', ');
        db.exec(invoicesTableSql('invoices_rebuilt'));
        db.exec(`INSERT INTO invoices_rebuilt (${columns}) SELECT ${columns} FROM invoices`);
        db.exec('DROP TABLE invoices');
        db.exec('ALTER TABLE invoices_rebuilt RENAME TO invoices');
      }
      const violations = db.pragma('foreign_key_check') as unknown[];
      if (violations.length > 0) {
        throw new Error(`Foreign key check failed after ZATCA schema removal (${violations.length} rows).`);
      }
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS organization_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL,
      cr_number TEXT NOT NULL,
      street_ar TEXT NOT NULL,
      building_no TEXT NOT NULL,
      city_ar TEXT NOT NULL,
      postal_code TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'SA',
      public_base_url TEXT NOT NULL DEFAULT '',
      thermal_width_mm INTEGER NOT NULL DEFAULT 80,
      auto_print_receipt INTEGER NOT NULL DEFAULT 0,
      font_size TEXT NOT NULL DEFAULT 'medium',
      table_page_size INTEGER NOT NULL DEFAULT 10
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      category_ar TEXT NOT NULL,
      category_en TEXT NOT NULL,
      unit_ar TEXT NOT NULL,
      unit_en TEXT NOT NULL,
      cost_price REAL NOT NULL,
      sell_price REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 15,
      tax_category TEXT NOT NULL DEFAULT 'S',
      stock_qty INTEGER NOT NULL DEFAULT 0,
      min_stock_alert INTEGER NOT NULL DEFAULT 10,
      expiry_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      qty_delta INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      reference_no TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      address_ar TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    ${invoicesTableSql('invoices')}

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      unit_ar TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL,
      tax_category TEXT NOT NULL DEFAULT 'S',
      line_subtotal REAL NOT NULL,
      line_vat REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS held_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      items_json TEXT NOT NULL,
      discount REAL NOT NULL DEFAULT 0,
      customer_id INTEGER,
      invoice_subtype TEXT NOT NULL DEFAULT '0200000',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      vat_number TEXT NOT NULL DEFAULT '',
      cr_number TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address_ar TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_number TEXT NOT NULL UNIQUE,
      supplier_id INTEGER NOT NULL,
      supplier_name TEXT NOT NULL,
      supplier_vat TEXT NOT NULL DEFAULT '',
      supplier_invoice_no TEXT NOT NULL DEFAULT '',
      payment_status TEXT NOT NULL DEFAULT 'paid',
      paid_amount REAL NOT NULL DEFAULT 0,
      subtotal REAL NOT NULL,
      vat_total REAL NOT NULL,
      grand_total REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      sku TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_cost REAL NOT NULL,
      tax_rate REAL NOT NULL DEFAULT 15,
      line_subtotal REAL NOT NULL,
      line_vat REAL NOT NULL,
      line_total REAL NOT NULL,
      FOREIGN KEY (purchase_id) REFERENCES purchases(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      description_ar TEXT NOT NULL DEFAULT '',
      description_en TEXT NOT NULL DEFAULT '',
      permissions_json TEXT NOT NULL,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      role_id INTEGER,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_login_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_number TEXT NOT NULL UNIQUE,
      voucher_type TEXT NOT NULL,
      payment_channel TEXT NOT NULL DEFAULT 'cash',
      party_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      voucher_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Atomic yearly document numbering (R1.8): see src/server/sequences.ts
    CREATE TABLE IF NOT EXISTS document_sequences (
      doc_type TEXT NOT NULL,
      period_year INTEGER NOT NULL,
      last_value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (doc_type, period_year)
    );

    -- Product categories (R1.11c). name_key = normalised Arabic name, so the
    -- same category cannot be created twice with different spacing or case.
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Failed logins per email for the temporary lockout (R1.9): see src/server/login-guard.ts
    CREATE TABLE IF NOT EXISTS login_attempts (
      email TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TEXT NOT NULL,
      locked_until TEXT
    );
  `);

  const orgCols = db
    .prepare('PRAGMA table_info(organization_settings)')
    .all() as Array<{ name: string }>;
  const colNames = new Set(orgCols.map((c) => c.name));

  if (!colNames.has('public_base_url')) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN public_base_url TEXT NOT NULL DEFAULT ''");
  }
  if (!colNames.has('thermal_width_mm')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN thermal_width_mm INTEGER NOT NULL DEFAULT 80');
  }
  if (!colNames.has('auto_print_receipt')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN auto_print_receipt INTEGER NOT NULL DEFAULT 0');
  }
  if (!colNames.has('font_size')) {
    db.exec("ALTER TABLE organization_settings ADD COLUMN font_size TEXT NOT NULL DEFAULT 'medium'");
  }
  if (!colNames.has('table_page_size')) {
    db.exec('ALTER TABLE organization_settings ADD COLUMN table_page_size INTEGER NOT NULL DEFAULT 10');
  }

  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  const userColNames = new Set(userCols.map((c) => c.name));
  if (!userColNames.has('phone')) {
    db.exec("ALTER TABLE users ADD COLUMN phone TEXT NOT NULL DEFAULT ''");
  }
  if (!userColNames.has('role_id')) {
    db.exec('ALTER TABLE users ADD COLUMN role_id INTEGER');
  }
  if (!userColNames.has('is_active')) {
    db.exec('ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  if (!userColNames.has('last_login_at')) {
    db.exec('ALTER TABLE users ADD COLUMN last_login_at TEXT');
  }

  // Vouchers are voided, never deleted (R1.8, SEC-17). Additive, non-destructive.
  const voucherCols = db.prepare('PRAGMA table_info(vouchers)').all() as Array<{ name: string }>;
  const voucherColNames = new Set(voucherCols.map((c) => c.name));
  if (!voucherColNames.has('status')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  }
  if (!voucherColNames.has('void_reason')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!voucherColNames.has('voided_at')) {
    db.exec('ALTER TABLE vouchers ADD COLUMN voided_at TEXT');
  }
  if (!voucherColNames.has('voided_by')) {
    db.exec('ALTER TABLE vouchers ADD COLUMN voided_by INTEGER');
  }

  // R1.4: drop the ZATCA columns from databases created by earlier versions.
  removeZatcaSchema();

  // R1.11c: products point to a category row. Additive and non-destructive:
  // the category_ar/category_en text columns stay as the display copy until
  // the MariaDB schema (R3), and existing products are linked by name.
  if (!columnsOf('products').has('category_id')) {
    db.exec('ALTER TABLE products ADD COLUMN category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id)');
  linkProductCategories();

  // Never reissue a number that already exists in this database.
  syncDocumentSequences(db);

  seedAndMigrateRolesAndUsers();

  const existingOrg = db
    .prepare('SELECT id FROM organization_settings WHERE id = 1')
    .get();

  // Neutral defaults: the administrator enters the restaurant's details in
  // Settings. Production starts with no business data at all (R1.7, H4);
  // demo records exist only in development (src/server/demo-data.ts).
  if (!existingOrg) {
    db.prepare(`
      INSERT INTO organization_settings (
        id, name_ar, name_en, vat_number, cr_number, street_ar, building_no,
        city_ar, postal_code, country_code,
        public_base_url, thermal_width_mm, auto_print_receipt, font_size, table_page_size
      ) VALUES (1, ?, ?, '', '', '', '', '', '', 'SA', '', 80, 0, 'medium', 10)
    `).run('اسم المطعم', 'Restaurant name');
  }
}

export function getOrganizationSettings(): OrganizationSettings {
  return db
    .prepare('SELECT * FROM organization_settings WHERE id = 1')
    .get() as OrganizationSettings;
}

/** Normalised name used for uniqueness: trimmed, single spaces, lower case. */
export function categoryKey(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function getAllCategories(): Category[] {
  return db
    .prepare(`
      SELECT c.id, c.name_ar, c.name_en, c.sort_order, c.created_at, c.updated_at,
             (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
      FROM categories c
      ORDER BY c.sort_order ASC, c.id ASC
    `)
    .all() as Category[];
}

export function getCategoryById(id: number): Category | undefined {
  return getAllCategories().find((c) => c.id === id);
}

/** Returns the category with this Arabic name, creating it (last in order) if needed. */
export function findOrCreateCategory(nameAr: string, nameEn = ''): Category {
  const cleanAr = nameAr.trim().replace(/\s+/g, ' ');
  const key = categoryKey(cleanAr);
  const existing = db.prepare('SELECT id FROM categories WHERE name_key = ?').get(key) as { id: number } | undefined;
  if (existing) return getCategoryById(existing.id)!;
  const now = new Date().toISOString();
  const next = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM categories').get() as { n: number };
  const info = db
    .prepare(`
      INSERT INTO categories (name_ar, name_en, name_key, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(cleanAr, nameEn.trim() || cleanAr, key, next.n, now, now);
  return getCategoryById(Number(info.lastInsertRowid))!;
}

/**
 * Links active products that have no category_id yet to a category with the
 * same name (created if needed). Inactive products are skipped on purpose: a
 * deleted category must not come back because a hidden product still carries
 * its name.
 */
export function linkProductCategories(): number {
  const rows = db
    .prepare(`
      SELECT id, category_ar, category_en FROM products
      WHERE category_id IS NULL AND active = 1 AND TRIM(category_ar) != ''
      ORDER BY id
    `)
    .all() as Array<{ id: number; category_ar: string; category_en: string }>;
  if (rows.length === 0) return 0;
  const link = db.prepare('UPDATE products SET category_id = ? WHERE id = ?');
  db.transaction(() => {
    for (const row of rows) link.run(findOrCreateCategory(row.category_ar, row.category_en).id, row.id);
  })();
  return rows.length;
}

export function getAllProducts(): Product[] {
  return db
    .prepare('SELECT * FROM products WHERE active = 1 ORDER BY id ASC')
    .all() as Product[];
}

export function getAllCustomers(): Customer[] {
  return db
    .prepare('SELECT * FROM customers ORDER BY id ASC')
    .all() as Customer[];
}

export function getAllSuppliers(): Supplier[] {
  return db
    .prepare('SELECT * FROM suppliers ORDER BY id DESC')
    .all() as Supplier[];
}

export function getAllPurchases(): Purchase[] {
  const purchases = db
    .prepare('SELECT * FROM purchases ORDER BY id DESC LIMIT 100')
    .all() as Purchase[];
  const itemsStmt = db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ?');
  return purchases.map((p) => ({
    ...p,
    items: itemsStmt.all(p.id) as PurchaseItem[],
  }));
}

export function getRecentMovements(limit = 50): StockMovement[] {
  return db
    .prepare(`
      SELECT sm.*, p.name_ar as product_name_ar, p.name_en as product_name_en, p.sku as sku
      FROM stock_movements sm
      JOIN products p ON p.id = sm.product_id
      ORDER BY sm.id DESC
      LIMIT ?
    `)
    .all(limit) as StockMovement[];
}

export function getAllInvoices(): Invoice[] {
  const invoices = db
    .prepare('SELECT * FROM invoices ORDER BY id DESC LIMIT 100')
    .all() as Invoice[];
  const itemsStmt = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?');
  return invoices.map((inv) => ({
    ...inv,
    items: itemsStmt.all(inv.id) as InvoiceItem[],
  }));
}

export function getHeldCarts(): HeldCart[] {
  return db
    .prepare('SELECT * FROM held_carts ORDER BY id DESC')
    .all() as HeldCart[];
}

export function getAllVouchers(): Voucher[] {
  return db
    .prepare('SELECT * FROM vouchers ORDER BY voucher_date DESC, id DESC LIMIT 300')
    .all() as Voucher[];
}

/** Invoice line as shown on the public page: no internal ids (R1.9). */
export type PublicInvoiceItem = Pick<
  InvoiceItem,
  | 'sku'
  | 'name_ar'
  | 'name_en'
  | 'unit_ar'
  | 'qty'
  | 'unit_price'
  | 'discount'
  | 'tax_rate'
  | 'tax_category'
  | 'line_subtotal'
  | 'line_vat'
  | 'line_total'
>;

/**
 * Anyone holding the link (receipt QR) can open this, so it returns an
 * allowlist only: no internal ids and no customer VAT number (R1.9, SEC-14).
 */
export function getPublicInvoiceByUuid(uuid: string): {
  invoice: {
    uuid: string;
    invoice_number: string;
    invoice_type_code: string;
    invoice_subtype: string;
    payment_method: string;
    cash_amount: number;
    card_amount: number;
    customer_name: string;
    subtotal: number;
    discount_total: number;
    vat_total: number;
    grand_total: number;
    related_invoice_number: string | null;
    created_at: string;
    items: PublicInvoiceItem[];
  };
  store: {
    name_ar: string;
    name_en: string;
    vat_number: string;
    cr_number: string;
    street_ar: string;
    building_no: string;
    city_ar: string;
    postal_code: string;
    public_base_url: string;
  };
} | null {
  const inv = db
    .prepare(`
      SELECT id, uuid, invoice_number, invoice_type_code, invoice_subtype,
             payment_method, cash_amount, card_amount, customer_name,
             subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
      FROM invoices
      WHERE uuid = ?
    `)
    .get(uuid) as
    | {
        id: number;
        uuid: string;
        invoice_number: string;
        invoice_type_code: string;
        invoice_subtype: string;
        payment_method: string;
        cash_amount: number;
        card_amount: number;
        customer_name: string;
        subtotal: number;
        discount_total: number;
        vat_total: number;
        grand_total: number;
        related_invoice_number: string | null;
        created_at: string;
      }
    | undefined;

  if (!inv) return null;

  const items = db
    .prepare(`
      SELECT sku, name_ar, name_en, unit_ar, qty, unit_price, discount, tax_rate, tax_category,
             line_subtotal, line_vat, line_total
      FROM invoice_items
      WHERE invoice_id = ?
      ORDER BY id
    `)
    .all(inv.id) as PublicInvoiceItem[];
  const org = getOrganizationSettings();

  const { id: _internalId, ...publicInvoice } = inv;
  return {
    invoice: {
      ...publicInvoice,
      items,
    },
    store: {
      name_ar: org.name_ar,
      name_en: org.name_en,
      vat_number: org.vat_number,
      cr_number: org.cr_number,
      street_ar: org.street_ar,
      building_no: org.building_no,
      city_ar: org.city_ar,
      postal_code: org.postal_code,
      public_base_url: org.public_base_url,
    },
  };
}

// The async scrypt runs on libuv's thread pool, so logins no longer block every
// other request (R1.9, SEC-07). Same parameters as before (Node defaults,
// 64-byte key), so hashes stored by the old scryptSync code still verify.
function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = await scryptAsync(password, salt);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function hasAnyUsers(): boolean {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
  return row.cnt > 0;
}

function seedAndMigrateRolesAndUsers(): void {
  const now = new Date().toISOString();
  const defaultRoles: Array<{
    slug: string;
    name_ar: string;
    name_en: string;
    description_ar: string;
    description_en: string;
    permissions: PermissionKey[];
    is_system: number;
  }> = [
    {
      slug: 'admin',
      name_ar: 'مدير النظام',
      name_en: 'System Admin',
      description_ar: 'صلاحيات كاملة لإدارة جميع أقسام النظام والمستخدمين والأدوار',
      description_en: 'Full administrative access across all modules, users, and roles',
      permissions: [...ALL_PERMISSION_KEYS],
      is_system: 1,
    },
    {
      slug: 'manager',
      name_ar: 'مشرف / مدير فرع',
      name_en: 'Branch Manager',
      description_ar: 'إدارة المبيعات والمخزون والمشتريات والتقارير والسندات دون تعديل المستخدمين',
      description_en: 'Manage POS, sales, inventory, purchases, reports, and vouchers',
      permissions: [
        'pos.access',
        'pos.discount',
        'pos.hold',
        'sales.view',
        'sales.return',
        'customers.manage',
        'inventory.view',
        'inventory.manage',
        'inventory.adjust',
        'purchases.view',
        'purchases.manage',
        'reports.view',
        'vouchers.manage',
      ],
      is_system: 0,
    },
    {
      slug: 'accountant',
      name_ar: 'محاسب',
      name_en: 'Accountant',
      description_ar: 'الوصول للتقارير المالية، مراجعة المبيعات والمشتريات، وإدارة السندات',
      description_en: 'Access financial reports, audit sales/purchases, and manage vouchers',
      permissions: [
        'sales.view',
        'customers.manage',
        'inventory.view',
        'purchases.view',
        'purchases.manage',
        'reports.view',
        'vouchers.manage',
      ],
      is_system: 0,
    },
    {
      slug: 'cashier',
      name_ar: 'كاشير',
      name_en: 'Cashier',
      description_ar: 'تنفيذ عمليات البيع في نقطة البيع، تعليق الفواتير، والاطلاع على العملاء والمخزون',
      description_en: 'Operate POS checkout, hold carts, and view sales & stock balances',
      permissions: [
        'pos.access',
        'pos.hold',
        'sales.view',
        'customers.manage',
        'inventory.view',
      ],
      is_system: 0,
    },
  ];

  const roleCount = db.prepare('SELECT COUNT(*) as cnt FROM roles').get() as { cnt: number };
  if (roleCount.cnt === 0) {
    const insertRole = db.prepare(`
      INSERT INTO roles (
        slug, name_ar, name_en, description_ar, description_en,
        permissions_json, is_system, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const r of defaultRoles) {
      insertRole.run(
        r.slug,
        r.name_ar,
        r.name_en,
        r.description_ar,
        r.description_en,
        JSON.stringify(r.permissions),
        r.is_system,
        now
      );
    }
  } else {
    // Ensure system admin role always retains full permissions
    db.prepare('UPDATE roles SET permissions_json = ?, is_system = 1 WHERE slug = ?').run(
      JSON.stringify(ALL_PERMISSION_KEYS),
      'admin'
    );
  }

  const allRoles = db.prepare('SELECT id, slug FROM roles').all() as Array<{
    id: number;
    slug: string;
  }>;
  const roleMap = new Map(allRoles.map((r) => [r.slug, r.id]));
  const fallbackCashierId = roleMap.get('cashier') ?? allRoles[0]?.id ?? null;
  const adminRoleId = roleMap.get('admin') ?? fallbackCashierId;

  const unlinkedUsers = db
    .prepare('SELECT id, role FROM users WHERE role_id IS NULL')
    .all() as Array<{ id: number; role: string }>;

  for (const u of unlinkedUsers) {
    const resolvedId =
      roleMap.get(u.role) ?? (u.role === 'admin' ? adminRoleId : fallbackCashierId);
    if (resolvedId) {
      db.prepare('UPDATE users SET role_id = ? WHERE id = ?').run(resolvedId, u.id);
    }
  }
}

interface RawRoleRow {
  id: number;
  slug: string;
  name_ar: string;
  name_en: string;
  description_ar: string;
  description_en: string;
  permissions_json: string;
  is_system: number;
  users_count?: number;
  created_at: string;
}

function mapRoleRow(row: RawRoleRow): RoleRecord {
  let parsed: unknown = [];
  try {
    parsed = JSON.parse(row.permissions_json);
  } catch {
    parsed = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    name_ar: row.name_ar,
    name_en: row.name_en,
    description_ar: row.description_ar,
    description_en: row.description_en,
    permissions:
      row.slug === 'admin' ? [...ALL_PERMISSION_KEYS] : sanitizePermissions(parsed),
    is_system: row.is_system,
    users_count: row.users_count ?? 0,
    created_at: row.created_at,
  };
}

export function getAllRoles(): RoleRecord[] {
  const rows = db
    .prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) as users_count
      FROM roles r
      ORDER BY r.is_system DESC, r.id ASC
    `)
    .all() as RawRoleRow[];
  return rows.map(mapRoleRow);
}

export function getRoleById(id: number): RoleRecord | null {
  const row = db
    .prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) as users_count
      FROM roles r
      WHERE r.id = ?
    `)
    .get(id) as RawRoleRow | undefined;
  return row ? mapRoleRow(row) : null;
}

export function getRoleBySlug(slug: string): RoleRecord | null {
  const row = db
    .prepare(`
      SELECT r.*, (SELECT COUNT(*) FROM users u WHERE u.role_id = r.id) as users_count
      FROM roles r
      WHERE r.slug = ?
    `)
    .get(slug) as RawRoleRow | undefined;
  return row ? mapRoleRow(row) : null;
}

export function getAllUsers(): ManagedUser[] {
  const rows = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.role_id,
             u.is_active, u.last_login_at, u.created_at,
             COALESCE(r.name_ar, u.role) as role_name_ar,
             COALESCE(r.name_en, u.role) as role_name_en,
             COALESCE(r.permissions_json, '[]') as permissions_json,
             COALESCE(r.slug, u.role) as role_slug
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ORDER BY u.id ASC
    `)
    .all() as Array<{
    id: number;
    full_name: string;
    email: string;
    phone: string;
    role: string;
    role_id: number | null;
    is_active: number;
    last_login_at: string | null;
    created_at: string;
    role_name_ar: string;
    role_name_en: string;
    permissions_json: string;
    role_slug: string;
  }>;

  return rows.map((row) => {
    let permsCount = 0;
    if (row.role_slug === 'admin') {
      permsCount = ALL_PERMISSION_KEYS.length;
    } else {
      try {
        permsCount = sanitizePermissions(JSON.parse(row.permissions_json)).length;
      } catch {
        permsCount = 0;
      }
    }
    return {
      id: row.id,
      full_name: row.full_name,
      email: row.email,
      phone: row.phone ?? '',
      role: row.role_slug,
      role_id: row.role_id ?? 0,
      role_name_ar: row.role_name_ar,
      role_name_en: row.role_name_en,
      permissions_count: permsCount,
      is_active: row.is_active ?? 1,
      last_login_at: row.last_login_at ?? null,
      created_at: row.created_at,
    };
  });
}

export function resolveAuthUserById(userId: number): AuthUser | null {
  const row = db
    .prepare(`
      SELECT u.id, u.full_name, u.email, u.phone, u.role, u.role_id, u.is_active, u.created_at,
             COALESCE(r.slug, u.role) as role_slug,
             COALESCE(r.name_ar, u.role) as role_name_ar,
             COALESCE(r.name_en, u.role) as role_name_en,
             COALESCE(r.permissions_json, '[]') as permissions_json
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      WHERE u.id = ?
    `)
    .get(userId) as
    | {
        id: number;
        full_name: string;
        email: string;
        phone: string;
        role: string;
        role_id: number | null;
        is_active: number;
        created_at: string;
        role_slug: string;
        role_name_ar: string;
        role_name_en: string;
        permissions_json: string;
      }
    | undefined;

  if (!row) return null;
  let perms: PermissionKey[] = [];
  if (row.role_slug === 'admin') {
    perms = [...ALL_PERMISSION_KEYS];
  } else {
    try {
      perms = sanitizePermissions(JSON.parse(row.permissions_json));
    } catch {
      perms = [];
    }
  }

  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    phone: row.phone ?? '',
    role: row.role_slug,
    role_id: row.role_id ?? 0,
    role_name_ar: row.role_name_ar,
    role_name_en: row.role_name_en,
    permissions: perms,
    is_active: row.is_active ?? 1,
    created_at: row.created_at,
  };
}

export function createSessionForUser(userId: number): { token: string; expiresAt: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare('DELETE FROM user_sessions WHERE user_id = ? AND expires_at <= ?').run(
    userId,
    now.toISOString()
  );

  db.prepare(`
    INSERT INTO user_sessions (user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(userId, tokenHash, expiresAt, now.toISOString());

  return { token, expiresAt };
}

export function getUserBySessionToken(token: string): AuthUser | null {
  if (!token) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const nowIso = new Date().toISOString();

  const row = db
    .prepare(`
      SELECT u.id
      FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ? AND u.is_active = 1
    `)
    .get(tokenHash, nowIso) as { id: number } | undefined;

  if (!row) return null;
  return resolveAuthUserById(row.id);
}

export function revokeSessionToken(token: string): void {
  if (!token) return;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare('DELETE FROM user_sessions WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllSessionsForUser(userId: number): void {
  db.prepare('DELETE FROM user_sessions WHERE user_id = ?').run(userId);
}
