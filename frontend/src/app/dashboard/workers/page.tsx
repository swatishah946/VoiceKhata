'use client';

import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { HardHat, Search, TrendingDown, Users } from 'lucide-react';

export default function WorkersPage() {
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    async function loadWorkers() {
      try {
        const res = await fetchApi('/workers');
        if (res.ok) {
          setWorkers(await res.json());
        }
      } catch (err) {
        console.error('Failed to load workers', err);
      } finally {
        setLoading(false);
      }
    }
    loadWorkers();
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
  };

  const filteredWorkers = workers.filter(w => 
    w.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 max-w-5xl">
      
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <HardHat className="text-purple-500 w-8 h-8" />
            Workers & Advances
          </h1>
          <p className="text-slate-400 mt-1">Manage your workforce and track advance payments.</p>
        </div>
        
        {/* Search */}
        <div className="relative w-full sm:w-72">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search className="h-4 w-4 text-slate-500" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-slate-700 rounded-xl leading-5 bg-slate-900 text-slate-300 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500 sm:text-sm transition-all"
            placeholder="Search workers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Grid of Worker Cards */}
      {loading ? (
        <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div></div>
      ) : filteredWorkers.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center">
          <HardHat className="mx-auto h-12 w-12 text-slate-600 mb-4" />
          <h3 className="text-lg font-medium text-white">No workers found</h3>
          <p className="mt-1 text-slate-400">Try adjusting your search or send a voice note to add an advance for a worker.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredWorkers.map((worker) => (
            <div key={worker.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 hover:border-slate-700 transition-all group">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                    <HardHat className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-white font-semibold truncate max-w-[150px]">{worker.name}</h3>
                    <p className="text-xs text-slate-500">Worker</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-5 border-t border-slate-800/50">
                <div className="flex justify-between items-center mb-2">
                   <p className="text-sm text-slate-400">Total Advances Taken</p>
                   <p className="text-sm font-medium text-slate-300">{formatCurrency(worker.advances_taken)}</p>
                </div>
                
                <div className="mt-3 pt-3 border-t border-slate-800/30">
                  <p className="text-sm text-slate-400 mb-1">Current Advance Balance</p>
                  <div className="flex items-end justify-between">
                    <p className={`text-2xl font-bold tracking-tight text-red-400`}>
                      {formatCurrency(Math.abs(Number(worker.net_due)))}
                    </p>
                    <TrendingDown className="w-4 h-4 text-red-400 mb-1" />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  );
}
