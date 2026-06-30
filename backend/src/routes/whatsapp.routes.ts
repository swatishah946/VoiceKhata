import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { messageQueue } from '../workers/message.worker';

const router = Router();

// Your unique verification token (needs to be set in Meta Developer Console)
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'voicekhata_secure_token_123';

/**
 * GET /webhook/whatsapp
 * Meta Cloud API Webhook Verification Endpoint
 * Meta will send a GET request here when you first configure the webhook in their dashboard.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  // Check if a request is a webhook verification request
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('✅ WhatsApp Webhook Verified!');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403); // Forbidden
  }
});

/**
 * POST /webhook/whatsapp
 * Endpoint where Meta sends the actual WhatsApp messages (including voice notes)
 */
router.post('/', async (req: Request, res: Response) => {
  const body = req.body;

  // Check if this is a WhatsApp API event
  if (body.object === 'whatsapp_business_account') {
    try {
      // Loop over each entry (there may be multiple if batched)
      for (const entry of body.entry) {
        // Check if the entry contains changes/messages
        if (entry.changes && entry.changes[0] && entry.changes[0].value.messages) {
          const webhookEvent = entry.changes[0].value;
          const message = webhookEvent.messages[0];
          const contact = webhookEvent.contacts[0];

          // 1. Safety Check: Idempotency
          // We hash the WhatsApp message ID to ensure we don't process it twice 
          // if there is a network glitch and Meta retries sending the same message.
          const messageIdHash = crypto.createHash('sha256').update(message.id).digest('hex');
          
          console.log(`📩 Received new message from ${contact.wa_id}. ID Hash: ${messageIdHash}`);

          // 2. Check the message type and add to Queue
          if (message.type === 'audio') {
            const audioId = message.audio.id;
            
            console.log(`🎤 Received Voice Note! Adding to Queue... (ID: ${audioId})`);
            await messageQueue.add('process_audio', {
              messageType: 'audio',
              mediaUrl: audioId, // In reality, we fetch the audio using this ID
              contactPhone: contact.wa_id,
              messageId: messageIdHash
            });
            
          } else if (message.type === 'text') {
            console.log(`📝 Received Text Message! Adding to Queue...`);
            await messageQueue.add('process_text', {
              messageType: 'text',
              textContent: message.text.body,
              contactPhone: contact.wa_id,
              messageId: messageIdHash
            });

          } else if (message.type === 'image') {
            console.log(`📸 Received Image! Adding to Queue...`);
            await messageQueue.add('process_image', {
              messageType: 'image',
              mediaUrl: message.image.id,
              contactPhone: contact.wa_id,
              messageId: messageIdHash
            });

          } else if (message.type === 'interactive') {
            // User clicked a button!
            const buttonReply = message.interactive.button_reply;
            if (buttonReply) {
              const payloadId = buttonReply.id;
              console.log(`🔘 User clicked button: ${payloadId}`);
              
              if (payloadId.startsWith('CONFIRM_')) {
                const transactionId = payloadId.replace('CONFIRM_', '');
                await messageQueue.add('confirm_transaction', { transactionId, contactPhone: contact.wa_id });
              } else if (payloadId.startsWith('EDIT_')) {
                const transactionId = payloadId.replace('EDIT_', '');
                await messageQueue.add('edit_transaction', { transactionId, contactPhone: contact.wa_id });
              }
            }
          } else {
            console.log(`ℹ️ Received unsupported message type: ${message.type}`);
          }
        }
      }
      
      // Always return 200 OK to Meta immediately so they don't retry the request
      res.status(200).send('EVENT_RECEIVED');
    } catch (error) {
      console.error('❌ Error processing webhook:', error);
      res.status(500).send('SERVER_ERROR');
    }
  } else {
    // Return 404 if not a WhatsApp API event
    res.sendStatus(404);
  }
});

export default router;
