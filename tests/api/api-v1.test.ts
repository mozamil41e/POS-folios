import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bearer, createTestApp, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.5a: the API v1 foundation. Under /api/v1 errors use the envelope
// { error: { code, message, details } }; the current /api/* routes keep
// their shape exactly (the UI moves to v1 in R4).
let t: TestApp;
let adminToken: string;

beforeAll(async () => {
  t = await createTestApp({ demoData: false });
  adminToken = await registerFirstAdmin(t.app);
});
afterAll(() => t.cleanup());

describe('GET /api/v1/health', () => {
  it('answers without a session, and says only that the database is reachable', async () => {
    const res = await request(t.app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
  });
});

describe('the v1 error envelope', () => {
  it('for an unknown v1 path: 401 without a session, 404 with one', async () => {
    const anonymous = await request(t.app).get('/api/v1/nothing-here');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', details: {} } });

    const signedIn = await request(t.app).get('/api/v1/nothing-here').set(bearer(adminToken));
    expect(signedIn.status).toBe(404);
    expect(signedIn.body).toEqual({ error: { code: 'NOT_FOUND', message: 'API route not found.', details: {} } });
  });

  it('for a malformed JSON body', async () => {
    const res = await request(t.app).post('/api/v1/health').set('Content-Type', 'application/json').send('{"broken"');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: 'Malformed JSON request body.', details: {} } });
  });
});

describe('the current routes keep their shape', () => {
  it('401 without a code, as before', async () => {
    const res = await request(t.app).get('/api/bootstrap');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication required.' });
  });

  it('a validation error flat, with code, field and reason', async () => {
    const res = await request(t.app).post('/api/customers').set(bearer(adminToken)).send({ name_ar: '' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'name_ar is required.', code: 'VALIDATION_FAILED', field: 'name_ar', reason: 'REQUIRED' });
  });

  it('malformed JSON, as before', async () => {
    const res = await request(t.app).post('/api/customers').set(bearer(adminToken)).set('Content-Type', 'application/json').send('{"x"');
    expect(res.body).toEqual({ error: 'Malformed JSON request body.', code: 'INVALID_JSON' });
  });
});
