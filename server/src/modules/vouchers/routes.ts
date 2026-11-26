import { Router } from 'express';
import type { AuthUser } from '../../../../shared/types.ts';
import { requireAuth, requireCanView, requirePermission } from '../../middleware/auth.ts';
import { pageMeta } from '../../../../shared/schemas/pagination.ts';
import { NotFoundError } from '../../shared/errors.ts';
import { pageFrom, sendData, sendError, sendList, sendScoped } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Cash vouchers module routes (R2.4b). Same paths and response shapes as the
 * legacy routes; the list comes with /api/bootstrap. All need vouchers.manage.
 */
type Body = Record<string, unknown>;

export function createVouchersRouter(): Router {
  const router = Router();
  const manage = [requireAuth(), requirePermission('vouchers.manage')];

  router.post('/api/vouchers', ...manage, async (req, res) => {
    const id = await service.createVoucher(req.body as Body);
    const vouchers = await service.lists.vouchers();
    sendScoped(res.status(201), { voucher: vouchers.find((v) => v.id === id), vouchers });
  });

  // Financial vouchers are never deleted (R1.8, SEC-17): they are voided with a reason.
  router.delete('/api/vouchers/:id', ...manage, (_req, res) => {
    res.status(405).json({
      error: 'Vouchers cannot be deleted. Void the voucher with a reason instead.',
      code: 'VOUCHER_DELETE_NOT_ALLOWED',
    });
  });

  router.post('/api/vouchers/:id/void', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    await service.voidVoucher(id, req.body as Body, res.locals.authUser as AuthUser);
    const vouchers = await service.lists.vouchers();
    sendScoped(res, { voucher: vouchers.find((v) => v.id === id), vouchers });
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  const view = [requireAuth(), requireCanView('vouchers')];

  router.get('/api/v1/vouchers', ...view, async (req, res) => {
    const page = pageFrom(req);
    sendList(res, await service.reads.page(page), pageMeta(page, await service.reads.count()));
  });

  router.get('/api/v1/vouchers/:id', ...view, async (req, res) => {
    const voucher = await service.reads.one(Number(req.params.id));
    if (!voucher) throw new NotFoundError('VOUCHER_NOT_FOUND', 'Voucher not found.');
    sendData(res, voucher);
  });

  // ----------------------------------------------- API v1 writes (R2.5c)
  router.post('/api/v1/vouchers', ...manage, async (req, res) => {
    const id = await service.createVoucher(req.body as Body);
    sendData(res, await service.reads.one(id), 201);
  });

  // Never deleted (R1.8): voided with a reason.
  router.delete('/api/v1/vouchers/:id', ...manage, (req, res) => {
    sendError(req, res, 405, 'VOUCHER_DELETE_NOT_ALLOWED', 'Vouchers cannot be deleted. Void the voucher with a reason instead.');
  });

  router.post('/api/v1/vouchers/:id/void', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    await service.voidVoucher(id, req.body as Body, res.locals.authUser as AuthUser);
    sendData(res, await service.reads.one(id));
  });

  return router;
}
