import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PartiesPage from '@/app/dashboard/parties/page';
import WorkersPage from '@/app/dashboard/workers/page';
import Home from '@/app/page';
import { setAuthToken } from '@/lib/api';
import { mockApi } from './helpers';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useParams: () => ({ id: 'p1' }) }));

describe('parties list', () => {
  const parties = [
    { id: 'p1', name: 'Siddhi Stone', type: 'customer', outstanding_balance: '21500.00' },
    { id: 'p2', name: 'Shiv Roadlines', type: 'transporter', outstanding_balance: '-700.00' },
  ];

  it('links every party to its khata page, owed amounts in red', async () => {
    mockApi({ 'GET /parties': { body: parties } });
    render(<PartiesPage />);
    const link = await screen.findByRole('link', { name: /siddhi stone/i });
    expect(link).toHaveAttribute('href', '/dashboard/parties/p1');
    expect(screen.getByText('₹21,500')).toHaveClass('text-red-400');
    expect(screen.getByText('-₹700')).toHaveClass('text-emerald-400');
  });

  it('search filters by name', async () => {
    mockApi({ 'GET /parties': { body: parties } });
    render(<PartiesPage />);
    await screen.findByText('Siddhi Stone');
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'shiv');
    expect(screen.queryByText('Siddhi Stone')).not.toBeInTheDocument();
    expect(screen.getByText('Shiv Roadlines')).toBeInTheDocument();
    await userEvent.clear(screen.getByPlaceholderText(/search/i));
    await userEvent.type(screen.getByPlaceholderText(/search/i), 'zzz');
    expect(screen.getByText('No parties found')).toBeInTheDocument();
  });
});

describe('workers list', () => {
  it('shows advances and links to the worker page', async () => {
    mockApi({ 'GET /workers': { body: [{ id: 'w1', name: 'Mohan', advances_taken: '800.00', net_due: '-800.00' }] } });
    render(<WorkersPage />);
    expect(await screen.findByRole('link', { name: /mohan/i })).toHaveAttribute('href', '/dashboard/workers/w1');
    expect(screen.getAllByText('₹800')).toHaveLength(2);
  });

  it('empty state', async () => {
    mockApi({ 'GET /workers': { body: [] } });
    render(<WorkersPage />);
    expect(await screen.findByText('No workers found')).toBeInTheDocument();
  });
});

describe('home page', () => {
  it('sends logged-in users to the dashboard and others to login', () => {
    render(<Home />);
    expect(push).toHaveBeenLastCalledWith('/login');
    setAuthToken('t');
    render(<Home />);
    expect(push).toHaveBeenLastCalledWith('/dashboard');
  });
});
