/**
 * Webhook load test: how fast does the webhook acknowledge Twilio, and how many
 * messages/second can it accept? (AI work happens later in the worker, so this
 * measures the part Twilio waits for.)
 *
 * Runs the real app (real Postgres for sender lookup + idempotency) with an
 * in-memory queue, sending correctly signed requests.
 *
 * Usage: TEST_DATABASE_URL=... npm run bench -- [requests=2000] [concurrency=20] [deliveries=1]
 *   deliveries=3 sends every message 3 times at once (like Twilio retries):
 *   "queued" must equal requests/3 — any more would be a duplicate ledger entry.
 */
process.env.NODE_ENV = 'test';

import http from 'http';
import { AddressInfo } from 'net';
import twilio from 'twilio';
import { migrate } from './migrate';

async function main() {
  const total = Number(process.argv[2] || 2000);
  const concurrency = Number(process.argv[3] || 20);
  const deliveries = Math.max(1, Number(process.argv[4] || 1));
  const dbUrl = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/voicekhata_test';
  await migrate(dbUrl, () => undefined);

  // Loaded only after NODE_ENV=test is set, so the bench never touches DATABASE_URL
  const { config } = require('../src/config') as typeof import('../src/config');
  const { createApp } = require('../src/app') as typeof import('../src/app');
  const pool = (require('../src/db') as typeof import('../src/db')).default;

  const phone = '+919876543210';
  await pool.query(
    `INSERT INTO organization_members (phone, organization_id, role) VALUES ($1, $2, 'owner') ON CONFLICT (phone) DO NOTHING`,
    [phone, config.DEFAULT_ORG_ID]
  );

  let queued = 0;
  const server = http.createServer(createApp({ enqueue: async () => void queued++ })).listen(0);
  const port = (server.address() as AddressInfo).port;
  const runId = Date.now().toString(16);

  const latencies: number[] = [];
  let sent = 0, failed = 0;
  const t0 = performance.now();

  async function one(i: number) {
    const params: Record<string, string> = {
      // with deliveries=3, requests 0,1,2 share one MessageSid, 3,4,5 the next, …
      MessageSid: `SMbench${runId}${String(Math.floor(i / deliveries)).padStart(10, '0')}`,
      From: `whatsapp:${phone}`,
      Body: 'Ramesh se 5000 aaya',
      NumMedia: '0',
    };
    const sig = twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN!, `${config.publicBaseUrl}/webhook/whatsapp`, params);
    const start = performance.now();
    const res = await fetch(`http://127.0.0.1:${port}/webhook/whatsapp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sig },
      body: new URLSearchParams(params),
    });
    await res.text();
    latencies.push(performance.now() - start);
    if (res.status !== 200) failed++;
  }

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (sent < total) await one(sent++);
    })
  );
  const seconds = (performance.now() - t0) / 1000;
  const s = latencies.sort((a, b) => a - b);
  const p = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1);

  console.log(
    JSON.stringify(
      {
        requests: total,
        concurrency,
        deliveriesPerMessage: deliveries,
        uniqueMessages: Math.ceil(total / deliveries),
        duplicatesQueued: queued - Math.ceil(total / deliveries),
        failed,
        queued,
        throughputPerSec: Math.round(total / seconds),
        latencyMs: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
      },
      null,
      2
    )
  );
  await pool.query(`DELETE FROM processed_messages WHERE message_sid LIKE $1`, [`SMbench${runId}%`]);
  server.close();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
