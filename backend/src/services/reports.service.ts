import pool, { Queryable } from '../db';
import { toPaise } from '../lib/money';

/**
 * Read-only reports: today's summary ("hisab" on WhatsApp / dashboard card),
 * one person's balance, and the CSV export.
 *
 * "Today" is the calendar day in INDIA time. Timestamps are stored in UTC, so
 * every date filter converts with AT TIME ZONE before comparing.
 */

const IST = `AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata'`;

export interface DailySummary {
  date: string; // YYYY-MM-DD (IST)
  dispatchCount: number;
  dispatchTotal: number; // paise
  paymentsCount: number;
  paymentsTotal: number;
  advancesTotal: number;
  pendingCount: number;
  marketDue: number;
  topDue: Array<{ name: string; outstanding: number }>;
}

export async function dailySummary(orgId: string, db: Queryable = pool): Promise<DailySummary> {
  const day = await db.query(`SELECT to_char((NOW() AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d`);
  const date: string = day.rows[0].d;

  const totals = await db.query(
    `SELECT transaction_type, COUNT(*)::int AS n,
            COALESCE(SUM(total_amount), 0) AS billed, COALESCE(SUM(advance_paid), 0) AS paid
       FROM transactions
      WHERE organization_id = $1 AND status = 'confirmed'
        AND (confirmed_at ${IST})::date = $2::date
      GROUP BY transaction_type`,
    [orgId, date]
  );
  const by = Object.fromEntries(totals.rows.map((r) => [r.transaction_type, r]));

  const [pending, due, top] = await Promise.all([
    db.query(`SELECT COUNT(*)::int AS n FROM transactions WHERE organization_id = $1 AND status = 'pending_confirmation'`, [orgId]),
    db.query(`SELECT COALESCE(SUM(outstanding_balance), 0) AS d FROM party_balances WHERE organization_id = $1 AND outstanding_balance > 0`, [orgId]),
    db.query(
      `SELECT p.name, b.outstanding_balance FROM party_balances b JOIN parties p ON p.id = b.party_id
        WHERE b.organization_id = $1 AND b.outstanding_balance > 0
        ORDER BY b.outstanding_balance DESC LIMIT 3`,
      [orgId]
    ),
  ]);

  return {
    date,
    dispatchCount: by.dispatch?.n ?? 0,
    dispatchTotal: toPaise(by.dispatch?.billed ?? 0),
    paymentsCount: by.payment?.n ?? 0,
    paymentsTotal: toPaise(by.payment?.paid ?? 0),
    advancesTotal: toPaise(by.worker_advance?.paid ?? 0),
    pendingCount: pending.rows[0].n,
    marketDue: toPaise(due.rows[0].d),
    topDue: top.rows.map((r) => ({ name: r.name, outstanding: toPaise(r.outstanding_balance) })),
  };
}

export interface PersonBalance {
  name: string;
  type: 'party' | 'worker';
  outstanding: number; // paise; party: customer owes us, worker: advance owed to us
  lastPaymentDate: Date | null;
}

export async function personBalance(orgId: string, person: { id: string; type: 'party' | 'worker'; name: string }, db: Queryable = pool): Promise<PersonBalance> {
  if (person.type === 'party') {
    const r = await db.query(
      `SELECT outstanding_balance, last_payment_date FROM party_balances WHERE organization_id = $1 AND party_id = $2`,
      [orgId, person.id]
    );
    return { name: person.name, type: 'party', outstanding: toPaise(r.rows[0]?.outstanding_balance ?? 0), lastPaymentDate: r.rows[0]?.last_payment_date ?? null };
  }
  const r = await db.query(`SELECT advances_taken FROM worker_ledger WHERE organization_id = $1 AND worker_id = $2`, [orgId, person.id]);
  return { name: person.name, type: 'worker', outstanding: toPaise(r.rows[0]?.advances_taken ?? 0), lastPaymentDate: null };
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Escapes one CSV cell. Also defuses "CSV injection": names come from voice/AI,
 * and a cell starting with = + - @ would run as a FORMULA when the file is
 * opened in Excel. Such cells are prefixed with an apostrophe.
 */
export function csvCell(value: unknown, isText = true): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  // Numbers (e.g. "-2000.00") are left alone; only free text is defused
  if (isText && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const CSV_COLUMNS = [
  'date_ist', 'ref', 'status', 'type', 'party_or_worker', 'stone', 'pieces', 'sqft', 'rate',
  'subtotal', 'loading', 'packing', 'tax_percent', 'tax', 'freight', 'bill_total', 'paid_or_advance',
] as const;
const TEXT_COLUMNS = new Set<string>(['ref', 'status', 'type', 'party_or_worker', 'stone']);

export async function transactionsCsv(orgId: string, fromDate: string, toDate: string, db: Queryable = pool): Promise<string> {
  const { rows } = await db.query(
    `SELECT to_char(t.created_at ${IST}, 'YYYY-MM-DD HH24:MI') AS date_ist, t.ref_code AS ref, t.status,
            t.transaction_type AS type, COALESCE(p.name, w.name, t.ai_extracted_json->>'party_name', t.ai_extracted_json->>'worker_name') AS party_or_worker,
            t.stone_type_text AS stone, t.pieces_count AS pieces, t.sqft_quantity AS sqft, t.unit_rate AS rate,
            t.subtotal_amount AS subtotal, t.loading_charge AS loading, t.packing_charge AS packing,
            t.tax_percentage AS tax_percent, t.tax_amount AS tax, t.freight_charge AS freight,
            t.total_amount AS bill_total, t.advance_paid AS paid_or_advance
       FROM transactions t
       LEFT JOIN parties p ON p.id = t.party_id
       LEFT JOIN workers w ON w.id = t.worker_id
      WHERE t.organization_id = $1
        AND (t.created_at ${IST})::date BETWEEN $2::date AND $3::date
      ORDER BY t.created_at ASC`,
    [orgId, fromDate, toDate]
  );
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => csvCell(r[c], TEXT_COLUMNS.has(c))).join(','));
  // BOM so Excel opens ₹ and Hindi names correctly
  return '﻿' + lines.join('\r\n') + '\r\n';
}
