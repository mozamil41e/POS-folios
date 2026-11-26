import { Router } from 'express';
import { requireAuth, requireCanView, requirePermission } from '../../middleware/auth.ts';
import { pageMeta } from '../../../../shared/schemas/pagination.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { pageFrom, sendData, sendList, sendScoped } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Suppliers module routes (R2.4b). Same paths and response shapes as the
 * legacy routes; the list itself comes with /api/bootstrap. Suppliers belong
 * to purchasing, so the permission is purchases.manage.
 */
type Body = Record<string, unknown>;

export function createSuppliersRouter(): Router {
  const router = Router();
  const manage = [requireAuth(), requirePermission('purchases.manage')];

  router.post('/api/suppliers', ...manage, async (req, res) => {
    const supplierId = await service.createSupplier(req.body as Body);
    sendScoped(res.status(201), { supplierId, suppliers: await service.lists.suppliers() });
  });

  router.put('/api/suppliers/:id', ...manage, async (req, res) => {
    await service.updateSupplier(Number(req.params.id), req.body as Body);
    sendScoped(res, { suppliers: await service.lists.suppliers() });
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  const view = [requireAuth(), requireCanView('suppliers')];

  router.get('/api/v1/suppliers', ...view, async (req, res) => {
    const page = pageFrom(req);
    sendList(res, await service.reads.page(page), pageMeta(page, await service.reads.count()));
  });

  router.get('/api/v1/suppliers/:id', ...view, async (req, res) => {
    const supplier = await service.reads.one(Number(req.params.id));
    if (!supplier) throw new NotFoundError('SUPPLIER_NOT_FOUND', 'Supplier not found.');
    sendData(res, supplier);
  });

  return router;
}
