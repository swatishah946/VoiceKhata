import pool from '../db';
import crypto from 'crypto';

export class LedgerService {
  
  /**
   * Helper: Find or create a party by name.
   */
  static async findOrCreateParty(name: string, type: string = 'customer', organizationId: string): Promise<{ id: string, isNew: boolean }> {
    if (!name) return { id: null as any, isNew: false };
    
    // First, try to find the party
    const result = await pool.query(
      `SELECT id FROM parties WHERE organization_id = $1 AND name ILIKE $2`,
      [organizationId, name]
    );

    if (result.rows.length > 0) {
      return { id: result.rows[0].id, isNew: false };
    }

    // If not found, create a new one
    const newId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO parties (id, organization_id, name, type) VALUES ($1, $2, $3, $4)`,
      [newId, organizationId, name, type]
    );
    
    return { id: newId, isNew: true };
  }

  /**
   * Helper: Find a worker by name.
   */
  static async findOrCreateWorker(name: string, organizationId: string): Promise<{ id: string, isNew: boolean }> {
    if (!name) return { id: null as any, isNew: false };
    
    const result = await pool.query(
      `SELECT id FROM workers WHERE organization_id = $1 AND name ILIKE $2`,
      [organizationId, name]
    );

    if (result.rows.length > 0) {
      return { id: result.rows[0].id, isNew: false };
    }

    const newId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO workers (id, organization_id, name) VALUES ($1, $2, $3)`,
      [newId, organizationId, name]
    );
    
