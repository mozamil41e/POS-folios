/**
 * A new Idempotency-Key for one sale attempt (R2.5a). crypto.randomUUID()
 * exists only on https or localhost; when the till is opened over plain http
 * from another device on the restaurant network, 16 random bytes from
 * crypto.getRandomValues() (available everywhere) are used instead.
 */
export function newIdempotencyKey(): string {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') return webCrypto.randomUUID();
  const bytes = new Uint8Array(16);
  webCrypto.getRandomValues(bytes);
  return `sale-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}
