import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import * as Ledger from '../../src/services/ledger.service';
import type { Extraction } from '../../src/lib/extraction';
import { ORG, OWNER, partyBalance, pool, resetDb } from '../helpers/db';

const app = createApp({ enqueue: async () => undefined });
let token = '';
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
const get = (p: string) => auth(request(app).get(p));
const post = (p: string) => auth(request(app).post(p));

let seq = 0;
async function pending(e: Partial<Extraction>) {
  return Ledger.createPending(ORG, OWNER, `SMdash${String(++seq).padStart(20, '0')}`, {
    intent: 'TRANSACTION', confidence_level: 1, ...e,
  } as Extraction);
}
const payment = (party: string, amount: number) => pending({ transaction_type: 'payment', party_name: party, amount });
const dispatch = (party: string, sqft: number, rate: number) =>
  pending({ transaction_type: 'dispatch', party_name: party, sqft_quantity: sqft, unit_rate: rate, stone_type: '2x1½' });

beforeEach(async () => {
  await resetDb();
  token = (await request(app).post('/api/auth/login').send({ password: 'test-password-123' })).body.token;
});

describe('confirm / cancel pending entries from the dashboard', () => {
  it('lists pending entries and confirms one', async () => {
    const e = await dispatch('Siddhi Stone', 100, 30);
    const list = await get('/api/transactions?status=pending_confirmation');
    expect(list.body.map((t: any) => t.id)).toEqual([e.id]);
    expect(list.body[0].party_name).toBe('Siddhi Stone'); // name shown even before the party exists

    const r = await post(`/api/transactions/${e.id}/confirm`);
    expect(r.status).toBe(200);
    expect(await partyBalance('Siddhi Stone')).toMatchObject({ outstanding: 3000 });

    const audit = await pool.query(`SELECT user_agent FROM audit_logs WHERE action = 'transaction.confirm'`);
    expect(audit.rows[0].user_agent).toBe('dashboard');
  });

  it('confirming twice is refused (409) and applied once', async () => {
    const e = await payment('Ramesh', 500);
    expect((await post(`/api/transactions/${e.id}/confirm`)).status).toBe(200);
    expect((await post(`/api/transactions/${e.id}/confirm`)).status).toBe(409);
    expect((await partyBalance('Ramesh'))!.paid).toBe(500);
  });

  it('a dashboard click and a WhatsApp "yes" at the same moment apply the entry once', async () => {
    const e = await payment('Ramesh', 700);
    const [web, wa] = await Promise.all([post(`/api/transactions/${e.id}/confirm`), Ledger.confirmPending(ORG, OWNER)]);
    const successes = (web.status === 200 ? 1 : 0) + (wa.status === 'done' ? 1 : 0);
    expect(successes).toBe(1);
    expect((await partyBalance('Ramesh'))!.paid).toBe(700);
  });

  it('cancel from the dashboard', async () => {
    const e = await payment('Ramesh', 500);
    expect((await post(`/api/transactions/${e.id}/cancel`)).status).toBe(200);
    expect((await post(`/api/transactions/${e.id}/confirm`)).status).toBe(409);
    expect(await partyBalance('Ramesh')).toBeNull();
  });

  it('malformed ids are a clean 404, unknown ids 409', async () => {
    expect((await post('/api/transactions/not-a-uuid/confirm')).status).toBe(404);
    expect((await post('/api/transactions/00000000-0000-4000-8000-000000000000/confirm')).status).toBe(409);
  });

  it('rejects an unknown status filter', async () => {
    expect((await get('/api/transactions?status=hacked')).status).toBe(400);
  });

  it('cannot confirm another organisation\'s entry', async () => {
    const other = '22222222-2222-2222-2222-222222222222';
    await pool.query(`INSERT INTO organizations (id, name, owner_phone) VALUES ($1, 'Other', '+912222222222') ON CONFLICT DO NOTHING`, [other]);
    const e = await Ledger.createPending(other, '+912222222222', 'SMotherorg000000000001', {
      intent: 'TRANSACTION', transaction_type: 'payment', party_name: 'X', amount: 1, confidence_level: 1,
    } as Extraction);
    expect((await post(`/api/transactions/${e.id}/confirm`)).status).toBe(409);
    const still = await pool.query(`SELECT status FROM transactions WHERE id = $1`, [e.id]);
    expect(still.rows[0].status).toBe('pending_confirmation');
    await pool.query(`DELETE FROM audit_logs WHERE organization_id = $1`, [other]);
    await pool.query(`DELETE FROM transactions WHERE organization_id = $1`, [other]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [other]);
  });
});

