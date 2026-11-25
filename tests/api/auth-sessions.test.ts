import crypto from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

// R2.4b: the auth module (server/src/modules/auth) owns setup, sign-in,
// sessions and the lockout. These tests cover what the move must keep and
// the codes it adds; the older auth tests run unchanged next to them.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp();
});
afterAll(() => t.cleanup());

const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
const me = (token: string) => request(t.app).get('/api/auth/me').set(bearer(token));
const login = (email: string, password: string) => request(t.app).post('/api/auth/login').send({ email, password });
const sessionCount = (userId: number) =>
  (t.db.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id = ?').get(userId) as { n: number }).n;

describe('first-run setup input (R2.4b: same messages, plus field and reason)', () => {
  const register = (body: Record<string, unknown>) => request(t.app).post('/api/auth/register').send(body);

  it('keeps the messages and adds VALIDATION_FAILED with field and reason', async () => {
    const shortName = await register({ full_name: 'A', email: 'a@test.local', password: 'long-enough' });
    expect(shortName.status).toBe(400);
    expect(shortName.body).toEqual({
      error: 'Full name must be between 2 and 100 characters.',
      code: 'VALIDATION_FAILED',
      field: 'full_name',
      reason: 'TOO_SHORT',
    });

    const badEmail = await register({ full_name: 'Someone', email: 'not-an-email', password: 'long-enough' });
    expect(badEmail.body).toEqual({
      error: 'Valid email address is required.',
      code: 'VALIDATION_FAILED',
      field: 'email',
      reason: 'INVALID_EMAIL',
    });
  });

  it('keeps PASSWORD_TOO_SHORT for the password, and checks the fields in the old order', async () => {
    const shortPassword = await register({ full_name: 'Someone', email: 'someone@test.local', password: 'abc' });
    expect(shortPassword.status).toBe(400);
    expect(shortPassword.body).toEqual({
      error: 'Password must be between 8 and 128 characters.',
      code: 'PASSWORD_TOO_SHORT',
    });

    // Name first, then email, then password.
    const allWrong = await register({ full_name: '', email: 'x', password: '' });
    expect(allWrong.body).toMatchObject({ field: 'full_name', reason: 'REQUIRED' });
  });

  it('creates the administrator with a session and a last sign-in time', async () => {
    adminToken = await registerFirstAdmin(t.app);
    const row = t.db.prepare('SELECT id, last_login_at FROM users WHERE email = ?').get(ADMIN.email) as {
      id: number;
      last_login_at: string | null;
    };
    expect(row.last_login_at).not.toBeNull();
    expect(sessionCount(row.id)).toBe(1);
  });
});

describe('sign-in responses (R2.4b)', () => {
  it('answers a missing email or password with the old message, now with a code', async () => {
    const res = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'Email and password are required.',
      code: 'VALIDATION_FAILED',
      field: 'password',
      reason: 'REQUIRED',
    });
  });

  it('refuses a deactivated account with the old message, now with ACCOUNT_DEACTIVATED', async () => {
    const { userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'gone@test.local', 'gone-pass-123');
    t.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
    const res = await login('gone@test.local', 'gone-pass-123');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'This account has been deactivated by an administrator.',
      code: 'ACCOUNT_DEACTIVATED',
    });
  });
});

