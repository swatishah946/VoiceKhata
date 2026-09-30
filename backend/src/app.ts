import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import pool from './db';
import apiRoutes from './routes/api.routes';
import { createWhatsAppRouter } from './routes/whatsapp.routes';
import { fileStore } from './services/file-store';
import type { IncomingMessageJob } from './workers/handlers';

/**
 * Builds the Express app. Kept separate from index.ts (which starts the server
 * and worker) so tests can create an app with a fake queue and call it with
 * supertest — no network, no Redis.
 */
export function createApp(deps: { enqueue: (job: IncomingMessageJob) => Promise<void> }) {
  const app = express();

  app.set('trust proxy', 1); // Render puts one proxy in front; needed for correct client IPs in rate limiting
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin)),
    })
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  if (!config.isTest) app.use(morgan(config.isProduction ? 'tiny' : 'dev'));

  app.get('/health', async (_req: Request, res: Response) => {
    try {
      await pool.query('SELECT 1');
      res.json({ status: 'OK', db: 'up', timestamp: new Date() });
    } catch {
      res.status(503).json({ status: 'DEGRADED', db: 'down', timestamp: new Date() });
    }
  });

  app.use('/webhook/whatsapp', createWhatsAppRouter(deps.enqueue));
  app.use('/api', apiRoutes);

  // Short-lived PDF links for Twilio (see services/file-store.ts)
  app.get('/pdfs/:id', (req: Request, res: Response) => {
    const file = fileStore.resolve(String(req.params.id));
    if (!file) return res.status(404).send('Not found');
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/pdf').sendFile(file);
  });

  app.use((_req: Request, res: Response) => res.status(404).json({ error: 'Not found' }));

  // Never leak stack traces or SQL errors to the client
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error('❌ unhandled error:', err?.message || err);
    if (res.headersSent) return;
    res.status(err?.status && err.status < 500 ? err.status : 500).json({ error: 'Server error' });
  });

  return app;
}
