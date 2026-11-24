import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import {
  createSessionForUser,
  db,
  getAllCustomers,
  getAllInvoices,
  getAllProducts,
  getAllPurchases,
  getAllRoles,
  getAllSuppliers,
  getAllUsers,
  getAllVouchers,
  getHeldCarts,
  getOrganizationSettings,
  getPublicInvoiceByUuid,
  getRecentMovements,
  getRoleById,
  getRoleBySlug,
  getUserBySessionToken,
  hasAnyUsers,
  hashPassword,
  initDatabase,
  resolveAuthUserById,
  revokeAllSessionsForUser,
  revokeSessionToken,
  verifyPassword,
} from './src/server/db.ts';
import {
  ALL_PERMISSION_KEYS,
  canViewData,
  sanitizePermissions,
  type VisibleDataKey,
} from './src/permissions.ts';
import { scopeForUser } from './src/server/visibility.ts';
import { isValidPasswordLength, isValidVatNumber } from './src/validation.ts';
import { nextDocumentNumber } from './src/server/sequences.ts';
import {
  clearLoginFailures,
  loginLockRemainingMs,
  recordLoginFailure,
} from './src/server/login-guard.ts';
import {
  InputError,
  parseCustomerInput,
  parseMovementInput,
  parseOpeningStock,
  parseProductInput,
  parseSupplierInput,
} from './src/server/input-rules.ts';
import {
  contentSecurityPolicy,
  createRateLimiters,
  noIndex,
  resolveTrustProxy,
  securityHeaders,
} from './src/server/security.ts';
import type {
  AuthUser,
  Customer,
  FontSizeLevel,
  Invoice,
  InvoiceItem,
  InvoiceSubtype,
  InvoiceTypeCode,
  PaymentMethod,
  PermissionKey,
  Product,
  Purchase,
  PurchasePaymentStatus,
  Supplier,
  VoucherChannel,
  VoucherType,
} from './src/types.ts';

initDatabase();

// Production = NODE_ENV=production or running the compiled bundle (npm start).
const currentFile = fileURLToPath(import.meta.url);
const isCompiledEntry =
  path.basename(currentFile) === 'server.js' ||
  path.basename(process.argv[1] || '') === 'server.js';
const isProduction = process.env.NODE_ENV === 'production' || isCompiledEntry;

const app = express();
// Client IPs come from Hostinger's proxy (X-Forwarded-For); see security.ts (SEC-22).
app.set('trust proxy', resolveTrustProxy(process.env.TRUST_PROXY, isProduction));
app.use(securityHeaders);
app.use(express.json({ limit: '2mb' }));
const limiters = createRateLimiters();

const PASSWORD_LENGTH_ERROR = 'Password must be between 8 and 128 characters.';

// Express 4 does not catch rejected promises from async handlers: an error there
// would be an unhandled rejection and crash the whole process (R1.5, SEC-08).
// This forwards it to the central error handler. Express 5 (R2.1) makes it unnecessary.
type AsyncRoute = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const asyncHandler =
  (fn: AsyncRoute) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };

// Business errors thrown inside transactions as Error('CODE') or Error('CODE:detail').
// Only these are reported to the client as 400; anything else is a 500 (R1.5, SEC-10).
function knownErrorCode(err: unknown, known: ReadonlySet<string>): string | null {
  if (!(err instanceof Error)) return null;
  const code = err.message.split(':')[0];
  return known.has(code) ? code : null;
}

// Public read-only invoice lookup (used by thermal receipt QR public URL).
// Rate limited and not indexed (R1.9); the payload is an allowlist (db.ts).
app.get('/api/public/invoices/:uuid', noIndex, limiters.publicInvoice, (req: Request, res: Response) => {
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

// Public Authentication Routes
app.get('/api/auth/status', (_req: Request, res: Response) => {
  res.json({
    hasUsers: hasAnyUsers(),
    setupTokenRequired: Boolean(process.env.SETUP_TOKEN),
  });
});

// When SETUP_TOKEN is configured (always in production), first-run setup must
// present it. Without it (local development) setup stays open on an empty DB.
function setupTokenMatches(provided: unknown): boolean {
  const expected = process.env.SETUP_TOKEN;
  if (!expected) return true;
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const REGISTRATION_CLOSED_RESPONSE = {
  error: 'Registration is closed. Ask an administrator to create your account.',
  code: 'REGISTRATION_CLOSED',
};

// First-run setup only (SEC-01): creates the first administrator while the
// users table is empty. Afterwards accounts are created by an admin via /api/users.
app.post('/api/auth/register', limiters.setup, asyncHandler(async (req: Request, res: Response) => {
  if (hasAnyUsers()) {
    res.status(403).json(REGISTRATION_CLOSED_RESPONSE);
    return;
  }

  const b = req.body as Record<string, unknown>;
  if (!setupTokenMatches(b.setup_token)) {
    res.status(403).json({ error: 'Invalid setup token.', code: 'INVALID_SETUP_TOKEN' });
    return;
  }

  const fullName = String(b.full_name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';

  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (!isValidPasswordLength(password)) {
    res.status(400).json({ error: PASSWORD_LENGTH_ERROR, code: 'PASSWORD_TOO_SHORT' });
    return;
  }

  // Hashed before the transaction: better-sqlite3 transactions cannot await.
  const passwordHash = await hashPassword(password);

  try {
    const registerTx = db.transaction(() => {
      // Re-checked inside the transaction so two simultaneous setup requests
      // cannot both create an account.
      const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
      if (countRow.cnt > 0) {
        throw new Error('REGISTRATION_CLOSED');
      }

      const targetSlug = 'admin';
      const targetRole = getRoleBySlug(targetSlug);
      const now = new Date().toISOString();

      const info = db
        .prepare(`
          INSERT INTO users (full_name, email, phone, password_hash, role, role_id, is_active, last_login_at, created_at)
          VALUES (?, ?, '', ?, ?, ?, 1, ?, ?)
        `)
        .run(
          fullName,
          email,
          passwordHash,
          targetRole?.slug ?? targetSlug,
          targetRole?.id ?? null,
          now,
          now
        );

      const userId = Number(info.lastInsertRowid);
      const session = createSessionForUser(userId);
      const authUser = resolveAuthUserById(userId);
      return {
        token: session.token,
        user: authUser,
      };
    });

    const result = registerTx();
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof Error && err.message === 'REGISTRATION_CLOSED') {
      res.status(403).json(REGISTRATION_CLOSED_RESPONSE);
      return;
    }
    res.status(400).json({ error: 'Failed to create account.' });
  }
}));

function sendLoginLocked(res: Response, retryAfterMs: number): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  res.setHeader('Retry-After', String(retryAfterSeconds));
  res.status(429).json({
    error: 'Too many failed sign-in attempts. Sign-in is paused for this account.',
    code: 'LOGIN_LOCKED',
    retryAfterSeconds,
  });
}

// Compared against when the email is unknown, so both cases take the same
// time and the response does not reveal which emails have accounts.
let timingDummyHash: Promise<string> | null = null;
const dummyPasswordHash = () => (timingDummyHash ??= hashPassword(crypto.randomUUID()));

app.post('/api/auth/login', limiters.login, asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const email = String(b.email ?? '').trim().toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  // R1.9 (SEC-05): while locked, even the right password is refused.
  const lockedForMs = loginLockRemainingMs(db, email);
  if (lockedForMs > 0) {
    sendLoginLocked(res, lockedForMs);
    return;
  }

  const user = db
    .prepare('SELECT id, password_hash, is_active FROM users WHERE email = ?')
    .get(email) as
    | {
        id: number;
        password_hash: string;
        is_active: number;
      }
    | undefined;

  const passwordOk = await verifyPassword(password, user?.password_hash ?? (await dummyPasswordHash()));
  if (!user || !passwordOk) {
    const failure = recordLoginFailure(db, email);
    if (failure.locked) {
      sendLoginLocked(res, failure.retryAfterMs);
      return;
    }
    res.status(401).json({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
      attemptsLeft: failure.attemptsLeft,
    });
    return;
  }

  clearLoginFailures(db, email);

  if (user.is_active === 0) {
    res.status(403).json({
      error: 'This account has been deactivated by an administrator.',
    });
    return;
  }

  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    user.id
  );
  const session = createSessionForUser(user.id);
  const authUser = resolveAuthUserById(user.id);
  res.json({
    token: session.token,
    user: authUser,
  });
}));

