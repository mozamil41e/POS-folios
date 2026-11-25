import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { DestinationStream } from 'pino';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ConfigError, loadConfig } from '../../server/src/config/env.ts';
import { ADMIN, bearer, createTestApp, makeTempDbPath, registerFirstAdmin, type TestApp } from '../helpers/app.ts';

// R2.1: Express 5, validated configuration, request ids and structured logs.

describe('configuration (R2.1)', () => {
  const TOKEN = 'a-long-enough-setup-token';

  it('requires SETUP_TOKEN in production, with a clear message', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(ConfigError);
    const blank = (() => {
      try {
        loadConfig({ NODE_ENV: 'production', SETUP_TOKEN: '   ' });
        return null;
      } catch (err) {
        return err as ConfigError;
      }
    })();
    expect(blank?.problems).toEqual(['SETUP_TOKEN: required in production (set it in Hostinger hPanel).']);
    expect(() => loadConfig({ NODE_ENV: 'production', SETUP_TOKEN: 'short' })).toThrow(/at least 16 characters/);
    expect(loadConfig({ NODE_ENV: 'production', SETUP_TOKEN: TOKEN }).isProduction).toBe(true);
  });

  it('treats the compiled bundle as production even without NODE_ENV', () => {
    expect(() => loadConfig({}, { compiledEntry: true })).toThrow(/SETUP_TOKEN/);
    expect(loadConfig({ SETUP_TOKEN: TOKEN }, { compiledEntry: true }).isProduction).toBe(true);
  });

  it('keeps first-run setup open locally (no token needed outside production)', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ isProduction: false, nodeEnv: 'development', port: 3000, setupToken: undefined, logLevel: 'info' });
  });

  it('rejects invalid values and names them', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('reads the optional values and is silent under test by default', () => {
    const config = loadConfig({ NODE_ENV: 'test', PORT: '4000', TRUST_PROXY: '1', MIZAN_DB_PATH: '/tmp/x.db' });
    expect(config).toMatchObject({ port: 4000, trustProxy: '1', dbPath: '/tmp/x.db', logLevel: 'silent' });
  });

  it('refuses to start the server and creates no database when production config is missing', () => {
    const dbPath = makeTempDbPath();
    const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');
    try {
      const res = spawnSync(process.execPath, [tsxCli, 'server/src/main.ts'], {
        env: { ...process.env, NODE_ENV: 'production', SETUP_TOKEN: '', MIZAN_DB_PATH: dbPath, VITEST: '' },
        encoding: 'utf8',
        timeout: 60_000,
      });
      expect(res.status).toBe(1);
      expect(res.stderr).toContain('Mizan POS cannot start');
      expect(res.stderr).toContain('SETUP_TOKEN');
      expect(fs.existsSync(dbPath)).toBe(false);
    } finally {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    }
  });
});

describe('requests on Express 5 (R2.1)', () => {
  let t: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();
    adminToken = await registerFirstAdmin(t.app);
  });
  afterAll(() => t.cleanup());

  it('gives every response a request id, keeping a safe incoming one', async () => {
    const plain = await request(t.app).get('/api/auth/status');
    expect(plain.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const kept = await request(t.app).get('/api/auth/status').set('X-Request-Id', 'till-2-abc12345');
    expect(kept.headers['x-request-id']).toBe('till-2-abc12345');

    const replaced = await request(t.app).get('/api/auth/status').set('X-Request-Id', '<script>x</script>');
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('treats a request without a JSON body as an empty one (400, not 500)', async () => {
    const res = await request(t.app).post('/api/auth/login');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Email and password are required.');
  });

  it('logs one line per API request, without passwords or tokens', async () => {
    const lines: string[] = [];
    const stream: DestinationStream = { write: (line: string) => void lines.push(line) };
    const { createApp } = await import('../../server/src/app.ts');
    const { createLogger } = await import('../../server/src/logger.ts');
    const { app } = createApp({ config: loadConfig({ NODE_ENV: 'test' }), logger: createLogger('info', stream) });

    const login = await request(app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password });
    await request(app).get('/api/auth/me').set(bearer(login.body.token));
    await request(app).get('/api/auth/me').set(bearer(adminToken));

    const entries = lines.map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(entries.map((e) => [e.method, e.path, e.status])).toEqual([
      ['POST', '/api/auth/login', 200],
      ['GET', '/api/auth/me', 200],
      ['GET', '/api/auth/me', 200],
    ]);
    expect(entries.every((e) => typeof e.reqId === 'string' && typeof e.ms === 'number')).toBe(true);
    const all = lines.join('\n');
    expect(all).not.toContain(ADMIN.password);
    expect(all).not.toContain(login.body.token);
    expect(all).not.toContain(adminToken);
  });
});
