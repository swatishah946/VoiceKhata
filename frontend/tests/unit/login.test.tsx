import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import { mockApi, stubLocation } from './helpers';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

beforeEach(() => push.mockClear());

async function login(password: string) {
  render(<LoginPage />);
  await userEvent.type(screen.getByPlaceholderText('Enter Dashboard Password'), password);
  await userEvent.click(screen.getByRole('button', { name: /secure login/i }));
}

describe('login page', () => {
  it('logs in, stores the token and opens the dashboard', async () => {
    const fetchMock = mockApi({ 'POST /auth/login': { body: { token: 'jwt123' } } });
    await login('papa-ki-dukaan');
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toEqual({ password: 'papa-ki-dukaan' });
    expect(localStorage.getItem('voicekhata_token')).toBe('jwt123');
    expect(push).toHaveBeenCalledWith('/dashboard');
  });

  it('shows "Invalid password" instead of silently reloading (regression)', async () => {
    const loc = stubLocation();
    mockApi({ 'POST /auth/login': { status: 401, body: { error: 'Invalid password' } } });
    await login('wrong');
    expect(await screen.findByText('Invalid password')).toBeInTheDocument();
    expect(loc.href).toBe('http://localhost/dashboard'); // no redirect
    expect(push).not.toHaveBeenCalled();
  });

  it('explains the lockout after too many attempts', async () => {
    mockApi({ 'POST /auth/login': { status: 429 } });
    await login('wrong');
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
  });

  it('shows a message when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await login('x');
    expect(await screen.findByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /secure login/i })).toBeEnabled();
  });
});
