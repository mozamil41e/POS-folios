import { describe, expect, it } from 'vitest';
import { parseLoginInput, parseSetupInput } from '../../shared/schemas/auth.ts';

// R2.4b: the sign-in and first-run setup rules shared by the server and the UI.
describe('parseSetupInput', () => {
  it('trims the name, trims and lower-cases the email, and never trims the password', () => {
    expect(parseSetupInput({ full_name: '  Owner  ', email: ' Owner@Test.Local ', password: ' pass word ' })).toEqual({
      ok: true,
      value: { full_name: 'Owner', email: 'owner@test.local', password: ' pass word ' },
    });
  });

  it('gives a reason for each kind of problem', () => {
    const reasons = (raw: Record<string, unknown>) => {
      const parsed = parseSetupInput(raw);
      return parsed.ok ? [] : parsed.problems.map((p) => `${p.field}:${p.reason}`);
    };
    expect(reasons({})).toEqual(['full_name:REQUIRED', 'email:REQUIRED', 'password:REQUIRED']);
    expect(reasons({ full_name: 'A', email: 'a@b', password: 'short' })).toEqual([
      'full_name:TOO_SHORT',
      'email:INVALID_EMAIL',
      'password:TOO_SHORT',
    ]);
    expect(
      reasons({ full_name: 'x'.repeat(101), email: `${'a'.repeat(155)}@b.com`, password: 'p'.repeat(129) })
    ).toEqual(['full_name:TOO_LONG', 'email:TOO_LONG', 'password:TOO_LONG']);
    expect(reasons({ full_name: 'Ok', email: 'ok@test.local', password: 12345678 })).toEqual(['password:REQUIRED']);
  });

  it('accepts the limits exactly', () => {
    const parsed = parseSetupInput({
      full_name: 'x'.repeat(100),
      email: `${'a'.repeat(153)}@b.com`, // 160 characters
      password: 'p'.repeat(8),
    });
    expect(parsed.ok).toBe(true);
  });
});

describe('parseLoginInput', () => {
  it('only requires both fields, so a wrong format just fails to sign in', () => {
    expect(parseLoginInput({ email: ' Who@Ever ', password: 'x' })).toEqual({
      ok: true,
      value: { email: 'who@ever', password: 'x' },
    });
    const missing = parseLoginInput({ email: '', password: '' });
    expect(missing.ok).toBe(false);
    expect(missing.ok ? [] : missing.problems.map((p) => p.message)).toEqual([
      'Email and password are required.',
      'Email and password are required.',
    ]);
  });
});
