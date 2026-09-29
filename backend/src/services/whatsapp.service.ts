import twilio from 'twilio';
import { config } from '../config';
import { maskPhone, toWhatsAppAddress } from '../lib/phone';
import { fileStore } from './file-store';

/**
 * Outgoing WhatsApp messages via Twilio.
 *
 * Changes from the old version:
 *  - errors are thrown (not silently swallowed) so the job is retried and, if it
 *    keeps failing, the user is told something went wrong;
 *  - PDFs are sent from memory through a short-lived random link (see file-store);
 *  - phone numbers are masked in logs.
 */

let client: ReturnType<typeof twilio> | null = null;
function getClient() {
  if (!config.TWILIO_ACCOUNT_SID || !config.TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials missing (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  }
  client ??= twilio(config.TWILIO_ACCOUNT_SID, config.TWILIO_AUTH_TOKEN);
  return client;
}

const from = () => toWhatsAppAddress(config.TWILIO_PHONE_NUMBER);
const MAX_BODY = 1500; // WhatsApp/Twilio limit is 1600 characters

export const WhatsAppService = {
  async sendText(to: string, text: string): Promise<void> {
    await getClient().messages.create({
      from: from(),
      to: toWhatsAppAddress(to),
      body: text.length > MAX_BODY ? text.slice(0, MAX_BODY - 1) + '…' : text,
    });
    console.log(`📨 text sent to ${maskPhone(to)}`);
  },

  async sendPdf(to: string, pdf: Buffer, caption: string): Promise<void> {
    const id = fileStore.save(pdf);
    const mediaUrl = `${config.publicBaseUrl}/pdfs/${id}`;
    await getClient().messages.create({
      from: from(),
      to: toWhatsAppAddress(to),
      body: caption.slice(0, MAX_BODY),
      mediaUrl: [mediaUrl],
    });
    console.log(`📨 PDF sent to ${maskPhone(to)}`);
  },
};

export type Messenger = typeof WhatsAppService;
