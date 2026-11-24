import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  SEED,
  bearer,
  createTestApp,
  createUserWithRole,
  getBootstrap,
  registerFirstAdmin,
  type TestApp,
} from '../helpers/app.ts';

// R1.11c: categories are their own table (option a: a category with products
// cannot be deleted). Products keep category_ar/category_en as a display copy.
let t: TestApp;
let adminToken: string;
let cashierToken: string;

const api = {
  get: (url: string, token = adminToken) => request(t.app).get(url).set(bearer(token)),
  post: (url: string, body: Record<string, unknown>, token = adminToken) =>
    request(t.app).post(url).set(bearer(token)).send(body),
  put: (url: string, body: Record<string, unknown>, token = adminToken) =>
    request(t.app).put(url).set(bearer(token)).send(body),
  del: (url: string, token = adminToken) => request(t.app).delete(url).set(bearer(token)),
};

type Cat = { id: number; name_ar: string; name_en: string; sort_order: number; product_count: number };
const categories = async (): Promise<Cat[]> => (await getBootstrap(t.app, adminToken)).categories;
const productRow = (id: number) =>
  t.db.prepare('SELECT category_id, category_ar, category_en FROM products WHERE id = ?').get(id) as {
    category_id: number | null;
    category_ar: string;
    category_en: string;
  };

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
  cashierToken = (await createUserWithRole(t.app, adminToken, 'cashier', 'cashier-cat@test.local')).token;
});
afterAll(() => t.cleanup());

describe('categories from existing products (R1.11c)', () => {
  it('links every product to a category created from its name', async () => {
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id IS NULL').get()).toEqual({ n: 0 });
    const list = await categories();
    expect(list.map((c) => c.sort_order)).toEqual(list.map((_, i) => i + 1));
    expect(list.reduce((sum, c) => sum + c.product_count, 0)).toBe(14);
    const milk = productRow(SEED.milk.id);
    expect(list.find((c) => c.id === milk.category_id)?.name_ar).toBe(milk.category_ar);
  });

  it('lets a cashier read the categories but not change them', async () => {
    const body = await getBootstrap(t.app, cashierToken);
    expect(body.categories.length).toBeGreaterThan(0);
    expect((await api.post('/api/categories', { name_ar: 'ممنوع' }, cashierToken)).status).toBe(403);
    expect((await api.put(`/api/categories/${body.categories[0].id}`, { name_ar: 'x' }, cashierToken)).status).toBe(403);
    expect((await api.del(`/api/categories/${body.categories[0].id}`, cashierToken)).status).toBe(403);
  });
});

describe('creating and renaming (R1.11c)', () => {
  it('creates a category at the end of the order', async () => {
    const before = await categories();
    const res = await api.post('/api/categories', { name_ar: '  مشويات   لحم ', name_en: 'Grills' });
    expect(res.status).toBe(201);
    expect(res.body.category).toMatchObject({ name_ar: 'مشويات لحم', name_en: 'Grills', product_count: 0 });
    expect(res.body.category.sort_order).toBe(before.length + 1);
  });

  it('refuses a duplicate name, even with other spacing or case', async () => {
    const res = await api.post('/api/categories', { name_ar: 'مشويات  لحم' });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CATEGORY_EXISTS', field: 'name_ar' });
    await api.post('/api/categories', { name_ar: 'Drinks' });
    expect((await api.post('/api/categories', { name_ar: 'drinks' })).status).toBe(409);
  });

  it('validates the name', async () => {
    expect((await api.post('/api/categories', { name_ar: '   ' })).body).toMatchObject({ field: 'name_ar', reason: 'REQUIRED' });
    expect((await api.post('/api/categories', { name_ar: 'x'.repeat(61) })).body).toMatchObject({ field: 'name_ar', reason: 'TOO_LONG' });
  });

  it('defaults the English name to the Arabic one', async () => {
    const res = await api.post('/api/categories', { name_ar: 'حلويات' });
    expect(res.body.category.name_en).toBe('حلويات');
  });

  it('renames a category and every product in it', async () => {
    const milk = productRow(SEED.milk.id);
    const res = await api.put(`/api/categories/${milk.category_id}`, { name_ar: 'الألبان', name_en: 'Dairy' });
    expect(res.status).toBe(200);
    const siblings = t.db
      .prepare('SELECT DISTINCT category_ar, category_en FROM products WHERE category_id = ?')
      .all(milk.category_id);
    expect(siblings).toEqual([{ category_ar: 'الألبان', category_en: 'Dairy' }]);
  });

  it('refuses renaming to another category name, and unknown ids', async () => {
    const milk = productRow(SEED.milk.id);
    expect((await api.put(`/api/categories/${milk.category_id}`, { name_ar: 'حلويات' })).status).toBe(409);
    expect((await api.put('/api/categories/999999', { name_ar: 'لا يوجد' })).status).toBe(404);
  });
});

