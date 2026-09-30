import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import DashboardOverview from '@/app/dashboard/page';
import { captureDownloads, mockApi, tx } from './helpers';

const summary = {
  date: '2026-09-30', dispatchCount: 2, dispatchTotal: 3150000, paymentsCount: 1, paymentsTotal: 500000,
  advancesTotal: 0, pendingCount: 1, marketDue: 0, topDue: [],
};

function api(overrides: Record<string, unknown> = {}) {
  return mockApi({
    'GET /analytics': { body: { totalMarketDue: 250000, monthlySales: 1200000, pendingCount: 1 } },
    'GET /transactions?limit=10': {
      body: [
        tx({ id: 'a', status: 'confirmed' }),
        tx({ id: 'b', status: 'cancelled', transaction_type: 'payment', advance_paid: '500.00', party_name: 'Ramesh' }),
        tx({ id: 'c', status: 'reversed', transaction_type: 'worker_advance', advance_paid: '200', party_name: null, worker_name: 'Mohan' }),
      ],
    },
    'GET /transactions?status=pending_confirmation&limit=50': { body: [tx({ id: 'p', status: 'pending_confirmation' })] },
    'GET /summary/today': { body: summary },
    ...overrides,
  });
}

describe('dashboard overview', () => {
  it('shows the key numbers', async () => {
    api();
    render(<DashboardOverview />);
    expect(await screen.findByText('₹2,50,000')).toBeInTheDocument(); // market outstanding
    expect(screen.getByText('₹12,00,000')).toBeInTheDocument(); // month sales
    expect(screen.getByText('₹31,500')).toBeInTheDocument(); // today's dispatch (from paise)
    expect(screen.getByText(/2 dispatch · ₹5,000 received/)).toBeInTheDocument();
  });

  it('shows cancelled and undone entries as such (they used to say "Pending")', async () => {
    api();
    render(<DashboardOverview />);
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Undone')).toBeInTheDocument();
    expect(screen.getByText('Mohan')).toBeInTheDocument();
  });

  it('shows pending entries with Confirm buttons', async () => {
    api();
    render(<DashboardOverview />);
    expect(await screen.findByRole('heading', { name: /waiting for confirmation/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /confirm entry/i })).toBeInTheDocument();
  });

  it('re-fetches everything after a confirm', async () => {
    const fetchMock = api({ 'POST /transactions/p/confirm': { body: {} } });
    render(<DashboardOverview />);
    await userEvent.click(await screen.findByRole('button', { name: /confirm entry/i }));
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/analytics'))).toHaveLength(2));
  });

  it('exports this month as CSV', async () => {
    const saved = captureDownloads();
    const fetchMock = api({ 'GET /export/transactions.csv*': { raw: 'date_ist,ref\r\n' } });
    render(<DashboardOverview />);
    await userEvent.click(await screen.findByRole('button', { name: /export this month/i }));
    await vi.waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]).toMatch(/^voicekhata_\d{4}-\d{2}-01_to_\d{4}-\d{2}-\d{2}\.csv$/);
    const url = String(fetchMock.mock.calls.at(-1)![0]);
    expect(url).toMatch(/\/export\/transactions\.csv\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}$/);
  });

  it('tells the user when the server is not answering', async () => {
    api({ 'GET /analytics': { status: 503 } });
    render(<DashboardOverview />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be loaded/i);
  });
});
