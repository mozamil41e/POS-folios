import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import type { db as DbInstance } from '../../src/server/db.ts';

export interface TestApp {
  app: Express;
  db: typeof DbInstance;
  cleanup: () => void;
}

export interface TestAppOptions {
  /** Use this database file instead of a fresh one (its directory is removed on cleanup). */
  dbPath?: string;
  /** Value of SETUP_TOKEN for this file. Unset by default (local-development behaviour). */
  setupToken?: string;
  /**
   * Value of TRUST_PROXY. Unset by default (no proxy, like local development).
   * Set it to '1' to simulate clients behind Hostinger's proxy with X-Forwarded-For.
   */
  trustProxy?: string;
  /**
   * Load the demo workspace (src/server/demo-data.ts) into an empty database.
   * Default true: most tests use its fixed catalogue (SEED). Production never
   * has it (R1.7); pass false to test a real first start.
   */
  demoData?: boolean;
}

/** Creates an empty temporary directory and returns the path of a database file inside it. */
export function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizan-test-'));
  return path.join(dir, 'test.db');
}

/**
 * Builds the real app (createApp in server/src/app.ts, the same code the server
 * runs) against a temporary SQLite database, plus the demo workspace unless
 * `demoData: false`. Call it once per test file in beforeAll: Vitest isolates
 * modules per file, so every file gets its own DB. The database module is
 * cached per file, so a second call in the same file reuses the first DB.
 * Environment variables are set explicitly because a worker process may be
 * reused by another test file; createApp() validates them like the server does.
 */
export async function createTestApp(options: TestAppOptions = {}): Promise<TestApp> {
  const dbPath = options.dbPath ?? makeTempDbPath();
  process.env.MIZAN_DB_PATH = dbPath;
  if (options.setupToken) {
    process.env.SETUP_TOKEN = options.setupToken;
  } else {
    delete process.env.SETUP_TOKEN;
  }
  if (options.trustProxy) {
    process.env.TRUST_PROXY = options.trustProxy;
  } else {
    delete process.env.TRUST_PROXY;
  }
  const { createApp } = await import('../../server/src/app.ts');
  const { db } = await import('../../src/server/db.ts');
  // A top-level import of a server module in a test file opens the database
  // before this function sets its path, on the shared fallback file: files
  // would then silently share one database. Fail loudly instead (R2.5c).
  if (path.resolve(db.name) !== path.resolve(dbPath)) {
    throw new Error(
      `The database was opened at ${db.name} before createTestApp() set ${dbPath}. ` +
        'Import server modules inside the test (await import(...)) after createTestApp().'
    );
  }
  const { app } = createApp();
  if (options.demoData !== false) {
    // Skipped automatically when the database already holds business data.
    const { seedDemoData } = await import('../../src/server/demo-data.ts');
    seedDemoData();
  }
  return {
    app,
    db,
    cleanup: () => {
      db.close();
      delete process.env.SETUP_TOKEN;
      delete process.env.TRUST_PROXY;
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const ADMIN = {
  full_name: 'Owner Admin',
  email: 'admin@test.local',
  password: 'admin-pass-123',
};

/** Completes first-run setup: creates the first (admin) account on an empty system. */
export async function registerFirstAdmin(app: Express): Promise<string> {
  const res = await request(app).post('/api/auth/register').send(ADMIN);
  if (res.status !== 201) {
    throw new Error(`Admin registration failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body.token as string;
}

export async function roleIdBySlug(app: Express, adminToken: string, slug: string): Promise<number> {
  const res = await request(app).get('/api/roles').set(bearer(adminToken));
  const role = (res.body.roles as Array<{ id: number; slug: string }>).find((r) => r.slug === slug);
  if (!role) throw new Error(`Role not found: ${slug}`);
  return role.id;
}

/** Creates a user through the admin API and logs them in. */
export async function createUserWithRole(
  app: Express,
  adminToken: string,
  roleSlug: string,
  email: string,
  password = 'user-pass-123'
): Promise<{ token: string; userId: number }> {
  const roleId = await roleIdBySlug(app, adminToken, roleSlug);
  const created = await request(app)
    .post('/api/users')
    .set(bearer(adminToken))
    .send({ full_name: `${roleSlug} user`, email, phone: '', password, role_id: roleId, is_active: true });
  if (created.status !== 201) {
    throw new Error(`User creation failed: ${created.status} ${JSON.stringify(created.body)}`);
  }
  const login = await request(app).post('/api/auth/login').send({ email, password });
  return { token: login.body.token as string, userId: created.body.userId as number };
}

export async function getBootstrap(app: Express, token: string) {
  const res = await request(app).get('/api/bootstrap').set(bearer(token));
  if (res.status !== 200) throw new Error(`Bootstrap failed: ${res.status}`);
  return res.body;
}

export async function stockOf(app: Express, token: string, productId: number): Promise<number> {
  const body = await getBootstrap(app, token);
  const product = (body.products as Array<{ id: number; stock_qty: number }>).find((p) => p.id === productId);
  if (!product) throw new Error(`Product not found: ${productId}`);
  return product.stock_qty;
}

/**
 * Seeded catalogue used by the tests (see seedProducts in src/server/db.ts):
 * prices are VAT-exclusive, tax rate 15%.
 */
export const SEED = {
  milk: { id: 1, price: 11.74, stock: 64 },
  rice: { id: 2, price: 42.61, stock: 32 },
  coffee: { id: 5, price: 29.57, stock: 9 },
  water: { id: 6, price: 13.91, stock: 95 },
  juiceOutOfStock: { id: 14, stock: 0 },
  supplierId: 1,
} as const;