describe('products and their category (R1.11c)', () => {
  it('saves a product under the chosen category and copies its names', async () => {
    const grills = (await categories()).find((c) => c.name_ar === 'مشويات لحم')!;
    const res = await api.post('/api/products', { sku: 'CAT-1', name_ar: 'كباب', sell_price: 30, category_id: grills.id });
    expect(res.status).toBe(201);
    expect(res.body.product).toMatchObject({ category_id: grills.id, category_ar: 'مشويات لحم', category_en: 'Grills' });
    expect(res.body.categories.find((c: Cat) => c.id === grills.id).product_count).toBe(1);
  });

  it('refuses an unknown or invalid category id', async () => {
    const unknown = await api.post('/api/products', { sku: 'CAT-2', name_ar: 'صنف', sell_price: 5, category_id: 999999 });
    expect(unknown.status).toBe(400);
    expect(unknown.body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'category_id', reason: 'NOT_FOUND' });
    const invalid = await api.post('/api/products', { sku: 'CAT-2', name_ar: 'صنف', sell_price: 5, category_id: 'abc' });
    expect(invalid.body).toMatchObject({ field: 'category_id', reason: 'INVALID_NUMBER' });
    expect(t.db.prepare("SELECT COUNT(*) AS n FROM products WHERE sku = 'CAT-2'").get()).toEqual({ n: 0 });
  });

  it('still accepts a category name from older clients (found or created)', async () => {
    const res = await api.post('/api/products', { sku: 'CAT-3', name_ar: 'كنافة', sell_price: 12, category_ar: 'حلويات' });
    const sweets = (await categories()).find((c) => c.name_ar === 'حلويات')!;
    expect(res.body.product.category_id).toBe(sweets.id);
    const created = await api.post('/api/products', { sku: 'CAT-4', name_ar: 'سلطة', sell_price: 9, category_ar: 'سلطات' });
    expect(created.body.product.category_ar).toBe('سلطات');
    expect((await categories()).some((c) => c.name_ar === 'سلطات')).toBe(true);
  });

  it('moves a product to another category on update', async () => {
    const grills = (await categories()).find((c) => c.name_ar === 'مشويات لحم')!;
    const res = await api.put(`/api/products/${SEED.rice.id}`, { category_id: grills.id });
    expect(res.status).toBe(200);
    expect(productRow(SEED.rice.id)).toEqual({ category_id: grills.id, category_ar: 'مشويات لحم', category_en: 'Grills' });
  });

  it('keeps the category when an update does not mention it', async () => {
    const before = productRow(SEED.water.id);
    await api.put(`/api/products/${SEED.water.id}`, { sell_price: 14 });
    expect(productRow(SEED.water.id)).toEqual(before);
  });
});

describe('ordering (R1.11c)', () => {
  it('sets the POS order from the full list of ids', async () => {
    const ids = (await categories()).map((c) => c.id).reverse();
    const res = await api.post('/api/categories/order', { ids });
    expect(res.status).toBe(200);
    expect(res.body.categories.map((c: Cat) => c.id)).toEqual(ids);
    expect(res.body.categories.map((c: Cat) => c.sort_order)).toEqual(ids.map((_, i) => i + 1));
  });

  it('refuses a partial, duplicated or invalid list', async () => {
    const ids = (await categories()).map((c) => c.id);
    expect((await api.post('/api/categories/order', { ids: ids.slice(1) })).status).toBe(400);
    expect((await api.post('/api/categories/order', { ids: [ids[0], ids[0]] })).status).toBe(400);
    expect((await api.post('/api/categories/order', { ids: 'x' })).status).toBe(400);
  });
});

describe('deleting, option (a) (R1.11c)', () => {
  it('refuses to delete a category that still has products', async () => {
    const grills = (await categories()).find((c) => c.name_ar === 'مشويات لحم')!;
    const res = await api.del(`/api/categories/${grills.id}`);
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'CATEGORY_IN_USE', count: grills.product_count });
    expect((await categories()).some((c) => c.id === grills.id)).toBe(true);
  });

  it('deletes an empty category, and 404 for an unknown one', async () => {
    const created = await api.post('/api/categories', { name_ar: 'مؤقت' });
    expect((await api.del(`/api/categories/${created.body.category.id}`)).status).toBe(200);
    expect((await categories()).some((c) => c.name_ar === 'مؤقت')).toBe(false);
    expect((await api.del('/api/categories/999999')).status).toBe(404);
  });

  it('frees hidden (deleted) products and never brings the category back on restart', async () => {
    const created = await api.post('/api/categories', { name_ar: 'موسمي' });
    const product = await api.post('/api/products', { sku: 'CAT-5', name_ar: 'صنف موسمي', sell_price: 4, category_id: created.body.category.id });
    await api.del(`/api/products/${product.body.product.id}`); // soft delete: active = 0
    expect((await api.del(`/api/categories/${created.body.category.id}`)).status).toBe(200);
    expect(productRow(product.body.product.id)).toEqual({ category_id: null, category_ar: 'موسمي', category_en: 'موسمي' });

    const { initDatabase } = await import('../../src/server/db.ts');
    initDatabase();
    expect((await categories()).some((c) => c.name_ar === 'موسمي')).toBe(false);
  });
});
