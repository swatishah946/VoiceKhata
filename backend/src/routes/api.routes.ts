import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import pool from '../db/index';
import { authMiddleware } from '../middleware/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'super_secret_voicekhata_key_for_dev';

// Standard login for the dashboard
router.post('/auth/login', (req: Request, res: Response) => {
  const { password } = req.body;
  
  // MVP: Hardcoded password for the single user (Father)
  const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'voicekhata2026';
  
  if (password === DASHBOARD_PASSWORD) {
    const token = jwt.sign(
      { orgId: '00000000-0000-0000-0000-000000000000', role: 'admin' }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );
    res.json({ token });
  } else {
    res.status(401).json({ error: 'Invalid password' });
  }
});

// Protect all routes below this line
router.use(authMiddleware);

/**
 * GET /transactions
 * Fetch recent ledger history (both pending and confirmed)
 */
router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const result = await pool.query(
      `SELECT t.*, 
              COALESCE(p.name, p.company_name) as party_name,
              w.name as worker_name
       FROM transactions t
       LEFT JOIN parties p ON t.party_id = p.id
       LEFT JOIN workers w ON t.worker_id = w.id
       WHERE t.organization_id = $1
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching transactions:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /parties
 * Fetch all customers/suppliers and their balances
 */
router.get('/parties', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    const result = await pool.query(
      `SELECT p.id, p.name, p.company_name, p.type, 
              b.total_billed, b.total_paid, b.outstanding_balance
       FROM parties p
       LEFT JOIN party_balances b ON p.id = b.party_id
       WHERE p.organization_id = $1
       ORDER BY b.outstanding_balance DESC NULLS LAST`,
      [orgId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching parties:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

/**
 * GET /analytics
 * High level stats for the dashboard cards
 */
router.get('/analytics', async (req: Request, res: Response) => {
  try {
    const orgId = (req as any).user.orgId;
    
    // Total Market Outstanding (Money people owe us)
    const marketRes = await pool.query(
      `SELECT SUM(outstanding_balance) as total_market_due 
       FROM party_balances 
       WHERE organization_id = $1 AND outstanding_balance > 0`,
      [orgId]
    );
    
    // Total Sales this month
    const salesRes = await pool.query(
      `SELECT SUM(total_amount) as monthly_sales 
       FROM transactions 
       WHERE organization_id = $1 
         AND transaction_type = 'dispatch' 
         AND status = 'confirmed'
         AND created_at >= date_trunc('month', CURRENT_DATE)`,
      [orgId]
    );

    res.json({
      totalMarketDue: marketRes.rows[0].total_market_due || 0,
      monthlySales: salesRes.rows[0].monthly_sales || 0
    });
  } catch (err) {
    console.error('Error fetching analytics:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
