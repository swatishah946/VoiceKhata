import { Router, Request, Response } from 'express';
import pool from '../db';
import { maskPhone, normalizePhone } from '../lib/phone';
import { isAllowedTwilioMediaUrl } from '../services/media.service';
import { findMemberByPhone } from '../services/members.service';
import { verifyTwilioSignature } from '../middleware/twilio-signature';
import type { IncomingMessageJob } from '../workers/handlers';

const EMPTY_TWIML = '<Response></Response>';

/**
 * POST /webhook/whatsapp — Twilio sends application/x-www-form-urlencoded.
 *
 * Order of checks:
 *   1. Twilio signature (middleware)              → 403 if forged
 *   2. Sender is a registered member              → ignored if unknown
 *   3. MessageSid not seen before (DB)            → ignored if duplicate retry
 *   4. Enqueue and answer immediately (<100 ms)   → AI work happens in the worker
 *
 * `enqueue` is injected so tests can run without Redis.
 */
export function createWhatsAppRouter(enqueue: (job: IncomingMessageJob) => Promise<void>) {
  const router = Router();

  router.post('/', verifyTwilioSignature, async (req: Request, res: Response) => {
    const body = req.body || {};
    const messageSid: string | undefined = body.MessageSid;
    const phone = normalizePhone(body.From);

    if (!messageSid || !phone || !/^[A-Za-z0-9]{10,64}$/.test(messageSid)) {
      return res.status(400).send('Invalid Twilio payload');
    }

    // 2. Only registered numbers may use the bot
    const member = await findMemberByPhone(phone);
    if (!member) {
      console.warn(`🚫 ignoring message from unregistered number ${maskPhone(phone)}`);
      return res.type('text/xml').send(EMPTY_TWIML); // 200 so Twilio does not retry
    }

    // 3. Idempotency: first writer wins, retries are dropped
    const inserted = await pool.query(
      `INSERT INTO processed_messages (message_sid, from_phone) VALUES ($1, $2)
       ON CONFLICT (message_sid) DO NOTHING RETURNING message_sid`,
      [messageSid, phone]
    );
    if (!inserted.rowCount) {
      console.log(`↩️ duplicate delivery of ${messageSid} ignored`);
      return res.type('text/xml').send(EMPTY_TWIML);
    }

    // Classify
    const numMedia = parseInt(body.NumMedia || '0', 10) || 0;
    const mediaType: string = String(body.MediaContentType0 || '');
    const mediaUrl: string | undefined = body.MediaUrl0;
    let kind: IncomingMessageJob['kind'] = 'text';
    if (numMedia > 0) {
      if (!isAllowedTwilioMediaUrl(mediaUrl)) {
        // Signed by Twilio but pointing elsewhere should never happen; refuse anyway
        console.warn(`🚫 refusing media URL outside api.twilio.com`);
        kind = 'other';
      } else if (mediaType.startsWith('audio/')) kind = 'audio';
      else if (mediaType.startsWith('image/')) kind = 'image';
      else kind = 'other';
    }

    const job: IncomingMessageJob = {
      messageSid,
      phone,
      organizationId: member.organizationId,
      kind,
      text: kind === 'text' ? String(body.Body || '').slice(0, 2000) : undefined,
      mediaUrl: kind === 'audio' || kind === 'image' ? mediaUrl : undefined,
      mediaType: mediaType || undefined,
    };

    try {
      await enqueue(job);
    } catch (err) {
      // Queue down: forget we saw it so Twilio's retry can be processed
      await pool.query('DELETE FROM processed_messages WHERE message_sid = $1', [messageSid]).catch(() => undefined);
      throw err;
    }

    console.log(`📩 queued ${kind} message ${messageSid} from ${maskPhone(phone)}`);
    res.type('text/xml').send(EMPTY_TWIML);
  });

  return router;
}