// Require valid Bearer session token for all private /api routes
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const user = getUserBySessionToken(token);
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  res.locals.authUser = user;
  res.locals.authToken = token;
  next();
});

function requirePermission(permission: PermissionKey) {
  return (_req: Request, res: Response, next: NextFunction) => {
    const authUser = res.locals.authUser as AuthUser | undefined;
    if (!authUser || authUser.is_active === 0 || !authUser.permissions.includes(permission)) {
      res.status(403).json({
        error: 'You do not have permission to perform this action.',
      });
      return;
    }
    next();
  };
}

// Every authenticated response that carries workspace data (lists, settings)
// goes through the read-scope filter (R1.3): no unreadable lists, no secrets,
// no cost prices for users without cost permission.
function sendScoped(res: Response, payload: Record<string, unknown>): void {
  res.json(scopeForUser(res.locals.authUser as AuthUser, payload));
}

app.get('/api/auth/me', (_req: Request, res: Response) => {
  res.json({ user: res.locals.authUser });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  const token = String(res.locals.authToken ?? '');
  revokeSessionToken(token);
  res.json({ ok: true });
});

// Bootstrap the workspace — only the data this user may read (R1.3).
app.get('/api/bootstrap', (_req: Request, res: Response) => {
  const authUser = res.locals.authUser as AuthUser;
  const can = (key: VisibleDataKey) => canViewData(authUser, key);
  const canManageUsers = authUser.permissions.includes('users.manage');
  res.json(
    scopeForUser(authUser, {
      settings: getOrganizationSettings(),
      products: can('products') ? getAllProducts() : undefined,
      customers: can('customers') ? getAllCustomers() : undefined,
      suppliers: can('suppliers') ? getAllSuppliers() : undefined,
      purchases: can('purchases') ? getAllPurchases() : undefined,
      invoices: can('invoices') ? getAllInvoices() : undefined,
      movements: can('movements') ? getRecentMovements(80) : undefined,
      heldCarts: can('heldCarts') ? getHeldCarts() : undefined,
      vouchers: can('vouchers') ? getAllVouchers() : undefined,
      ...(canManageUsers ? { users: getAllUsers(), roles: getAllRoles() } : {}),
    })
  );
});

// Users & Roles Management (RBAC)
app.get('/api/users', requirePermission('users.manage'), (_req: Request, res: Response) => {
  res.json({
    users: getAllUsers(),
    roles: getAllRoles(),
  });
});

app.post('/api/users', requirePermission('users.manage'), asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const fullName = String(b.full_name ?? '').trim();
  const email = String(b.email ?? '').trim().toLowerCase();
  const phone = String(b.phone ?? '').trim().slice(0, 30);
  const password = typeof b.password === 'string' ? b.password : '';
  const roleId = Number(b.role_id ?? 0);
  const isActive = b.is_active === false || b.is_active === 0 ? 0 : 1;

  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (!isValidPasswordLength(password)) {
    res.status(400).json({ error: PASSWORD_LENGTH_ERROR, code: 'PASSWORD_TOO_SHORT' });
    return;
  }

  const targetRole = getRoleById(roleId);
  if (!targetRole) {
    res.status(400).json({ error: 'Selected role does not exist.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }

  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  // Re-checked after the await: another request may have used the email meanwhile.
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    res.status(409).json({ error: 'An account with this email already exists.' });
    return;
  }
  // Failures recorded before the account existed must not carry over.
  clearLoginFailures(db, email);
  const info = db
    .prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role, role_id, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(fullName, email, phone, passwordHash, targetRole.slug, targetRole.id, isActive, now);

  res.status(201).json({
    userId: Number(info.lastInsertRowid),
    users: getAllUsers(),
    roles: getAllRoles(),
  });
}));

