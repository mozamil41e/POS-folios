import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, makeTempDbPath, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// Builds a database shaped like the pre-R1.4 schema (ZATCA columns, UNIQUE icv,
// invoice_items cascading from invoices) with a few invoices in it, then lets the
// new version open it. D13 option (a): the upgrade must keep every row.
function createLegacyDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE organization_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name_ar TEXT NOT NULL, name_en TEXT NOT NULL, vat_number TEXT NOT NULL, cr_number TEXT NOT NULL,
      street_ar TEXT NOT NULL, building_no TEXT NOT NULL, city_ar TEXT NOT NULL, postal_code TEXT NOT NULL,
      country_code TEXT NOT NULL DEFAULT 'SA', egs_serial TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'simulator',
      zatca_enabled INTEGER NOT NULL DEFAULT 0, public_base_url TEXT NOT NULL DEFAULT '',
      thermal_width_mm INTEGER NOT NULL DEFAULT 80, auto_print_receipt INTEGER NOT NULL DEFAULT 0,
      font_size TEXT NOT NULL DEFAULT 'medium', table_page_size INTEGER NOT NULL DEFAULT 10,
      ccsid_token TEXT NOT NULL DEFAULT '', ccsid_secret TEXT NOT NULL DEFAULT '', ccsid_request_id TEXT NOT NULL DEFAULT '',
      pcsid_token TEXT NOT NULL DEFAULT '', pcsid_secret TEXT NOT NULL DEFAULT '', private_key_pem TEXT NOT NULL DEFAULT '',
      public_key_base64 TEXT NOT NULL DEFAULT '', csr_pem TEXT NOT NULL DEFAULT '', onboarding_step INTEGER NOT NULL DEFAULT 1,
      last_icv INTEGER NOT NULL DEFAULT 0, last_pih TEXT NOT NULL
    );
    CREATE TABLE invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, invoice_number TEXT NOT NULL UNIQUE,
      icv INTEGER NOT NULL UNIQUE, invoice_type_code TEXT NOT NULL DEFAULT '388',
      invoice_subtype TEXT NOT NULL DEFAULT '0200000', payment_method TEXT NOT NULL DEFAULT 'cash',
      cash_amount REAL NOT NULL DEFAULT 0, card_amount REAL NOT NULL DEFAULT 0, customer_id INTEGER,
      customer_name TEXT NOT NULL DEFAULT '', customer_vat TEXT NOT NULL DEFAULT '', subtotal REAL NOT NULL,
      discount_total REAL NOT NULL DEFAULT 0, vat_total REAL NOT NULL, grand_total REAL NOT NULL,
      invoice_hash TEXT NOT NULL, previous_hash TEXT NOT NULL, qr_tlv_base64 TEXT NOT NULL, xml_content TEXT NOT NULL,
      zatca_status TEXT NOT NULL, zatca_mode TEXT NOT NULL, zatca_response_json TEXT NOT NULL,
      related_invoice_number TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      sku TEXT NOT NULL, name_ar TEXT NOT NULL, name_en TEXT NOT NULL, unit_ar TEXT NOT NULL, qty INTEGER NOT NULL,
      unit_price REAL NOT NULL, discount REAL NOT NULL DEFAULT 0, tax_rate REAL NOT NULL,
      tax_category TEXT NOT NULL DEFAULT 'S', line_subtotal REAL NOT NULL, line_vat REAL NOT NULL, line_total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);
  db.prepare(`
    INSERT INTO organization_settings (id, name_ar, name_en, vat_number, cr_number, street_ar, building_no, city_ar,
      postal_code, egs_serial, private_key_pem, ccsid_secret, pcsid_secret, last_icv, last_pih)
    VALUES (1, 'مطعم قديم', 'Legacy Restaurant', '310000000000003', '1010', 'شارع', '1', 'الرياض', '12345',
      'EGS-1', '-----BEGIN PRIVATE KEY-----x', 'secret-a', 'secret-b', 2, 'pih')
  `).run();
  const insertInvoice = db.prepare(`
    INSERT INTO invoices (uuid, invoice_number, icv, subtotal, vat_total, grand_total, invoice_hash, previous_hash,
      qr_tlv_base64, xml_content, zatca_status, zatca_mode, zatca_response_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'h', 'p', 'q', '<xml/>', 'REPORTED', 'simulator', '{}', ?)
  `);
  const insertItem = db.prepare(`
    INSERT INTO invoice_items (invoice_id, product_id, sku, name_ar, name_en, unit_ar, qty, unit_price, tax_rate,
      line_subtotal, line_vat, line_total)
    VALUES (?, 1, 'SKU', 'صنف', 'Item', 'حبة', 2, 10, 15, 20, 3, 23)
  `);
  for (const [i, number] of ['INV-2026-00001', 'INV-2026-00002'].entries()) {
    const info = insertInvoice.run(`00000000-0000-4000-8000-00000000000${i}`, number, i + 1, 20, 3, 23, new Date().toISOString());
    insertItem.run(info.lastInsertRowid);
    insertItem.run(info.lastInsertRowid);
  }
  db.close();
}

