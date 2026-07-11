import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import pool from '../db/index';

export class PdfService {
  /**
   * Generates a pricing PDF dynamically from the database.
   * Returns the absolute path to the generated PDF.
   */
  static async generatePricingPdf(organizationId: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        // Fetch current prices from the database
        const result = await pool.query(
          `SELECT stone_type, rate_per_sqft 
           FROM price_list 
           WHERE organization_id = $1 
           ORDER BY stone_type ASC`,
          [organizationId]
        );
        const prices = result.rows;

        // Ensure public directory exists
        const publicDir = path.join(__dirname, '../../public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }

        const filePath = path.join(publicDir, `Pricing_List_${Date.now()}.pdf`);
        const doc = new PDFDocument({ margin: 50 });
        
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('VoiceKhata Stone Traders', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(12).font('Helvetica').fillColor('gray').text('Official Pricing List', { align: 'center' });
        doc.text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
        doc.moveDown(2);

        // Table Header
        doc.fillColor('black');
        doc.fontSize(14).font('Helvetica-Bold');
        doc.text('Stone Size / Type', 50, doc.y, { continued: true });
        doc.text('Rate per SqFt (₹)', 300, doc.y);
        
        doc.moveTo(50, doc.y + 10).lineTo(500, doc.y + 10).stroke();
        doc.moveDown(1.5);

        // Table Rows
        doc.fontSize(12).font('Helvetica');
        prices.forEach((item, index) => {
          const y = doc.y;
          // Alternate row backgrounds
          if (index % 2 === 0) {
            doc.rect(50, y - 5, 450, 20).fill('#f8fafc');
          }
          doc.fillColor('black');
          
          doc.text(item.stone_type, 60, y);
          doc.text(`₹ ${parseFloat(item.rate_per_sqft).toFixed(2)}`, 300, y);
          doc.moveDown(0.8);
        });

        // Footer
        doc.moveDown(3);
        doc.fontSize(10).fillColor('gray').text('Thank you for your business.', { align: 'center' });

        doc.end();

        stream.on('finish', () => {
          resolve(filePath);
        });

        stream.on('error', (err) => {
          reject(err);
        });

      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generates a Ledger (Khata) statement PDF for a specific party or worker.
   */
  static async generateKhataPdf(organizationId: string, personId: string, personType: 'party' | 'worker', personName: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
      try {
        let transactions = [];
        let finalBalance = 0;
        let balanceLabel = '';

        if (personType === 'party') {
          // Get party transactions
          const txResult = await pool.query(
            `SELECT created_at, transaction_type, subtotal_amount, total_amount, advance_paid 
             FROM transactions 
             WHERE organization_id = $1 AND party_id = $2 AND status = 'confirmed'
             ORDER BY created_at ASC`,
            [organizationId, personId]
          );
          transactions = txResult.rows;

          // Get final balance
          const balResult = await pool.query(
            `SELECT outstanding_balance FROM party_balances WHERE organization_id = $1 AND party_id = $2`,
            [organizationId, personId]
          );
          finalBalance = balResult.rows.length > 0 ? balResult.rows[0].outstanding_balance : 0;
          balanceLabel = 'Outstanding Balance (Owed by Customer):';
        } else {
          // Get worker transactions
          const txResult = await pool.query(
            `SELECT created_at, transaction_type, subtotal_amount, total_amount, advance_paid 
             FROM transactions 
             WHERE organization_id = $1 AND worker_id = $2 AND status = 'confirmed'
             ORDER BY created_at ASC`,
            [organizationId, personId]
          );
          transactions = txResult.rows;

          // Get final balance
          const balResult = await pool.query(
            `SELECT net_due FROM worker_ledger WHERE organization_id = $1 AND worker_id = $2`,
            [organizationId, personId]
          );
          finalBalance = balResult.rows.length > 0 ? balResult.rows[0].net_due : 0;
          balanceLabel = 'Net Due (Owed by Worker):';
        }

        const publicDir = path.join(__dirname, '../../public');
        if (!fs.existsSync(publicDir)) {
          fs.mkdirSync(publicDir, { recursive: true });
        }

        const filePath = path.join(publicDir, `Khata_${personName.replace(/\s+/g, '_')}_${Date.now()}.pdf`);
        const doc = new PDFDocument({ margin: 50 });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // Header
        doc.fontSize(24).font('Helvetica-Bold').text('VoiceKhata', { align: 'center' });
        doc.moveDown(0.5);
        doc.fontSize(16).font('Helvetica').text(`Khata Statement: ${personName}`, { align: 'center' });
        doc.fontSize(10).fillColor('gray').text(`Generated on: ${new Date().toLocaleDateString('en-IN')}`, { align: 'center' });
        doc.moveDown(2);

        // Table Header
        doc.fillColor('black');
        doc.fontSize(12).font('Helvetica-Bold');
        doc.text('Date', 50, doc.y, { continued: true });
        doc.text('Type', 150, doc.y, { continued: true });
        doc.text('Bill Amt', 300, doc.y, { continued: true });
        doc.text('Paid/Adv', 400, doc.y);
        
        doc.moveTo(50, doc.y + 10).lineTo(500, doc.y + 10).stroke();
        doc.moveDown(1.5);

        // Table Rows
        doc.fontSize(10).font('Helvetica');
        transactions.forEach((tx, index) => {
          const y = doc.y;
          if (index % 2 === 0) doc.rect(50, y - 5, 450, 20).fill('#f8fafc');
          doc.fillColor('black');
          
          doc.text(new Date(tx.created_at).toLocaleDateString('en-IN'), 50, y);
          doc.text(tx.transaction_type, 150, y);
          doc.text(`₹ ${parseFloat(tx.total_amount || 0).toFixed(2)}`, 300, y);
          doc.text(`₹ ${parseFloat(tx.advance_paid || 0).toFixed(2)}`, 400, y);
          doc.moveDown(1);
        });

        // Final Balance
        doc.moveDown(2);
        doc.moveTo(50, doc.y).lineTo(500, doc.y).stroke();
        doc.moveDown(1);
        doc.fontSize(14).font('Helvetica-Bold').fillColor('red');
        doc.text(balanceLabel, 50, doc.y, { continued: true });
        doc.text(`₹ ${parseFloat(finalBalance as any).toFixed(2)}`, 300, doc.y);

        doc.end();

        stream.on('finish', () => resolve(filePath));
        stream.on('error', (err) => reject(err));

      } catch (err) {
        reject(err);
      }
    });
  }
}
