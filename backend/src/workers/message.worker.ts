import { Worker, Queue } from 'bullmq';
import { transcribeAudio } from '../services/whisper.service';
import { extractTransactionDetails } from '../services/ai.service';
// Note: In reality, we will use a db connection to save the result.

const connection = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT || '6380', 10)
};

// Create the Queue where voice notes and images will be added
export const messageQueue = new Queue('process_whatsapp_message', { connection });

// Initialize the Worker
// Concurrency: 1 ensures that we process sequentially and don't hit the 15/min Gemini limit
const worker = new Worker(
  'process_whatsapp_message',
  async (job) => {
    const { messageType, mediaUrl, textContent, contactPhone, messageId } = job.data;

    console.log(`⏳ Processing Job ${job.id}: ${messageType} from ${contactPhone}`);

    try {
      let extractedData;

      if (messageType === 'audio') {
        // Step 1: Transcribe Audio using Groq (Super fast, Free, High Accuracy)
        const transcription = await transcribeAudio(mediaUrl); // Needs local file path in reality

        // Step 2: Extract Data using Gemini
        extractedData = await extractTransactionDetails(transcription);
      }
      else if (messageType === 'text') {
        // Direct extraction for text
        extractedData = await extractTransactionDetails(textContent);
      }
      else if (messageType === 'image') {
        // Future: Extract data using Gemini Vision with the image URL
        // extractedData = await extractFromImage(mediaUrl);
        extractedData = { status: "Image processing coming soon!" };
      }

      console.log(`✅ Extraction Complete for ${contactPhone}:`, extractedData);

      // Step 3: Insert into PostgreSQL as PENDING_CONFIRMATION
      // await db.transactions.create({ ... })

      // Step 4: Send WhatsApp Confirmation Button Message
      // await whatsapp.sendMessage(contactPhone, "Please confirm...")

      // Add delay to respect Gemini rate limit (15 requests/min = 1 req every 4 seconds)
      await new Promise(resolve => setTimeout(resolve, 4000));

      return { success: true, extractedData };
    } catch (error) {
      console.error(`❌ Job ${job.id} failed:`, error);
      throw error; // Let BullMQ retry
    }
  },
  {
    connection,
    concurrency: 1 // Sequential processing
  }
);

worker.on('completed', (job) => {
  console.log(`🏆 Job ${job.id} has completed successfully!`);
});

worker.on('failed', (job, err) => {
  console.log(`🚨 Job ${job?.id} has failed with error: ${err.message}`);
});
