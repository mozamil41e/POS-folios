import { Router } from 'express';
import { requireAuth, requireCanView, requirePermission } from '../../middleware/auth.ts';
import { pageMeta } from '../../../../shared/schemas/pagination.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { pageFrom, sendData, sendList, sendScoped } from '../../shared/respond.ts';
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

  // ------------------------------------------------ API v1 reads (R2.5b)
  const view = [requireAuth(), requireCanView('customers')];

  router.get('/api/v1/customers', ...view, async (req, res) => {
    const page = pageFrom(req);
    sendList(res, await service.reads.page(page), pageMeta(page, await service.reads.count()));
  });

  router.get('/api/v1/customers/:id', ...view, async (req, res) => {
    const customer = await service.reads.one(Number(req.params.id));
    if (!customer) throw new NotFoundError('CUSTOMER_NOT_FOUND', 'Customer not found.');
    sendData(res, customer);
  });

  return router;
}
