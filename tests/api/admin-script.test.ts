import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  bearer,
  createTestApp,
  createUserWithRole,
  makeTempDbPath,
  roleIdBySlug,
  type TestApp,
} from '../helpers/app.ts';

const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs');

describe('npm run admin:create — emergency administrator recovery', () => {
  let t: TestApp;
  let dbPath: string;

  const runScript = (env: Record<string, string>) =>
    spawnSync(process.execPath, [tsxCli, 'scripts/create-admin.ts'], {
      env: { ...process.env, MIZAN_DB_PATH: dbPath, ...env },
      encoding: 'utf8',
    });

  const login = (email: string, password: string) =>
    request(t.app).post('/api/auth/login').send({ email, password });

  let createdOutput = '';

  beforeAll(async () => {
    dbPath = makeTempDbPath();
    const created = runScript({ ADMIN_EMAIL: 'owner@test.local', ADMIN_NAME: 'Owner', ADMIN_PASSWORD: 'owner-pass-1' });
    if (created.status !== 0) {
      throw new Error(`create-admin failed (${created.status}): ${created.stderr}`);
    }
    createdOutput = created.stdout;
    t = await createTestApp({ dbPath });
  });
  afterAll(() => t.cleanup());

  it('rejects invalid input without touching the database', () => {
    const res = runScript({ ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'short' });
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('ADMIN_PASSWORD');
  });

  it('creates an administrator who can sign in, and closes setup', async () => {
    expect(createdOutput).toContain('created administrator owner@test.local');
    const res = await login('owner@test.local', 'owner-pass-1');
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect((await request(t.app).get('/api/auth/status')).body.hasUsers).toBe(true);
  });

  it('restores access to an existing account: new password, sessions revoked', async () => {
    const before = await login('owner@test.local', 'owner-pass-1');
    const oldToken = before.body.token as string;

    const res = runScript({ ADMIN_EMAIL: 'owner@test.local', ADMIN_PASSWORD: 'owner-pass-2' });
    expect({ status: res.status, stderr: res.stderr }).toMatchObject({ status: 0 });
    expect(res.stdout).toContain('restored administrator access');

    expect((await request(t.app).get('/api/auth/me').set(bearer(oldToken))).status).toBe(401);
    expect((await login('owner@test.local', 'owner-pass-1')).status).toBe(401);
    expect((await login('owner@test.local', 'owner-pass-2')).status).toBe(200);
  });

  it('re-activates a deactivated account and makes it an administrator', async () => {
    const adminToken = (await login('owner@test.local', 'owner-pass-2')).body.token as string;
    const { userId } = await createUserWithRole(t.app, adminToken, 'cashier', 'staff@test.local', 'staff-pass-1');
    const cashierRoleId = await roleIdBySlug(t.app, adminToken, 'cashier');
    await request(t.app)
      .put(`/api/users/${userId}`)
      .set(bearer(adminToken))
      .send({ full_name: 'Staff', email: 'staff@test.local', phone: '', role_id: cashierRoleId, is_active: false });
    expect((await login('staff@test.local', 'staff-pass-1')).status).toBe(403);

    const res = runScript({ ADMIN_EMAIL: 'staff@test.local', ADMIN_PASSWORD: 'staff-pass-2' });
    expect({ status: res.status, stderr: res.stderr }).toMatchObject({ status: 0 });

    const after = await login('staff@test.local', 'staff-pass-2');
    expect(after.status).toBe(200);
    expect(after.body.user.role).toBe('admin');
  });
});
