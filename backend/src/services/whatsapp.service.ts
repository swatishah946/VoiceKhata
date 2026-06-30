import fetch from 'node-fetch';

export class WhatsAppService {
  private static getApiUrl() {
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    return `https://graph.facebook.com/v19.0/${phoneNumberId}/messages`;
  }

  private static getHeaders() {
    return {
      'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Send a standard text message
   */
  static async sendTextMessage(to: string, text: string) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { body: text }
    };

    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error('WhatsApp Text API Error:', await response.text());
      }
    } catch (err) {
      console.error('Failed to send WhatsApp message:', err);
    }
  }

  /**
   * Send an interactive button message to confirm a transaction
   */
  static async sendInteractiveConfirmation(to: string, dbResult: any) {
    const summaryText = `📄 *New Bill Generated (Pending)*\n` +
                        `Total Amount: ₹${dbResult.total_amount}\n` +
                        `\nKya yeh sahi hai? (Is this correct?)`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: {
          text: summaryText
        },
        action: {
          buttons: [
            {
              type: 'reply',
              reply: {
                id: `CONFIRM_${dbResult.transactionId}`,
                title: '✅ Sahi Hai'
              }
            },
            {
              type: 'reply',
              reply: {
                id: `EDIT_${dbResult.transactionId}`,
                title: '❌ Galat Hai'
              }
            }
          ]
        }
      }
    };

    try {
      const response = await fetch(this.getApiUrl(), {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(payload)
      });
      
      if (!response.ok) {
        console.error('WhatsApp Interactive API Error:', await response.text());
      }
    } catch (err) {
      console.error('Failed to send WhatsApp interactive message:', err);
    }
  }

  /**
   * Download media (like an image) from the WhatsApp Cloud API
   */
  static async downloadMedia(mediaId: string): Promise<{ base64: string, mimeType: string }> {
    // 1. Get the media URL from Meta
    const urlResponse = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
      headers: this.getHeaders()
    });
    
    if (!urlResponse.ok) {
      throw new Error(`Failed to get media URL: ${await urlResponse.text()}`);
    }
    
    const urlData: any = await urlResponse.json();
    const mediaUrl = urlData.url;
    const mimeType = urlData.mime_type;

    // 2. Download the actual binary data
    const mediaResponse = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }
    });

    if (!mediaResponse.ok) {
      throw new Error(`Failed to download media binary: ${await mediaResponse.text()}`);
    }

    const arrayBuffer = await mediaResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64 = buffer.toString('base64');

    return { base64, mimeType };
  }
}

