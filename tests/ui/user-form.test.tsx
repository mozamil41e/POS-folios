// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { UsersPermissionsView } from '../../src/components/UsersPermissionsView.tsx';
import type { RoleRecord } from '../../shared/types.ts';
import { CASHIER_PERMISSIONS, admin, resolves } from './fixtures.ts';

const CASHIER_ROLE: RoleRecord = {
  id: 2,
  slug: 'cashier',
  name_ar: 'كاشير',
  name_en: 'Cashier',
  description_ar: '',
  description_en: '',
  permissions: CASHIER_PERMISSIONS,
  is_system: 0,
  created_at: '2026-11-01T08:00:00.000Z',
};

// Reported bug: in the "add user" form the browser filled the admin's own saved
// email into the phone field. The fields now tell the browser this form is for
// a new account, not a login.
describe('add-user form autofill (R1.6)', () => {
  it('marks the phone, email and password fields so saved logins are not filled in', () => {
    render(
      <UsersPermissionsView
        lang="en"
        currentUser={admin()}
        users={[]}
        roles={[CASHIER_ROLE]}
        pageSize={10}
        onCreateUser={resolves(true)}
        onUpdateUser={resolves(true)}
        onDeleteUser={resolves(true)}
        onCreateRole={resolves(null)}
        onUpdateRole={resolves(true)}
        onDeleteRole={resolves(true)}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add User' }));

    const phone = screen.getByLabelText('Phone') as HTMLInputElement;
    expect(phone.type).toBe('tel');
    expect(phone.getAttribute('autocomplete')).toBe('off');
    expect(phone.value).toBe('');

    const email = screen.getByLabelText('Email') as HTMLInputElement;
    expect(email.getAttribute('autocomplete')).toBe('off');

    const password = screen.getByLabelText('Password') as HTMLInputElement;
    expect(password.getAttribute('autocomplete')).toBe('new-password');

    expect(phone.closest('form')?.getAttribute('autocomplete')).toBe('off');
  });
});
