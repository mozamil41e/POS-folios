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
// Since R2.4b it goes through the auth and users modules (no SQL here).
import { db, initDatabase } from '../src/server/db.ts';
import { kysely } from '../server/src/db/kysely.ts';
import { withTransaction } from '../server/src/db/transaction.ts';
import { clearLoginFailures, hashPassword, revokeAllSessionsForUser } from '../server/src/modules/auth/service.ts';
import * as users from '../server/src/modules/users/repository.ts';
import { EMAIL_PATTERN, FULL_NAME_MAX_LENGTH, FULL_NAME_MIN_LENGTH } from '../shared/schemas/auth.ts';
import { INPUT_LIMITS } from '../shared/schemas/common.ts';
import { isValidPasswordLength } from '../shared/validation.ts';

function fail(message: string): never {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const fullName = (process.env.ADMIN_NAME ?? '').trim();
const password = process.env.ADMIN_PASSWORD ?? '';

if (!EMAIL_PATTERN.test(email) || email.length > INPUT_LIMITS.email) {
  fail('ADMIN_EMAIL must be a valid email address.');
}
if (!isValidPasswordLength(password)) {
  fail('ADMIN_PASSWORD must be between 8 and 128 characters.');
}

initDatabase();
const passwordHash = await hashPassword(password);

const adminRole = await users.roles.findBySlug(kysely, 'admin');
if (!adminRole) {
  fail('The system administrator role is missing from the database.');
}

const existingId = await users.users.findIdByEmail(kysely, email);

if (existingId !== undefined) {
  await withTransaction(async (trx) => {
    await users.users.restoreAdmin(trx, existingId, {
      password_hash: passwordHash,
      role: adminRole.slug,
      role_id: adminRole.id,
    });
    await revokeAllSessionsForUser(existingId, trx);
    await clearLoginFailures([email], trx); // also lifts a sign-in lockout (R1.9)
  });
  console.log(
    `create-admin: restored administrator access for ${email} (user #${existingId}); its sessions were revoked.`
  );
} else {
  if (fullName.length < FULL_NAME_MIN_LENGTH || fullName.length > FULL_NAME_MAX_LENGTH) {
    fail('ADMIN_NAME (2-100 characters) is required to create a new account.');
  }
  const userId = await withTransaction((trx) =>
    users.users.insert(trx, {
      full_name: fullName,
      email,
      phone: '',
      password_hash: passwordHash,
      role: adminRole.slug,
      role_id: adminRole.id,
      is_active: 1,
      created_at: new Date().toISOString(),
    })
  );
  console.log(`create-admin: created administrator ${email} (user #${userId}).`);
}

db.close();
