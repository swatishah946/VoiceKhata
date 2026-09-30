'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Download, Building2, HardHat } from 'lucide-react';
import { downloadFile, fetchApi } from '@/lib/api';
import { describeEntry, entryAmount, formatCurrency, formatDate, formatDateTime, statusBadge } from '@/lib/format';
import type { PartyDetail } from '@/lib/types';

/** Detail page for one party or worker: balance, every entry, and a khata PDF download. */
export default function PersonDetail({ id, kind }: { id: string; kind: 'party' | 'worker' }) {
  const base = kind === 'party' ? '/parties' : '/workers';
  const [data, setData] = useState<PartyDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'not_found' | 'error'>('loading');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchApi(`${base}/${id}`);
        if (cancelled) return;
        if (res.status === 404) return setState('not_found');
        if (!res.ok) return setState('error');
        setData(await res.json());
        setState('ready');
      } catch {
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, id]);

  async function download() {
    if (!data) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadFile(`${base}/${id}/khata.pdf`, `Khata_${data.name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }

  const back = (
    <Link href={`/dashboard${base}`} className="inline-flex items-center gap-2 text-slate-400 hover:text-white text-sm">
      <ArrowLeft className="w-4 h-4" /> Back to {kind === 'party' ? 'parties' : 'workers'}
    </Link>
  );

  if (state === 'loading') {
    return <div role="status" aria-label="Loading" className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>;
  }
  if (state !== 'ready' || !data) {
    return (
      <div className="space-y-4">
        {back}
        <p className="text-slate-400">{state === 'not_found' ? 'This khata was not found.' : 'Could not load this khata. Please try again.'}</p>
      </div>
    );
  }

  const isParty = kind === 'party';
  const due = isParty ? Number(data.outstanding_balance ?? 0) : Number(data.advances_taken ?? 0);
  const Icon = isParty ? Building2 : HardHat;

  return (
    <div className="space-y-6 max-w-5xl">
      {back}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-3 rounded-xl ${isParty ? 'bg-blue-500/10 text-blue-400' : 'bg-purple-500/10 text-purple-400'}`}>
            <Icon className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-tight">{data.name}</h1>
            <p className="text-slate-400 capitalize">{data.type}</p>
          </div>
        </div>
        <button
          onClick={download}
          disabled={downloading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50"
        >
          <Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download Khata PDF'}
        </button>
      </div>
      {downloadError && <p role="alert" className="text-red-400 text-sm">{downloadError}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {isParty ? (
          <>
            <Stat label="Outstanding (to collect)" value={formatCurrency(due, 2)} tone={due > 0 ? 'red' : 'green'} />
            <Stat label="Total billed" value={formatCurrency(data.total_billed, 2)} />
            <Stat label="Total received" value={formatCurrency(data.total_paid, 2)} hint={data.last_payment_date ? `Last payment ${formatDate(data.last_payment_date)}` : undefined} />
          </>
        ) : (
          <Stat label="Advance outstanding" value={formatCurrency(due, 2)} tone={due > 0 ? 'red' : 'green'} />
        )}
      </div>

      <section aria-labelledby="entries-heading">
        <h2 id="entries-heading" className="text-xl font-bold text-white mb-3">Entries</h2>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-x-auto">
          {data.transactions.length === 0 ? (
            <p className="p-8 text-center text-slate-500">No entries yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-slate-400 text-left border-b border-slate-800">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Details</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {data.transactions.map((tx) => {
                  const badge = statusBadge(tx.status);
                  return (
                    <tr key={tx.id} className="text-slate-300">
                      <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(tx.created_at)}</td>
                      <td className="px-4 py-3">{describeEntry(tx)}{tx.ref_code && <span className="text-slate-500"> · {tx.ref_code}</span>}</td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{formatCurrency(entryAmount(tx), 2)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full border ${badge.className}`}>{badge.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: 'red' | 'green'; hint?: string }) {
  const color = tone === 'red' ? 'text-red-400' : tone === 'green' ? 'text-emerald-400' : 'text-white';
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
      <p className="text-sm text-slate-400">{label}</p>
      <p className={`text-2xl font-bold mt-2 ${color}`}>{value}</p>
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  );
}
