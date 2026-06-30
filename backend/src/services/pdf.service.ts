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
}
