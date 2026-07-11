import twilio from 'twilio';
import fetch from 'node-fetch';
import * as fs from 'fs';
import path from 'path';

export class WhatsAppService {
  private static getClient() {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) throw new Error('Twilio credentials missing in .env');
    return twilio(accountSid, authToken);
  }

  private static getFromNumber() {
    return `whatsapp:${process.env.TWILIO_PHONE_NUMBER || '+14155238886'}`;
  }

  /**
   * Send a standard text message
   */
  static async sendTextMessage(to: string, text: string) {
    try {
      const client = this.getClient();
      // Ensure the 'to' number has the whatsapp: prefix
      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace('+', '')}`;
      
      await client.messages.create({
        body: text,
        from: this.getFromNumber(),
        to: formattedTo
      });
      console.log(`📨 Sent Twilio message to ${formattedTo}`);
    } catch (err) {
      console.error('Failed to send Twilio message:', err);
    }
  }

  /**
   * Send an interactive button message to confirm a transaction
   * Note: Twilio Sandbox doesn't support rich interactive buttons well, 
   * so we fall back to a simple text prompt.
   */
  static async sendInteractiveConfirmation(to: string, dbResult: any) {
    const data = dbResult.extractedData || {};
    let summaryText = `📄 *New Entry Generated (Pending)*\n\n`;

    if (dbResult.transaction_type === 'payment' || dbResult.transaction_type === 'worker_advance' || dbResult.transaction_type === 'freight_payment') {
      const name = data.party_name || data.worker_name || 'Unknown';
      summaryText += `*Name:* ${name}\n`;
      summaryText += `*Type:* ${dbResult.transaction_type.toUpperCase()}\n`;
      summaryText += `*Amount Paid/Advance:* ₹${dbResult.advance_paid}\n\n`;
    } else {
      const name = data.party_name || 'Unknown Customer';
      summaryText += `*Customer:* ${name}\n`;
      if (data.stone_type) summaryText += `*Stone Type:* ${data.stone_type}\n`;
      if (data.pieces_count) summaryText += `*Pieces:* ${data.pieces_count}\n`;
      if (data.sqft_quantity) summaryText += `*Quantity:* ${data.sqft_quantity} sqft\n`;
      if (data.unit_rate) summaryText += `*Rate:* ₹${data.unit_rate}/sqft\n`;
      
      const sub = (data.sqft_quantity || 0) * (data.unit_rate || 0);
      if (sub > 0) summaryText += `*Subtotal:* ₹${sub.toFixed(2)}\n`;
      
      if (data.loading_charge) summaryText += `*Loading:* +₹${data.loading_charge}\n`;
      if (data.freight_charge) summaryText += `*Freight Deducted:* -₹${data.freight_charge}\n`;
      
      summaryText += `\n*Total Bill Amount:* ₹${parseFloat(dbResult.total_amount).toFixed(2)}\n\n`;
    }

    summaryText += `Kya yeh sahi hai? (Is this correct?)\n`;
    summaryText += `👉 Reply *Yes* to confirm\n`;
    summaryText += `👉 Reply *No* to cancel`;

    await this.sendTextMessage(to, summaryText);
  }

  /**
   * Download media (like an image/audio) from the Twilio API
   */
  static async downloadMedia(mediaUrl: string): Promise<{ base64: string, mimeType: string }> {
    // Twilio provides a direct URL, but it requires HTTP Basic Auth to download
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const authHeader = 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const response = await fetch(mediaUrl, {
      headers: { 'Authorization': authHeader }
    });

    if (!response.ok) {
      throw new Error(`Failed to download Twilio media: ${await response.text()}`);
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    return { base64: base64, mimeType: contentType };
  }

  /**
   * In Twilio, we don't pre-upload media. We just pass the public URL later.
   */
  static async uploadMedia(filePath: string, mimeType: string): Promise<string> {
    return filePath; 
  }

  /**
   * Send a Document (e.g. PDF) to a user
   * Twilio requires a PUBLIC URL to send a document. So we copy the local PDF 
   * to our Express public folder and serve it so Twilio can download it!
   */
  static async sendDocument(to: string, filePath: string, filename: string, caption: string) {
    try {
      const client = this.getClient();
      const formattedTo = to.startsWith('whatsapp:') ? to : `whatsapp:+${to.replace('+', '')}`;
      
      // Move the local file to a publicly accessible folder in Express
      const publicDir = path.join(process.cwd(), 'public', 'pdfs');
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      
      const newPath = path.join(publicDir, filename);
      fs.copyFileSync(filePath, newPath);
      
      // Get the live Render URL (using a fallback just in case)
      const baseUrl = process.env.RENDER_EXTERNAL_URL || 'https://voicekhata-yqsj.onrender.com';
      const publicUrl = `${baseUrl}/pdfs/${filename}`;
      
      console.log(`🌍 Hosting PDF publicly for Twilio at: ${publicUrl}`);

      await client.messages.create({
        body: caption,
        from: this.getFromNumber(),
        to: formattedTo,
        mediaUrl: [publicUrl]
      });
      console.log(`📨 Sent Twilio PDF document to ${formattedTo}`);
    } catch (err) {
      console.error('Failed to send Twilio PDF:', err);
    }
  }
}
