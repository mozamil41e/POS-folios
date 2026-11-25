import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN,
  bearer,
  createTestApp,
  createUserWithRole,
  registerFirstAdmin,
  roleIdBySlug,
  type TestApp,
} from '../helpers/app.ts';

// R2.4b: the users and roles module (server/src/modules/users). Same paths,
// messages and status codes as before, plus stable codes; the phone rule of
// customers and suppliers (owner's option a); the last-administrator check
// also holds when two administrators demote each other at the same moment.
let t: TestApp;
let adminToken: string;
let adminId: number;
let cashierRoleId: number;
let adminRoleId: number;

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
  adminId = (await request(t.app).get('/api/auth/me').set(bearer(adminToken))).body.user.id;
  cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
  adminRoleId = await roleIdBySlug(t.app, adminToken, 'admin');
});
afterAll(() => t.cleanup());

const asAdmin = {
  post: (path: string, body: Record<string, unknown>) => request(t.app).post(path).set(bearer(adminToken)).send(body),
  put: (path: string, body: Record<string, unknown>) => request(t.app).put(path).set(bearer(adminToken)).send(body),
  delete: (path: string) => request(t.app).delete(path).set(bearer(adminToken)),
};

const newUser = (overrides: Record<string, unknown> = {}) => ({
  full_name: 'New Cashier',
  email: 'new@test.local',
  phone: '',
  password: 'cashier-pass-1',
  role_id: cashierRoleId,
  is_active: true,
  ...overrides,
});

const userRow = (email: string) =>
  t.db.prepare('SELECT id, full_name, phone, role, is_active FROM users WHERE email = ?').get(email) as
    | { id: number; full_name: string; phone: string; role: string; is_active: number }
    | undefined;

describe('creating users', () => {
  it('creates a user and answers with the id and both lists, as before', async () => {
    const res = await asAdmin.post('/api/users', newUser({ email: ' First@Test.Local ' }));
    expect(res.status).toBe(201);
    expect(res.body.userId).toBe(userRow('first@test.local')?.id);
    expect(res.body.users.map((u: { email: string }) => u.email)).toContain('first@test.local');
    expect(res.body.roles.length).toBeGreaterThanOrEqual(4);
    expect(JSON.stringify(res.body.users)).not.toContain('password');
  });

  it('keeps the messages and adds codes', async () => {
    const duplicate = await asAdmin.post('/api/users', newUser({ email: 'first@test.local' }));
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({
      error: 'An account with this email already exists.',
      code: 'EMAIL_EXISTS',
      field: 'email',
    });

    const noRole = await asAdmin.post('/api/users', newUser({ email: 'norole@test.local', role_id: 9999 }));
    expect(noRole.status).toBe(400);
    expect(noRole.body).toEqual({
      error: 'Selected role does not exist.',
      code: 'VALIDATION_FAILED',
      field: 'role_id',
      reason: 'NOT_FOUND',
    });

    const shortPassword = await asAdmin.post('/api/users', newUser({ email: 'short@test.local', password: 'abc' }));
    expect(shortPassword.body).toEqual({
      error: 'Password must be between 8 and 128 characters.',
      code: 'PASSWORD_TOO_SHORT',
    });

    const badName = await asAdmin.post('/api/users', newUser({ email: 'name@test.local', full_name: 'A' }));
    expect(badName.body).toMatchObject({ error: 'Full name must be between 2 and 100 characters.', field: 'full_name' });

    expect(userRow('norole@test.local')).toBeUndefined();
    expect(userRow('short@test.local')).toBeUndefined();
  });

  it('creates exactly one account when the same email is sent twice at once', async () => {
    const [a, b] = await Promise.all([
      asAdmin.post('/api/users', newUser({ email: 'twice@test.local' })),
      asAdmin.post('/api/users', newUser({ email: 'twice@test.local' })),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?').get('twice@test.local')).toEqual({ n: 1 });
  });
});

describe('phone rule (owner option a: refused, not cut)', () => {
  it('refuses a phone longer than 30 characters or with letters', async () => {
    const tooLong = await asAdmin.post('/api/users', newUser({ email: 'long@test.local', phone: '0'.repeat(31) }));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toMatchObject({ code: 'VALIDATION_FAILED', field: 'phone', reason: 'TOO_LONG' });

    const letters = await asAdmin.post('/api/users', newUser({ email: 'letters@test.local', phone: '05x-call-me' }));
    expect(letters.body).toMatchObject({ field: 'phone', reason: 'INVALID_PHONE' });

    expect(userRow('long@test.local')).toBeUndefined();
    expect(userRow('letters@test.local')).toBeUndefined();
  });

  it('accepts digits (also Arabic), spaces, + and - and stores the trimmed value', async () => {
    const res = await asAdmin.post('/api/users', newUser({ email: 'phone@test.local', phone: '  +966 ٥٠-123 (4567) ' }));
    expect(res.status).toBe(201);
    expect(userRow('phone@test.local')?.phone).toBe('+966 ٥٠-123 (4567)');
  });

  it('applies the same rule when a user is edited', async () => {
    const id = userRow('phone@test.local')?.id;
    const res = await asAdmin.put(`/api/users/${id}`, {
      full_name: 'Phone User',
      email: 'phone@test.local',
      phone: '1'.repeat(31),
      role_id: cashierRoleId,
      is_active: true,
    });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ field: 'phone', reason: 'TOO_LONG' });
    expect(userRow('phone@test.local')?.phone).toBe('+966 ٥٠-123 (4567)');
  });
});

