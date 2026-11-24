import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ADMIN, createTestApp, type TestApp } from '../helpers/app.ts';

const SETUP_TOKEN = 'test-setup-token-6f1c2a9d';

describe('first-run setup with SETUP_TOKEN configured (production mode)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp({ setupToken: SETUP_TOKEN });
  });
  afterAll(() => t.cleanup());

  it('reports that a setup token is required', async () => {
    const res = await request(t.app).get('/api/auth/status');
    expect(res.body).toEqual({ hasUsers: false, setupTokenRequired: true });
  });

  it('rejects setup without a token or with a wrong one', async () => {
    const missing = await request(t.app).post('/api/auth/register').send(ADMIN);
    expect(missing.status).toBe(403);
    expect(missing.body.code).toBe('INVALID_SETUP_TOKEN');

    const wrong = await request(t.app)
      .post('/api/auth/register')
      .send({ ...ADMIN, setup_token: 'not-the-token' });
    expect(wrong.status).toBe(403);
    expect(wrong.body.code).toBe('INVALID_SETUP_TOKEN');

    expect((await request(t.app).get('/api/auth/status')).body.hasUsers).toBe(false);
  });

  it('creates the administrator with the correct token', async () => {
    const res = await request(t.app)
      .post('/api/auth/register')
      .send({ ...ADMIN, setup_token: SETUP_TOKEN });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('admin');
  });

  it('stays closed afterwards, even with the correct token', async () => {
    const res = await request(t.app)
      .post('/api/auth/register')
      .send({ full_name: 'Second Admin', email: 'second@test.local', password: 'second-pass', setup_token: SETUP_TOKEN });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('REGISTRATION_CLOSED');
  });
});
