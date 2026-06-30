import { Worker, Queue } from 'bullmq';
import { transcribeAudio } from '../services/whisper.service';
import { extractTransactionDetails, extractTransactionDetailsFromImage } from '../services/ai.service';
import { LedgerService } from '../services/ledger.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { PdfService } from '../services/pdf.service';
import pool from '../db/index';

import IORedis from 'ioredis';

const connection = process.env.REDIS_URL 
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: parseInt(process.env.REDIS_PORT || '6380', 10),
      maxRetriesPerRequest: null
    });

// Create the Queue where voice notes and images will be added
export const messageQueue = new Queue('process_whatsapp_message', { connection: connection as any });

// Initialize the Worker
// Concurrency: 1 ensures that we process sequentially and don't hit the 15/min Gemini limit
const worker = new Worker(
  'process_whatsapp_message',
  async (job) => {
    const data = job.data;
    console.log(`⏳ Processing Job ${job.id} [${job.name}]`);

    try {
      // 1. Handle Confirmation Button Click
      if (job.name === 'confirm_transaction') {
        const { transactionId, contactPhone } = data;
        await LedgerService.confirmTransaction(transactionId);
        await WhatsAppService.sendTextMessage(contactPhone, '✅ Confirmed! Ledger update ho gaya hai.');
        console.log(`✅ Transaction ${transactionId} confirmed.`);
        return { success: true, action: 'confirmed' };
      } 
      
      // 2. Handle Edit Button Click
      else if (job.name === 'edit_transaction') {
        const { transactionId, contactPhone } = data;
        await WhatsAppService.sendTextMessage(contactPhone, `❌ Transaction cancelled. Kripya naya voice note bheje, ya manual type karein (e.g. 'Sidhhi stone ka bill 120,000 karna hai').`);
        console.log(`❌ Transaction ${transactionId} cancelled for edit.`);
        return { success: true, action: 'edit' };
      }

      // 3. Handle Incoming Messages (Audio/Text/Image)
      const { messageType, mediaUrl, textContent, contactPhone, messageId } = data;
      let extractedData;

      if (messageType === 'audio') {
        const transcription = await transcribeAudio(mediaUrl); 
        extractedData = await extractTransactionDetails(transcription);
      }
      else if (messageType === 'text') {
        extractedData = await extractTransactionDetails(textContent);
      }
      else if (messageType === 'image') {
        console.log(`📸 Processing Image using Gemini Vision...`);
        const { base64, mimeType } = await WhatsAppService.downloadMedia(mediaUrl);
        extractedData = await extractTransactionDetailsFromImage(base64, mimeType);
      }

      // 4. Handle Intents & Execute Logic
      if (extractedData) {
        console.log(`✅ Extracted JSON Data:`, extractedData);
        
        const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000000'; 
        
        if (extractedData.intent === 'UPDATE_PRICE') {
          console.log(`📝 Updating price for ${extractedData.updated_stone_type} to ₹${extractedData.updated_rate}`);
          
          // Update DB
          await pool.query(
            `INSERT INTO price_list (organization_id, stone_type, rate_per_sqft)
             VALUES ($1, $2, $3)
             ON CONFLICT (organization_id, stone_type) 
             DO UPDATE SET rate_per_sqft = EXCLUDED.rate_per_sqft, updated_at = CURRENT_TIMESTAMP`,
            [DEFAULT_ORG_ID, extractedData.updated_stone_type, extractedData.updated_rate]
          );
          
          // Generate PDF, upload and send
          const pdfPath = await PdfService.generatePricingPdf(DEFAULT_ORG_ID);
          const mediaId = await WhatsAppService.uploadMedia(pdfPath, 'application/pdf');
          await WhatsAppService.sendDocument(contactPhone, mediaId, 'Pricing_List.pdf', `✅ Done! The price for ${extractedData.updated_stone_type} has been updated to ₹${extractedData.updated_rate}. Here is the latest Pricing PDF.`);
          console.log(`📨 Sent Updated PDF to ${contactPhone}`);

        } else if (extractedData.intent === 'GET_PDF') {
          console.log(`📄 Generating and sending pricing PDF to ${contactPhone}`);
          
          // Generate PDF, upload and send
          const pdfPath = await PdfService.generatePricingPdf(DEFAULT_ORG_ID);
          const mediaId = await WhatsAppService.uploadMedia(pdfPath, 'application/pdf');
          await WhatsAppService.sendDocument(contactPhone, mediaId, 'Pricing_List.pdf', 'Sir, yeh rahi latest pricing list. Aap isey customer ko forward kar sakte hain.');
          console.log(`📨 Sent Pricing PDF to ${contactPhone}`);
          
        } else if (extractedData.intent === 'TRANSACTION') {
          // Save to Database (Pending)
          const dbResult = await LedgerService.processTransaction(extractedData, DEFAULT_ORG_ID, messageId);
          console.log(`✅ Saved to Database (Pending Confirmation): Transaction ID ${dbResult.transactionId}`);
          
          // Send WhatsApp Interactive Message
          await WhatsAppService.sendInteractiveConfirmation(contactPhone, dbResult);
          console.log(`📨 Sent WhatsApp confirmation to ${contactPhone}`);
        }
      }

      // Add delay to respect Gemini rate limit
      await new Promise(resolve => setTimeout(resolve, 4000));

      return { success: true, extractedData };
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error);
      throw error;
    }
  },
  {
    connection: connection as any,
    concurrency: 1
  }
);

worker.on('completed', (job) => {
  console.log(`🏆 Job ${job.id} has completed successfully!`);
});

worker.on('failed', (job, err) => {
  console.log(`🚨 Job ${job?.id} has failed with error: ${err.message}`);
});
