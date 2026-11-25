import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { IMPORT_COLUMNS } from '../../shared/schemas/product-import.ts';
import { bearer, createTestApp, createUserWithRole, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.4a: product import from CSV. Owner's decisions (a)+(a): an existing or
// repeated SKU, or any invalid row, rejects the whole file.
let t: TestApp;
let adminToken: string;
let cashierToken: string;

const HEADER = IMPORT_COLUMNS.map((c) => c.ar).join(',');
const csv = (...rows: string[]) => `﻿${[HEADER, ...rows].join('\r\n')}\r\n`;
const send = (body: Record<string, unknown>, token = adminToken) =>
  request(t.app).post('/api/products/import').set(bearer(token)).send(body);
const productCount = () => (t.db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
const categoryCount = () => (t.db.prepare('SELECT COUNT(*) AS n FROM categories').get() as { n: number }).n;

// sku, name_ar, name_en, category, unit, cost, sell, tax, stock, alert, expiry
const GOOD = [
  'SH-001,شاورما دجاج,Chicken Shawarma,شاورما,ساندويتش,6,12,15,40,5,',
  'SH-002,شاورما لحم,Meat Shawarma,شاورما,ساندويتش,8,15,15,30,5,',
  'RC-001,شواية بالرز,Grill with Rice,أطباق رز,طبق,14,32,15,0,2,',
  'DR-001,ماء,Water,مشروبات,علبة,0.5,1.5,0,100,20,2027-06-30',
];

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
  cashierToken = (await createUserWithRole(t.app, adminToken, 'cashier', 'cashier-import@test.local')).token;
});
afterAll(() => t.cleanup());

describe('access (R2.4a)', () => {
  it('needs inventory.manage', async () => {
    expect((await send({ csv: csv(GOOD[0]) }, cashierToken)).status).toBe(403);
    expect((await request(t.app).post('/api/products/import').send({ csv: csv(GOOD[0]) })).status).toBe(401);
  });
});

