import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import { maskPhone } from './lib/phone';
import { handleIncomingMessage, IncomingMessageJob, defaultDeps } from './workers/handlers';
import { MSG } from './workers/messages';

/**
 * BullMQ queue + worker.
 *
 * Changes:
 *  - the job id is the Twilio MessageSid, so BullMQ itself drops duplicates;
 *  - rate limiting uses BullMQ's built-in limiter (max 12 jobs/min for Gemini's
 *    free tier) instead of a fixed 4-second sleep after every job;
 *  - when a job fails for the last time, the user gets a WhatsApp message
 *    instead of silence;
 *  - the connection is created lazily, so tests can import the app without Redis.
 */

export const QUEUE_NAME = 'process_whatsapp_message';
export const JOB_ATTEMPTS = 5;

let connection: IORedis | null = null;
let queue: Queue | null = null;

function getConnection() {
  connection ??= config.REDIS_URL
    ? new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null })
    : new IORedis({ host: config.REDIS_HOST, port: config.REDIS_PORT, maxRetriesPerRequest: null });
  return connection;
}

export function getQueue(): Queue {
  queue ??= new Queue(QUEUE_NAME, {
    connection: getConnection() as any,
    defaultJobOptions: {
      attempts: JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return queue;
}

export async function enqueueMessage(job: IncomingMessageJob): Promise<void> {
  // BullMQ ids cannot contain ':'; MessageSids never do, but be safe
  await getQueue().add('incoming_message', job, { jobId: job.messageSid.replace(/:/g, '_') });
}

export function startWorker() {
  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job<IncomingMessageJob>) => handleIncomingMessage(job.data),
    {
      connection: getConnection() as any,
      // 1 = messages are handled strictly in arrival order, so a quick "yes"
      // can never be processed before the voice note it is confirming.
      concurrency: 1,
      limiter: { max: 12, duration: 60_000 },
    }
  );

  worker.on('completed', (job, outcome) => {
    console.log(`🏁 job ${job.id} → ${outcome} (${maskPhone(job.data.phone)})`);
  });

  worker.on('failed', async (job, err) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === 'UnrecoverableError';
    console.error(`🚨 job ${job.id} attempt ${job.attemptsMade} failed: ${err.message}${final ? ' (giving up)' : ''}`);
    if (final) {
      await defaultDeps.messenger.sendText(job.data.phone, MSG.failed).catch((e) => {
        console.error('could not send failure notice:', e.message);
      });
    }
  });

  return worker;
}

export async function closeQueue() {
  await queue?.close();
  await connection?.quit();
}
