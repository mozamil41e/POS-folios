import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { contentSecurityPolicy, resolveTrustProxy } from '../../src/server/security.ts';
import { ADMIN, createTestApp, getBootstrap, type TestApp } from '../helpers/app.ts';

// Simulates Hostinger: the app sits behind one proxy that appends the client IP
// to X-Forwarded-For (TRUST_PROXY=1). Each test uses its own client IPs.
let t: TestApp;
const from = (ip: string) => ({ 'X-Forwarded-For': ip });

beforeAll(async () => {
  t = await createTestApp({ trustProxy: '1' });
});
afterAll(() => t.cleanup());

describe('per-IP limits (R1.9)', () => {
  // Runs first, while the system is still empty (setup is open).
  it('allows 10 failed setup attempts per IP, then answers 429 for 15 minutes', async () => {
    const attempt = (ip: string) =>
      request(t.app).post('/api/auth/register').set(from(ip)).send({ full_name: 'X', email: 'bad', password: 'short' });

    for (let i = 0; i < 10; i++) expect((await attempt('203.0.113.10')).status).toBe(400);
    const blocked = await attempt('203.0.113.10');
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(Number(blocked.headers['retry-after'])).toBe(blocked.body.retryAfterSeconds);

    // Another network is not affected: it can still complete setup.
    const setup = await request(t.app).post('/api/auth/register').set(from('203.0.113.11')).send(ADMIN);
    expect(setup.status).toBe(201);
  });

  it('allows 30 failed sign-ins per IP across any emails, then answers 429', async () => {
    // Different emails, so the per-email lockout (5) never triggers here.
    const fail = (ip: string, i: number) =>
      request(t.app).post('/api/auth/login').set(from(ip)).send({ email: `guess${i}@test.local`, password: 'wrong-pass' });

    for (let i = 0; i < 30; i++) expect((await fail('198.51.100.20', i)).status).toBe(401);
    const blocked = await fail('198.51.100.20', 99);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');

    // Another IP still gets a normal answer, and can sign in.
    expect((await fail('198.51.100.21', 100)).status).toBe(401);
    const ok = await request(t.app)
      .post('/api/auth/login')
      .set(from('198.51.100.21'))
      .send({ email: ADMIN.email, password: ADMIN.password });
    expect(ok.status).toBe(200);
  });

  it('does not count successful sign-ins', async () => {
    for (let i = 0; i < 35; i++) {
      const res = await request(t.app)
        .post('/api/auth/login')
        .set(from('198.51.100.30'))
        .send({ email: ADMIN.email, password: ADMIN.password });
      expect(res.status).toBe(200);
    }
  });

  it('allows 60 public invoice lookups per IP per minute', async () => {
    const login = await request(t.app)
      .post('/api/auth/login')
      .set(from('192.0.2.1'))
      .send({ email: ADMIN.email, password: ADMIN.password });
    const { invoices } = await getBootstrap(t.app, login.body.token);
    const lookup = (ip: string) => request(t.app).get(`/api/public/invoices/${invoices[0].uuid}`).set(from(ip));

    for (let i = 0; i < 60; i++) expect((await lookup('192.0.2.40')).status).toBe(200);
    const blocked = await lookup('192.0.2.40');
    expect(blocked.status).toBe(429);
    expect(blocked.body.retryAfterSeconds).toBeLessThanOrEqual(60);
    expect((await lookup('192.0.2.41')).status).toBe(200);
  });
});

describe('security headers (R1.9, SEC-11)', () => {
  it('sends helmet headers on every response', async () => {
    const res = await request(t.app).get('/api/auth/status');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers).not.toHaveProperty('x-powered-by');
  });

  it('builds a CSP for the production UI: own scripts only, Google Fonts allowed', async () => {
    const page = express();
    page.use(contentSecurityPolicy);
    page.get('/', (_req, res) => res.send('ok'));
    const csp = (await request(page).get('/')).headers['content-security-policy'] as string;

    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe/);
    expect(csp).toContain('https://fonts.googleapis.com');
    expect(csp).toContain('https://fonts.gstatic.com');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toContain('upgrade-insecure-requests'); // would break `npm start` on http://localhost
  });
});

describe('TRUST_PROXY parsing (R1.9, SEC-22)', () => {
  it('defaults to one proxy hop in production and none elsewhere', () => {
    expect(resolveTrustProxy(undefined, true)).toBe(1);
    expect(resolveTrustProxy('', true)).toBe(1);
    expect(resolveTrustProxy(undefined, false)).toBe(false);
  });

  it('accepts false, a hop count or an Express trust value', () => {
    expect(resolveTrustProxy('false', true)).toBe(false);
    expect(resolveTrustProxy('0', true)).toBe(false);
    expect(resolveTrustProxy('2', false)).toBe(2);
    expect(resolveTrustProxy('loopback', true)).toBe('loopback');
  });
});
