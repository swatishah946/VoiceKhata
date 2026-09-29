import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import pool from '../db';
import { config } from '../config';
import { authMiddleware, signToken } from '../middleware/auth';

const router = Router();

/**
 * SECURITY FIX: at most 5 login attempts per IP per 15 minutes, so the
 * dashboard password cannot be brute-forced.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

/** Constant-time comparison, so response timing leaks nothing about the password. */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function passwordMatches(input: string): Promise<boolean> {
  if (config.DASHBOARD_PASSWORD_HASH) return bcrypt.compare(input, config.DASHBOARD_PASSWORD_HASH);
  return safeEqual(input, config.DASHBOARD_PASSWORD!);
}

router.post('/auth/login', loginLimiter, async (req: Request, res: Response) => {
  const password = req.body?.password;
  if (typeof password !== 'string' || password.length === 0 || password.length > 200) {
    return res.status(400).json({ error: 'Password required' });
  }
  if (!(await passwordMatches(password))) {
    return res.status(401).json({ error: 'Invalid password' });
  }
  res.json({ token: signToken({ orgId: config.DEFAULT_ORG_ID, role: 'admin' }) });
});

// Everything below requires a valid token
router.use(authMiddleware);

router.get('/transactions', async (req: Request, res: Response) => {
  const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
  const result = await pool.query(
    `SELECT t.id, t.transaction_type, t.status, t.stone_type_text, t.pieces_count, t.sqft_quantity,
            t.unit_rate, t.subtotal_amount, t.loading_charge, t.packing_charge, t.tax_percentage,
            t.tax_amount, t.freight_charge, t.total_amount, t.advance_paid, t.outstanding_balance,
            t.needs_price_confirmation, t.price_warning, t.ref_code, t.created_at, t.confirmed_at,
            COALESCE(p.name, t.ai_extracted_json->>'party_name') AS party_name,
            COALESCE(w.name, t.ai_extracted_json->>'worker_name') AS worker_name
       FROM transactions t
       LEFT JOIN parties p ON t.party_id = p.id
       LEFT JOIN workers w ON t.worker_id = w.id
      WHERE t.organization_id = $1
      ORDER BY t.created_at DESC
      LIMIT $2`,
    [req.user!.orgId, limit]
  );
  res.json(result.rows);
});

router.get('/parties', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT p.id, p.name, p.type, b.total_billed, b.total_paid, b.outstanding_balance, b.last_payment_date
       FROM parties p
       LEFT JOIN party_balances b ON p.id = b.party_id
      WHERE p.organization_id = $1
      ORDER BY b.outstanding_balance DESC NULLS LAST`,
    [req.user!.orgId]
  );
  res.json(result.rows);
});

router.get('/analytics', async (req: Request, res: Response) => {
  const orgId = req.user!.orgId;
  const [market, sales, pending] = await Promise.all([
    pool.query(
      `SELECT COALESCE(SUM(outstanding_balance), 0) AS total_market_due
         FROM party_balances WHERE organization_id = $1 AND outstanding_balance > 0`,
      [orgId]
    ),
    // "This month" in INDIA time (timestamps are stored in UTC)
    pool.query(
      `SELECT COALESCE(SUM(total_amount), 0) AS monthly_sales
         FROM transactions
        WHERE organization_id = $1 AND transaction_type = 'dispatch' AND status = 'confirmed'
          AND (created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')
              >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Kolkata')`,
      [orgId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE organization_id = $1 AND status = 'pending_confirmation'`,
      [orgId]
    ),
  ]);
  res.json({
    totalMarketDue: Number(market.rows[0].total_market_due),
    monthlySales: Number(sales.rows[0].monthly_sales),
    pendingCount: pending.rows[0].n,
  });
});

router.get('/workers', async (req: Request, res: Response) => {
  const result = await pool.query(
    `SELECT w.id, w.name, l.advances_taken, l.net_due
       FROM workers w
       LEFT JOIN worker_ledger l ON w.id = l.worker_id
      WHERE w.organization_id = $1
      ORDER BY l.net_due ASC NULLS LAST`,
    [req.user!.orgId]
  );
  res.json(result.rows);
});

export default router;
