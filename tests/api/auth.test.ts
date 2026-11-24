import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, bearer, createTestApp, type TestApp } from '../helpers/app.ts';

describe('auth (characterization)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.cleanup());

  it('reports no users on a fresh database', async () => {
    const res = await request(t.app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasUsers: false });
  });

  it('makes the first registered account an admin with every permission', async () => {
    const res = await request(t.app).post('/api/auth/register').send(ADMIN);
    expect(res.status).toBe(201);
    expect(res.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.user.role).toBe('admin');
    expect(res.body.user.permissions).toHaveLength(16);

    const status = await request(t.app).get('/api/auth/status');
    expect(status.body).toEqual({ hasUsers: true });
  });

  // CURRENT BEHAVIOUR (SEC-01): self-registration stays open after setup.
  // R1.2 closes it — this test must then be flipped to expect 403.
  it('CURRENT BEHAVIOUR: lets anyone self-register later accounts as cashiers', async () => {
    const res = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'Stranger', email: 'stranger@test.local', password: 'stranger-pass' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('cashier');
  });

  it('rejects a duplicate email with 409', async () => {
    const res = await request(t.app).post('/api/auth/register').send(ADMIN);
    expect(res.status).toBe(409);
  });

  it('validates registration input', async () => {
    const shortPassword = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'Someone', email: 'someone@test.local', password: 'abc' });
    expect(shortPassword.status).toBe(400);

    const badEmail = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'Someone', email: 'not-an-email', password: 'long-enough' });
    expect(badEmail.status).toBe(400);

    const shortName = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'A', email: 'a@test.local', password: 'long-enough' });
    expect(shortName.status).toBe(400);
  });

  it('rejects a wrong password with 401 and accepts the right one (email case-insensitive)', async () => {
    const wrong = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: 'wrong-pass' });
    expect(wrong.status).toBe(401);

    const missing = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email });
    expect(missing.status).toBe(400);

    const ok = await request(t.app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email.toUpperCase(), password: ADMIN.password });
    expect(ok.status).toBe(200);
    expect(ok.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.body.user.email).toBe(ADMIN.email);
  });

  it('returns the current user from /api/auth/me and requires a valid token', async () => {
    const login = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });

    const me = await request(t.app).get('/api/auth/me').set(bearer(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(ADMIN.email);

    expect((await request(t.app).get('/api/auth/me')).status).toBe(401);
    expect((await request(t.app).get('/api/auth/me').set(bearer('not-a-real-token'))).status).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const login = await request(t.app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    const token = login.body.token as string;

    const logout = await request(t.app).post('/api/auth/logout').set(bearer(token));
    expect(logout.status).toBe(200);
    expect(logout.body).toEqual({ ok: true });

    expect((await request(t.app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
  });
});
