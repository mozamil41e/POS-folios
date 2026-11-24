import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, bearer, createTestApp, type TestApp } from '../helpers/app.ts';

describe('auth & first-run setup (no SETUP_TOKEN configured)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  afterAll(() => t.cleanup());

  it('reports an empty system that does not require a setup token', async () => {
    const res = await request(t.app).get('/api/auth/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ hasUsers: false, setupTokenRequired: false });
  });

  // Validation runs only while setup is still open (before the first account exists).
  it('validates setup input', async () => {
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

    expect((await request(t.app).get('/api/auth/status')).body.hasUsers).toBe(false);
  });

  it('creates exactly one administrator when two setup requests arrive together', async () => {
    const [first, second] = await Promise.all([
      request(t.app).post('/api/auth/register').send(ADMIN),
      request(t.app).post('/api/auth/register').send(ADMIN),
    ]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 403]);

    const created = first.status === 201 ? first : second;
    expect(created.body.token).toMatch(/^[0-9a-f]{64}$/);
    expect(created.body.user.role).toBe('admin');
    expect(created.body.user.permissions).toHaveLength(16);

    const status = await request(t.app).get('/api/auth/status');
    expect(status.body).toEqual({ hasUsers: true, setupTokenRequired: false });
  });

  // SEC-01 fixed in R1.2: self-registration is closed once any user exists.
  it('rejects any further self-registration with 403 REGISTRATION_CLOSED', async () => {
    const stranger = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'Stranger', email: 'stranger@test.local', password: 'stranger-pass' });
    expect(stranger.status).toBe(403);
    expect(stranger.body.code).toBe('REGISTRATION_CLOSED');
    expect(stranger.body).not.toHaveProperty('token');

    const sameEmail = await request(t.app).post('/api/auth/register').send(ADMIN);
    expect(sameEmail.status).toBe(403);

    const invalidInput = await request(t.app).post('/api/auth/register').send({});
    expect(invalidInput.status).toBe(403);

    const login = await request(t.app)
      .post('/api/auth/login')
      .send({ email: 'stranger@test.local', password: 'stranger-pass' });
    expect(login.status).toBe(401);
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
