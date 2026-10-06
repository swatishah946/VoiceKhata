import IORedis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it as baseIt, vi } from 'vitest';
import { createMessageQueue } from '../../src/queue';
import { defaultDeps, Deps, IncomingMessageJob } from '../../src/workers/handlers';
import { AiError } from '../../src/services/ai.service';
import { MediaError } from '../../src/services/media.service';
import { MSG } from '../../src/workers/messages';
import { ORG, OWNER, resetDb } from '../helpers/db';

/**
 * The real BullMQ queue + worker against a real Redis, with fake WhatsApp/AI.
 * Needs Redis: set TEST_REDIS_URL (CI does). Skipped locally if Redis is not running,
 * but in CI a missing Redis FAILS the run instead of silently skipping.
 */
const REDIS_URL = process.env.TEST_REDIS_URL || 'redis://127.0.0.1:6380';

async function redisReachable() {
  const probe = new IORedis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 0, retryStrategy: () => null });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
}
let available = false;
let connection: IORedis | null = null;

beforeAll(async () => {
  available = await redisReachable();
  if (!available && process.env.CI) throw new Error(`Redis not reachable at ${REDIS_URL} (required in CI)`);
  if (!available) console.warn(`⚠️ Redis not reachable at ${REDIS_URL}; queue tests skipped (set TEST_REDIS_URL)`);
  else connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
});
beforeEach(resetDb);

/** Like it(), but skips when Redis is not running locally. */
const it = (name: string, fn: () => Promise<void>) =>
  baseIt(name, async (ctx) => {
    if (!available) return ctx.skip();
    await fn();
  });

let seq = 0;
const job = (text: string): IncomingMessageJob => ({
  messageSid: `SMq${Date.now().toString(16)}${String(++seq).padStart(8, '0')}`,
  phone: OWNER,
  organizationId: ORG,
  kind: 'text',
  text,
});

function fakeDeps(extract: () => Promise<unknown>) {
  const sent: string[] = [];
  const deps = {
    ...defaultDeps,
    messenger: {
      sendText: vi.fn(async (_to: string, t: string) => void sent.push(t)),
      sendPdf: vi.fn(async (_to: string, _pdf: Buffer, caption: string) => void sent.push(`[pdf] ${caption}`)),
    },
    extractFromText: vi.fn(extract),
    pdf: { generatePricingPdf: async () => Buffer.from('%PDF'), generateKhataPdf: async () => Buffer.from('%PDF') },
  } as unknown as Deps;
  return { deps, sent };
}

/** Resolves once `n` jobs have finished (completed or permanently failed). */
function waitForJobs(worker: ReturnType<ReturnType<typeof createMessageQueue>['startWorker']>, n: number) {
  return new Promise<{ completed: string[]; failed: string[] }>((resolve) => {
    const completed: string[] = [];
    const failed: string[] = [];
    const check = () => completed.length + failed.length >= n && resolve({ completed, failed });
    worker.on('completed', (j) => { completed.push(j.id!); check(); });
    worker.on('failed', (j, err) => {
      if (j && (j.attemptsMade >= (j.opts.attempts ?? 1) || err.name === 'UnrecoverableError')) {
        // give the failure-notice handler a moment to send its WhatsApp message
        setTimeout(() => { failed.push(j.id!); check(); }, 50);
      }
    });
  });
}

const open: Array<{ close: () => Promise<void>; worker?: { close: () => Promise<void> } }> = [];

function setup(deps: Deps, attempts = 3) {
  const mq = createMessageQueue({
    connection: connection!,
    name: `test_${Date.now()}_${++seq}`, // isolated queue per test
    deps,
    attempts,
    backoffDelayMs: 10,
    limiter: { max: 1000, duration: 1000 },
    log: () => undefined,
  });
  const worker = mq.startWorker();
  open.push({ close: mq.close, worker });
  return { ...mq, worker };
}

afterEach(async () => {
  for (const o of open.splice(0)) {
    await o.worker?.close();
    await o.close();
  }
});
afterAll(async () => {
  await connection?.quit();
});

describe('message queue (real Redis)', () => {
  it('drops a duplicate delivery of the same MessageSid', async () => {
    const { deps, sent } = fakeDeps(async () => ({ intent: 'GET_PDF' }));
    const { enqueue, worker } = setup(deps);
    const done = waitForJobs(worker, 1);
    const j = job('price list');
    await enqueue(j);
    await enqueue(j); // Twilio retry
    await enqueue(j);
    await done;
    await new Promise((r) => setTimeout(r, 200)); // would a 2nd job run?
    expect(deps.extractFromText).toHaveBeenCalledTimes(1);
    expect(sent).toEqual([`[pdf] ${MSG.priceList}`]);
  });

  it('processes messages strictly in the order they arrived', async () => {
    const order: string[] = [];
    const { deps } = fakeDeps(async () => ({ intent: 'GET_PDF' }));
    (deps.messenger.sendText as any).mockImplementation(async (_to: string, t: string) => void order.push(t));
    const { enqueue, worker } = setup(deps);
    const done = waitForJobs(worker, 4);
    // help/yes/no/undo are handled without AI; replies reveal processing order
    for (const t of ['help', 'yes', 'no', 'undo']) await enqueue(job(t));
    await done;
    expect(order).toEqual([MSG.help, MSG.nothingPending, MSG.nothingPending, MSG.nothingToUndo]);
  });

  it('retries after a Gemini rate limit, then succeeds', async () => {
    let calls = 0;
    const { deps, sent } = fakeDeps(async () => {
      if (++calls < 3) throw new AiError('429 quota', true, 429);
      return { intent: 'GET_PDF' };
    });
    const { enqueue, worker } = setup(deps, 5);
    const done = waitForJobs(worker, 1);
    await enqueue(job('price list'));
    const r = await done;
    expect(r.completed).toHaveLength(1);
    expect(calls).toBe(3);
    expect(sent).toEqual([`[pdf] ${MSG.priceList}`]); // no failure message
  });

  it('after the last failed attempt, tells the user instead of staying silent', async () => {
    const { deps, sent } = fakeDeps(async () => {
      throw new AiError('503 overloaded', true, 503);
    });
    const { enqueue, worker } = setup(deps, 3);
    const done = waitForJobs(worker, 1);
    await enqueue(job('Ramesh se 5000 aaya'));
    const r = await done;
    expect(r.failed).toHaveLength(1);
    expect(deps.extractFromText).toHaveBeenCalledTimes(3);
    expect(sent).toEqual([MSG.failed]);
  });

  it('does not retry errors that can never succeed (bad media URL)', async () => {
    const { deps, sent } = fakeDeps(async () => ({ intent: 'GET_PDF' }));
    deps.downloadMedia = vi.fn(async () => {
      throw new MediaError('Refusing to download media from a non-Twilio URL');
    });
    const { enqueue, worker } = setup(deps, 5);
    const done = waitForJobs(worker, 1);
    await enqueue({ ...job(''), kind: 'audio', mediaUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/x' });
    await done;
    expect(deps.downloadMedia).toHaveBeenCalledTimes(1); // not 5
    expect(sent).toEqual([MSG.failed]);
  });
});
