import type { Transaction, TxStatus } from './types';

/** "1500.5" / 1500.5 / null → "₹1,501" (Indian grouping). Never shows NaN. */
export function formatCurrency(amount: string | number | null | undefined, fractionDigits = 0): string {
  const n = Number(amount ?? 0);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(n) ? n : 0);
}

/** Paise (from /summary/today) → "₹1,501" */
export const formatPaise = (paise: number, fractionDigits = 0) => formatCurrency(paise / 100, fractionDigits);

/** Always India time, whatever the viewer's computer is set to. */
export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
}

/** Today's date in India as YYYY-MM-DD (for the CSV export range). */
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

export function monthStartIST(now: Date = new Date()): string {
  return todayIST(now).slice(0, 8) + '01';
}

export const STATUS_BADGES: Record<TxStatus, { label: string; className: string }> = {
  confirmed: { label: 'Confirmed', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' },
  pending_confirmation: { label: 'Pending', className: 'border-amber-500/20 bg-amber-500/10 text-amber-400' },
  cancelled: { label: 'Cancelled', className: 'border-slate-500/20 bg-slate-500/10 text-slate-400 line-through' },
  reversed: { label: 'Undone', className: 'border-rose-500/20 bg-rose-500/10 text-rose-400 line-through' },
};

export function statusBadge(status: string) {
  return STATUS_BADGES[status as TxStatus] ?? STATUS_BADGES.pending_confirmation;
}

export const TYPE_LABELS: Record<string, string> = {
  dispatch: 'Dispatch to',
  payment: 'Payment from',
  worker_advance: 'Advance to',
  freight_payment: 'Freight paid to',
};

/** The money that matters for a row: the bill for a dispatch, the amount for everything else. */
export function entryAmount(tx: Pick<Transaction, 'transaction_type' | 'total_amount' | 'advance_paid'>): number {
  return Number((tx.transaction_type === 'dispatch' ? tx.total_amount : tx.advance_paid) ?? 0);
}

export function describeEntry(tx: Transaction): string {
  if (tx.transaction_type === 'dispatch') {
    const parts = [tx.stone_type_text, tx.sqft_quantity ? `${Number(tx.sqft_quantity)} sqft` : null,
      tx.unit_rate ? `@ ₹${Number(tx.unit_rate)}` : null].filter(Boolean);
    return parts.length ? `Dispatch · ${parts.join(' ')}` : 'Dispatch';
  }
  return { payment: 'Payment received', worker_advance: 'Advance given', freight_payment: 'Freight paid' }[tx.transaction_type] ?? tx.transaction_type;
}
