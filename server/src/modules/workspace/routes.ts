import { Router } from 'express';
import { canViewData, type VisibleDataKey } from '../../../../shared/permissions.ts';
import type { AuthUser } from '../../../../shared/types.ts';
import { scopeForUser } from '../../../../src/server/visibility.ts';
import { requireAuth } from '../../middleware/auth.ts';
import { lists as customers } from '../customers/service.ts';
import { lists as inventory } from '../inventory/service.ts';
import { lists as purchases } from '../purchases/service.ts';
import { lists as sales } from '../sales/service.ts';
import { getSettings } from '../settings/service.ts';
import { lists as suppliers } from '../suppliers/service.ts';
import { lists as users } from '../users/service.ts';
import { lists as vouchers } from '../vouchers/service.ts';

/**
 * The workspace bootstrap (R1.3, a module since R2.4b): everything the UI
 * loads after sign-in, but only the lists this user may read. Each list is
 * read only when the user may see it; scopeForUser() also hides cost prices
 * (D11) and keeps settings to their public fields. Same keys and contents as
 * before. R2.5 replaces it with one read endpoint per resource.
 */
export function createWorkspaceRouter(): Router {
  const router = Router();

  router.get('/api/bootstrap', requireAuth(), async (_req, res) => {
    const authUser = res.locals.authUser as AuthUser;
    const can = (key: VisibleDataKey) => canViewData(authUser, key);
    const canManageUsers = authUser.permissions.includes('users.manage');
    res.json(
      scopeForUser(authUser, {
        settings: await getSettings(),
        products: can('products') ? await inventory.products() : undefined,
        categories: can('categories') ? await inventory.categories() : undefined,
        customers: can('customers') ? await customers.customers() : undefined,
        suppliers: can('suppliers') ? await suppliers.suppliers() : undefined,
        purchases: can('purchases') ? await purchases.purchases() : undefined,
        invoices: can('invoices') ? await sales.invoices() : undefined,
        movements: can('movements') ? await inventory.movements() : undefined,
        heldCarts: can('heldCarts') ? await sales.heldCarts() : undefined,
        vouchers: can('vouchers') ? await vouchers.vouchers() : undefined,
        ...(canManageUsers ? { users: await users.users(), roles: await users.roles() } : {}),
      })
    );
  });

  return router;
}
