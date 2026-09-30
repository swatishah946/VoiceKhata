import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { config } from './config';
import { maskPhone } from './lib/phone';
import { handleIncomingMessage, IncomingMessageJob, defaultDeps, Deps } from './workers/handlers';
import { MSG } from './workers/messages';

/**
 * BullMQ queue + worker.
 *
 *  - job id = Twilio MessageSid, so BullMQ itself drops duplicates;
 *  - BullMQ's limiter (12 jobs/min, Gemini free tier) instead of a fixed sleep;
 *  - concurrency 1 keeps messages in arrival order ("yes" can't overtake its voice note);
 *  - when a job fails for the last time, the user gets a WhatsApp message;
 *  - everything is injectable (connection, queue name, deps, timings) so the
 *    tests run the real queue against a real Redis with fake WhatsApp/AI.
 */

export const QUEUE_NAME = 'process_whatsapp_message';
export const JOB_ATTEMPTS = 5;

export function createRedisConnection(url = config.REDIS_URL): IORedis {
  return url
    ? new IORedis(url, { maxRetriesPerRequest: null })
    : new IORedis({ host: config.REDIS_HOST, port: config.REDIS_PORT, maxRetriesPerRequest: null });
}

export interface MessageQueueOptions {
  connection?: IORedis;
  name?: string;
  deps?: Deps;
  attempts?: number;
  backoffDelayMs?: number;
  limiter?: { max: number; duration: number };
  log?: (msg: string) => void;
}

export function createMessageQueue(opts: MessageQueueOptions = {}) {
  const connection = opts.connection ?? createRedisConnection();
  const name = opts.name ?? QUEUE_NAME;
  const deps = opts.deps ?? defaultDeps;
  const log = opts.log ?? console.log;

  const queue = new Queue(name, {
    connection: connection as any,
    defaultJobOptions: {
      attempts: opts.attempts ?? JOB_ATTEMPTS,
      backoff: { type: 'exponential', delay: opts.backoffDelayMs ?? 5000 },
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });

  async function enqueue(job: IncomingMessageJob): Promise<void> {
    // BullMQ ids cannot contain ':'; MessageSids never do, but be safe
    await queue.add('incoming_message', job, { jobId: job.messageSid.replace(/:/g, '_') });
  }

  function startWorker() {
    const worker = new Worker(name, async (job: Job<IncomingMessageJob>) => handleIncomingMessage(job.data, deps), {
      connection: connection as any,
      concurrency: 1,
      limiter: opts.limiter ?? { max: 12, duration: 60_000 },
    });

    worker.on('completed', (job, outcome) => {
      log(`🏁 job ${job.id} → ${outcome} (${maskPhone(job.data.phone)})`);
    });

    worker.on('failed', async (job, err) => {
      if (!job) return;
      const final = job.attemptsMade >= (job.opts.attempts ?? 1) || err.name === 'UnrecoverableError';
      log(`🚨 job ${job.id} attempt ${job.attemptsMade} failed: ${err.message}${final ? ' (giving up)' : ''}`);
      if (final) {
        await deps.messenger.sendText(job.data.phone, MSG.failed).catch((e) => {
          log(`could not send failure notice: ${e.message}`);
        });
      }
    });

    return worker;
  }

  async function close() {
    await queue.close();
    if (!opts.connection) await connection.quit();
  }

  return { queue, enqueue, startWorker, close };
}
