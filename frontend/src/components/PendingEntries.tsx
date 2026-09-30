'use client';

import { useState } from 'react';
import { Check, X, AlertTriangle } from 'lucide-react';
import { fetchApi } from '@/lib/api';
import { describeEntry, entryAmount, formatCurrency, formatDateTime, TYPE_LABELS } from '@/lib/format';
import type { Transaction } from '@/lib/types';

/**
 * Entries waiting for "yes". Confirm/Cancel here does the same thing as replying
 * on WhatsApp (same row lock on the server, so both at once can't double-count).
 */
export default function PendingEntries({ entries, onChanged }: { entries: Transaction[]; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function act(id: string, action: 'confirm' | 'cancel') {
    if (action === 'cancel' && !window.confirm('Cancel this entry? It will not be added to the khata.')) return;
    setBusy(id);
    setError('');
    try {
      const res = await fetchApi(`/transactions/${id}/${action}`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Could not ${action} (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(null);
      onChanged(); // refresh either way — someone may have replied on WhatsApp meanwhile
    }
  }

  if (entries.length === 0) return null;

  return (
    <section aria-labelledby="pending-heading" className="bg-amber-500/5 border border-amber-500/20 rounded-2xl overflow-hidden">
      <div className="px-4 sm:px-6 py-4 border-b border-amber-500/10 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5 text-amber-400" />
        <h2 id="pending-heading" className="text-lg font-semibold text-white">
          Waiting for confirmation <span className="text-amber-400">({entries.length})</span>
        </h2>
      </div>
      {error && <p role="alert" className="px-6 pt-3 text-sm text-red-400">{error}</p>}
      <ul className="divide-y divide-slate-800/50">
        {entries.map((tx) => (
          <li key={tx.id} className="p-4 sm:px-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-white font-medium">
                {TYPE_LABELS[tx.transaction_type] ?? 'Entry for'}{' '}
                <span className="text-blue-400">{tx.party_name || tx.worker_name || 'Unknown'}</span>{' '}
                <span className="font-bold">{formatCurrency(entryAmount(tx), 2)}</span>
              </p>
              <p className="text-sm text-slate-500 mt-1">
                {describeEntry(tx)} · {formatDateTime(tx.created_at)}
                {tx.ref_code && <> · Ref {tx.ref_code}</>}
              </p>
              {tx.price_warning && (
                <p className="text-sm text-amber-400 mt-1">
                  ⚠️ Price list rate ₹{tx.price_warning.masterRate}, entered ₹{tx.price_warning.spokenRate} ({tx.price_warning.diffPercent}%)
                </p>
              )}
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => act(tx.id, 'confirm')}
                disabled={busy !== null}
                aria-label={`Confirm entry ${tx.ref_code ?? ''}`.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> {busy === tx.id ? 'Saving…' : 'Confirm'}
              </button>
              <button
                onClick={() => act(tx.id, 'cancel')}
                disabled={busy !== null}
                aria-label={`Cancel entry ${tx.ref_code ?? ''}`.trim()}
                className="flex items-center gap-1 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium disabled:opacity-50"
              >
                <X className="w-4 h-4" /> Cancel
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