app.put('/api/users/:id', requirePermission('users.manage'), asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const authUser = res.locals.authUser as AuthUser;
  const existing = db
    .prepare('SELECT id, email, role, role_id, is_active FROM users WHERE id = ?')
    .get(id) as
    | { id: number; email: string; role: string; role_id: number | null; is_active: number }
    | undefined;

  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  const fullName = String(b.full_name ?? '').trim();
  const email = String(b.email ?? existing.email).trim().toLowerCase();
  const phone = String(b.phone ?? '').trim().slice(0, 30);
  const password = typeof b.password === 'string' ? b.password : '';
  const roleId = Number(b.role_id ?? existing.role_id ?? 0);
  const nextActive =
    b.is_active === undefined ? existing.is_active : b.is_active === false || b.is_active === 0 ? 0 : 1;

  if (fullName.length < 2 || fullName.length > 100) {
    res.status(400).json({ error: 'Full name must be between 2 and 100 characters.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
    res.status(400).json({ error: 'Valid email address is required.' });
    return;
  }
  if (password && !isValidPasswordLength(password)) {
    res.status(400).json({ error: PASSWORD_LENGTH_ERROR, code: 'PASSWORD_TOO_SHORT' });
    return;
  }

  const targetRole = getRoleById(roleId);
  if (!targetRole) {
    res.status(400).json({ error: 'Selected role does not exist.' });
    return;
  }

  const dupEmail = db
    .prepare('SELECT id FROM users WHERE email = ? AND id != ?')
    .get(email, id);
  if (dupEmail) {
    res.status(409).json({ error: 'Another account already uses this email.' });
    return;
  }

  // Safeguard: cannot deactivate self or remove the last active admin
  if (id === authUser.id && nextActive === 0) {
    res.status(400).json({ error: 'You cannot deactivate your own active account.' });
    return;
  }

  const existingRole = existing.role_id ? getRoleById(existing.role_id) : null;
  const wasManagerAdmin =
    existingRole?.permissions.includes('users.manage') || existing.role === 'admin';
  const willKeepManagerAdmin = targetRole.permissions.includes('users.manage') && nextActive === 1;

  if (wasManagerAdmin && !willKeepManagerAdmin) {
    const adminManagers = db
      .prepare(`
        SELECT u.id, COALESCE(r.permissions_json, '[]') as permissions_json, u.role
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.is_active = 1 AND u.id != ?
      `)
      .all(id) as Array<{ id: number; permissions_json: string; role: string }>;

    const anotherAdminExists = adminManagers.some((u) => {
      if (u.role === 'admin') return true;
      try {
        return sanitizePermissions(JSON.parse(u.permissions_json)).includes('users.manage');
      } catch {
        return false;
      }
    });

    if (!anotherAdminExists) {
      res.status(400).json({
        error: 'Cannot demote or deactivate the last active user administrator.',
      });
      return;
    }
  }

  // Hashed before any write, so a failure cannot leave a half-updated user.
  const newPasswordHash = password ? await hashPassword(password) : null;

  db.transaction(() => {
    db.prepare(`
      UPDATE users
      SET full_name = ?, email = ?, phone = ?, role = ?, role_id = ?, is_active = ?
      WHERE id = ?
    `).run(fullName, email, phone, targetRole.slug, targetRole.id, nextActive, id);

    if (newPasswordHash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, id);
      // An administrator setting a new password also lifts a lockout (R1.9).
      clearLoginFailures(db, existing.email, email);
    }
  })();

  if (nextActive === 0 || password) {
    revokeAllSessionsForUser(id);
  }

  res.json({
    users: getAllUsers(),
    roles: getAllRoles(),
    currentUser: id === authUser.id ? resolveAuthUserById(authUser.id) : undefined,
  });
}));

app.delete('/api/users/:id', requirePermission('users.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const authUser = res.locals.authUser as AuthUser;
  if (id === authUser.id) {
    res.status(400).json({ error: 'You cannot delete your own account.' });
    return;
  }

  const existing = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
  if (!existing) {
    res.status(404).json({ error: 'User not found.' });
    return;
  }

  revokeAllSessionsForUser(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);

  res.json({
    users: getAllUsers(),
    roles: getAllRoles(),
  });
});

app.get('/api/roles', requirePermission('users.manage'), (_req: Request, res: Response) => {
  res.json({ roles: getAllRoles() });
});

app.post('/api/roles', requirePermission('users.manage'), (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const nameAr = String(b.name_ar ?? '').trim();
  const nameEn = String(b.name_en ?? '').trim() || nameAr;
  const descAr = String(b.description_ar ?? '').trim();
  const descEn = String(b.description_en ?? '').trim() || descAr;
  const permissions = sanitizePermissions(b.permissions);

  if (nameAr.length < 2 || nameAr.length > 60) {
    res.status(400).json({ error: 'Role name must be between 2 and 60 characters.' });
    return;
  }

  const baseSlug = nameEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'custom_role';
  const slug = `${baseSlug}_${crypto.randomBytes(2).toString('hex')}`;
  const now = new Date().toISOString();

  const info = db
    .prepare(`
      INSERT INTO roles (
        slug, name_ar, name_en, description_ar, description_en,
        permissions_json, is_system, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `)
    .run(slug, nameAr, nameEn, descAr, descEn, JSON.stringify(permissions), now);

  res.status(201).json({
    role: getRoleById(Number(info.lastInsertRowid)),
    roles: getAllRoles(),
  });
});

app.put('/api/roles/:id', requirePermission('users.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const authUser = res.locals.authUser as AuthUser;
  const role = getRoleById(id);
  if (!role) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }

  const b = req.body as Record<string, unknown>;
  const nameAr = String(b.name_ar ?? role.name_ar).trim();
  const nameEn = String(b.name_en ?? role.name_en).trim() || nameAr;
  const descAr = String(b.description_ar ?? role.description_ar).trim();
  const descEn = String(b.description_en ?? role.description_en).trim();

  if (nameAr.length < 2 || nameAr.length > 60) {
    res.status(400).json({ error: 'Role name must be between 2 and 60 characters.' });
    return;
  }

  const nextPermissions =
    role.slug === 'admin'
      ? [...ALL_PERMISSION_KEYS]
      : b.permissions === undefined
      ? role.permissions
      : sanitizePermissions(b.permissions);

  db.prepare(`
    UPDATE roles
    SET name_ar = ?, name_en = ?, description_ar = ?, description_en = ?, permissions_json = ?
    WHERE id = ?
  `).run(nameAr, nameEn, descAr, descEn, JSON.stringify(nextPermissions), id);

  res.json({
    role: getRoleById(id),
    roles: getAllRoles(),
    users: getAllUsers(),
    currentUser: resolveAuthUserById(authUser.id),
  });
});

app.delete('/api/roles/:id', requirePermission('users.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const role = getRoleById(id);
  if (!role) {
    res.status(404).json({ error: 'Role not found.' });
    return;
  }
  if (role.is_system === 1 || role.slug === 'admin') {
    res.status(400).json({ error: 'System administrator role cannot be deleted.' });
    return;
  }
  if ((role.users_count ?? 0) > 0) {
    res.status(400).json({
      error: 'Reassign users from this role before deleting it.',
    });
    return;
  }

  db.prepare('DELETE FROM roles WHERE id = ?').run(id);
  res.json({ roles: getAllRoles() });
});

