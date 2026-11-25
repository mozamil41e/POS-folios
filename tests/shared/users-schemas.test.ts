import { describe, expect, it } from 'vitest';
import { parseNewRole, parseNewUser, parseRoleUpdate, parseUserUpdate } from '../../shared/schemas/users.ts';

// R2.4b: the user and role rules shared by the server and the UI.
const problems = (parsed: { ok: boolean; problems?: { field: string; reason: string }[] }) =>
  parsed.ok ? [] : (parsed.problems ?? []).map((p) => `${p.field}:${p.reason}`);

describe('parseNewUser', () => {
  it('normalises the input as the legacy route did', () => {
    expect(
      parseNewUser({ full_name: ' Ali ', email: ' ALI@Test.Local ', phone: ' 0500 ', password: 'pass-word', role_id: '3' })
    ).toEqual({
      ok: true,
      value: { full_name: 'Ali', email: 'ali@test.local', phone: '0500', password: 'pass-word', role_id: 3, is_active: 1 },
    });
  });

  it('reads is_active like before: only false or 0 deactivate', () => {
    const base = { full_name: 'Ali', email: 'a@b.co', password: 'pass-word', role_id: 1 };
    const active = (v: unknown) => {
      const parsed = parseNewUser({ ...base, is_active: v });
      return parsed.ok ? parsed.value.is_active : null;
    };
    expect([active(false), active(0), active(true), active(1), active('no'), active(undefined)]).toEqual([0, 0, 1, 1, 1, 1]);
  });

  it('turns an unusable role id into 0, which matches no role', () => {
    const roleId = (v: unknown) => {
      const parsed = parseNewUser({ full_name: 'Ali', email: 'a@b.co', password: 'pass-word', role_id: v });
      return parsed.ok ? parsed.value.role_id : null;
    };
    expect([roleId(undefined), roleId('x'), roleId(2.5), roleId(null), roleId('4')]).toEqual([0, 0, 0, 0, 4]);
  });

  it('checks name, email, phone, then password', () => {
    expect(problems(parseNewUser({ full_name: 'A', email: 'bad', phone: 'abc', password: 'short' }))).toEqual([
      'full_name:TOO_SHORT',
      'email:INVALID_EMAIL',
      'phone:INVALID_PHONE',
      'password:TOO_SHORT',
    ]);
    expect(problems(parseNewUser({ full_name: 'Ali', email: 'a@b.co', phone: '1'.repeat(31), password: 'pass-word' }))).toEqual([
      'phone:TOO_LONG',
    ]);
  });
});

describe('parseUserUpdate', () => {
  const existing = { email: 'old@test.local', role_id: 7, is_active: 0 };

  it('keeps email, role and status when not sent; the name and phone are always taken', () => {
    expect(parseUserUpdate({ full_name: 'New Name' }, existing)).toEqual({
      ok: true,
      value: { full_name: 'New Name', email: 'old@test.local', phone: '', password: '', role_id: 7, is_active: 0 },
    });
    expect(problems(parseUserUpdate({}, existing))).toEqual(['full_name:REQUIRED']);
  });

  it('treats an empty password as "keep it" and checks any other', () => {
    expect(parseUserUpdate({ full_name: 'Ali', password: '' }, existing).ok).toBe(true);
    expect(problems(parseUserUpdate({ full_name: 'Ali', password: 'short' }, existing))).toEqual(['password:TOO_SHORT']);
    const changed = parseUserUpdate({ full_name: 'Ali', password: 'long-enough', is_active: true }, existing);
    expect(changed.ok ? [changed.value.password, changed.value.is_active] : null).toEqual(['long-enough', 1]);
  });
});

describe('role rules', () => {
  it('falls back to the Arabic name and description on create', () => {
    expect(parseNewRole({ name_ar: ' مشرف ', description_ar: 'وصف', permissions: ['pos.access', 'bogus'] })).toEqual({
      ok: true,
      value: { name_ar: 'مشرف', name_en: 'مشرف', description_ar: 'وصف', description_en: 'وصف', permissions: ['pos.access'] },
    });
  });

  it('keeps fields not sent on update, and permissions only when not sent', () => {
    const existing = { name_ar: 'قديم', name_en: 'Old', description_ar: 'أ', description_en: 'A' };
    expect(parseRoleUpdate({ description_en: '' }, existing)).toEqual({
      ok: true,
      value: { name_ar: 'قديم', name_en: 'Old', description_ar: 'أ', description_en: '', permissions: undefined },
    });
    const replaced = parseRoleUpdate({ permissions: [] }, existing);
    expect(replaced.ok ? replaced.value.permissions : null).toEqual([]);
  });

  it('requires a name of 2 to 60 characters', () => {
    expect(problems(parseNewRole({}))).toEqual(['name_ar:REQUIRED']);
    expect(problems(parseNewRole({ name_ar: 'م' }))).toEqual(['name_ar:TOO_SHORT']);
    expect(problems(parseNewRole({ name_ar: 'م'.repeat(61) }))).toEqual(['name_ar:TOO_LONG']);
    expect(parseNewRole({ name_ar: 'م'.repeat(60) }).ok).toBe(true);
  });
});
