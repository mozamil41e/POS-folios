import { Router } from 'express';
import { requireAuth, requireCanView, requirePermission } from '../../middleware/auth.ts';
import { pageMeta } from '../../../../shared/schemas/pagination.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { pageFrom, sendData, sendList, sendScoped } from '../../shared/respond.ts';
import { lists as inventoryLists } from '../inventory/service.ts';
import * as service from './service.ts';

/**
 * Purchases module routes (R2.4b). Same paths and response shapes as the
 * legacy routes; the list itself comes with /api/bootstrap. Product cost
 * prices in the response follow the reader's permissions (sendScoped).
 */
type Body = Record<string, unknown>;

export function createPurchasesRouter(): Router {
  const router = Router();
  const manage = [requireAuth(), requirePermission('purchases.manage')];

  router.post('/api/purchases', ...manage, async (req, res) => {
    const id = await service.createPurchase(req.body as Body);
    const purchases = await service.lists.purchases();
    sendScoped(res.status(201), {
      purchase: purchases.find((p) => p.id === id),
      purchases,
      products: await inventoryLists.products(),
      movements: await inventoryLists.movements(),
    });
  });

  router.post('/api/purchases/:id/pay', ...manage, async (req, res) => {
    await service.payPurchase(Number(req.params.id), req.body as Body);
    sendScoped(res, { purchases: await service.lists.purchases() });
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  const view = [requireAuth(), requireCanView('purchases')];

  router.get('/api/v1/purchases', ...view, async (req, res) => {
    const page = pageFrom(req);
    sendList(res, await service.reads.page(page), pageMeta(page, await service.reads.count()));
  });

  router.get('/api/v1/purchases/:id', ...view, async (req, res) => {
    const purchase = await service.reads.one(Number(req.params.id));
    if (!purchase) throw new NotFoundError('PURCHASE_NOT_FOUND', 'Purchase invoice not found.');
    sendData(res, purchase);
  });

  // ----------------------------------------------- API v1 writes (R2.5c)
  // Each answers with the affected purchase (and its lines) only.
  router.post('/api/v1/purchases', ...manage, async (req, res) => {
    const id = await service.createPurchase(req.body as Body);
    sendData(res, await service.reads.one(id), 201);
  });

  router.post('/api/v1/purchases/:id/payments', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    await service.payPurchase(id, req.body as Body);
    sendData(res, await service.reads.one(id));
  });

  return router;
}
