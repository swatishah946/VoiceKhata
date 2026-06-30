'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { Wallet, TrendingUp, ArrowUpRight, ArrowDownRight, Activity } from 'lucide-react';

export default function DashboardOverview() {
  const [analytics, setAnalytics] = useState({ totalMarketDue: 0, monthlySales: 0 });
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [analyticsRes, txRes] = await Promise.all([
          fetchApi('/analytics'),
          fetchApi('/transactions')
        ]);
        
        if (analyticsRes.ok) setAnalytics(await analyticsRes.json());
        if (txRes.ok) setTransactions(await txRes.json());
      } catch (err) {
        console.error('Failed to load dashboard data', err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div></div>;
  }

  return (
    <div className="space-y-6">
      
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Overview</h1>
        <p className="text-slate-400 mt-1">Your VoiceKhata business pulse.</p>
      </div>

      {/* Analytics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* Market Outstanding Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">
            <Wallet className="w-24 h-24 text-blue-500" />
          </div>
          <div className="relative z-10">
            <p className="text-sm font-medium text-slate-400 flex items-center gap-2">
              Total Market Outstanding
            </p>
            <h2 className="text-4xl font-bold text-white mt-4 tracking-tight">
              {formatCurrency(analytics.totalMarketDue)}
            </h2>
            <div className="flex items-center gap-2 mt-4 text-emerald-400 text-sm font-medium">
              <span className="bg-emerald-400/10 text-emerald-400 px-2 py-1 rounded-md flex items-center gap-1">
                <ArrowUpRight className="w-3 h-3" /> To Collect
              </span>
            </div>
          </div>
        </div>

        {/* Monthly Sales Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-6 opacity-10 group-hover:scale-110 transition-transform">
            <TrendingUp className="w-24 h-24 text-emerald-500" />
          </div>
          <div className="relative z-10">
            <p className="text-sm font-medium text-slate-400 flex items-center gap-2">
              Confirmed Sales (This Month)
            </p>
            <h2 className="text-4xl font-bold text-white mt-4 tracking-tight">
              {formatCurrency(analytics.monthlySales)}
            </h2>
            <div className="flex items-center gap-2 mt-4 text-blue-400 text-sm font-medium">
              <span className="bg-blue-400/10 text-blue-400 px-2 py-1 rounded-md flex items-center gap-1">
                <Activity className="w-3 h-3" /> Active
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* Recent Transactions List */}
      <div className="mt-8">
        <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
        
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          {transactions.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No transactions recorded yet. Send a voice note!</div>
          ) : (
            <div className="divide-y divide-slate-800/50">
              {transactions.slice(0, 10).map((tx) => (
                <div key={tx.id} className="p-4 sm:px-6 hover:bg-slate-800/50 transition-colors flex items-center justify-between">
                  <div>
                    <p className="text-white font-medium">
                      {tx.transaction_type === 'dispatch' ? 'Dispatch to' : 
                       tx.transaction_type === 'payment' ? 'Payment from' : 'Advance to'}{' '}
                      <span className="text-blue-400">{tx.party_name || tx.worker_name}</span>
                    </p>
                    <p className="text-sm text-slate-500 mt-1">
                      {new Date(tx.created_at).toLocaleDateString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  
                  <div className="text-right">
                    <p className={`font-bold ${tx.transaction_type === 'dispatch' ? 'text-white' : 'text-emerald-400'}`}>
                      {tx.transaction_type === 'dispatch' ? '+' : '-'}{formatCurrency(tx.total_amount || tx.advance_paid)}
                    </p>
                    <span className={`inline-flex mt-1 text-xs px-2 py-0.5 rounded-full border ${
                      tx.status === 'confirmed' 
                        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' 
                        : 'border-amber-500/20 bg-amber-500/10 text-amber-400'
                    }`}>
                      {tx.status === 'confirmed' ? 'Confirmed' : 'Pending WhatsApp'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