app.post('/api/vouchers', requirePermission('vouchers.manage'), (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const voucherType: VoucherType = b.voucher_type === 'payment' ? 'payment' : 'receipt';
  const paymentChannel: VoucherChannel = b.payment_channel === 'bank' ? 'bank' : 'cash';
  const partyName = String(b.party_name ?? '').trim();
  const category = String(b.category ?? '').trim();
  const notes = String(b.notes ?? '').trim();
  const amount = Number(b.amount ?? 0);
  const rawDate = String(b.voucher_date ?? '').trim();
  const voucherDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate
    : new Date().toISOString().slice(0, 10);

  if (!partyName) {
    res.status(400).json({ error: 'Party or description name is required.' });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({ error: 'Voucher amount must be greater than zero.' });
    return;
  }

  const now = new Date().toISOString();

  // Number and row are written in one transaction (R1.8): no duplicates, no gaps on failure.
  const voucherId = db.transaction(() => {
    const voucherNumber = nextDocumentNumber(db, voucherType === 'receipt' ? 'RCV' : 'PAY');
    const info = db
      .prepare(`
        INSERT INTO vouchers (
          voucher_number, voucher_type, payment_channel, party_name, category,
          amount, notes, voucher_date, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        voucherNumber,
        voucherType,
        paymentChannel,
        partyName,
        category || (voucherType === 'receipt' ? 'إيرادات أخرى' : 'مصروفات تشغيلية'),
        Number(amount.toFixed(2)),
        notes,
        voucherDate,
        now
      );
    return Number(info.lastInsertRowid);
  })();

  const vouchers = getAllVouchers();
  res.status(201).json({
    voucher: vouchers.find((v) => v.id === voucherId),
    vouchers,
  });
});

// Financial vouchers are never deleted (R1.8, SEC-17): they are voided with a reason.
app.delete('/api/vouchers/:id', requirePermission('vouchers.manage'), (_req: Request, res: Response) => {
  res.status(405).json({
    error: 'Vouchers cannot be deleted. Void the voucher with a reason instead.',
    code: 'VOUCHER_DELETE_NOT_ALLOWED',
  });
});

app.post('/api/vouchers/:id/void', requirePermission('vouchers.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const authUser = res.locals.authUser as AuthUser;
  const reason = String((req.body as Record<string, unknown>).reason ?? '').trim();

  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: 'Invalid voucher ID.', code: 'INVALID_ID' });
    return;
  }
  if (reason.length < 3 || reason.length > 300) {
    res.status(400).json({
      error: 'A reason of 3 to 300 characters is required to void a voucher.',
      code: 'VOID_REASON_REQUIRED',
    });
    return;
  }

  const voucher = db.prepare('SELECT id, status FROM vouchers WHERE id = ?').get(id) as
    | { id: number; status: string }
    | undefined;
  if (!voucher) {
    res.status(404).json({ error: 'Voucher not found.', code: 'NOT_FOUND' });
    return;
  }
  if (voucher.status === 'void') {
    res.status(409).json({ error: 'This voucher is already void.', code: 'ALREADY_VOID' });
    return;
  }

  db.prepare(`
    UPDATE vouchers SET status = 'void', void_reason = ?, voided_at = ?, voided_by = ? WHERE id = ?
  `).run(reason, new Date().toISOString(), authUser.id, id);

  const vouchers = getAllVouchers();
  res.json({ voucher: vouchers.find((v) => v.id === id), vouchers });
});

// Organization (store) and thermal-print settings
app.put('/api/settings', requirePermission('settings.manage'), (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const current = getOrganizationSettings();

  const nameAr = String(body.name_ar ?? current.name_ar).trim();
  const nameEn = String(body.name_en ?? current.name_en).trim();
  const vatNumber = String(body.vat_number ?? current.vat_number).trim();
  const crNumber = String(body.cr_number ?? current.cr_number).trim();
  const streetAr = String(body.street_ar ?? current.street_ar).trim();
  const buildingNo = String(body.building_no ?? current.building_no).trim();
  const cityAr = String(body.city_ar ?? current.city_ar).trim();
  const postalCode = String(body.postal_code ?? current.postal_code).trim();
  const thermalWidthMm =
    body.thermal_width_mm === undefined
      ? current.thermal_width_mm
      : Number(body.thermal_width_mm) === 58
      ? 58
      : 80;
  const autoPrintReceipt =
    body.auto_print_receipt === undefined
      ? current.auto_print_receipt
      : body.auto_print_receipt === true ||
        body.auto_print_receipt === 1 ||
        body.auto_print_receipt === '1'
      ? 1
      : 0;
  const fontSize: FontSizeLevel =
    body.font_size === 'small' || body.font_size === 'large'
      ? body.font_size
      : body.font_size === 'medium'
      ? 'medium'
      : current.font_size === 'small' || current.font_size === 'large'
      ? current.font_size
      : 'medium';
  const rawPageSize = Number(body.table_page_size);
  const allowedPageSizes = [5, 10, 20, 50];
  const tablePageSize =
    body.table_page_size === undefined
      ? current.table_page_size || 10
      : allowedPageSizes.includes(rawPageSize)
      ? rawPageSize
      : 10;

  let publicBaseUrl =
    body.public_base_url === undefined
      ? current.public_base_url
      : String(body.public_base_url).trim().replace(/\/+$/, '');

  if (publicBaseUrl) {
    try {
      const parsed = new URL(publicBaseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        res.status(400).json({ error: 'Public Base URL must use http:// or https://' });
        return;
      }
      publicBaseUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '');
    } catch {
      res.status(400).json({ error: 'Invalid Public Base URL format.' });
      return;
    }
  }

  if (!nameAr || !vatNumber) {
    res.status(400).json({ error: 'Store name and VAT number are required.' });
    return;
  }
  // R1.10 (owner approved): the restaurant's own VAT number goes on every receipt.
  if (!isValidVatNumber(vatNumber)) {
    res.status(400).json({
      error: 'VAT number must be 15 digits starting and ending with 3.',
      code: 'VALIDATION_FAILED',
      field: 'vat_number',
      reason: 'INVALID_VAT',
    });
    return;
  }

  db.prepare(`
    UPDATE organization_settings
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?,
        street_ar = ?, building_no = ?, city_ar = ?, postal_code = ?,
        public_base_url = ?,
        thermal_width_mm = ?, auto_print_receipt = ?, font_size = ?, table_page_size = ?
    WHERE id = 1
  `).run(
    nameAr,
    nameEn,
    vatNumber,
    crNumber,
    streetAr,
    buildingNo,
    cityAr,
    postalCode,
    publicBaseUrl,
    thermalWidthMm,
    autoPrintReceipt,
    fontSize,
    tablePageSize
  );

  sendScoped(res, { settings: getOrganizationSettings() });
});

// Product CRUD
const SKU_EXISTS_RESPONSE = { error: 'SKU/Barcode already exists.', code: 'SKU_EXISTS', field: 'sku' };
const skuTaken = (sku: string, exceptId = 0) =>
  Boolean(db.prepare('SELECT id FROM products WHERE sku = ? AND id != ?').get(sku, exceptId));

app.post('/api/products', requirePermission('inventory.manage'), (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  // R1.10 (SEC-19): every field validated; throws InputError -> 400 VALIDATION_FAILED.
  const input = parseProductInput(b);
  const stockQty = parseOpeningStock(b);
  const {
    sku,
    name_ar: nameAr,
    name_en: nameEn,
    category_ar: categoryAr,
    category_en: categoryEn,
    unit_ar: unitAr,
    unit_en: unitEn,
    cost_price: costPrice,
    sell_price: sellPrice,
    tax_rate: taxRate,
    tax_category: taxCategory,
    min_stock_alert: minStockAlert,
    expiry_date: expiryDate,
  } = input;

  if (skuTaken(sku)) {
    res.status(409).json(SKU_EXISTS_RESPONSE);
    return;
  }

  const now = new Date().toISOString();
  try {
    const createTx = db.transaction(() => {
      const info = db
        .prepare(`
          INSERT INTO products (
            sku, name_ar, name_en, category_ar, category_en, unit_ar, unit_en,
            cost_price, sell_price, tax_rate, tax_category, stock_qty, min_stock_alert,
            expiry_date, active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `)
        .run(
          sku,
          nameAr,
          nameEn,
          categoryAr,
          categoryEn,
          unitAr,
          unitEn,
          costPrice,
          sellPrice,
          taxRate,
          taxCategory,
          stockQty,
          minStockAlert,
          expiryDate,
          now,
          now
        );

      if (stockQty > 0) {
        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'purchase', ?, ?, 'NEW-SKU', 'إضافة صنف جديد للمخزون', ?)
        `).run(info.lastInsertRowid, stockQty, stockQty, now);
      }

      return info.lastInsertRowid;
    });

    const id = createTx();
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    sendScoped(res.status(201), {
      product,
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    // Two requests creating the same SKU at once: the UNIQUE index decides.
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      res.status(409).json(SKU_EXISTS_RESPONSE);
      return;
    }
    throw err;
  }
});

