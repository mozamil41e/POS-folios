/**
 * Legacy API routes (R2.1). The route code of the former server.ts, moved
 * here unchanged except for: Express 5 (no asyncHandler wrapper), the router
 * instead of the app.
 * Strangler: R2.4 moved each domain out into server/src/modules/<domain>:
 * products/inventory (R2.4a), then auth, users/roles, settings, customers,
 * suppliers, purchases, vouchers and sales (R2.4b). What is left, the public
 * invoice page and the workspace bootstrap, moves next; then this file goes.
 */
import { Router, type Request, type Response } from 'express';
import {
  getAllCategories,
  getAllProducts,
  getPublicInvoiceByUuid,
  getRecentMovements,
} from '../../../src/server/db.ts';
import { canViewData, type VisibleDataKey } from '../../../shared/permissions.ts';
import { scopeForUser } from '../../../src/server/visibility.ts';
import { lists as customersLists } from '../modules/customers/service.ts';
import { lists as purchasesLists } from '../modules/purchases/service.ts';
import { lists as salesLists } from '../modules/sales/service.ts';
import { getSettings } from '../modules/settings/service.ts';
import { lists as suppliersLists } from '../modules/suppliers/service.ts';
import { lists as usersLists } from '../modules/users/service.ts';
import { lists as vouchersLists } from '../modules/vouchers/service.ts';
import { noIndex, type RateLimiters } from '../../../src/server/security.ts';
import type { AuthUser } from '../../../shared/types.ts';
import { requireAuth } from '../middleware/auth.ts';

export interface LegacyContext {
  limiters: RateLimiters;
}

export function createLegacyRouter({ limiters }: LegacyContext): Router {
  const router = Router();

  // Public read-only invoice lookup (used by thermal receipt QR public URL).
  // Rate limited and not indexed (R1.9); the payload is an allowlist (db.ts).
  router.get('/api/public/invoices/:uuid', noIndex, limiters.publicInvoice, (req: Request, res: Response) => {
    const uuid = String(req.params.uuid ?? '').trim();
    if (!uuid || uuid.length > 80) {
      res.status(400).json({ error: 'Invalid invoice identifier.' });
      return;
    }
    const payload = getPublicInvoiceByUuid(uuid);
    if (!payload) {
      res.status(404).json({ error: 'Invoice not found.' });
      return;
    }
    res.json(payload);
  });

  // Require valid Bearer session token for all private /api routes
  // (server/src/middleware/auth.ts; the modules use the same checks, R2.4a).
  router.use('/api', requireAuth());

  // Bootstrap the workspace — only the data this user may read (R1.3).
  router.get('/api/bootstrap', async (_req: Request, res: Response) => {
    const authUser = res.locals.authUser as AuthUser;
    const can = (key: VisibleDataKey) => canViewData(authUser, key);
    const canManageUsers = authUser.permissions.includes('users.manage');
    res.json(
      scopeForUser(authUser, {
        settings: await getSettings(),
        products: can('products') ? getAllProducts() : undefined,
        categories: can('categories') ? getAllCategories() : undefined,
        customers: can('customers') ? await customersLists.customers() : undefined,
        suppliers: can('suppliers') ? await suppliersLists.suppliers() : undefined,
        purchases: can('purchases') ? await purchasesLists.purchases() : undefined,
        invoices: can('invoices') ? await salesLists.invoices() : undefined,
        movements: can('movements') ? getRecentMovements(80) : undefined,
        heldCarts: can('heldCarts') ? await salesLists.heldCarts() : undefined,
        vouchers: can('vouchers') ? await vouchersLists.vouchers() : undefined,
        ...(canManageUsers ? { users: await usersLists.users(), roles: await usersLists.roles() } : {}),
      })
    );
  });

  return router;
}
