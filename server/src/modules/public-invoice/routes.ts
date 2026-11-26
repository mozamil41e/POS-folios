import { Router, type RequestHandler } from 'express';
import { noIndex } from '../../../../src/server/security.ts';
import * as service from './service.ts';

/**
 * Public invoice route (R2.4b): read-only, without a session, rate limited
 * per IP and not indexed by search engines (R1.9). The page itself is the
 * UI route /i/:uuid.
 */
export interface PublicInvoiceRouterContext {
  limiters: { publicInvoice: RequestHandler };
}

export function createPublicInvoiceRouter({ limiters }: PublicInvoiceRouterContext): Router {
  const router = Router();

  router.get('/api/public/invoices/:uuid', noIndex, limiters.publicInvoice, async (req, res) => {
    res.json(await service.publicInvoice(req.params.uuid));
  });

  return router;
}
