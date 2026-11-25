// Emergency recovery: create an administrator, or restore administrator access
// to an existing account (reset its password, re-activate it, make it admin and
// revoke its sessions). Self-registration is closed after first-run setup (R1.2),
// so this is the way back in if every administrator account is lost.
//
// Input comes from environment variables so the password is not a CLI argument:
//   PowerShell:  $env:ADMIN_EMAIL='owner@example.com'; $env:ADMIN_NAME='Owner'; $env:ADMIN_PASSWORD='...'; npm run admin:create
//   Bash:        ADMIN_EMAIL=owner@example.com ADMIN_NAME=Owner ADMIN_PASSWORD='...' npm run admin:create
//
// It uses the same database as the server: MIZAN_DB_PATH, or ./data/mizan-pos.db.
import { db, getRoleBySlug, initDatabase } from '../src/server/db.ts';
import { hashPassword } from '../server/src/modules/auth/passwords.ts';
import { clearLoginFailures, revokeAllSessionsForUser } from '../server/src/modules/auth/service.ts';
import { isValidPasswordLength } from '../shared/validation.ts';

function fail(message: string): never {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const fullName = (process.env.ADMIN_NAME ?? '').trim();
const password = process.env.ADMIN_PASSWORD ?? '';

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) {
  fail('ADMIN_EMAIL must be a valid email address.');
}
if (!isValidPasswordLength(password)) {
  fail('ADMIN_PASSWORD must be between 8 and 128 characters.');
}

initDatabase();
const passwordHash = await hashPassword(password);

const adminRole = getRoleBySlug('admin');
if (!adminRole) {
  fail('The system administrator role is missing from the database.');
}

const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email) as
  | { id: number }
  | undefined;

if (existing) {
  db.prepare(
    'UPDATE users SET password_hash = ?, role = ?, role_id = ?, is_active = 1 WHERE id = ?'
  ).run(passwordHash, adminRole.slug, adminRole.id, existing.id);
  await revokeAllSessionsForUser(existing.id);
  await clearLoginFailures(email); // also lifts a sign-in lockout (R1.9)
  console.log(
    `create-admin: restored administrator access for ${email} (user #${existing.id}); its sessions were revoked.`
  );
} else {
  if (fullName.length < 2 || fullName.length > 100) {
    fail('ADMIN_NAME (2-100 characters) is required to create a new account.');
  }
  const info = db
    .prepare(`
      INSERT INTO users (full_name, email, phone, password_hash, role, role_id, is_active, created_at)
      VALUES (?, ?, '', ?, ?, ?, 1, ?)
    `)
    .run(fullName, email, passwordHash, adminRole.slug, adminRole.id, new Date().toISOString());
  console.log(`create-admin: created administrator ${email} (user #${Number(info.lastInsertRowid)}).`);
}

db.close();