describe('upgrading a pre-R1.4 database (ZATCA schema removal, D13-a)', () => {
  let t: TestApp;
  let dbPath: string;

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    createLegacyDatabase(dbPath);
    t = await createTestApp({ dbPath }); // initDatabase() runs the migration here
  });
  afterAll(() => t.cleanup());

  it('writes a full backup of the old database before changing it', () => {
    const dir = path.dirname(dbPath);
    const backups = fs.readdirSync(dir).filter((f) => f.includes('backup-pre-zatca-removal'));
    expect(backups).toHaveLength(1);
    const backup = new Database(path.join(dir, backups[0]), { readonly: true });
    try {
      const cols = (backup.prepare('PRAGMA table_info(invoices)').all() as Array<{ name: string }>).map((c) => c.name);
      expect(cols).toContain('xml_content'); // the backup is the untouched old schema
      expect((backup.prepare('SELECT COUNT(*) AS n FROM invoice_items').get() as { n: number }).n).toBe(4);
    } finally {
      backup.close();
    }
  });

  it('drops every ZATCA column and keeps the regular settings values', () => {
    const settingsCols = (t.db.prepare('PRAGMA table_info(organization_settings)').all() as Array<{ name: string }>).map((c) => c.name);
    const invoiceCols = (t.db.prepare('PRAGMA table_info(invoices)').all() as Array<{ name: string }>).map((c) => c.name);
    for (const c of ['private_key_pem', 'ccsid_secret', 'pcsid_secret', 'last_icv', 'last_pih', 'egs_serial']) {
      expect(settingsCols).not.toContain(c);
    }
    for (const c of ['icv', 'xml_content', 'invoice_hash', 'qr_tlv_base64', 'zatca_status']) {
      expect(invoiceCols).not.toContain(c);
    }
    const org = t.db.prepare('SELECT name_ar, vat_number FROM organization_settings WHERE id = 1').get();
    expect(org).toEqual({ name_ar: 'مطعم قديم', vat_number: '310000000000003' });
  });

  it('keeps every invoice and every invoice item (no cascade on the rebuild)', () => {
    const invoices = t.db.prepare('SELECT id, invoice_number FROM invoices ORDER BY id').all();
    expect(invoices).toEqual([
      { id: 1, invoice_number: 'INV-2026-00001' },
      { id: 2, invoice_number: 'INV-2026-00002' },
    ]);
    expect((t.db.prepare('SELECT COUNT(*) AS n FROM invoice_items').get() as { n: number }).n).toBe(4);
    expect(t.db.pragma('foreign_key_check')).toEqual([]);
    expect(t.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('keeps working after the upgrade: new numbers continue, ids do not collide', async () => {
    const adminToken = await registerFirstAdmin(t.app);
    // Production databases get no demo products (R1.7): add one to sell.
    t.db
      .prepare(
        `INSERT INTO products (sku, name_ar, name_en, category_ar, category_en, unit_ar, unit_en, cost_price,
           sell_price, tax_rate, tax_category, stock_qty, min_stock_alert, expiry_date, active, created_at, updated_at)
         VALUES ('UPG-1', 'صنف', 'Item', 'عام', 'General', 'حبة', 'Pcs', 5, 10, 15, 'S', 10, 1, NULL, 1, ?, ?)`
      )
      .run(new Date().toISOString(), new Date().toISOString());
    const productId = (t.db.prepare("SELECT id FROM products WHERE sku = 'UPG-1'").get() as { id: number }).id;
    const sale = await request(t.app)
      .post('/api/invoices')
      .set(bearer(adminToken))
      .send({
        items: [{ product_id: productId, qty: 1 }],
        invoice_subtype: '0200000',
        payment_method: 'cash',
        cash_amount: 0,
        discount_total: 0,
        customer_id: null,
      });
    expect(sale.status).toBe(201);
    expect(sale.body.invoice.id).toBeGreaterThan(2);
    expect(sale.body.invoice.invoice_number).toMatch(/^INV-\d{4}-\d{5}$/);
    expect(sale.body.invoice.invoice_number).not.toBe('INV-2026-00001');
    expect(sale.body.invoice.invoice_number).not.toBe('INV-2026-00002');
  });

  it('runs only once: a second start finds a clean schema and makes no new backup', async () => {
    const dir = path.dirname(dbPath);
    const before = fs.readdirSync(dir).filter((f) => f.includes('backup-')).length;
    const { initDatabase } = await import('../../src/server/db.ts');
    initDatabase();
    const after = fs.readdirSync(dir).filter((f) => f.includes('backup-')).length;
    expect(after).toBe(before);
  });
});
