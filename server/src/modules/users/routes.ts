import { Router } from 'express';
import type { AuthUser } from '../../../../shared/types.ts';
import { requireAuth, requirePermission } from '../../middleware/auth.ts';
import { resolveAuthUserById } from '../auth/service.ts';
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

  return router;
}
