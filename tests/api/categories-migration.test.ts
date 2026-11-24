import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, makeTempDbPath, type TestApp } from '../helpers/app.ts';

// R1.11c upgrade path: a database from before categories (products carry only
// category_ar/category_en text) gets a category per name, every active product
// linked, and nothing else touched. Additive only: no table is rebuilt.
function createPreCategoryDatabase(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sku TEXT NOT NULL UNIQUE, name_ar TEXT NOT NULL, name_en TEXT NOT NULL,
      category_ar TEXT NOT NULL, category_en TEXT NOT NULL, unit_ar TEXT NOT NULL, unit_en TEXT NOT NULL,
      cost_price REAL NOT NULL, sell_price REAL NOT NULL, tax_rate REAL NOT NULL DEFAULT 15,
      tax_category TEXT NOT NULL DEFAULT 'S', stock_qty INTEGER NOT NULL DEFAULT 0,
      min_stock_alert INTEGER NOT NULL DEFAULT 10, expiry_date TEXT, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  const insert = db.prepare(`
    INSERT INTO products (sku, name_ar, name_en, category_ar, category_en, unit_ar, unit_en, cost_price, sell_price,
      stock_qty, active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'طبق', 'Plate', 5, 10, 3, ?, '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z')
  `);
  insert.run('P1', 'شاورما', 'Shawarma', 'شاورما', 'Shawarma', 1);
  insert.run('P2', 'شاورما عربي', 'Arabic Shawarma', 'شاورما ', 'Shawarma', 1); // same name, extra space
  insert.run('P3', 'شواية رز', 'Rice Platter', 'أطباق رز', 'Rice Dishes', 1);
  insert.run('P4', 'صنف قديم', 'Old item', 'موقوف', 'Retired', 0); // hidden product
  db.close();
}

describe('upgrading a database from before categories (R1.11c)', () => {
  let t: TestApp;

  beforeAll(async () => {
    const dbPath = makeTempDbPath();
    createPreCategoryDatabase(dbPath);
    t = await createTestApp({ dbPath, demoData: false }); // initDatabase() upgrades it here
  });
  afterAll(() => t.cleanup());

  it('creates one category per distinct name used by active products', () => {
    const cats = t.db.prepare('SELECT name_ar, name_en, sort_order FROM categories ORDER BY sort_order').all();
    expect(cats).toEqual([
      { name_ar: 'شاورما', name_en: 'Shawarma', sort_order: 1 },
      { name_ar: 'أطباق رز', name_en: 'Rice Dishes', sort_order: 2 },
    ]);
  });

  it('links every active product and leaves hidden ones alone', () => {
    const rows = t.db
      .prepare('SELECT p.sku, c.name_ar AS category FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.sku')
      .all();
    expect(rows).toEqual([
      { sku: 'P1', category: 'شاورما' },
      { sku: 'P2', category: 'شاورما' },
      { sku: 'P3', category: 'أطباق رز' },
      { sku: 'P4', category: null },
    ]);
  });

  it('keeps every product and its other fields', () => {
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 4 });
    expect(t.db.prepare("SELECT name_ar, stock_qty, sell_price FROM products WHERE sku = 'P3'").get()).toEqual({
      name_ar: 'شواية رز',
      stock_qty: 3,
      sell_price: 10,
    });
  });

  it('runs only once: a second start changes nothing', async () => {
    const before = t.db.prepare('SELECT id, name_ar, sort_order FROM categories ORDER BY id').all();
    const { initDatabase } = await import('../../src/server/db.ts');
    initDatabase();
    expect(t.db.prepare('SELECT id, name_ar, sort_order FROM categories ORDER BY id').all()).toEqual(before);
  });
});
