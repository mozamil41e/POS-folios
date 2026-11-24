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

// One app per file: Vitest caches server.ts per file, so a second
// createTestApp() would reuse the same database.
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp();
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());

const login = (email: string, password: string) =>
  request(t.app).post('/api/auth/login').send({ email, password });

// R1.9 (SEC-05/06/07), numbers approved by the owner: 5 wrong passwords within
// 15 minutes lock that email for 15 minutes.
describe('sign-in lockout per email (R1.9)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts down the attempts, locks on the fifth and refuses even the right password', async () => {
    await createUserWithRole(t.app, adminToken, 'cashier', 'lock@test.local', 'lock-pass-123');

    const left: number[] = [];
    for (let i = 0; i < 4; i++) {
      const res = await login('lock@test.local', 'wrong-pass');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      left.push(res.body.attemptsLeft);
    }
    expect(left).toEqual([4, 3, 2, 1]);

    const fifth = await login('lock@test.local', 'wrong-pass');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('LOGIN_LOCKED');
    expect(fifth.body.retryAfterSeconds).toBe(15 * 60);
    expect(fifth.headers['retry-after']).toBe(String(15 * 60));

    const rightPassword = await login('lock@test.local', 'lock-pass-123');
    expect(rightPassword.status).toBe(429);
    expect(rightPassword.body.code).toBe('LOGIN_LOCKED');
    expect(rightPassword.body).not.toHaveProperty('token');
  });

  it('lets the user in again once the 15 minutes are over', async () => {
    await createUserWithRole(t.app, adminToken, 'cashier', 'later@test.local', 'later-pass-123');
    // Close to the real time, so existing sessions are not seen as expired.
    const start = Date.now();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(start);
    for (let i = 0; i < 5; i++) await login('later@test.local', 'wrong-pass');

    vi.setSystemTime(start + 14 * 60 * 1000);
    const stillLocked = await login('later@test.local', 'later-pass-123');
    expect(stillLocked.status).toBe(429);
    expect(stillLocked.body.retryAfterSeconds).toBe(60);

    vi.setSystemTime(start + 15 * 60 * 1000 + 1000);
    expect((await login('later@test.local', 'later-pass-123')).status).toBe(200);
  });

  it('resets the counter after a successful sign-in', async () => {
    await createUserWithRole(t.app, adminToken, 'cashier', 'reset@test.local', 'reset-pass-123');
    for (let i = 0; i < 3; i++) await login('reset@test.local', 'wrong-pass');
    expect((await login('reset@test.local', 'reset-pass-123')).status).toBe(200);

    const next = await login('reset@test.local', 'wrong-pass');
    expect(next.status).toBe(401);
    expect(next.body.attemptsLeft).toBe(4);
  });

  it('treats an unknown email exactly like a known one', async () => {
    const first = await login('nobody@test.local', 'whatever-pass');
    expect(first.status).toBe(401);
    expect(first.body).toEqual({
      error: 'Invalid email or password.',
      code: 'INVALID_CREDENTIALS',
      attemptsLeft: 4,
    });
    for (let i = 0; i < 3; i++) await login('nobody@test.local', 'whatever-pass');
    expect((await login('nobody@test.local', 'whatever-pass')).body.code).toBe('LOGIN_LOCKED');
  });

  it('lifts the lock when an administrator sets a new password', async () => {
    const { userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'helpdesk@test.local', 'old-pass-123');
    for (let i = 0; i < 5; i++) await login('helpdesk@test.local', 'wrong-pass');
    expect((await login('helpdesk@test.local', 'old-pass-123')).status).toBe(429);

    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    const reset = await request(t.app)
      .put(`/api/users/${userId}`)
      .set(bearer(adminToken))
      .send({ full_name: 'Helpdesk', email: 'helpdesk@test.local', phone: '', password: 'new-pass-123', role_id: cashierRoleId, is_active: true });
    expect(reset.status).toBe(200);

    expect((await login('helpdesk@test.local', 'new-pass-123')).status).toBe(200);
  });

  it('does not lock other accounts', async () => {
    expect((await login(ADMIN.email, ADMIN.password)).status).toBe(200);
  });
});

describe('password rules and hashing (R1.9)', () => {
  let cashierRoleId: number;

  const createUser = (email: string, password: string) =>
    request(t.app)
      .post('/api/users')
      .set(bearer(adminToken))
      .send({ full_name: 'Policy User', email, phone: '', password, role_id: cashierRoleId, is_active: true });

  beforeAll(async () => {
    cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
  });

  it('requires at least 8 characters for a new user', async () => {
    const short = await createUser('short@test.local', '7-chars');
    expect(short.status).toBe(400);
    expect(short.body.code).toBe('PASSWORD_TOO_SHORT');
    expect((await createUser('eight@test.local', '8-chars!')).status).toBe(201);
  });

  it('requires at least 8 characters when an administrator changes a password', async () => {
    const created = await createUser('change@test.local', 'first-pass-1');
    const res = await request(t.app)
      .put(`/api/users/${created.body.userId}`)
      .set(bearer(adminToken))
      .send({ full_name: 'Policy User', email: 'change@test.local', phone: '', password: 'short1', role_id: cashierRoleId, is_active: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('still accepts accounts saved before R1.9 (6-character password, scryptSync hash)', async () => {
    // Same format and parameters the old synchronous code wrote.
    const salt = crypto.randomBytes(16).toString('hex');
    const legacyHash = `${salt}:${crypto.scryptSync('abc123', salt, 64).toString('hex')}`;
    t.db
      .prepare(
        `INSERT INTO users (full_name, email, phone, password_hash, role, role_id, is_active, created_at)
         VALUES ('Legacy', 'legacy@test.local', '', ?, 'cashier', ?, 1, ?)`
      )
      .run(legacyHash, cashierRoleId, new Date().toISOString());

    const res = await login('legacy@test.local', 'abc123');
    expect(res.status).toBe(200);
  });

  it('stores new passwords as salt:hash, never in clear text', () => {
    const row = t.db.prepare("SELECT password_hash FROM users WHERE email = 'eight@test.local'").get() as {
      password_hash: string;
    };
    expect(row.password_hash).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(row.password_hash).not.toContain('8-chars!');
  });
});
