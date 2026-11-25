import crypto from 'node:crypto';

/**
 * Password hashing (moved from src/server/db.ts in R2.4b, unchanged).
 *
 * The async scrypt runs on libuv's thread pool, so a sign-in does not block
 * other requests (R1.9, SEC-07). Same parameters as the original scryptSync
 * code (Node defaults, 64-byte key) and the same stored format, `salt:hash`
 * in hex, so every stored password still verifies.
 *
 * Hashing is slow on purpose: always do it BEFORE withTransaction(), never inside.
 */
function scryptAsync(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt);
  return `${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  try {
    const derived = await scryptAsync(password, salt);
    const expected = Buffer.from(hexHash, 'hex');
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// Compared against when the email is unknown, so both cases take the same
// time and the response does not reveal which emails have accounts.
let timingDummyHash: Promise<string> | null = null;
export const dummyPasswordHash = (): Promise<string> => (timingDummyHash ??= hashPassword(crypto.randomUUID()));
