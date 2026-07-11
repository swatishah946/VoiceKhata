import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { messageQueue } from '../workers/message.worker';

const router = Router();

/**
 * POST /webhook/whatsapp
 * Twilio sends application/x-www-form-urlencoded data here
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  try {
    const from = body.From; // e.g. 'whatsapp:+919999999999'
    const messageId = body.MessageSid;
    const bodyText = body.Body;
    const numMedia = parseInt(body.NumMedia || '0');

    if (!from || !messageId) {
      return res.status(400).send('Invalid Twilio payload');
    }

    // Extract the raw phone number (remove 'whatsapp:+' prefix)
    const contactPhone = from.replace('whatsapp:+', '');

    // 1. Safety Check: Idempotency using Twilio's MessageSid
    const messageIdHash = crypto.createHash('sha256').update(messageId).digest('hex');
    console.log(`📩 Received Twilio message from ${contactPhone}. ID Hash: ${messageIdHash}`);

    // 2. Check for Media (Audio/Image)
    if (numMedia > 0) {
      const mediaContentType = body.MediaContentType0;
      const mediaUrl = body.MediaUrl0;

      if (mediaContentType && mediaContentType.startsWith('audio/')) {
        console.log(`🎤 Received Twilio Voice Note! Adding to Queue...`);
        await messageQueue.add('process_audio', {
          messageType: 'audio',
          mediaUrl: mediaUrl,
          contactPhone: contactPhone,
          messageId: messageIdHash
        });
      } else if (mediaContentType && mediaContentType.startsWith('image/')) {
        console.log(`📸 Received Twilio Image! Adding to Queue...`);
        await messageQueue.add('process_image', {
          messageType: 'image',
          mediaUrl: mediaUrl,
          contactPhone: contactPhone,
          messageId: messageIdHash
        });
      } else {
        console.log(`ℹ️ Received unsupported Twilio media type: ${mediaContentType}`);
      }
    } else {
      // It's a text message (or an interactive button reply)
      const lowerText = bodyText ? bodyText.trim().toLowerCase() : '';
      const yesWords = ['yes', 'y', 'haan', 'sahi hai', 'confirm'];
      const noWords = ['no', 'n', 'nahin', 'galat', 'edit', 'cancel'];

      if (yesWords.includes(lowerText)) {
        await messageQueue.add('confirm_latest_transaction', { contactPhone: contactPhone });
      } else if (noWords.includes(lowerText)) {
        await messageQueue.add('cancel_latest_transaction', { contactPhone: contactPhone });
      } else {
        console.log(`📝 Received Twilio Text Message! Adding to Queue...`);
        await messageQueue.add('process_text', {
          messageType: 'text',
          textContent: bodyText,
          contactPhone: contactPhone,
          messageId: messageIdHash
        });
      }
    }

    // Always return a TwiML response immediately to prevent timeout
    res.set('Content-Type', 'text/xml');
    res.status(200).send('<Response></Response>');

  } catch (error) {
    console.error('❌ Error processing Twilio webhook:', error);
    res.status(500).send('SERVER_ERROR');
  }
});

export default router;