    return { id: newId, isNew: true };
  }

  /**
   * Math Engine: Process a transaction extracted by AI
   */
  static async processTransaction(extractedData: any, organizationId: string, whatsappMsgId: string = crypto.randomUUID()) {
    const {
      transaction_type,
      party_name,
      worker_name,
      stone_type,
      pieces_count = 0,
      sqft_quantity = 0,
      unit_rate = 0,
      amount = 0,
      freight_charge = 0,
      loading_charge = 0,
      packing_charge = 0,
      tax_percentage = 0
    } = extractedData;

    let partyId = null;
    let workerId = null;
    let isNewParty = false;
    let isNewWorker = false;

    // 1. Resolve Entities
    if (transaction_type === 'dispatch' || transaction_type === 'payment') {
      const party = await this.findOrCreateParty(party_name, 'customer', organizationId);
      partyId = party.id;
      isNewParty = party.isNew;
    } else if (transaction_type === 'worker_advance') {
      const worker = await this.findOrCreateWorker(worker_name, organizationId);
      workerId = worker.id;
      isNewWorker = worker.isNew;
    } else if (transaction_type === 'freight_payment') {
      const transporter = await this.findOrCreateParty(worker_name || party_name, 'transporter', organizationId);
      partyId = transporter.id;
    }

    // Prepare database fields
    let subtotal_amount = 0;
    let total_amount = 0;
    let advance_paid = 0;
    let outstanding_balance = 0;
    let needs_price_confirmation = isNewParty || isNewWorker;
    let price_warning = null;
    const transactionId = crypto.randomUUID();

    // 2. Perform Strict Math based on transaction type
    if (transaction_type === 'dispatch') {
      // NOTE: We trust the AI's sqft_quantity for now. Later we can fetch the multiplier from DB.
      subtotal_amount = (sqft_quantity || 0) * (unit_rate || 0);
      
      // Math Rule from PDF: Add Loading/Tax, Subtract Freight
      const taxable_amount = subtotal_amount + (loading_charge || 0) + (packing_charge || 0);
      const tax_amount = taxable_amount * ((tax_percentage || 0) / 100);
      
      // Freight is deducted because factory pays it or subtracts it from FOR rate
      total_amount = taxable_amount + tax_amount - (freight_charge || 0);
      outstanding_balance = total_amount; // Assuming no advance paid on the same dispatch voice note for now

    } else if (transaction_type === 'payment' || transaction_type === 'worker_advance' || transaction_type === 'freight_payment') {
      advance_paid = amount;
      total_amount = 0;
      outstanding_balance = 0 - advance_paid; // Negative balance means we received money or gave advance
    }

    // 3. Insert into PostgreSQL with 'pending' status
    await pool.query(
      `INSERT INTO transactions (
        id, organization_id, party_id, worker_id, transaction_type, 
        pieces_count, sqft_quantity, unit_rate, subtotal_amount, 
        freight_charge, total_amount, advance_paid, outstanding_balance,
        status, needs_price_confirmation, ai_extracted_json, whatsapp_message_id
      ) VALUES (
        $1, $2, $3, $4, $5, 
        $6, $7, $8, $9, 
        $10, $11, $12, $13,
        $14, $15, $16, $17
      )`,
      [
        transactionId, organizationId, partyId, workerId, transaction_type,
        pieces_count, sqft_quantity, unit_rate, subtotal_amount,
        freight_charge, total_amount, advance_paid, outstanding_balance,
        'pending_confirmation', needs_price_confirmation, extractedData, whatsappMsgId
      ]
    );

      return {
      transactionId,
      subtotal_amount,
      total_amount,
      status: 'pending_confirmation',
      requires_approval: true
    };
  }

  /**
   * Confirm a pending transaction and officially update the ledgers.
   */
  static async confirmTransaction(transactionId: string) {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN'); // Start secure SQL transaction
      
      // 1. Get the transaction details
      const txRes = await client.query(
        `SELECT * FROM transactions WHERE id = $1 AND status = 'pending_confirmation' FOR UPDATE`,
        [transactionId]
      );
      
      if (txRes.rows.length === 0) {
        throw new Error('Transaction not found or already confirmed.');
      }
      
      const tx = txRes.rows[0];

      // 2. Update Party Balance
      if (tx.party_id) {
        // Find existing balance
        const pbRes = await client.query(
          `SELECT * FROM party_balances WHERE party_id = $1 FOR UPDATE`,
          [tx.party_id]
        );
        
        if (pbRes.rows.length === 0) {
          await client.query(
            `INSERT INTO party_balances (organization_id, party_id, total_billed, total_paid, outstanding_balance) 
             VALUES ($1, $2, $3, $4, $5)`,
            [tx.organization_id, tx.party_id, Math.max(tx.total_amount, 0), tx.advance_paid, tx.outstanding_balance]
          );
        } else {
          await client.query(
            `UPDATE party_balances 
             SET total_billed = total_billed + $1, 
                 total_paid = total_paid + $2, 
                 outstanding_balance = outstanding_balance + $3,
                 updated_at = CURRENT_TIMESTAMP
             WHERE party_id = $4`,
            [Math.max(tx.total_amount, 0), tx.advance_paid, tx.outstanding_balance, tx.party_id]
          );
        }
      }

      // 3. Update Worker Ledger
      if (tx.worker_id) {
        const wlRes = await client.query(
          `SELECT * FROM worker_ledger WHERE worker_id = $1 FOR UPDATE`,
          [tx.worker_id]
        );
        
        if (wlRes.rows.length === 0) {
          await client.query(
            `INSERT INTO worker_ledger (organization_id, worker_id, advances_taken, net_due) 
             VALUES ($1, $2, $3, $4)`,
            [tx.organization_id, tx.worker_id, tx.advance_paid, -tx.advance_paid] // Negative means they owe us
          );
        } else {
          await client.query(
            `UPDATE worker_ledger 
             SET advances_taken = advances_taken + $1, 
                 net_due = net_due - $2,
                 updated_at = CURRENT_TIMESTAMP
             WHERE worker_id = $3`,
            [tx.advance_paid, tx.advance_paid, tx.worker_id]
          );
        }
      }

      // 4. Mark transaction as confirmed
      await client.query(
        `UPDATE transactions SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [transactionId]
      );

      await client.query('COMMIT');
      return { success: true };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

