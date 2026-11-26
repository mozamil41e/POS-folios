import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { sendScoped } from '../../shared/respond.ts';
import { importProducts } from './import.ts';
import * as service from './service.ts';

/**
 * Inventory module routes (R2.4a): products, stock movements, categories and
 * the CSV import. Same paths and response shapes as the legacy routes they
 * replace (the UI did not change), plus POST /api/products/import.
 * Each route authenticates itself.
 */
export function createInventoryRouter(): Router {
  const router = Router();
  const auth = requireAuth();
  const manage = [auth, requirePermission('inventory.manage')];
  const { lists } = service;

  // ------------------------------------------------------------ products
  router.post('/api/products/import', ...manage, async (req, res) => {
    const report = await importProducts(req.body as Record<string, unknown>);
    if (report.dryRun) {
      res.json(report);
      return;
    }
    if (report.imported === 0) {
      res.status(400).json({ error: 'The file has problems; nothing was imported.', code: 'IMPORT_INVALID', ...report });
      return;
    }
    sendScoped(res.status(201), {
      ...report,
      products: await lists.products(),
      categories: await lists.categories(),
      movements: await lists.movements(),
    });
  });

  router.post('/api/products', ...manage, async (req, res) => {
    const id = await service.createProduct(req.body as Record<string, unknown>);
    sendScoped(res.status(201), {
      product: await lists.product(id),
      products: await lists.products(),
      categories: await lists.categories(),
      movements: await lists.movements(),
    });
  });

  router.put('/api/products/:id', ...manage, async (req, res) => {
    await service.updateProduct(Number(req.params.id), req.body as Record<string, unknown>);
    sendScoped(res, { products: await lists.products(), categories: await lists.categories() });
  });

  router.delete('/api/products/:id', ...manage, async (req, res) => {
    await service.deleteProduct(Number(req.params.id));
    sendScoped(res, { products: await lists.products(), categories: await lists.categories() });
  });

  // ----------------------------------------------------- stock movements
  router.post('/api/inventory/movement', auth, requirePermission('inventory.adjust'), async (req, res) => {
    await service.recordMovement(req.body as Record<string, unknown>);
    sendScoped(res, { products: await lists.products(), movements: await lists.movements() });
  });

  // ---------------------------------------------------------- categories
  router.post('/api/categories', ...manage, async (req, res) => {
    const category = await service.createCategory(req.body as Record<string, unknown>);
    sendScoped(res.status(201), { category, categories: await lists.categories() });
  });

  router.put('/api/categories/:id', ...manage, async (req, res) => {
    await service.updateCategory(Number(req.params.id), req.body as Record<string, unknown>);
    sendScoped(res, { categories: await lists.categories(), products: await lists.products() });
  });

  router.post('/api/categories/order', ...manage, async (req, res) => {
    await service.reorderCategories(req.body as Record<string, unknown>);
    sendScoped(res, { categories: await lists.categories() });
  });

  router.delete('/api/categories/:id', ...manage, async (req, res) => {
    await service.deleteCategory(Number(req.params.id));
    sendScoped(res, { categories: await lists.categories() });
  });

  return router;
}
