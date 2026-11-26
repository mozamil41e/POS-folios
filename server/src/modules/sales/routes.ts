import { Router, type Response } from 'express';
import type { AuthUser } from '../../../../shared/types.ts';
import type { Logger } from '../../logger.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { sendScoped } from '../../shared/respond.ts';
import { lists as inventoryLists } from '../inventory/service.ts';
import { getSettings } from '../settings/service.ts';
import * as service from './service.ts';

/**
 * Sales module routes (R2.4b): checkout, credit note and held carts. Same
 * paths and response shapes as the legacy routes; mounted before them.
 */
type Body = Record<string, unknown>;

export interface SalesRouterContext {
  logger: Logger;
}

export function createSalesRouter({ logger }: SalesRouterContext): Router {
  const router = Router();
  const auth = requireAuth();

  /**
   * Once a sale or credit note is committed, never answer with an error
   * (R1.5): the cashier would sell the same cart again. A failure while
   * loading the lists is logged and the sale is still confirmed (201).
   */
  async function confirmSaved(res: Response, saved: service.Saved): Promise<void> {
    try {
      const invoices = await service.lists.invoices();
      sendScoped(res.status(201), {
        invoice: invoices.find((i) => i.id === saved.id),
        settings: await getSettings(),
        products: await inventoryLists.products(),
        invoices,
        movements: await inventoryLists.movements(),
      });
    } catch (err) {
      logger.error({ err, invoiceId: saved.id, reqId: res.locals.requestId }, 'saved, but loading the response lists failed');
      res.status(201).json({ invoiceId: saved.id, invoice_number: saved.invoiceNumber });
    }
  }

  // ---------------------------------------------------------- held carts
  router.post('/api/carts/hold', auth, requirePermission('pos.hold'), async (req, res) => {
    await service.holdCart(req.body as Body);
    sendScoped(res.status(201), { heldCarts: await service.lists.heldCarts() });
  });

  router.delete('/api/carts/hold/:id', auth, requirePermission('pos.hold'), async (req, res) => {
    await service.releaseCart(Number(req.params.id));
    sendScoped(res, { heldCarts: await service.lists.heldCarts() });
  });

  // ---------------------------------------------------------- checkout
  router.post('/api/invoices', auth, requirePermission('pos.access'), async (req, res) => {
    const saved = await service.checkout(req.body as Body, res.locals.authUser as AuthUser);
    await confirmSaved(res, saved);
  });

  // ---------------------------------------------------------- credit note
  router.post('/api/invoices/:id/credit-note', auth, requirePermission('sales.return'), async (req, res) => {
    const saved = await service.creditNote(Number(req.params.id));
    await confirmSaved(res, saved);
  });

  return router;
}
