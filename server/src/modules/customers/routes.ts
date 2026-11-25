import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { sendScoped } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Customers module routes (R2.4b). Same paths and response shapes as the
 * legacy routes; the list itself comes with /api/bootstrap. customers.manage
 * belongs to the cashier role too, so a cashier can add a customer at the till.
 */
type Body = Record<string, unknown>;

export function createCustomersRouter(): Router {
  const router = Router();
  const manage = [requireAuth(), requirePermission('customers.manage')];

  router.post('/api/customers', ...manage, async (req, res) => {
    const customerId = await service.createCustomer(req.body as Body);
    sendScoped(res.status(201), { customerId, customers: await service.lists.customers() });
  });

  router.put('/api/customers/:id', ...manage, async (req, res) => {
    await service.updateCustomer(Number(req.params.id), req.body as Body);
    sendScoped(res, { customers: await service.lists.customers() });
  });

  return router;
}
