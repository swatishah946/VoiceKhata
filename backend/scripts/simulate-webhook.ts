/**
 * Sends a correctly SIGNED fake Twilio webhook to a running backend, to test the
 * full flow locally without WhatsApp. (The old test-webhook.ts sent Meta's
 * payload format, which this Twilio route rejects with 400.)
 *
 * Usage (backend running, sender registered with add-member):
 *   npm run simulate -- +919876543210 "Siddhi Stone ko 5000 sqft 2x1½ bheja rate 31.5"
 *   npm run simulate -- +919876543210 "yes"
 */
import twilio from 'twilio';
import dotenv from 'dotenv';
dotenv.config({ quiet: true });

async function main() {
  const [phone, ...words] = process.argv.slice(2);
  const text = words.join(' ');
  if (!phone || !text) {
    console.error('Usage: npm run simulate -- <from phone> "<message text>"');
    process.exit(1);
  }
  const base = (process.env.SIMULATE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
  const signedBase = (process.env.PUBLIC_BASE_URL || base).replace(/\/$/, '');
  const params: Record<string, string> = {
    MessageSid: 'SM' + Date.now().toString(16).padStart(32, '0'),
    From: `whatsapp:${phone}`,
    To: `whatsapp:${process.env.TWILIO_PHONE_NUMBER || '+14155238886'}`,
    Body: text,
    NumMedia: '0',
  };
  const signature = twilio.getExpectedTwilioSignature(
    process.env.TWILIO_AUTH_TOKEN || '',
    `${signedBase}/webhook/whatsapp`,
    params
  );
  const res = await fetch(`${base}/webhook/whatsapp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': signature },
    body: new URLSearchParams(params),
  });
  console.log(`→ ${res.status} ${await res.text()}`);
}

main();