describe('sessions (R2.4b)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores only the SHA-256 of the token', async () => {
    const res = await login(ADMIN.email, ADMIN.password);
    const token = res.body.token as string;
    const stored = t.db.prepare('SELECT token_hash FROM user_sessions WHERE token_hash IN (?, ?)').all(token, sha256(token));
    expect(stored).toEqual([{ token_hash: sha256(token) }]);
  });

  it('rejects an expired session, and the next sign-in purges the expired rows', async () => {
    const { token, userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'expiry@test.local', 'expiry-pass-1');
    expect((await me(token)).status).toBe(200);

    t.db.prepare('UPDATE user_sessions SET expires_at = ? WHERE token_hash = ?').run('2000-01-01T00:00:00.000Z', sha256(token));
    expect((await me(token)).status).toBe(401);
    // Also on a module route and a legacy route.
    expect((await request(t.app).get('/api/bootstrap').set(bearer(token))).status).toBe(401);
    expect(
      (await request(t.app).post('/api/categories').set(bearer(token)).send({ name_ar: 'تجربة' })).status
    ).toBe(401);

    expect(sessionCount(userId)).toBe(1);
    expect((await login('expiry@test.local', 'expiry-pass-1')).status).toBe(200);
    expect(sessionCount(userId)).toBe(1); // the expired one is gone, the new one remains
  });

  it('lasts 24 hours', async () => {
    const { token } = await createUserWithRole(t.app, adminToken, 'cashier', 'day@test.local', 'day-pass-123');
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start + 23 * 60 * 60 * 1000);
    expect((await me(token)).status).toBe(200);
    vi.setSystemTime(start + 24 * 60 * 60 * 1000 + 1000);
    expect((await me(token)).status).toBe(401);
  });

  it('rejects the token of an account deactivated directly in the database', async () => {
    const { token, userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'off@test.local', 'off-pass-123');
    t.db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(userId);
    expect((await me(token)).status).toBe(401);
    expect(sessionCount(userId)).toBe(1); // refused by the check, not by revocation
  });

  it('signs out only the session that asked', async () => {
    const { token: first } = await createUserWithRole(t.app, adminToken, 'cashier', 'two@test.local', 'two-pass-123');
    const second = (await login('two@test.local', 'two-pass-123')).body.token as string;

    const out = await request(t.app).post('/api/auth/logout').set(bearer(first));
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ ok: true });
    expect((await me(first)).status).toBe(401);
    expect((await me(second)).status).toBe(200);
  });
});

describe('users routes still revoke sessions through the auth module (R2.4b)', () => {
  const update = (userId: number, body: Record<string, unknown>) =>
    request(t.app).put(`/api/users/${userId}`).set(bearer(adminToken)).send(body);

  it('keeps sessions on an edit without a new password, and revokes them all on a new password', async () => {
    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    const { token, userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'edit@test.local', 'edit-pass-123');
    const other = (await login('edit@test.local', 'edit-pass-123')).body.token as string;
    const base = { full_name: 'Edited Name', email: 'edit@test.local', phone: '', role_id: cashierRoleId, is_active: true };

    expect((await update(userId, base)).status).toBe(200);
    expect((await me(token)).status).toBe(200);

    expect((await update(userId, { ...base, password: 'changed-pass-1' })).status).toBe(200);
    expect((await me(token)).status).toBe(401);
    expect((await me(other)).status).toBe(401);
    expect((await login('edit@test.local', 'edit-pass-123')).status).toBe(401);
    expect((await login('edit@test.local', 'changed-pass-1')).status).toBe(200);
  });

  it('revokes sessions on deactivation and on deletion', async () => {
    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    const a = await createUserWithRole(t.app, adminToken, 'cashier', 'deact@test.local', 'deact-pass-1');
    const off = await update(a.userId, {
      full_name: 'Deact',
      email: 'deact@test.local',
      phone: '',
      role_id: cashierRoleId,
      is_active: false,
    });
    expect(off.status).toBe(200);
    expect(sessionCount(a.userId)).toBe(0);

    const b = await createUserWithRole(t.app, adminToken, 'cashier', 'delete@test.local', 'delete-pass-1');
    const removed = await request(t.app).delete(`/api/users/${b.userId}`).set(bearer(adminToken));
    expect(removed.status).toBe(200);
    expect(sessionCount(b.userId)).toBe(0);
    expect((await me(b.token)).status).toBe(401);
  });

  it('returns the current user with fresh permissions after a role change', async () => {
    const roles = await request(t.app).get('/api/roles').set(bearer(adminToken));
    const admin = (roles.body.roles as Array<{ id: number; slug: string }>).find((r) => r.slug === 'admin');
    const res = await request(t.app)
      .put(`/api/roles/${admin?.id}`)
      .set(bearer(adminToken))
      .send({ name_ar: 'مدير النظام' });
    expect(res.status).toBe(200);
    expect(res.body.currentUser).toMatchObject({ email: ADMIN.email, role: 'admin' });
    expect(res.body.currentUser.permissions).toHaveLength(15);
  });
});

describe('lockout window (R1.9 numbers, now in the auth module)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts counting again when 15 minutes pass without a lock', async () => {
    await createUserWithRole(t.app, adminToken, 'cashier', 'window@test.local', 'window-pass-1');
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    for (let i = 0; i < 4; i++) await login('window@test.local', 'wrong-pass');

    vi.setSystemTime(start + 15 * 60 * 1000);
    const fresh = await login('window@test.local', 'wrong-pass');
    expect(fresh.status).toBe(401);
    expect(fresh.body.attemptsLeft).toBe(4);
  });
});
