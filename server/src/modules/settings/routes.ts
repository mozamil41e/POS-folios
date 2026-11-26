import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { scopedFor, sendData, sendScoped } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Settings module routes (R2.4b): the restaurant's details and printing
 * options. Same path and response shape as the legacy route; the settings
 * are read through /api/bootstrap.
 */
export function createSettingsRouter(): Router {
  const router = Router();

  router.put('/api/settings', requireAuth(), requirePermission('settings.manage'), async (req, res) => {
    const settings = await service.updateSettings(req.body as Record<string, unknown>);
    sendScoped(res, { settings });
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  // Every signed-in user reads the settings (the receipt needs them), public fields only.
  router.get('/api/v1/settings', requireAuth(), async (_req, res) => {
    sendData(res, scopedFor(res, 'settings', await service.getSettings()));
  });

  return router;
}
