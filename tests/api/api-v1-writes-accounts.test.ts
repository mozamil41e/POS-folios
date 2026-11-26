import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, bearer, createTestApp, roleIdBySlug, type TestApp } from '../helpers/app.ts';

// R2.5c, group 1: v1 writes for sign-in, users and roles, and settings. The
// same services as the current routes (whose tests run unchanged); answers
// carry only the affected resource, in the v1 envelope.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
});
afterAll(() => t.cleanup());

const v1 = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: Record<string, unknown>, token = adminToken) => {
  const req = request(t.app)[method](path);
  if (token) req.set(bearer(token));
  return body === undefined ? req : req.send(body);
};
const onlyData = (body: Record<string, unknown>) => Object.keys(body);

describe('sign-in (v1)', () => {
  it('status, first-run setup and the closed setup afterwards', async () => {
    expect((await v1('get', '/api/v1/auth/status', undefined, '')).body).toEqual({ data: { hasUsers: false, setupTokenRequired: false } });
    const setup = await v1('post', '/api/v1/auth/setup', ADMIN, '');
    expect(setup.status).toBe(201);
    expect(setup.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(setup.body.data.user).toMatchObject({ email: ADMIN.email, role: 'admin' });
    adminToken = setup.body.data.token;

    const again = await v1('post', '/api/v1/auth/setup', ADMIN, '');
    expect(again.status).toBe(403);
    expect(again.body).toEqual({
      error: { code: 'REGISTRATION_CLOSED', message: 'Registration is closed. Ask an administrator to create your account.', details: {} },
    });
  });

  it('login, me and logout', async () => {
    const wrong = await v1('post', '/api/v1/auth/login', { email: ADMIN.email, password: 'wrong-pass' }, '');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS', details: { attemptsLeft: 4 } });

    const login = await v1('post', '/api/v1/auth/login', { email: ADMIN.email, password: ADMIN.password }, '');
    expect(login.status).toBe(200);
    const token = login.body.data.token as string;
    expect((await v1('get', '/api/v1/auth/me', undefined, token)).body.data).toMatchObject({ email: ADMIN.email });

    const out = await v1('post', '/api/v1/auth/logout', undefined, token);
    expect(out.status).toBe(204);
    expect(out.text).toBe('');
    const gone = await v1('get', '/api/v1/auth/me', undefined, token);
    expect(gone.status).toBe(401);
    expect(gone.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('shares the setup rate limit with the current route, and answers 429 in the v1 envelope', async () => {
    // Setup is closed, so each attempt fails and counts; the limit is 10 failures.
    for (let i = 0; i < 5; i++) await v1('post', '/api/auth/register', ADMIN, '');
    for (let i = 0; i < 5; i++) await v1('post', '/api/v1/auth/setup', ADMIN, '');
    const limited = await v1('post', '/api/v1/auth/setup', ADMIN, '');
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    expect(limited.body.error).toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: expect.any(Number) } });
    // The current route keeps its own shape.
    const current = await v1('post', '/api/auth/register', ADMIN, '');
    expect(current.body).toMatchObject({ code: 'RATE_LIMITED', retryAfterSeconds: expect.any(Number) });
  });
});

describe('users and roles (v1)', () => {
  let cashierRoleId: number;
  let userId: number;

  beforeAll(async () => {
    cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
  });

  it('creates an account and answers with that account only', async () => {
    const res = await v1('post', '/api/v1/users', {
      full_name: 'Cashier One',
      email: 'c1@test.local',
      phone: '0500',
      password: 'cashier-pass-1',
      role_id: cashierRoleId,
      is_active: true,
    });
    expect(res.status).toBe(201);
    expect(onlyData(res.body)).toEqual(['data']);
    expect(res.body.data).toMatchObject({ email: 'c1@test.local', full_name: 'Cashier One', role: 'cashier', phone: '0500' });
    expect(JSON.stringify(res.body)).not.toContain('password');
    userId = res.body.data.id;
  });

  it('PATCH changes only what is sent (name and phone stay)', async () => {
    const res = await v1('patch', `/api/v1/users/${userId}`, { is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ full_name: 'Cashier One', phone: '0500', is_active: 0 });
  });

  it('keeps the rules and codes, in the v1 envelope', async () => {
    const me = (await v1('get', '/api/v1/auth/me')).body.data.id as number;
    const self = await v1('patch', `/api/v1/users/${me}`, { is_active: false });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe('CANNOT_DEACTIVATE_SELF');
    const missing = await v1('patch', '/api/v1/users/99999', { full_name: 'Nobody' });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('USER_NOT_FOUND');
  });

  it('deletes an account with 204', async () => {
    const res = await v1('delete', `/api/v1/users/${userId}`);
    expect(res.status).toBe(204);
    expect((await v1('get', '/api/v1/users')).body.data.some((u: { id: number }) => u.id === userId)).toBe(false);
  });

  it('creates, changes and deletes a role', async () => {
    const created = await v1('post', '/api/v1/roles', { name_ar: 'مطبخ', name_en: 'Kitchen', permissions: ['inventory.view'] });
    expect(created.status).toBe(201);
    expect(onlyData(created.body)).toEqual(['data']);
    const id = created.body.data.id as number;
    const changed = await v1('patch', `/api/v1/roles/${id}`, { permissions: ['inventory.view', 'reports.view'] });
    expect(changed.body.data).toMatchObject({ name_ar: 'مطبخ', permissions: ['inventory.view', 'reports.view'] });
    expect((await v1('delete', `/api/v1/roles/${id}`)).status).toBe(204);

    const adminRole = await roleIdBySlug(t.app, adminToken, 'admin');
    const system = await v1('delete', `/api/v1/roles/${adminRole}`);
    expect(system.status).toBe(400);
    expect(system.body.error.code).toBe('SYSTEM_ROLE');
  });
});

describe('settings (v1)', () => {
  it('PATCH saves what is sent and answers with the settings', async () => {
    const res = await v1('patch', '/api/v1/settings', { name_ar: 'مطعم', vat_number: '300000000000003', table_page_size: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ name_ar: 'مطعم', table_page_size: 20 });
    const bad = await v1('patch', '/api/v1/settings', { thermal_width_mm: 70 });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatchObject({ code: 'VALIDATION_FAILED', details: { field: 'thermal_width_mm', reason: 'INVALID_CHOICE' } });
  });
});
