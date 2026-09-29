import { config } from './config';
import { createApp } from './app';
import pool from './db';
import { closeQueue, enqueueMessage, startWorker } from './queue';
import { fileStore } from './services/file-store';

/**
 * Entry point: HTTP server + queue worker in one process (fits Render's free tier).
 * config is imported first, so a missing secret stops startup with a clear error.
 */
const app = createApp({ enqueue: enqueueMessage });
const server = app.listen(config.PORT, () => {
  console.log(`🚀 VoiceKhata backend listening on port ${config.PORT}`);
});
const worker = startWorker();
const cleanupTimer = setInterval(() => fileStore.cleanup(), 10 * 60 * 1000);

// Graceful shutdown: Render sends SIGTERM on every deploy. Finish the current
// job and close connections instead of being killed mid-transaction.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down…`);
  clearInterval(cleanupTimer);
  server.close();
  await worker.close().catch(() => undefined);
  await closeQueue().catch(() => undefined);
  await pool.end().catch(() => undefined);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
