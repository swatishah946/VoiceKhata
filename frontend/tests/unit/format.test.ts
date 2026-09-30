import { describe, expect, it } from 'vitest';
import { describeEntry, entryAmount, formatCurrency, formatDateTime, formatPaise, monthStartIST, statusBadge, todayIST } from '@/lib/format';
import type { Transaction } from '@/lib/types';
import { tx } from './helpers';

describe('formatting', () => {
  it('formats rupees with Indian grouping and never shows NaN', () => {
    expect(formatCurrency('1234567.4')).toBe('₹12,34,567');
    expect(formatCurrency('1500.5', 2)).toBe('₹1,500.50');
    expect(formatCurrency(null)).toBe('₹0');
    expect(formatCurrency('abc')).toBe('₹0');
    expect(formatPaise(15750_00)).toBe('₹15,750');
  });

  it('shows India time even when the computer is set to UTC (TZ=UTC in this test run)', () => {
    expect(formatDateTime('2026-09-29T20:00:00Z')).toMatch(/30 Sept?,? 01:30 am/i);
  });

  it('"today" and "this month" follow the Indian calendar', () => {
    // 30 Sep 20:00 UTC is already 1 Oct in India
    expect(todayIST(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(monthStartIST(new Date('2026-09-30T20:00:00Z'))).toBe('2026-10-01');
    expect(monthStartIST(new Date('2026-09-15T06:00:00Z'))).toBe('2026-09-01');
  });

  it('status badges, with a safe fallback for unknown statuses', () => {
    expect(statusBadge('reversed').label).toBe('Undone');
    expect(statusBadge('cancelled').label).toBe('Cancelled');
    expect(statusBadge('weird').label).toBe('Pending');
  });

  it('uses the bill for dispatches and the amount for payments', () => {
    expect(entryAmount({ transaction_type: 'dispatch', total_amount: '100', advance_paid: '0' })).toBe(100);
    expect(entryAmount({ transaction_type: 'payment', total_amount: '0', advance_paid: '50' })).toBe(50);
  });

  it('describes entries in plain words', () => {
    expect(describeEntry(tx() as unknown as Transaction)).toBe('Dispatch · 2x1½ 500 sqft @ ₹31.5');
    expect(describeEntry(tx({ transaction_type: 'payment' }) as unknown as Transaction)).toBe('Payment received');
    expect(describeEntry(tx({ stone_type_text: null, sqft_quantity: null, unit_rate: null }) as unknown as Transaction)).toBe('Dispatch');
  });
});
