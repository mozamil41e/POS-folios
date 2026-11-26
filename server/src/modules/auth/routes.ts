import { Router, type RequestHandler } from 'express';
import type { AppConfig } from '../../config/env.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { sendData } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Auth module routes (R2.4b): first-run setup, sign-in, the current user and
 * sign-out. Same paths and response shapes as the legacy routes they replace.
 * status, register and login are public (rate limited); me and logout need a
 * session. Mounted first in createApp().
 */
export interface AuthRouterContext {
  config: AppConfig;
  limiters: { setup: RequestHandler; login: RequestHandler };
}

type Body = Record<string, unknown>;

export function createAuthRouter({ config, limiters }: AuthRouterContext): Router {
  const router = Router();

  router.get('/api/auth/status', async (_req, res) => {
    res.json(await service.status(config.setupToken));
  });

  router.post('/api/auth/register', limiters.setup, async (req, res) => {
    res.status(201).json(await service.setupFirstAdmin(req.body as Body, config.setupToken));
  });

  router.post('/api/auth/login', limiters.login, async (req, res) => {
    res.json(await service.login(req.body as Body));
  });

  router.get('/api/auth/me', requireAuth(), (_req, res) => {
    res.json({ user: res.locals.authUser });
  });

  router.post('/api/auth/logout', requireAuth(), async (_req, res) => {
    await service.logout(String(res.locals.authToken ?? ''));
    res.json({ ok: true });
  });

  // ------------------------------------------------------- API v1 (R2.5c)
  // The same services and the same rate limiters (one counter for both paths,
  // so switching path does not reset it). Sessions stay Bearer until R2.6.
  router.get('/api/v1/auth/status', async (_req, res) => {
    sendData(res, await service.status(config.setupToken));
  });

  router.post('/api/v1/auth/setup', limiters.setup, async (req, res) => {
    sendData(res, await service.setupFirstAdmin(req.body as Body, config.setupToken), 201);
  });

  router.post('/api/v1/auth/login', limiters.login, async (req, res) => {
    sendData(res, await service.login(req.body as Body));
  });

  router.get('/api/v1/auth/me', requireAuth(), (_req, res) => {
    sendData(res, res.locals.authUser);
  });

  router.post('/api/v1/auth/logout', requireAuth(), async (_req, res) => {
    await service.logout(String(res.locals.authToken ?? ''));
    res.status(204).end();
  });

  return router;
}