app.put('/api/products/:id', requirePermission('inventory.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Product | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Product not found.' });
    return;
  }

  // R1.10 (SEC-19): fields not sent keep their value; stock changes only through movements.
  const input = parseProductInput(req.body as Record<string, unknown>, existing);
  if (skuTaken(input.sku, id)) {
    res.status(409).json(SKU_EXISTS_RESPONSE);
    return;
  }
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE products
    SET sku = ?, name_ar = ?, name_en = ?, category_ar = ?, category_en = ?,
        unit_ar = ?, unit_en = ?, cost_price = ?, sell_price = ?,
        tax_rate = ?, tax_category = ?, min_stock_alert = ?, expiry_date = ?, updated_at = ?
    WHERE id = ?
  `).run(
    input.sku,
    input.name_ar,
    input.name_en,
    input.category_ar,
    input.category_en,
    input.unit_ar,
    input.unit_en,
    input.cost_price,
    input.sell_price,
    input.tax_rate,
    input.tax_category,
    input.min_stock_alert,
    input.expiry_date,
    now,
    id
  );

  sendScoped(res, { products: getAllProducts() });
});

app.delete('/api/products/:id', requirePermission('inventory.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
  sendScoped(res, { products: getAllProducts() });
});

// Inventory movement (purchase / adjustment / return)
app.post('/api/inventory/movement', requirePermission('inventory.adjust'), (req: Request, res: Response) => {
  // R1.10 (SEC-19): validated input; throws InputError -> 400 VALIDATION_FAILED.
  const {
    product_id: productId,
    type,
    qty,
    notes,
    reference_no: referenceNo,
  } = parseMovementInput(req.body as Record<string, unknown>);

  try {
    const moveTx = db.transaction(() => {
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(productId) as Product | undefined;
      if (!product) {
        throw new Error('PRODUCT_NOT_FOUND');
      }

      const delta = type === 'purchase' || type === 'return' ? Math.abs(qty) : qty;
      const newBalance = product.stock_qty + delta;
      // DB-11, owner's option (a): refuse instead of clamping at 0, so the
      // ledger (sum of qty_delta) always equals the stock balance.
      if (newBalance < 0) {
        throw new Error(`INSUFFICIENT_STOCK:${product.stock_qty}`);
      }
      const now = new Date().toISOString();

      db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
        newBalance,
        now,
        product.id
      );

      db.prepare(`
        INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(product.id, type, delta, newBalance, referenceNo, notes, now);
    });

    moveTx();
    sendScoped(res, {
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    if (err instanceof Error && err.message === 'PRODUCT_NOT_FOUND') {
      res.status(404).json({ error: 'Product not found.', code: 'PRODUCT_NOT_FOUND' });
      return;
    }
    if (err instanceof Error && err.message.startsWith('INSUFFICIENT_STOCK:')) {
      const available = Number(err.message.split(':')[1]);
      res.status(400).json({
        error: `Not enough stock: only ${available} available.`,
        code: 'INSUFFICIENT_STOCK',
        field: 'qty',
        available,
      });
      return;
    }
    throw err;
  }
});

// Suppliers & Purchases CRUD
app.post('/api/suppliers', requirePermission('purchases.manage'), (req: Request, res: Response) => {
  // R1.10: name required; VAT number optional but valid when given (D12 format).
  const {
    name_ar: nameAr,
    name_en: nameEn,
    vat_number: vatNumber,
    cr_number: crNumber,
    phone,
    email,
    address_ar: addressAr,
  } = parseSupplierInput(req.body as Record<string, unknown>);

  const info = db
    .prepare(`
      INSERT INTO suppliers (name_ar, name_en, vat_number, cr_number, phone, email, address_ar, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(nameAr, nameEn, vatNumber, crNumber, phone, email, addressAr, new Date().toISOString());

  res.status(201).json({
    supplierId: info.lastInsertRowid,
    suppliers: getAllSuppliers(),
  });
});

app.put('/api/suppliers/:id', requirePermission('purchases.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Supplier not found.' });
    return;
  }

  const input = parseSupplierInput(req.body as Record<string, unknown>, existing);
  db.prepare(`
    UPDATE suppliers
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, phone = ?, email = ?, address_ar = ?
    WHERE id = ?
  `).run(
    input.name_ar,
    input.name_en,
    input.vat_number,
    input.cr_number,
    input.phone,
    input.email,
    input.address_ar,
    id
  );

  res.json({ suppliers: getAllSuppliers() });
});

const PURCHASE_ERROR_CODES: ReadonlySet<string> = new Set([
  'SUPPLIER_NOT_FOUND',
  'PRODUCT_NOT_FOUND',
  'INVALID_PURCHASE_LINE',
]);

app.post('/api/purchases', requirePermission('purchases.manage'), (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const supplierId = Number(b.supplier_id);
  const supplierInvoiceNo = String(b.supplier_invoice_no ?? '').trim();
  const paymentStatus: PurchasePaymentStatus =
    b.payment_status === 'credit' || b.payment_status === 'partial'
      ? (b.payment_status as PurchasePaymentStatus)
      : 'paid';
  const notes = String(b.notes ?? '').trim();
  const rawItems = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];

  if (!supplierId || rawItems.length === 0) {
    res.status(400).json({ error: 'Supplier and at least one line item are required.' });
    return;
  }

  try {
    const createPurchaseTx = db.transaction(() => {
      const supplier = db.prepare('SELECT * FROM suppliers WHERE id = ?').get(supplierId) as
        | Supplier
        | undefined;
      if (!supplier) {
        throw new Error('SUPPLIER_NOT_FOUND');
      }

      const now = new Date().toISOString();
      // Atomic yearly number (R1.8) instead of COUNT(*)+1.
      const purchaseNumber = nextDocumentNumber(db, 'PO');

      let subtotal = 0;
      let vatTotal = 0;
      const preparedItems: Array<{
        product: Product;
        qty: number;
        unitCost: number;
        taxRate: number;
        lineSub: number;
        lineVat: number;
        lineTotal: number;
      }> = [];

      for (const entry of rawItems) {
        const productId = Number(entry.product_id);
        const qty = Math.floor(Number(entry.qty ?? 0));
        const unitCost = Number(entry.unit_cost ?? 0);
        const taxRate = Number(entry.tax_rate ?? 15);
        if (qty <= 0 || Number.isNaN(unitCost) || unitCost < 0) {
          throw new Error('INVALID_PURCHASE_LINE');
        }

        const product = db
          .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
          .get(productId) as Product | undefined;
        if (!product) {
          throw new Error('PRODUCT_NOT_FOUND');
        }

        const lineSub = Number((qty * unitCost).toFixed(2));
        const lineVat = Number((lineSub * (taxRate / 100)).toFixed(2));
        const lineTotal = Number((lineSub + lineVat).toFixed(2));
        subtotal += lineSub;
        vatTotal += lineVat;

        preparedItems.push({
          product,
          qty,
          unitCost,
          taxRate,
          lineSub,
          lineVat,
          lineTotal,
        });
      }

      subtotal = Number(subtotal.toFixed(2));
      vatTotal = Number(vatTotal.toFixed(2));
      const grandTotal = Number((subtotal + vatTotal).toFixed(2));
      const paidAmount =
        paymentStatus === 'paid'
          ? grandTotal
          : paymentStatus === 'partial'
          ? Math.min(grandTotal, Math.max(0, Number(b.paid_amount ?? 0)))
          : 0;

      const poInfo = db
        .prepare(`
          INSERT INTO purchases (
            purchase_number, supplier_id, supplier_name, supplier_vat, supplier_invoice_no,
            payment_status, paid_amount, subtotal, vat_total, grand_total, notes, received_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          purchaseNumber,
          supplier.id,
          supplier.name_ar,
          supplier.vat_number,
          supplierInvoiceNo,
          paymentStatus,
          paidAmount,
          subtotal,
          vatTotal,
          grandTotal,
          notes,
          now,
          now
        );

      const insertItemStmt = db.prepare(`
        INSERT INTO purchase_items (
          purchase_id, product_id, sku, name_ar, name_en, qty, unit_cost, tax_rate,
          line_subtotal, line_vat, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of preparedItems) {
        insertItemStmt.run(
          poInfo.lastInsertRowid,
          item.product.id,
          item.product.sku,
          item.product.name_ar,
          item.product.name_en,
          item.qty,
          item.unitCost,
          item.taxRate,
          item.lineSub,
          item.lineVat,
          item.lineTotal
        );

        const newStock = item.product.stock_qty + item.qty;
        db.prepare(
          'UPDATE products SET stock_qty = ?, cost_price = ?, updated_at = ? WHERE id = ?'
        ).run(newStock, item.unitCost, now, item.product.id);

        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'purchase', ?, ?, ?, ?, ?)
        `).run(
          item.product.id,
          item.qty,
          newStock,
          purchaseNumber,
          `فاتورة مشتريات من ${supplier.name_ar}`,
          now
        );
      }

      return Number(poInfo.lastInsertRowid);
    });

    const purchaseId = createPurchaseTx();
    const purchases = getAllPurchases();
    sendScoped(res.status(201), {
      purchase: purchases.find((p) => p.id === purchaseId),
      purchases,
      products: getAllProducts(),
      movements: getRecentMovements(80),
    });
  } catch (err) {
    const code = knownErrorCode(err, PURCHASE_ERROR_CODES);
    if (code) {
      res.status(400).json({ error: code, code });
      return;
    }
    throw err; // unexpected: central error handler answers 500 without internal details
  }
});

