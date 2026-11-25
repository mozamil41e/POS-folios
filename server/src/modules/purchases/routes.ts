import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { sendScoped } from '../../shared/respond.ts';
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

  return router;
}