describe('editing and deleting users', () => {
  it('keeps the email, role and status when they are not sent', async () => {
    const id = userRow('first@test.local')?.id;
    const res = await asAdmin.put(`/api/users/${id}`, { full_name: 'Renamed', phone: '' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('currentUser');
    expect(userRow('first@test.local')).toMatchObject({ full_name: 'Renamed', role: 'cashier', is_active: 1 });
  });

  it('answers the old messages with codes', async () => {
    const missing = await asAdmin.put('/api/users/99999', { full_name: 'Nobody' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'User not found.', code: 'USER_NOT_FOUND' });

    const firstId = userRow('first@test.local')?.id;
    const taken = await asAdmin.put(`/api/users/${firstId}`, { full_name: 'Renamed', email: ADMIN.email });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ error: 'Another account already uses this email.', code: 'EMAIL_EXISTS' });

    const base = { full_name: ADMIN.full_name, email: ADMIN.email, phone: '' };
    const selfOff = await asAdmin.put(`/api/users/${adminId}`, { ...base, role_id: adminRoleId, is_active: false });
    expect(selfOff.status).toBe(400);
    expect(selfOff.body).toEqual({ error: 'You cannot deactivate your own active account.', code: 'CANNOT_DEACTIVATE_SELF' });

    const selfDemote = await asAdmin.put(`/api/users/${adminId}`, { ...base, role_id: cashierRoleId, is_active: true });
    expect(selfDemote.status).toBe(400);
    expect(selfDemote.body).toEqual({
      error: 'Cannot demote or deactivate the last active user administrator.',
      code: 'LAST_ADMIN',
    });

    const selfDelete = await asAdmin.delete(`/api/users/${adminId}`);
    expect(selfDelete.status).toBe(400);
    expect(selfDelete.body).toEqual({ error: 'You cannot delete your own account.', code: 'CANNOT_DELETE_SELF' });

    const deleteMissing = await asAdmin.delete('/api/users/99999');
    expect(deleteMissing.status).toBe(404);
    expect(deleteMissing.body.code).toBe('USER_NOT_FOUND');
  });

  it('returns the refreshed profile when administrators edit themselves', async () => {
    const res = await asAdmin.put(`/api/users/${adminId}`, {
      full_name: 'Owner Renamed',
      email: ADMIN.email,
      phone: '',
      role_id: adminRoleId,
      is_active: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.currentUser).toMatchObject({ id: adminId, full_name: 'Owner Renamed', role: 'admin' });
  });

  it('deletes another user for good (owner option a, unchanged)', async () => {
    const { userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'bye@test.local', 'bye-pass-123');
    const res = await asAdmin.delete(`/api/users/${userId}`);
    expect(res.status).toBe(200);
    expect(res.body.users.some((u: { id: number }) => u.id === userId)).toBe(false);
    expect(userRow('bye@test.local')).toBeUndefined();
  });
});

describe('the last user administrator', () => {
  it('allows demoting an administrator while another one remains', async () => {
    const other = await createUserWithRole(t.app, adminToken, 'admin', 'second-admin@test.local', 'second-pass-1');
    const res = await asAdmin.put(`/api/users/${other.userId}`, {
      full_name: 'Second Admin',
      email: 'second-admin@test.local',
      phone: '',
      role_id: cashierRoleId,
      is_active: true,
    });
    expect(res.status).toBe(200);
  });

  it('keeps one administrator when two demote each other at the same moment', async () => {
    const b = await createUserWithRole(t.app, adminToken, 'admin', 'admin-b@test.local', 'admin-b-pass-1');
    const { updateUser } = await import('../../server/src/modules/users/service.ts');
    const { resolveAuthUserById } = await import('../../server/src/modules/auth/service.ts');
    const actorA = await resolveAuthUserById(adminId);
    const actorB = await resolveAuthUserById(b.userId);
    if (!actorA || !actorB) throw new Error('both administrators must exist');

    // Started in the same turn, both pass the first check; both change a
    // password, so both wait for the slow hashing before writing. Only the
    // check inside the transaction can stop the second one.
    const demote = (id: number, email: string, actor: typeof actorA) =>
      updateUser(
        id,
        { full_name: 'Demoted', email, phone: '', password: 'demoted-pass-1', role_id: cashierRoleId, is_active: true },
        actor
      ).then(
        () => 'ok',
        (err: { code?: string }) => err.code
      );
    const results = await Promise.all([demote(b.userId, 'admin-b@test.local', actorA), demote(adminId, ADMIN.email, actorB)]);
    expect([...results].sort()).toEqual(['LAST_ADMIN', 'ok']);

    const admins = t.db
      .prepare("SELECT COUNT(*) AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.slug = 'admin' AND u.is_active = 1")
      .get() as { n: number };
    expect(admins.n).toBe(1);

    // The next tests need a working administrator session: whoever kept the role.
    const ownerKept = results[0] === 'ok';
    const login = ownerKept
      ? { email: ADMIN.email, password: ADMIN.password }
      : { email: 'admin-b@test.local', password: 'admin-b-pass-1' };
    adminToken = (await request(t.app).post('/api/auth/login').send(login)).body.token;
  });
});

describe('roles', () => {
  it('creates a role with a slug from the English name and only known permissions', async () => {
    const res = await asAdmin.post('/api/roles', {
      name_ar: 'طاقم المطبخ',
      name_en: 'Kitchen Staff!',
      permissions: ['inventory.view', 'not.a.permission', 'inventory.view'],
    });
    expect(res.status).toBe(201);
    expect(res.body.role.slug).toMatch(/^kitchen_staff_[0-9a-f]{4}$/);
    expect(res.body.role.permissions).toEqual(['inventory.view']);
    expect(res.body.role).toMatchObject({ is_system: 0, users_count: 0, description_en: '' });
    expect(res.body.roles.some((r: { id: number }) => r.id === res.body.role.id)).toBe(true);
  });

  it('falls back to the Arabic name, and the slug to custom_role', async () => {
    const res = await asAdmin.post('/api/roles', { name_ar: 'مشرف وردية', description_ar: 'وصف' });
    expect(res.status).toBe(201);
    expect(res.body.role).toMatchObject({ name_en: 'مشرف وردية', description_en: 'وصف', permissions: [] });
    expect(res.body.role.slug).toMatch(/^custom_role_[0-9a-f]{4}$/);
  });

  it('keeps the name message and adds field and reason', async () => {
    const res = await asAdmin.post('/api/roles', { name_ar: 'م' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Role name must be between 2 and 60 characters.',
      code: 'VALIDATION_FAILED',
      field: 'name_ar',
      reason: 'TOO_SHORT',
    });
  });

  it('keeps the administrator role at every permission', async () => {
    const res = await asAdmin.put(`/api/roles/${adminRoleId}`, { permissions: [] });
    expect(res.status).toBe(200);
    expect(res.body.role.permissions).toHaveLength(15);
    expect(res.body.currentUser.permissions).toHaveLength(15);
  });

  it('keeps permissions that are not sent, and replaces them when sent', async () => {
    const created = await asAdmin.post('/api/roles', { name_ar: 'دور تجربة', permissions: ['pos.access'] });
    const id = created.body.role.id as number;
    const renamed = await asAdmin.put(`/api/roles/${id}`, { name_ar: 'دور معدل' });
    expect(renamed.body.role).toMatchObject({ name_ar: 'دور معدل', permissions: ['pos.access'] });
    const changed = await asAdmin.put(`/api/roles/${id}`, { permissions: ['reports.view'] });
    expect(changed.body.role).toMatchObject({ name_ar: 'دور معدل', permissions: ['reports.view'] });
    expect(changed.body.users.length).toBeGreaterThan(0);
  });

  it('refuses to delete the system role or a role in use, with codes', async () => {
    const system = await asAdmin.delete(`/api/roles/${adminRoleId}`);
    expect(system.status).toBe(400);
    expect(system.body).toEqual({ error: 'System administrator role cannot be deleted.', code: 'SYSTEM_ROLE' });

    const inUse = await asAdmin.delete(`/api/roles/${cashierRoleId}`);
    expect(inUse.status).toBe(400);
    expect(inUse.body).toMatchObject({ error: 'Reassign users from this role before deleting it.', code: 'ROLE_IN_USE' });
    expect(inUse.body.count).toBeGreaterThan(0);

    const missing = await asAdmin.put('/api/roles/99999', { name_ar: 'لا شيء' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Role not found.', code: 'ROLE_NOT_FOUND' });
  });

  it('deletes an unused role', async () => {
    const created = await asAdmin.post('/api/roles', { name_ar: 'مؤقت' });
    const res = await asAdmin.delete(`/api/roles/${created.body.role.id}`);
    expect(res.status).toBe(200);
    expect(res.body.roles.some((r: { id: number }) => r.id === created.body.role.id)).toBe(false);
  });
});

describe('access', () => {
  it('needs users.manage for every route, reads included', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'manager', 'manager@test.local', 'manager-pass-1');
    const statuses: string[] = [];
    for (const [method, path] of [
      ['get', '/api/users'],
      ['get', '/api/roles'],
      ['post', '/api/roles'],
      ['delete', `/api/roles/${cashierRoleId}`],
    ] as const) {
      const res = await request(t.app)[method](path).set(bearer(token)).send({});
      statuses.push(`${method} ${path} ${res.status}`);
    }
    expect(statuses).toEqual([
      'get /api/users 403',
      'get /api/roles 403',
      'post /api/roles 403',
      `delete /api/roles/${cashierRoleId} 403`,
    ]);
    expect((await request(t.app).get('/api/users')).status).toBe(401);
  });
});
