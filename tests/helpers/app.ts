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

/**
 * Boots the real server module (server.ts) against a fresh temporary SQLite
 * database, seeded exactly like a new installation. Call it once per test file
 * in beforeAll — Vitest isolates modules per file, so every file gets its own DB.
 */
export async function createTestApp(): Promise<TestApp> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mizan-test-'));
  process.env.MIZAN_DB_PATH = path.join(dir, 'test.db');
  const server = await import('../../server.ts');
  const { db } = await import('../../src/server/db.ts');
  return {
    app: server.app,
    db,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

export const ADMIN = {
  full_name: 'Owner Admin',
  email: 'admin@test.local',
  password: 'admin-pass-123',
};

/** Registers the first account, which the current code always makes an admin. */
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
