// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthView } from '../../src/components/AuthView.tsx';
import { callback } from './fixtures.ts';

type Reply = { status: number; body: unknown };

/** Answers /api/auth/status as an installed system, and the sign-in/setup call with `reply`. */
function mockServer(reply: Reply, hasUsers = true) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    if (url.endsWith('/api/auth/status')) {
      return new Response(JSON.stringify({ hasUsers, setupTokenRequired: false }), { status: 200 });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function renderAuth() {
  render(
    <AuthView
      lang="en"
      darkMode={false}
      onToggleLang={callback()}
      onToggleDarkMode={callback()}
      onAuthSuccess={callback()}
    />
  );
}

async function signIn(email: string, password: string) {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

const sentLogins = (fetchMock: ReturnType<typeof mockServer>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/api/auth/login'));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('sign-in screen (R1.9)', () => {
  it('tells the user how many attempts are left', async () => {
    mockServer({ status: 401, body: { error: 'Invalid email or password.', code: 'INVALID_CREDENTIALS', attemptsLeft: 2 } });
    renderAuth();
    await signIn('cashier@test.local', 'wrong-pass');

    expect(await screen.findByText(/Attempts left before a temporary pause: 2/)).toBeTruthy();
  });

  it('shows a countdown and blocks the button while the account is paused', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const fetchMock = mockServer({ status: 429, body: { code: 'LOGIN_LOCKED', retryAfterSeconds: 90 } });
    renderAuth();
    await signIn('cashier@test.local', 'wrong-pass');

    const alert = await screen.findByText(/Sign-in for this account is paused/);
    expect(alert.textContent).toContain('Try again in 1:30');
    const button = screen.getByRole('button', { name: 'Try again in 1:30' });
    expect(button.hasAttribute('disabled')).toBe(true);

    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole('button', { name: 'Try again in 1:00' })).toBeTruthy();

    // Submitting during the pause sends nothing.
    fireEvent.submit(button.closest('form')!);
    expect(sentLogins(fetchMock)).toHaveLength(1);

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    expect(screen.getByRole('button', { name: 'Sign In' }).hasAttribute('disabled')).toBe(false);
    expect(screen.queryByText(/Sign-in for this account is paused/)).toBeNull();
  });

  it('lets an account pause apply to that email only', async () => {
    mockServer({ status: 429, body: { code: 'LOGIN_LOCKED', retryAfterSeconds: 900 } });
    renderAuth();
    await signIn('locked@test.local', 'wrong-pass');
    await screen.findByText(/Sign-in for this account is paused/);

    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'manager@test.local' } });
    expect(screen.getByRole('button', { name: 'Sign In' }).hasAttribute('disabled')).toBe(false);
  });

  it('pauses every attempt when the network is rate limited', async () => {
    mockServer({ status: 429, body: { code: 'RATE_LIMITED', retryAfterSeconds: 600 } });
    renderAuth();
    await signIn('someone@test.local', 'wrong-pass');

    expect(await screen.findByText(/Too many failed sign-in attempts from this network/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email Address'), { target: { value: 'other@test.local' } });
    expect(screen.getByRole('button', { name: 'Try again in 10:00' }).hasAttribute('disabled')).toBe(true);
  });

  it('still sends a short password at sign-in (accounts created before R1.9)', async () => {
    const fetchMock = mockServer({ status: 401, body: { code: 'INVALID_CREDENTIALS', attemptsLeft: 4 } });
    renderAuth();
    await signIn('old@test.local', 'abc123');
    await waitFor(() => expect(sentLogins(fetchMock)).toHaveLength(1));
  });
});

describe('first-run setup screen (R1.9)', () => {
  it('requires at least 8 characters for the administrator password', async () => {
    mockServer({ status: 201, body: {} }, false);
    renderAuth();
    await waitFor(() => expect(screen.getByLabelText('Password')).toBeTruthy());
    expect(screen.getByLabelText('Password').getAttribute('minlength')).toBe('8');
  });
});