describe('preview (R2.4a)', () => {
  it('reports a clean file without changing anything', async () => {
    const before = productCount();
    const res = await send({ csv: csv(...GOOD), dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, totalRows: 4, validRows: 4, rowProblems: [], fileProblems: [], imported: 0 });
    expect(res.body.newCategories).toEqual(['شاورما', 'أطباق رز', 'مشروبات']);
    expect(productCount()).toBe(before);
  });

  it('lists every problem with its spreadsheet row and Arabic column', async () => {
    const res = await send({
      csv: csv(
        'BAD-1,صنف,,عام,,2,-5,15,1,1,', // row 2: negative price
        'BAD-2,صنف,,عام,,2,5,7,1,1,', // row 3: VAT 7%
        'BAD-3,,,,,2,5,15,1.5,1,2026-02-30' // row 4: no name, fractional stock, bad date
      ),
      dryRun: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.validRows).toBe(0);
    const problems = res.body.rowProblems.map((p: { row: number; column: string; reason: string }) => [p.row, p.column, p.reason]);
    expect(problems).toEqual([
      [2, 'سعر البيع', 'MUST_BE_POSITIVE'],
      [3, 'الضريبة', 'INVALID_TAX'],
      [4, 'الاسم بالعربية', 'REQUIRED'],
      [4, 'تاريخ الانتهاء', 'INVALID_DATE'],
      [4, 'الرصيد الافتتاحي', 'NOT_INTEGER'],
    ]);
  });

  it('flags a SKU repeated in the file and one that already exists', async () => {
    const existing = t.db.prepare('SELECT sku FROM products WHERE id = 1').get() as { sku: string };
    const res = await send({
      csv: csv('DUP-1,أول,,,,1,2,15,0,0,', 'DUP-1,ثان,,,,1,2,15,0,0,', `${existing.sku},موجود,,,,1,2,15,0,0,`),
      dryRun: true,
    });
    const problems = res.body.rowProblems.map((p: { row: number; reason: string }) => [p.row, p.reason]);
    expect(problems).toEqual([
      [3, 'DUPLICATE_IN_FILE'],
      [4, 'ALREADY_EXISTS'],
    ]);
    expect(res.body.validRows).toBe(1);
  });

  it('reports file problems: missing columns, no data, too many rows', async () => {
    const missing = await send({ csv: 'الباركود,الاسم بالعربية\nA,ب\n', dryRun: true });
    expect(missing.body.fileProblems).toEqual([{ code: 'MISSING_COLUMNS', columns: ['سعر البيع'] }]);

    expect((await send({ csv: csv(), dryRun: true })).body.fileProblems).toEqual([{ code: 'EMPTY_FILE' }]);
    expect((await send({ csv: '', dryRun: true })).body.fileProblems).toEqual([{ code: 'EMPTY_FILE' }]);

    const rows = Array.from({ length: 1001 }, (_, i) => `MANY-${i},صنف ${i},,,,1,2,15,0,0,`);
    expect((await send({ csv: csv(...rows), dryRun: true })).body.fileProblems).toEqual([
      { code: 'TOO_MANY_ROWS', max: 1000, found: 1001 },
    ]);
  });

  it('accepts ";" files, English headings, Arabic digits and skips blank rows', async () => {
    const text = 'sku;name_ar;sell_price;tax_rate;stock_qty\nAR-1;صنف;١٢٫٥;١٥;٣\n\n;;;;\nAR-2;صنف ٢;7;0;0\n';
    const res = await send({ csv: text, dryRun: true });
    expect(res.body).toMatchObject({ totalRows: 2, validRows: 2, rowProblems: [] });
  });
});

describe('import (R2.4a)', () => {
  it('rejects a file with any problem and adds nothing (decision a)', async () => {
    const before = productCount();
    const res = await send({ csv: csv(GOOD[0], 'BAD-9,صنف,,,,1,0,15,0,0,'), dryRun: false });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'IMPORT_INVALID', imported: 0 });
    expect(res.body.rowProblems[0]).toMatchObject({ row: 3, reason: 'MUST_BE_POSITIVE' });
    expect(productCount()).toBe(before);
  });

  it('adds every row in one go, with categories and opening stock movements', async () => {
    const beforeProducts = productCount();
    const beforeCategories = categoryCount();
    const res = await send({ csv: csv(...GOOD), dryRun: false });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ imported: 4, dryRun: false });
    expect(productCount()).toBe(beforeProducts + 4);
    expect(categoryCount()).toBe(beforeCategories + 3);

    const shawarma = t.db
      .prepare("SELECT p.stock_qty, p.sell_price, p.tax_category, p.unit_ar, c.name_ar AS category FROM products p JOIN categories c ON c.id = p.category_id WHERE p.sku = 'SH-001'")
      .get();
    expect(shawarma).toEqual({ stock_qty: 40, sell_price: 12, tax_category: 'S', unit_ar: 'ساندويتش', category: 'شاورما' });
    const water = t.db.prepare("SELECT tax_rate, tax_category, expiry_date FROM products WHERE sku = 'DR-001'").get();
    expect(water).toEqual({ tax_rate: 0, tax_category: 'Z', expiry_date: '2027-06-30' });
    const movements = t.db
      .prepare("SELECT COUNT(*) AS n FROM stock_movements WHERE reference_no = 'CSV-IMPORT'")
      .get() as { n: number };
    expect(movements.n).toBe(3); // RC-001 has no opening stock
    expect(res.body.products.some((p: { sku: string }) => p.sku === 'SH-001')).toBe(true);
  });

  it('keeps the ledger equal to the stock of every product', () => {
    const mismatches = t.db
      .prepare(
        `SELECT p.id FROM products p LEFT JOIN stock_movements m ON m.product_id = p.id
         GROUP BY p.id HAVING p.stock_qty != COALESCE(SUM(m.qty_delta), 0)`
      )
      .all();
    expect(mismatches).toEqual([]);
  });

  it('rejects the same file again: its SKUs now exist', async () => {
    const res = await send({ csv: csv(...GOOD), dryRun: false });
    expect(res.status).toBe(400);
    expect(res.body.rowProblems.every((p: { reason: string }) => p.reason === 'ALREADY_EXISTS')).toBe(true);
  });

  it('adds nothing at all when the database fails half way (one transaction)', async () => {
    const beforeProducts = productCount();
    const beforeCategories = categoryCount();
    t.db.exec(
      `CREATE TRIGGER fail_import BEFORE INSERT ON products WHEN NEW.sku = 'ATOM-3'
       BEGIN SELECT RAISE(ABORT, 'simulated failure'); END;`
    );
    try {
      const res = await send({
        csv: csv('ATOM-1,أ,,فئة جديدة,,1,2,15,5,0,', 'ATOM-2,ب,,فئة جديدة,,1,2,15,5,0,', 'ATOM-3,ج,,فئة جديدة,,1,2,15,5,0,'),
        dryRun: false,
      });
      expect(res.status).toBe(500);
    } finally {
      t.db.exec('DROP TRIGGER fail_import');
    }
    expect(productCount()).toBe(beforeProducts);
    expect(categoryCount()).toBe(beforeCategories);
  });

  it('imports 1000 rows quickly', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => `BULK-${i},صنف ${i},,دفعة,,1,2,15,3,0,`);
    const started = Date.now();
    const res = await send({ csv: csv(...rows), dryRun: false });
    expect(res.status).toBe(201);
    expect(res.body.imported).toBe(1000);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});
