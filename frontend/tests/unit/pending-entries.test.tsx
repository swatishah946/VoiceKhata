import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PendingEntries from '@/components/PendingEntries';
import type { Transaction } from '@/lib/types';
import { mockApi, tx } from './helpers';

const entry = tx({
  status: 'pending_confirmation',
  total_amount: '15750.00',
  price_warning: { masterRate: 31.5, spokenRate: 25, diffPercent: -20.6 },
}) as unknown as Transaction;

describe('pending entries panel', () => {
  it('renders nothing when there is nothing to confirm', () => {
    const { container } = render(<PendingEntries entries={[]} onChanged={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows who, how much, the ref code and the price-list warning', () => {
    render(<PendingEntries entries={[entry]} onChanged={() => undefined} />);
    const item = screen.getByRole('listitem');
    expect(within(item).getByText('Siddhi Stone')).toBeInTheDocument();
    expect(item).toHaveTextContent('₹15,750.00');
    expect(item).toHaveTextContent('Ref K7Q2');
    expect(item).toHaveTextContent('Price list rate ₹31.5, entered ₹25 (-20.6%)');
    expect(screen.getByRole('heading', { name: /waiting for confirmation \(1\)/i })).toBeInTheDocument();
  });

  it('Confirm posts to the API and refreshes the page data', async () => {
    const fetchMock = mockApi({ [`POST /transactions/${entry.id}/confirm`]: { body: { status: 'confirmed' } } });
    const onChanged = vi.fn();
    render(<PendingEntries entries={[entry]} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm entry K7Q2' }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]!.method).toBe('POST');
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows the reason when it was already confirmed on WhatsApp (409)', async () => {
    mockApi({ [`POST /transactions/${entry.id}/confirm`]: { status: 409, body: { error: 'Entry is not pending' } } });
    const onChanged = vi.fn();
    render(<PendingEntries entries={[entry]} onChanged={onChanged} />);
    await userEvent.click(screen.getByRole('button', { name: 'Confirm entry K7Q2' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Entry is not pending');
    expect(onChanged).toHaveBeenCalled(); // list refreshes so the stale entry disappears
  });

  it('Cancel asks first, and does nothing if the user says no', async () => {
    const fetchMock = mockApi({ [`POST /transactions/${entry.id}/cancel`]: { body: {} } });
    const ask = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<PendingEntries entries={[entry]} onChanged={() => undefined} />);
    const cancel = screen.getByRole('button', { name: 'Cancel entry K7Q2' });
    await userEvent.click(cancel);
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(cancel);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