app.post('/api/purchases/:id/pay', requirePermission('purchases.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const purchase = db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as
    | Purchase
    | undefined;
  if (!purchase) {
    res.status(404).json({ error: 'Purchase invoice not found.' });
    return;
  }

  const amount = Number((req.body as Record<string, unknown>).amount ?? 0);
  if (Number.isNaN(amount) || amount <= 0) {
    res.status(400).json({ error: 'Positive payment amount is required.' });
    return;
  }

  const nextPaid = Math.min(purchase.grand_total, Number((purchase.paid_amount + amount).toFixed(2)));
  const nextStatus: PurchasePaymentStatus =
    nextPaid >= purchase.grand_total - 0.01 ? 'paid' : 'partial';

  db.prepare('UPDATE purchases SET paid_amount = ?, payment_status = ? WHERE id = ?').run(
    nextPaid,
    nextStatus,
    id
  );

  sendScoped(res, { purchases: getAllPurchases() });
});

// Customers CRUD for B2B
app.post('/api/customers', requirePermission('customers.manage'), (req: Request, res: Response) => {
  // R1.10: name required; VAT number optional but valid when given (D12 format).
  const {
    name_ar: nameAr,
    name_en: nameEn,
    vat_number: vatNumber,
    cr_number: crNumber,
    address_ar: addressAr,
    phone,
  } = parseCustomerInput(req.body as Record<string, unknown>);

  const now = new Date().toISOString();
  const info = db
    .prepare(`
      INSERT INTO customers (name_ar, name_en, vat_number, cr_number, address_ar, phone, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(nameAr, nameEn, vatNumber, crNumber, addressAr, phone, now);

  res.status(201).json({
    customerId: info.lastInsertRowid,
    customers: getAllCustomers(),
  });
});

app.put('/api/customers/:id', requirePermission('customers.manage'), (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM customers WHERE id = ?').get(id) as Customer | undefined;
  if (!existing) {
    res.status(404).json({ error: 'Customer not found.' });
    return;
  }

  const input = parseCustomerInput(req.body as Record<string, unknown>, existing);
  db.prepare(`
    UPDATE customers
    SET name_ar = ?, name_en = ?, vat_number = ?, cr_number = ?, address_ar = ?, phone = ?
    WHERE id = ?
  `).run(
    input.name_ar,
    input.name_en,
    input.vat_number,
    input.cr_number,
    input.address_ar,
    input.phone,
    id
  );

  res.json({ customers: getAllCustomers() });
});

// Held carts
app.post('/api/carts/hold', requirePermission('pos.hold'), (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const label = String(b.label ?? `طلب معلق #${Date.now().toString().slice(-4)}`).trim();
  const itemsJson = JSON.stringify(Array.isArray(b.items) ? b.items : []);
  const discount = Number(b.discount ?? 0);
  const customerId = b.customer_id ? Number(b.customer_id) : null;
  const invoiceSubtype: InvoiceSubtype =
    b.invoice_subtype === '0100000' ? '0100000' : '0200000';

  db.prepare(`
    INSERT INTO held_carts (label, items_json, discount, customer_id, invoice_subtype, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(label, itemsJson, discount, customerId, invoiceSubtype, new Date().toISOString());

  res.status(201).json({ heldCarts: getHeldCarts() });
});

app.delete('/api/carts/hold/:id', requirePermission('pos.hold'), (req: Request, res: Response) => {
  db.prepare('DELETE FROM held_carts WHERE id = ?').run(Number(req.params.id));
  res.json({ heldCarts: getHeldCarts() });
});

// Atomic POS checkout: price from the DB, deduct stock, issue the sales invoice (388)
const CHECKOUT_ERROR_CODES: ReadonlySet<string> = new Set([
  'INVALID_QTY',
  'PRODUCT_NOT_FOUND',
  'INSUFFICIENT_STOCK',
]);

app.post('/api/invoices', requirePermission('pos.access'), asyncHandler(async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const authUser = res.locals.authUser as AuthUser;
  const rawItems = Array.isArray(b.items) ? (b.items as Array<Record<string, unknown>>) : [];
  const invoiceSubtype: InvoiceSubtype =
    b.invoice_subtype === '0100000' ? '0100000' : '0200000';

  // Sales invoices only (R1.5, SEC-09). Credit notes are issued through
  // POST /api/invoices/:id/credit-note, which links them to the original sale.
  if (b.invoice_type_code !== undefined && b.invoice_type_code !== '388') {
    res.status(400).json({
      error: 'Only sales invoices can be issued here.',
      code: 'INVALID_DOCUMENT_TYPE',
    });
    return;
  }
  const invoiceTypeCode: InvoiceTypeCode = '388';
  const paymentMethod: PaymentMethod =
    b.payment_method === 'card' || b.payment_method === 'split'
      ? (b.payment_method as PaymentMethod)
      : 'cash';
  const discountTotal = Math.max(0, Number(b.discount_total ?? 0));
  const customerId = b.customer_id ? Number(b.customer_id) : null;

  if (discountTotal > 0 && !authUser.permissions.includes('pos.discount')) {
    res.status(403).json({ error: 'You do not have permission to apply discounts.' });
    return;
  }

  if (rawItems.length === 0) {
    res.status(400).json({ error: 'Cart cannot be empty.' });
    return;
  }

  // Customer: an unknown id is an error (it used to fall back to the cash
  // customer silently). A standard tax invoice (B2B) needs a registered customer
  // with a valid VAT number (D12).
  let customerName = 'عميل نقدي / Cash Customer';
  let customerVat = '';
  if (customerId) {
    const cust = db
      .prepare('SELECT name_ar, vat_number FROM customers WHERE id = ?')
      .get(customerId) as { name_ar: string; vat_number: string } | undefined;
    if (!cust) {
      res.status(400).json({ error: 'Customer not found.', code: 'CUSTOMER_NOT_FOUND' });
      return;
    }
    customerName = cust.name_ar;
    customerVat = cust.vat_number.trim();
  }
  if (invoiceSubtype === '0100000') {
    if (!customerId) {
      res.status(400).json({
        error: 'A tax invoice (B2B) requires a registered customer.',
        code: 'CUSTOMER_REQUIRED',
      });
      return;
    }
    if (!isValidVatNumber(customerVat)) {
      res.status(400).json({
        error: 'A tax invoice (B2B) requires the customer to have a valid 15-digit VAT number.',
        code: 'CUSTOMER_VAT_INVALID',
      });
      return;
    }
  }

  try {
    const prepared = db.transaction(() => {
      const now = new Date();
      const createdAt = now.toISOString();
      // Random, unguessable id used by the public invoice link / receipt QR (D1).
      const uuid = crypto.randomUUID();
      // Own yearly sequence (R1.8).
      const invoiceNumber = nextDocumentNumber(db, 'INV');

      const lineItems: InvoiceItem[] = [];
      let rawSubtotal = 0;

      for (const entry of rawItems) {
        const productId = Number(entry.product_id);
        const qty = Math.floor(Number(entry.qty ?? 0));
        if (qty <= 0) {
          throw new Error('INVALID_QTY');
        }

        const product = db
          .prepare('SELECT * FROM products WHERE id = ? AND active = 1')
          .get(productId) as Product | undefined;

        if (!product) {
          throw new Error('PRODUCT_NOT_FOUND');
        }
        if (product.stock_qty < qty) {
          throw new Error(`INSUFFICIENT_STOCK:${product.name_ar}`);
        }

        const newStock = product.stock_qty - qty;
        db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
          newStock,
          createdAt,
          product.id
        );

        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'sale', ?, ?, ?, 'بيع عبر نقطة البيع', ?)
        `).run(product.id, -qty, newStock, invoiceNumber, createdAt);

        const lineSub = Number((product.sell_price * qty).toFixed(2));
        const lineVat = Number((lineSub * (product.tax_rate / 100)).toFixed(2));
        const lineTotal = Number((lineSub + lineVat).toFixed(2));
        rawSubtotal += lineSub;

        lineItems.push({
          product_id: product.id,
          sku: product.sku,
          name_ar: product.name_ar,
          name_en: product.name_en,
          unit_ar: product.unit_ar,
          qty,
          unit_price: product.sell_price,
          discount: 0,
          tax_rate: product.tax_rate,
          tax_category: product.tax_category,
          line_subtotal: lineSub,
          line_vat: lineVat,
          line_total: lineTotal,
        });
      }

      const effectiveDiscount = Math.min(discountTotal, rawSubtotal);
      const discountRatio = rawSubtotal > 0 ? (rawSubtotal - effectiveDiscount) / rawSubtotal : 1;
      const subtotal = Number((rawSubtotal - effectiveDiscount).toFixed(2));
      const vatTotal = Number(
        (lineItems.reduce((sum, item) => sum + item.line_vat, 0) * discountRatio).toFixed(2)
      );
      const grandTotal = Number((subtotal + vatTotal).toFixed(2));

      const cashAmount =
        paymentMethod === 'cash'
          ? grandTotal
          : paymentMethod === 'split'
          ? Math.min(grandTotal, Math.max(0, Number(b.cash_amount ?? 0)))
          : 0;
      const cardAmount =
        paymentMethod === 'card'
          ? grandTotal
          : paymentMethod === 'split'
          ? Number((grandTotal - cashAmount).toFixed(2))
          : 0;

      const invResult = db
        .prepare(`
          INSERT INTO invoices (
            uuid, invoice_number, invoice_type_code, invoice_subtype,
            payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
            subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)
        `)
        .run(
          uuid,
          invoiceNumber,
          invoiceTypeCode,
          invoiceSubtype,
          paymentMethod,
          cashAmount,
          cardAmount,
          customerId,
          customerName,
          customerVat,
          subtotal,
          effectiveDiscount,
          vatTotal,
          grandTotal,
          createdAt
        );

      const insertItemStmt = db.prepare(`
        INSERT INTO invoice_items (
          invoice_id, product_id, sku, name_ar, name_en, unit_ar,
          qty, unit_price, discount, tax_rate, tax_category,
          line_subtotal, line_vat, line_total
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const item of lineItems) {
        insertItemStmt.run(
          invResult.lastInsertRowid,
          item.product_id,
          item.sku,
          item.name_ar,
          item.name_en,
          item.unit_ar,
          item.qty,
          item.unit_price,
          item.discount,
          item.tax_rate,
          item.tax_category,
          item.line_subtotal,
          item.line_vat,
          item.line_total
        );
      }

      return { invoiceId: Number(invResult.lastInsertRowid) };
    });

    // The invoice and its stock movements are committed once prepared() returns.
    // Rule (R1.5): any follow-up step added here must log its failures instead of
    // reporting a failed checkout, or the cashier would sell the same cart again.
    const result = prepared();

    const invoices = getAllInvoices();
    const createdInvoice = invoices.find((i) => i.id === result.invoiceId);

    sendScoped(res.status(201), {
      invoice: createdInvoice,
      settings: getOrganizationSettings(),
      products: getAllProducts(),
      invoices,
      movements: getRecentMovements(80),
    });
  } catch (err) {
    const code = knownErrorCode(err, CHECKOUT_ERROR_CODES);
    if (code) {
      res.status(400).json({ error: (err as Error).message, code });
      return;
    }
    throw err; // unexpected: central error handler answers 500
  }
}));

// Issue a credit note (381) for an existing sales invoice and return its items to stock
app.post('/api/invoices/:id/credit-note', requirePermission('sales.return'), asyncHandler(async (req: Request, res: Response) => {
  const sourceId = Number(req.params.id);
  const sourceInv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(sourceId) as Invoice | undefined;
  if (!sourceInv) {
    res.status(404).json({ error: 'Original invoice not found.' });
    return;
  }
  if (sourceInv.invoice_type_code !== '388') {
    res.status(400).json({ error: 'Credit note can only be issued for a sales invoice.' });
    return;
  }
  const existingCreditNote = db
    .prepare(
      "SELECT invoice_number FROM invoices WHERE invoice_type_code = '381' AND related_invoice_number = ?"
    )
    .get(sourceInv.invoice_number) as { invoice_number: string } | undefined;
  if (existingCreditNote) {
    res.status(400).json({
      error: `Invoice already returned via ${existingCreditNote.invoice_number}.`,
    });
    return;
  }

  const sourceItems = db
    .prepare('SELECT * FROM invoice_items WHERE invoice_id = ?')
    .all(sourceId) as InvoiceItem[];

  const prepared = db.transaction(() => {
    const now = new Date();
    const createdAt = now.toISOString();
    const uuid = crypto.randomUUID();
    // Credit notes have their own sequence (R1.8): they no longer consume invoice numbers.
    const invoiceNumber = nextDocumentNumber(db, 'CN');

    for (const item of sourceItems) {
      const prod = db.prepare('SELECT stock_qty FROM products WHERE id = ?').get(item.product_id) as
        | { stock_qty: number }
        | undefined;
      if (prod) {
        const newQty = prod.stock_qty + item.qty;
        db.prepare('UPDATE products SET stock_qty = ?, updated_at = ? WHERE id = ?').run(
          newQty,
          createdAt,
          item.product_id
        );
        db.prepare(`
          INSERT INTO stock_movements (product_id, type, qty_delta, balance_after, reference_no, notes, created_at)
          VALUES (?, 'return', ?, ?, ?, ?, ?)
        `).run(
          item.product_id,
          item.qty,
          newQty,
          invoiceNumber,
          `إشعار دائن للفاتورة ${sourceInv.invoice_number}`,
          createdAt
        );
      }
    }

    const info = db
      .prepare(`
        INSERT INTO invoices (
          uuid, invoice_number, invoice_type_code, invoice_subtype,
          payment_method, cash_amount, card_amount, customer_id, customer_name, customer_vat,
          subtotal, discount_total, vat_total, grand_total, related_invoice_number, created_at
        ) VALUES (?, ?, '381', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        uuid,
        invoiceNumber,
        sourceInv.invoice_subtype,
        sourceInv.payment_method,
        sourceInv.cash_amount,
        sourceInv.card_amount,
        sourceInv.customer_id,
        sourceInv.customer_name,
        sourceInv.customer_vat,
        sourceInv.subtotal,
        sourceInv.discount_total,
        sourceInv.vat_total,
        sourceInv.grand_total,
        sourceInv.invoice_number,
        createdAt
      );

    const insertItemStmt = db.prepare(`
      INSERT INTO invoice_items (
        invoice_id, product_id, sku, name_ar, name_en, unit_ar,
        qty, unit_price, discount, tax_rate, tax_category,
        line_subtotal, line_vat, line_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const item of sourceItems) {
      insertItemStmt.run(
        info.lastInsertRowid,
        item.product_id,
        item.sku,
        item.name_ar,
        item.name_en,
        item.unit_ar,
        item.qty,
        item.unit_price,
        item.discount,
        item.tax_rate,
        item.tax_category,
        item.line_subtotal,
        item.line_vat,
        item.line_total
      );
    }

    return { invoiceId: Number(info.lastInsertRowid) };
  });

  // Committed once prepared() returns (credit note + restocking). Any follow-up
  // step added later must log its failures, not report a failed credit note (R1.5).
  const result = prepared();

  const invoices = getAllInvoices();
  sendScoped(res.status(201), {
    invoice: invoices.find((i) => i.id === result.invoiceId),
    settings: getOrganizationSettings(),
    products: getAllProducts(),
    invoices,
    movements: getRecentMovements(80),
  });
}));

// Central error handler (R1.5, SEC-08/SEC-10): every error ends as a JSON
// response without stack traces or internal messages; details go to the server
// log only. Must be registered after all routes.
function errorHandler(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const e = err as { type?: string } | null;
  if (e?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'Malformed JSON request body.', code: 'INVALID_JSON' });
    return;
  }
  if (e?.type === 'entity.too.large') {
    res.status(413).json({ error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });
    return;
  }
  // R1.10: invalid input names the field, so the UI can say what to fix.
  if (err instanceof InputError) {
    res.status(400).json({ error: err.message, code: 'VALIDATION_FAILED', field: err.field, reason: err.reason });
    return;
  }

  console.error('[error]', err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: 'Internal server error.', code: 'INTERNAL' });
}

app.use(errorHandler);

async function startServer(): Promise<void> {
  // Last-resort safety net (R1.5): a stray rejected promise is logged instead of
  // crashing the server for every terminal.
  process.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason);
  });

  const port = Number(process.env.PORT) || 3000;
  const currentDir = path.dirname(currentFile);

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distCandidates = [
      path.resolve(currentDir, 'dist'),
      path.resolve(process.cwd(), 'dist'),
    ];
    const distDir =
      distCandidates.find((dir) => fs.existsSync(path.join(dir, 'index.html'))) ??
      distCandidates[0];

    // R1.9 (SEC-11): CSP for the built UI only; Vite's dev server needs inline scripts.
    app.use(contentSecurityPolicy);
    app.use('/i', noIndex); // public invoice pages opened from the receipt QR
    app.use(express.static(distDir));
    app.use('/api', (_req: Request, res: Response) => {
      res.status(404).json({ error: 'API route not found.' });
    });
    app.get('*', (_req: Request, res: Response) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found.');
      }
    });
  }

  // Also cover the static / SPA routes registered above.
  app.use(errorHandler);

  app.listen(port, '0.0.0.0', () => {
    console.log(`Mizan POS server running at http://0.0.0.0:${port}`);
  });
}

// Exported so automated tests can exercise the API without opening a port.
export { app };

// Vitest sets VITEST; in every other context (dev, production, Hostinger) the server starts as before.
if (!process.env.VITEST) {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
