import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, getBootstrap, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.3: Kysely over the shared SQLite connection, withTransaction and its guards.
let t: TestApp;
let adminToken: string;
let kysely: typeof import('../../server/src/db/kysely.ts').kysely;
let tx: typeof import('../../server/src/db/transaction.ts');
let TABLE_COLUMNS: typeof import('../../server/src/db/schema.ts').TABLE_COLUMNS;

const categoryCount = (name: string) =>
  (t.db.prepare('SELECT COUNT(*) AS n FROM categories WHERE name_ar = ?').get(name) as { n: number }).n;

const newCategory = (name: string) => ({
  name_ar: name,
  name_en: name,
  name_key: name,
  sort_order: 99,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
  ({ kysely } = await import('../../server/src/db/kysely.ts'));
  tx = await import('../../server/src/db/transaction.ts');
  ({ TABLE_COLUMNS } = await import('../../server/src/db/schema.ts'));
});
afterAll(() => t.cleanup());

describe('table types (R2.3)', () => {
  it('match the real database: same tables, same columns in the same order', () => {
    const tables = (
      t.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(Object.keys(TABLE_COLUMNS).sort()).toEqual(tables);
    for (const table of tables) {
      const columns = (t.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
      expect({ table, columns }).toEqual({ table, columns: [...TABLE_COLUMNS[table as keyof typeof TABLE_COLUMNS]] });
    }
  });

  it('let the type checker refuse unknown columns', () => {
    // Never executed: `npm run typecheck` fails if this line stops being an error.
    const typeOnly = () =>
      // @ts-expect-error -- 'no_such_column' is not a column of products
      kysely.selectFrom('products').select('no_such_column');
    expect(typeof typeOnly).toBe('function');
  });
});

describe('Kysely on the shared connection (R2.3)', () => {
  it('reads the same rows as the existing queries', async () => {
    const legacy = t.db.prepare('SELECT * FROM products ORDER BY id').all();
    const typed = await kysely.selectFrom('products').selectAll().orderBy('id').execute();
    expect(typed).toEqual(legacy);
    expect(typed.length).toBe(14);
  });

  it('sees writes from the legacy routes, and the routes see its writes', async () => {
    const created = await request(t.app).post('/api/categories').set(bearer(adminToken)).send({ name_ar: 'من المسار القديم' });
    expect(created.status).toBe(201);
    const row = await kysely.selectFrom('categories').select(['id', 'name_ar']).where('name_ar', '=', 'من المسار القديم').executeTakeFirst();
    expect(row?.id).toBe(created.body.category.id);

    await kysely.insertInto('categories').values(newCategory('من Kysely')).execute();
    const body = await getBootstrap(t.app, adminToken);
    expect(body.categories.some((c: { name_ar: string }) => c.name_ar === 'من Kysely')).toBe(true);
  });
});

describe('withTransaction (R2.3)', () => {
  it('commits every write together', async () => {
    const result = await tx.withTransaction(async (trx) => {
      await trx.insertInto('categories').values(newCategory('معاملة 1')).execute();
      await trx.insertInto('categories').values(newCategory('معاملة 2')).execute();
      return 'done';
    });
    expect(result).toBe('done');
    expect(categoryCount('معاملة 1') + categoryCount('معاملة 2')).toBe(2);
  });

  it('rolls everything back when the body throws', async () => {
    await expect(
      tx.withTransaction(async (trx) => {
        await trx.insertInto('categories').values(newCategory('لن تُحفظ')).execute();
        throw new Error('business rule failed');
      })
    ).rejects.toThrow('business rule failed');
    expect(categoryCount('لن تُحفظ')).toBe(0);
    expect(tx.isTransactionOpen()).toBe(false);
  });

  it('refuses nesting (pass trx down instead)', async () => {
    await expect(
      tx.withTransaction(async () => {
        await tx.withTransaction(async () => undefined);
      })
    ).rejects.toThrow(/already running/);
    expect(tx.isTransactionOpen()).toBe(false);
  });
});

describe('guards against breaking the rule (R2.3)', () => {
  it('rolls back a transaction that waited on non-database work', async () => {
    await expect(
      tx.withTransaction(async (trx) => {
        await trx.insertInto('categories').values(newCategory('انتظار بطيء')).execute();
        await new Promise((resolve) => setTimeout(resolve, 20)); // forbidden: a timer inside the transaction
      })
    ).rejects.toBeInstanceOf(tx.TransactionSpanError);
    expect(categoryCount('انتظار بطيء')).toBe(0);
  });

  it('refuses another request arriving meanwhile, so nothing is mixed, then serves normally', async () => {
    let during: request.Response | undefined;
    await expect(
      tx.withTransaction(async (trx) => {
        await trx.insertInto('categories').values(newCategory('معاملة مخالفة')).execute();
        // Forbidden on purpose: another HTTP request is handled while the transaction is open.
        during = await request(t.app).post('/api/categories').set(bearer(adminToken)).send({ name_ar: 'طلب متزامن' });
      })
    ).rejects.toBeInstanceOf(tx.TransactionSpanError);

    expect(during?.status).toBe(503);
    expect(during?.body.code).toBe('SERVER_BUSY');
    expect(during?.headers['retry-after']).toBe('1');
    expect(categoryCount('معاملة مخالفة')).toBe(0);
    expect(categoryCount('طلب متزامن')).toBe(0);

    const after = await request(t.app).post('/api/categories').set(bearer(adminToken)).send({ name_ar: 'طلب متزامن' });
    expect(after.status).toBe(201);
  });
});
