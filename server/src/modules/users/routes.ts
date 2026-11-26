import { Router } from 'express';
import type { AuthUser } from '../../../../shared/types.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { resolveAuthUserById } from '../auth/service.ts';
import { sendAll, sendData } from '../../shared/respond.ts';
import * as service from './service.ts';

/**
 * Users and roles module routes (R2.4b). Same paths and response shapes as the
 * legacy routes they replace (the UI did not change). Every route needs
 * users.manage.
 */
type Body = Record<string, unknown>;

export function createUsersRouter(): Router {
  const router = Router();
  const manage = [requireAuth(), requirePermission('users.manage')];
  const { lists } = service;
  const actorOf = (locals: Record<string, unknown>) => locals.authUser as AuthUser;

  // ---------------------------------------------------------------- users
  router.get('/api/users', ...manage, async (_req, res) => {
    res.json({ users: await lists.users(), roles: await lists.roles() });
  });

  router.post('/api/users', ...manage, async (req, res) => {
    const userId = await service.createUser(req.body as Body);
    res.status(201).json({ userId, users: await lists.users(), roles: await lists.roles() });
  });

  router.put('/api/users/:id', ...manage, async (req, res) => {
    const currentUser = await service.updateUser(Number(req.params.id), req.body as Body, actorOf(res.locals));
    res.json({ users: await lists.users(), roles: await lists.roles(), currentUser });
  });

  router.delete('/api/users/:id', ...manage, async (req, res) => {
    await service.deleteUser(Number(req.params.id), actorOf(res.locals));
    res.json({ users: await lists.users(), roles: await lists.roles() });
  });

  // ---------------------------------------------------------------- roles
  router.get('/api/roles', ...manage, async (_req, res) => {
    res.json({ roles: await lists.roles() });
  });

  router.post('/api/roles', ...manage, async (req, res) => {
    const id = await service.createRole(req.body as Body);
    res.status(201).json({ role: await lists.role(id), roles: await lists.roles() });
  });

  router.put('/api/roles/:id', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    await service.updateRole(id, req.body as Body);
    res.json({
      role: await lists.role(id),
      roles: await lists.roles(),
      users: await lists.users(),
      // The editor's own permissions may have changed with the role.
      currentUser: await resolveAuthUserById(actorOf(res.locals).id),
    });
  });

  router.delete('/api/roles/:id', ...manage, async (req, res) => {
    await service.deleteRole(Number(req.params.id));
    res.json({ roles: await lists.roles() });
  });

  // ------------------------------------------------ API v1 reads (R2.5b)
  router.get('/api/v1/users', ...manage, async (_req, res) => {
    sendAll(res, await lists.users());
  });

  router.get('/api/v1/roles', ...manage, async (_req, res) => {
    sendAll(res, await lists.roles());
  });

  // ----------------------------------------------- API v1 writes (R2.5c)
  // Each answers with the affected account or role only.
  router.post('/api/v1/users', ...manage, async (req, res) => {
    const id = await service.createUser(req.body as Body);
    sendData(res, await lists.user(id), 201);
  });

  // PATCH: what is not sent keeps its value. The current PUT always takes the
  // name and phone from the request, so they are filled in from the account.
  router.patch('/api/v1/users/:id', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    const current = await lists.user(id);
    const body = { full_name: current?.full_name, phone: current?.phone, ...(req.body as Body) };
    await service.updateUser(id, body, actorOf(res.locals));
    sendData(res, await lists.user(id));
  });

  router.delete('/api/v1/users/:id', ...manage, async (req, res) => {
    await service.deleteUser(Number(req.params.id), actorOf(res.locals));
    res.status(204).end();
  });

  router.post('/api/v1/roles', ...manage, async (req, res) => {
    const id = await service.createRole(req.body as Body);
    sendData(res, await lists.role(id), 201);
  });

  router.patch('/api/v1/roles/:id', ...manage, async (req, res) => {
    const id = Number(req.params.id);
    await service.updateRole(id, req.body as Body);
    sendData(res, await lists.role(id));
  });

  router.delete('/api/v1/roles/:id', ...manage, async (req, res) => {
    await service.deleteRole(Number(req.params.id));
    res.status(204).end();
  });

  return router;
}
