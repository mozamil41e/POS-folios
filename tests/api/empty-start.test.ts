import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, getBootstrap, makeTempDbPath, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R1.7 (H4), approved option (a): production always starts empty. Demo data
// exists only through `npm run seed:dev` in development.
const BUSINESS_TABLES = [
  'products',
  'stock_movements',
  'customers',
  'suppliers',
  'purchases',
  'purchase_items',
  'invoices',
  'invoice_items',
  'vouchers',
  'held_carts',
];

let t: TestApp;
const countOf = (table: string) => (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
});
afterAll(() => t.cleanup());

describe('first start without demo data (R1.7)', () => {
  it('creates no business records at all', () => {
    for (const table of BUSINESS_TABLES) expect({ table, rows: countOf(table) }).toEqual({ table, rows: 0 });
  });

  it('still creates what the system needs: the default roles and a neutral settings row', () => {
    expect(countOf('roles')).toBe(4);
    const settings = t.db
      .prepare('SELECT name_ar, name_en, vat_number, cr_number FROM organization_settings WHERE id = 1')
      .get();
    expect(settings).toEqual({ name_ar: 'اسم المطعم', name_en: 'Restaurant name', vat_number: '', cr_number: '' });
  });

  it('gives the first administrator an empty workspace', async () => {
    const token = await registerFirstAdmin(t.app);
    const body = await getBootstrap(t.app, token);
    for (const key of ['products', 'customers', 'suppliers', 'purchases', 'invoices', 'movements', 'vouchers', 'heldCarts']) {
      expect({ key, value: body[key] }).toEqual({ key, value: [] });
    }
    expect(body.roles).toHaveLength(4);
    expect(body.users).toHaveLength(1);
  });

  it('never brings demo data back on a restart, even after a table was emptied', async () => {
    // H4: deleting every voucher used to restore the demo vouchers on restart.
    const token = (await request(t.app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'admin-pass-123' })).body
      .token as string;
    const created = await request(t.app)
      .post('/api/vouchers')
      .set(bearer(token))
      .send({ voucher_type: 'receipt', payment_channel: 'cash', party_name: 'Opening float', amount: 100, voucher_date: '2026-11-24' });
    expect(created.status).toBe(201);
    t.db.exec('DELETE FROM vouchers');

    const { initDatabase } = await import('../../src/server/db.ts');
    initDatabase();
    initDatabase();
    for (const table of BUSINESS_TABLES) expect({ table, rows: countOf(table) }).toEqual({ table, rows: 0 });
  });

  it('first numbers start at 00001', async () => {
    const token = (await request(t.app).post('/api/auth/login').send({ email: 'admin@test.local', password: 'admin-pass-123' })).body
      .token as string;
    const res = await request(t.app)
      .post('/api/vouchers')
      .set(bearer(token))
      .send({ voucher_type: 'payment', payment_channel: 'cash', party_name: 'Supplier', amount: 10, voucher_date: '2026-11-24' });
    expect(res.body.voucher.voucher_number).toMatch(/^PAY-\d{4}-00001$/);
  });
});

describe('seedDemoData guards (R1.7)', () => {
  it('refuses to run in production', async () => {
    const { seedDemoData } = await import('../../src/server/demo-data.ts');
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => seedDemoData()).toThrow('DEMO_DATA_IN_PRODUCTION');
    } finally {
      process.env.NODE_ENV = previous;
    }
    expect(countOf('products')).toBe(0);
  });

  it('adds nothing to a database that already has business data', async () => {
    const { seedDemoData } = await import('../../src/server/demo-data.ts');
    t.db
      .prepare(
        `INSERT INTO customers (name_ar, name_en, vat_number, cr_number, address_ar, phone, created_at)
         VALUES ('عميل حقيقي', 'Real customer', '', '', '', '', ?)`
      )
      .run(new Date().toISOString());
    expect(seedDemoData()).toBe(false);
    expect(countOf('products')).toBe(0);
    expect(countOf('customers')).toBe(1);
  });
});

describe('npm run seed:dev (R1.7)', () => {
  const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
  const dbPath = makeTempDbPath();
  const run = (nodeEnv: string) =>
    spawnSync(process.execPath, [tsxCli, 'scripts/seed-dev.ts'], {
      env: { ...process.env, MIZAN_DB_PATH: dbPath, NODE_ENV: nodeEnv },
      encoding: 'utf8',
    });
  const products = () => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return (db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n;
    } finally {
      db.close();
    }
  };
  afterAll(() => fs.rmSync(path.dirname(dbPath), { recursive: true, force: true }));

  it('refuses with NODE_ENV=production and creates nothing', () => {
    const res = run('production');
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('NODE_ENV=production');
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('loads the demo workspace into an empty development database, once', () => {
    const first = run('development');
    expect({ status: first.status, stderr: first.stderr }).toMatchObject({ status: 0 });
    expect(products()).toBe(14);

    const second = run('development');
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('already has business data');
    expect(products()).toBe(14);
  });
});
