/** Shapes returned by the backend API (money fields arrive as decimal strings, e.g. "1500.00"). */

export type TxStatus = 'pending_confirmation' | 'confirmed' | 'cancelled' | 'reversed';
export type TxType = 'dispatch' | 'payment' | 'worker_advance' | 'freight_payment';
type Money = string | number | null;

export interface Transaction {
  id: string;
  transaction_type: TxType;
  status: TxStatus;
  stone_type_text?: string | null;
  pieces_count?: number | null;
  sqft_quantity?: Money;
  unit_rate?: Money;
  subtotal_amount?: Money;
  loading_charge?: Money;
  packing_charge?: Money;
  tax_percentage?: Money;
  tax_amount?: Money;
  freight_charge?: Money;
  total_amount: Money;
  advance_paid: Money;
  ref_code?: string | null;
  party_name?: string | null;
  worker_name?: string | null;
  price_warning?: { masterRate: number; spokenRate: number; diffPercent: number } | null;
  created_at: string;
  confirmed_at?: string | null;
}

export interface Analytics {
  totalMarketDue: number;
  monthlySales: number;
  pendingCount?: number;
}

/** From /api/summary/today — amounts in PAISE */
export interface TodaySummary {
  date: string;
  dispatchCount: number;
  dispatchTotal: number;
  paymentsCount: number;
  paymentsTotal: number;
  advancesTotal: number;
  pendingCount: number;
  marketDue: number;
  topDue: Array<{ name: string; outstanding: number }>;
}

export interface PartyDetail {
  id: string;
  name: string;
  type: string;
  phone?: string | null;
  total_billed?: Money;
  total_paid?: Money;
  outstanding_balance?: Money;
  last_payment_date?: string | null;
  advances_taken?: Money;
  net_due?: Money;
  transactions: Transaction[];
}