describe('party / worker detail and khata download', () => {
  it('returns the balance and every entry of one party', async () => {
    await dispatch('Siddhi Stone', 100, 30);
    await Ledger.confirmPending(ORG, OWNER);
    await payment('Siddhi Stone', 1000);
    await Ledger.confirmPending(ORG, OWNER);
    const party = await pool.query(`SELECT id FROM parties WHERE name = 'Siddhi Stone'`);

    const r = await get(`/api/parties/${party.rows[0].id}`);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ name: 'Siddhi Stone', outstanding_balance: '2000.00' });
    expect(r.body.transactions.map((t: any) => t.transaction_type)).toEqual(['payment', 'dispatch']);
  });

  it('downloads the khata as a PDF', async () => {
    await payment('Siddhi Stone', 1000);
    await Ledger.confirmPending(ORG, OWNER);
    const party = await pool.query(`SELECT id FROM parties WHERE name = 'Siddhi Stone'`);
    const r = await get(`/api/parties/${party.rows[0].id}/khata.pdf`).buffer(true);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect(r.headers['content-disposition']).toBe('attachment; filename="Khata_Siddhi_Stone.pdf"');
    expect(Buffer.from(r.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('worker detail + khata', async () => {
    await pending({ transaction_type: 'worker_advance', worker_name: 'Mohan', amount: 2000 });
    await Ledger.confirmPending(ORG, OWNER);
    const w = await pool.query(`SELECT id FROM workers WHERE name = 'Mohan'`);
    const r = await get(`/api/workers/${w.rows[0].id}`);
    expect(r.body).toMatchObject({ name: 'Mohan', advances_taken: '2000.00', net_due: '-2000.00' });
    expect((await get(`/api/workers/${w.rows[0].id}/khata.pdf`)).status).toBe(200);
  });

  it('unknown or malformed ids → 404, and detail endpoints need a token', async () => {
    expect((await get('/api/parties/00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await get('/api/parties/../../etc/passwd')).status).toBe(404);
    expect((await get('/api/workers/abc/khata.pdf')).status).toBe(404);
    expect((await request(app).get('/api/parties/00000000-0000-4000-8000-000000000000')).status).toBe(401);
  });
});

describe('today\'s summary', () => {
  it('counts confirmed entries of today (IST) and ignores pending ones', async () => {
    await dispatch('Siddhi Stone', 100, 30);
    await Ledger.confirmPending(ORG, OWNER);
    await payment('Siddhi Stone', 1000);
    await Ledger.confirmPending(ORG, OWNER);
    await payment('Ramesh', 50); // still pending
    const r = await get('/api/summary/today');
    expect(r.body).toMatchObject({
      dispatchCount: 1, dispatchTotal: 300000, paymentsCount: 1, paymentsTotal: 100000,
      pendingCount: 1, marketDue: 200000, topDue: [{ name: 'Siddhi Stone', outstanding: 200000 }],
    });
  });
});

describe('CSV export', () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

  it('exports every entry with all bill fields', async () => {
    await dispatch('Siddhi Stone', 100, 30);
    await Ledger.confirmPending(ORG, OWNER);
    const r = await get(`/api/export/transactions.csv?from=${today}&to=${today}`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain(`voicekhata_${today}_to_${today}.csv`);
    const [header, row] = r.text.replace('﻿', '').trim().split('\r\n');
    expect(header).toBe('date_ist,ref,status,type,party_or_worker,stone,pieces,sqft,rate,subtotal,loading,packing,tax_percent,tax,freight,bill_total,paid_or_advance');
    expect(row).toContain(',confirmed,dispatch,Siddhi Stone,2x1½,,100.00,30.00,3000.00,');
  });

  it('defuses spreadsheet formulas hidden in names (CSV injection)', async () => {
    await payment('=HYPERLINK("http://evil","click")', 10);
    const r = await get(`/api/export/transactions.csv?from=${today}&to=${today}`);
    expect(r.text).toContain(`"'=HYPERLINK(""http://evil"",""click"")"`);
  });

  it.each([
    ['', ''],
    ['2026-13-01', '2026-13-02'],
    ['2026-09-30', '2026-09-01'],
    ['2020-01-01', '2026-01-01'],
    ["2026-09-01' OR 1=1--", '2026-09-30'],
  ])('rejects bad ranges from=%s to=%s', async (from, to) => {
    expect((await get(`/api/export/transactions.csv?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)).status).toBe(400);
  });
});
