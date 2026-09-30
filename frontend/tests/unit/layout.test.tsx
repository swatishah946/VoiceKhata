import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardLayout from '@/app/dashboard/layout';
import { setAuthToken } from '@/lib/api';

const push = vi.fn();
let pathname = '/dashboard/parties/abc';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), usePathname: () => pathname }));

beforeEach(() => {
  push.mockClear();
  pathname = '/dashboard/parties/abc';
});

describe('dashboard auth guard + navigation', () => {
  it('sends visitors without a token to /login and renders nothing', () => {
    const { container } = render(<DashboardLayout><p>secret ledger</p></DashboardLayout>);
    expect(push).toHaveBeenCalledWith('/login');
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the page when logged in, with the section highlighted on detail pages', () => {
    setAuthToken('t');
    render(<DashboardLayout><p>secret ledger</p></DashboardLayout>);
    expect(screen.getByText('secret ledger')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
    const active = screen.getAllByRole('link', { name: /parties & ledgers/i })[0];
    expect(active.className).toContain('bg-blue-600');
    expect(screen.getAllByRole('link', { name: /overview/i })[0].className).not.toContain('bg-blue-600');
  });

  it('sign out clears the token', async () => {
    setAuthToken('t');
    render(<DashboardLayout><p>x</p></DashboardLayout>);
    await userEvent.click(screen.getByRole('button', { name: /sign out/i }));
    expect(localStorage.getItem('voicekhata_token')).toBeNull();
    expect(push).toHaveBeenCalledWith('/login');
  });
});
