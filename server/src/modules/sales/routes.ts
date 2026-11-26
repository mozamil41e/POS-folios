import { Router, type Response } from 'express';
import type { AuthUser } from '../../../../shared/types.ts';
import type { Logger } from '../../logger.ts';
import { requireAuth, requireCanView, requirePermission } from '../../middleware/auth.ts';
import { idempotencyKeyFrom } from '../../shared/idempotency.ts';
import { pageMeta } from '../../../../shared/schemas/pagination.ts';
import { AppError, NotFoundError } from '../../shared/errors.ts';
import { pageFrom, sendAll, sendData, sendList, sendScoped } from '../../shared/respond.ts';
import { lists as inventoryLists } from '../inventory/service.ts';
import { getSettings } from '../settings/service.ts';
import * as service from './service.ts';

/**
 * Sales module routes (R2.4b): checkout, credit note and held carts. Same
 * paths and response shapes as the legacy routes they replaced.
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
  // R2.5a: an optional Idempotency-Key (the till sends one per sale attempt).
  // The same key again answers with the first invoice, marked Idempotent-Replayed.
  router.post('/api/invoices', auth, requirePermission('pos.access'), async (req, res) => {
    const key = idempotencyKeyFrom(req.get('Idempotency-Key'));
    const saved = await service.checkout(req.body as Body, res.locals.authUser as AuthUser, key);
    if (saved.replayed) res.setHeader('Idempotent-Replayed', 'true');
    await confirmSaved(res, saved);
  });

  // ---------------------------------------------------------- credit note
  router.post('/api/invoices/:id/credit-note', auth, requirePermission('sales.return'), async (req, res) => {
    const saved = await service.creditNote(Number(req.params.id));
    await confirmSaved(res, saved);
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  router.get('/api/v1/invoices', auth, requireCanView('invoices'), async (req, res) => {
    const page = pageFrom(req);
    sendList(res, await service.reads.page(page), pageMeta(page, await service.reads.count()));
  });

  router.get('/api/v1/invoices/:id', auth, requireCanView('invoices'), async (req, res) => {
    const invoice = await service.reads.one(Number(req.params.id));
    if (!invoice) throw new NotFoundError('INVOICE_NOT_FOUND', 'Invoice not found.');
    sendData(res, invoice);
  });

  router.get('/api/v1/held-carts', auth, requireCanView('heldCarts'), async (_req, res) => {
    sendAll(res, await service.lists.heldCarts());
  });

  // ----------------------------------------------- API v1 writes (R2.5c)
  /**
   * The v1 answer to a committed sale or credit note: the document itself.
   * As for the current routes (R1.5), a failure while reading it back is
   * logged and the sale is still confirmed with its id and number.
   */
  async function confirmSavedV1(res: Response, saved: service.Saved): Promise<void> {
    if (saved.replayed) res.setHeader('Idempotent-Replayed', 'true');
    try {
      sendData(res, await service.reads.one(saved.id), 201);
    } catch (err) {
      logger.error({ err, invoiceId: saved.id, reqId: res.locals.requestId }, 'saved, but reading the document back failed');
      sendData(res, { id: saved.id, invoice_number: saved.invoiceNumber }, 201);
    }
  }

  // The Idempotency-Key is required here (R2.5, owner's decision a); the same
  // key as on the current route, so a retry may switch paths safely.
  router.post('/api/v1/invoices', auth, requirePermission('pos.access'), async (req, res) => {
    const key = idempotencyKeyFrom(req.get('Idempotency-Key'));
    if (!key) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required for a sale.', {
        field: 'Idempotency-Key',
      });
    }
    await confirmSavedV1(res, await service.checkout(req.body as Body, res.locals.authUser as AuthUser, key));
  });

  router.post('/api/v1/invoices/:id/credit-note', auth, requirePermission('sales.return'), async (req, res) => {
    await confirmSavedV1(res, await service.creditNote(Number(req.params.id)));
  });

  router.post('/api/v1/held-carts', auth, requirePermission('pos.hold'), async (req, res) => {
    const id = await service.holdCart(req.body as Body);
    sendData(res, (await service.lists.heldCarts()).find((c) => c.id === id), 201);
  });

  router.delete('/api/v1/held-carts/:id', auth, requirePermission('pos.hold'), async (req, res) => {
    await service.releaseCart(Number(req.params.id));
    res.status(204).end();
  });

  return router;
}
