/**
 * Backend for the browser end-to-end tests (frontend/tests/e2e).
 *
 * Resets a TEST database, seeds a small realistic ledger through the real ledger
 * code, and serves the real Express app. Only the queue is replaced (no Redis,
 * no WhatsApp/AI calls) — the dashboard never uses it.
 *
 * Usage (Playwright starts this automatically):
 *   E2E_DATABASE_URL=postgres://.../voicekhata_e2e_test PORT=3100 npm run e2e:server
 *   npm run e2e:server -- --seed-only    # reset + re-seed, then exit (run before each browser project)
 */
process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL = process.env.E2E_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/voicekhata_e2e_test';

import { Client } from 'pg';
import { migrate } from './migrate';

async function ensureDatabase(url: string) {
  const u = new URL(url);
  const name = u.pathname.slice(1);
  if (!/test/i.test(name)) throw new Error(`Refusing to reset "${name}": e2e database name must contain "test"`);
  const admin = new Client({ connectionString: url.replace(/\/[^/?]+(\?|$)/, '/postgres$1') });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  if (!exists.rowCount) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  await admin.end();
}

async function main() {
  const url = process.env.TEST_DATABASE_URL!;
  await ensureDatabase(url);
  await migrate(url, () => undefined);

  const { config } = require('../src/config') as typeof import('../src/config');
  const { default: pool } = require('../src/db') as typeof import('../src/db');
  const Ledger = require('../src/services/ledger.service') as typeof import('../src/services/ledger.service');
  const { createApp } = require('../src/app') as typeof import('../src/app');

  const ORG = config.DEFAULT_ORG_ID;
  const PHONE = '+919876543210';
  await pool.query(`
    TRUNCATE audit_logs, transaction_line_items, party_balances, worker_ledger, stone_price_history,
             transactions, stone_types, parties, workers, organization_members, processed_messages
    RESTART IDENTITY CASCADE`);
  await pool.query(
    `INSERT INTO organizations (id, name, owner_phone) VALUES ($1, 'VoiceKhata Admin', '+10000000000') ON CONFLICT (id) DO NOTHING`,
    [ORG]
  );
  await pool.query(`INSERT INTO organization_members (phone, organization_id, name, role) VALUES ($1, $2, 'Papa', 'owner')`, [PHONE, ORG]);
  await pool.query(`INSERT INTO stone_types (organization_id, size_format, finish, current_price) VALUES ($1, '2x1½', 'Standard', 31.5)`, [ORG]);

  let n = 0;
  const entry = async (data: Record<string, unknown>, confirm: boolean) => {
    await Ledger.createPending(ORG, PHONE, `SMe2e${String(++n).padStart(20, '0')}`, { intent: 'TRANSACTION', confidence_level: 1, ...data } as any);
    if (confirm) await Ledger.confirmPending(ORG, PHONE);
  };
  // Siddhi Stone: billed ₹31,500, paid ₹10,000 → ₹21,500 outstanding
  await entry({ transaction_type: 'dispatch', party_name: 'Siddhi Stone', stone_type: '2x1½', sqft_quantity: 1000, unit_rate: 31.5 }, true);
  await entry({ transaction_type: 'payment', party_name: 'Siddhi Stone', amount: 10000 }, true);
  await entry({ transaction_type: 'worker_advance', worker_name: 'Mohan', amount: 800 }, true);
  // Waiting for "yes": the dashboard test confirms this one
  await entry({ transaction_type: 'payment', party_name: 'Ramesh Traders', amount: 5000 }, false);

  if (process.argv.includes('--seed-only')) {
    await pool.end();
    console.log('e2e database re-seeded');
    return;
  }

  const port = Number(process.env.PORT || 3100);
  createApp({ enqueue: async () => undefined }).listen(port, () => {
    console.log(`e2e backend ready on http://localhost:${port} (db ${new URL(url).pathname.slice(1)})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
