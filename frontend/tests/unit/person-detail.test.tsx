import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PersonDetail from '@/components/PersonDetail';
import { captureDownloads, mockApi, tx } from './helpers';

const party = {
  id: 'p1', name: 'Siddhi Stone', type: 'customer', total_billed: '31500.00', total_paid: '10000.00',
  outstanding_balance: '21500.00', last_payment_date: '2026-09-29T06:00:00Z',
  transactions: [tx({ transaction_type: 'payment', advance_paid: '10000.00' }), tx({ id: 'x2' })],
};

describe('party detail page', () => {
  it('shows the balance, totals and every entry', async () => {
    mockApi({ 'GET /parties/p1': { body: party } });
    render(<PersonDetail id="p1" kind="party" />);
    expect(await screen.findByRole('heading', { name: 'Siddhi Stone' })).toBeInTheDocument();
    expect(screen.getByText('₹21,500.00')).toBeInTheDocument();
    expect(screen.getByText('Last payment 29 Sept 2026', { exact: false })).toBeInTheDocument();
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2 entries
    expect(screen.getByText('Payment received')).toBeInTheDocument();
  });

  it('downloads the khata PDF', async () => {
    const saved = captureDownloads();
    mockApi({ 'GET /parties/p1': { body: party }, 'GET /parties/p1/khata.pdf': { raw: '%PDF' } });
    render(<PersonDetail id="p1" kind="party" />);
    await userEvent.click(await screen.findByRole('button', { name: /download khata pdf/i }));
    await vi.waitFor(() => expect(saved).toEqual(['Khata_Siddhi_Stone.pdf']));
  });

  it('shows download errors', async () => {
    mockApi({ 'GET /parties/p1': { body: party }, 'GET /parties/p1/khata.pdf': { status: 500, body: { error: 'Server error' } } });
    render(<PersonDetail id="p1" kind="party" />);
    await userEvent.click(await screen.findByRole('button', { name: /download khata pdf/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Server error');
  });

  it('handles an unknown id', async () => {
    mockApi({ 'GET /parties/nope': { status: 404 } });
    render(<PersonDetail id="nope" kind="party" />);
    expect(await screen.findByText('This khata was not found.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to parties/i })).toHaveAttribute('href', '/dashboard/parties');
  });

  it('worker page shows the advance outstanding', async () => {
    mockApi({ 'GET /workers/w1': { body: { id: 'w1', name: 'Mohan', type: 'worker', advances_taken: '800.00', net_due: '-800.00', transactions: [] } } });
    render(<PersonDetail id="w1" kind="worker" />);
    expect(await screen.findByText('Advance outstanding')).toBeInTheDocument();
    expect(screen.getByText('₹800.00')).toBeInTheDocument();
    expect(screen.getByText('No entries yet.')).toBeInTheDocument();
  });
});
