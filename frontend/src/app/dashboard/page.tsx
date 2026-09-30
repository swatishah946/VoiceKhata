'use client';

import { useEffect, useState } from 'react';
import { Wallet, TrendingUp, ArrowUpRight, Activity, CalendarDays, Download } from 'lucide-react';
import { downloadFile, fetchApi } from '@/lib/api';
import { entryAmount, formatCurrency, formatDateTime, formatPaise, monthStartIST, statusBadge, todayIST, TYPE_LABELS } from '@/lib/format';
import type { Analytics, TodaySummary, Transaction } from '@/lib/types';
import PendingEntries from '@/components/PendingEntries';

export default function DashboardOverview() {
  const [analytics, setAnalytics] = useState<Analytics>({ totalMarketDue: 0, monthlySales: 0 });
  const [today, setToday] = useState<TodaySummary | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [pending, setPending] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [exportError, setExportError] = useState('');
  const [reloadKey, setReloadKey] = useState(0); // bump to re-fetch (after Confirm/Cancel)

  useEffect(() => {
    let cancelled = false;
    (async () => {
    try {
      const [analyticsRes, txRes, pendingRes, todayRes] = await Promise.all([
        fetchApi('/analytics'),
        fetchApi('/transactions?limit=10'),
        fetchApi('/transactions?status=pending_confirmation&limit=50'),
        fetchApi('/summary/today'),
      ]);
      if (cancelled) return;
      if (analyticsRes.ok) setAnalytics(await analyticsRes.json());
      if (txRes.ok) setTransactions(await txRes.json());
      if (pendingRes.ok) setPending(await pendingRes.json());
      if (todayRes.ok) setToday(await todayRes.json());
      setLoadError(![analyticsRes, txRes, pendingRes, todayRes].every((r) => r.ok));
    } catch {
      if (!cancelled) setLoadError(true);
    } finally {
      if (!cancelled) setLoading(false);
    }
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  async function exportMonth() {
    setExportError('');
    const from = monthStartIST();
    const to = todayIST();
    try {
      await downloadFile(`/export/transactions.csv?from=${from}&to=${to}`, `voicekhata_${from}_to_${to}.csv`);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Export failed');
    }
  }

  if (loading) {
    return <div role="status" aria-label="Loading" className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Overview</h1>
          <p className="text-slate-400 mt-1">Your VoiceKhata business pulse.</p>
        </div>
        <button
          onClick={exportMonth}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-sm font-medium"
        >
          <Download className="w-4 h-4" /> Export this month (CSV)
        </button>
      </div>
      {exportError && <p role="alert" className="text-red-400 text-sm">{exportError}</p>}
      {loadError && (
        <p role="alert" className="text-amber-400 text-sm">
          Some data could not be loaded. The server may be waking up — refresh in a few seconds.
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card icon={<Wallet className="w-24 h-24 text-blue-500" />} label="Total Market Outstanding" value={formatCurrency(analytics.totalMarketDue)}
          tag={<span className="bg-emerald-400/10 text-emerald-400 px-2 py-1 rounded-md flex items-center gap-1"><ArrowUpRight className="w-3 h-3" /> To Collect</span>} />
        <Card icon={<TrendingUp className="w-24 h-24 text-emerald-500" />} label="Confirmed Sales (This Month)" value={formatCurrency(analytics.monthlySales)}
          tag={<span className="bg-blue-400/10 text-blue-400 px-2 py-1 rounded-md flex items-center gap-1"><Activity className="w-3 h-3" /> Active</span>} />
        <Card icon={<CalendarDays className="w-24 h-24 text-amber-500" />} label="Today"
          value={today ? formatPaise(today.dispatchTotal) : '—'}
          tag={today ? (
            <span className="text-slate-400">
              {today.dispatchCount} dispatch · {formatPaise(today.paymentsTotal)} received
            </span>
          ) : null} />
      </div>

      <PendingEntries entries={pending} onChanged={() => setReloadKey((k) => k + 1)} />

      <div className="mt-8">
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No transactions recorded yet. Send a voice note!</div>
          ) : (
            <ul className="divide-y divide-slate-800/50">
              {transactions.map((tx) => {
                const badge = statusBadge(tx.status);
                return (
                  <li key={tx.id} className="p-4 sm:px-6 hover:bg-slate-800/50 transition-colors flex items-center justify-between">
                    <div>
                      <p className="text-white font-medium">
                        {TYPE_LABELS[tx.transaction_type] ?? 'Entry for'}{' '}
                        <span className="text-blue-400">{tx.party_name || tx.worker_name}</span>
                      </p>
                      <p className="text-sm text-slate-500 mt-1">{formatDateTime(tx.created_at)}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-bold ${tx.transaction_type === 'dispatch' ? 'text-white' : 'text-emerald-400'}`}>
                        {tx.transaction_type === 'dispatch' ? '+' : '-'}
                        {formatCurrency(entryAmount(tx))}
                      </p>
                      <span className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-full border ${badge.className}`}>{badge.label}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function Card({ icon, label, value, tag }: { icon: React.ReactNode; label: string; value: string; tag: React.ReactNode }) {
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
      <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">{icon}</div>
      <div className="relative z-10">
        <p className="text-sm font-medium text-slate-400">{label}</p>
        <h2 className="text-4xl font-bold text-white mt-4 tracking-tight">{value}</h2>
        <div className="flex items-center gap-2 mt-4 text-sm font-medium">{tag}</div>
      </div>
    </div>
  );
}
