import request from 'supertest';
import twilio from 'twilio';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app';
import { config } from '../../src/config';
import { generateKhataPdf, generatePricingPdf } from '../../src/services/pdf.service';
import { fileStore } from '../../src/services/file-store';
import type { IncomingMessageJob } from '../../src/workers/handlers';
import { ORG, OWNER, STRANGER, pool, resetDb, seedPrice } from '../helpers/db';

const WEBHOOK = '/webhook/whatsapp';
let seq = 0;

function twilioParams(over: Record<string, string> = {}) {
  return {
    MessageSid: `SM${String(++seq).padStart(32, '0')}`,
    From: `whatsapp:${OWNER}`,
    To: 'whatsapp:+14155238886',
    Body: 'Ramesh se 5000 aaya',
    NumMedia: '0',
    ...over,
  };
}

function sign(params: Record<string, string>) {
  return twilio.getExpectedTwilioSignature(config.TWILIO_AUTH_TOKEN!, `${config.publicBaseUrl}${WEBHOOK}`, params);
}

function setup() {
  const jobs: IncomingMessageJob[] = [];
  const app = createApp({ enqueue: async (j) => void jobs.push(j) });
  const post = (params: Record<string, string>, signature: string | null = sign(params)) => {
    const r = request(app).post(WEBHOOK).type('form').send(params);
    return signature === null ? r : r.set('X-Twilio-Signature', signature);
  };
  return { app, jobs, post };
}

beforeEach(resetDb);

describe('webhook security', () => {
  it('accepts a correctly signed message from a registered number', async () => {
    const { jobs, post } = setup();
    const res = await post(twilioParams());
    expect(res.status).toBe(200);
    expect(res.text).toBe('<Response></Response>');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ phone: OWNER, organizationId: ORG, kind: 'text', text: 'Ramesh se 5000 aaya' });
  });

  it('rejects requests without a Twilio signature (403)', async () => {
    const { jobs, post } = setup();
    expect((await post(twilioParams(), null)).status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('rejects a forged signature', async () => {
    const { jobs, post } = setup();
    expect((await post(twilioParams(), 'Zm9yZ2Vk')).status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('rejects a signed request whose body was tampered with', async () => {
    const { jobs, post } = setup();
    const params = twilioParams();
    const signature = sign(params);
    expect((await post({ ...params, Body: 'yes' }, signature)).status).toBe(403);
    expect(jobs).toHaveLength(0);
  });

  it('ignores messages from unregistered numbers', async () => {
    const { jobs, post } = setup();
    const res = await post(twilioParams({ From: `whatsapp:${STRANGER}` }));
    expect(res.status).toBe(200); // 200 so Twilio doesn't retry, but…
    expect(jobs).toHaveLength(0); // …nothing is processed
  });

  it('processes a Twilio retry (same MessageSid) only once', async () => {
    const { jobs, post } = setup();
    const params = twilioParams();
    await post(params);
    await post(params);
    await post(params);
    expect(jobs).toHaveLength(1);
  });

  it('never queues media from a non-Twilio URL (SSRF)', async () => {
    const { jobs, post } = setup();
    await post(twilioParams({ NumMedia: '1', MediaContentType0: 'audio/ogg', MediaUrl0: 'https://attacker.example.com/x' }));
    expect(jobs[0].kind).toBe('other');
    expect(jobs[0].mediaUrl).toBeUndefined();
  });

  it('queues a Twilio voice note as audio', async () => {
    const { jobs, post } = setup();
    const url = 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1';
    await post(twilioParams({ NumMedia: '1', MediaContentType0: 'audio/ogg', MediaUrl0: url, Body: '' }));
    expect(jobs[0]).toMatchObject({ kind: 'audio', mediaUrl: url });
  });

  it('if the queue is down, returns 500 and lets Twilio retry the same message', async () => {
    let fail = true;
    const jobs: IncomingMessageJob[] = [];
    const app = createApp({
      enqueue: async (j) => {
        if (fail) throw new Error('redis down');
        jobs.push(j);
      },
    });
    const params = twilioParams();
    const send = () => request(app).post(WEBHOOK).type('form').send(params).set('X-Twilio-Signature', sign(params));
    expect((await send()).status).toBe(500);
    fail = false;
    expect((await send()).status).toBe(200);
    expect(jobs).toHaveLength(1);
  });

  it('rejects malformed payloads', async () => {
    const { post } = setup();
    const params = { From: `whatsapp:${OWNER}`, Body: 'hi' } as Record<string, string>;
    expect((await post(params)).status).toBe(400);
  });
});

describe('dashboard API security', () => {
  const password = 'test-password-123';

  it('logs in with the right password and gets a working token', async () => {
    const { app } = setup();
    const res = await request(app).post('/api/auth/login').send({ password });
    expect(res.status).toBe(200);
    const api = await request(app).get('/api/analytics').set('Authorization', `Bearer ${res.body.token}`);
    expect(api.status).toBe(200);
    expect(api.body).toEqual({ totalMarketDue: 0, monthlySales: 0, pendingCount: 0 });
  });

  it('returns ledger data scoped to the token\'s organisation', async () => {
    const { app } = setup();
    const party = await pool.query(
      `INSERT INTO parties (organization_id, name, type) VALUES ($1, 'Ramesh', 'customer') RETURNING id`, [ORG]);
    await pool.query(
      `INSERT INTO party_balances (organization_id, party_id, total_billed, total_paid, outstanding_balance)
       VALUES ($1, $2, 5000, 1000, 4000)`, [ORG, party.rows[0].id]);
    await pool.query(
      `INSERT INTO transactions (organization_id, party_id, transaction_type, total_amount, status)
       VALUES ($1, $2, 'dispatch', 5000, 'confirmed')`, [ORG, party.rows[0].id]);
    await pool.query(`INSERT INTO workers (organization_id, name) VALUES ($1, 'Mohan')`, [ORG]);

    // A second organisation's data must never appear
    const other = '11111111-1111-1111-1111-111111111111';
    await pool.query(`INSERT INTO organizations (id, name, owner_phone) VALUES ($1, 'Other', '+911111111111') ON CONFLICT DO NOTHING`, [other]);
    await pool.query(`INSERT INTO parties (organization_id, name, type) VALUES ($1, 'Secret Customer', 'customer')`, [other]);

    const { body } = await request(app).post('/api/auth/login').send({ password });
    const get = (p: string) => request(app).get(p).set('Authorization', `Bearer ${body.token}`);

    const parties = await get('/api/parties');
    expect(parties.body.map((p: any) => p.name)).toEqual(['Ramesh']);
    expect(Number(parties.body[0].outstanding_balance)).toBe(4000);
    expect((await get('/api/transactions')).body[0]).toMatchObject({ party_name: 'Ramesh', status: 'confirmed' });
    expect((await get('/api/workers')).body[0].name).toBe('Mohan');
    const analytics = (await get('/api/analytics')).body;
    expect(analytics).toEqual({ totalMarketDue: 4000, monthlySales: 5000, pendingCount: 0 });

    await pool.query(`DELETE FROM parties WHERE organization_id = $1`, [other]);
    await pool.query(`DELETE FROM organizations WHERE id = $1`, [other]);
  });

  it('rejects wrong passwords and locks out after 5 failures', async () => {
    const { app } = setup();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      statuses.push((await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ password: 'nope' })).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });

  it('requires a token for data endpoints', async () => {
    const { app } = setup();
    for (const path of ['/api/transactions', '/api/parties', '/api/workers', '/api/analytics']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('rejects tokens signed with the old public fallback secret', async () => {
    const { app } = setup();
    const forged = jwt.sign({ orgId: ORG, role: 'admin' }, 'super_secret_voicekhata_key_for_dev');
    expect((await request(app).get('/api/parties').set('Authorization', `Bearer ${forged}`)).status).toBe(401);
  });

  it('rejects "alg: none" tokens', async () => {
    const { app } = setup();
    const unsigned = jwt.sign({ orgId: ORG }, '', { algorithm: 'none' as any });
    expect((await request(app).get('/api/parties').set('Authorization', `Bearer ${unsigned}`)).status).toBe(401);
  });

  it('only allows configured dashboard origins (CORS)', async () => {
    const { app } = setup();
    const ok = await request(app).get('/health').set('Origin', 'https://voice-khata.vercel.app');
    expect(ok.headers['access-control-allow-origin']).toBe('https://voice-khata.vercel.app');
    const bad = await request(app).get('/health').set('Origin', 'https://evil.example.com');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not leak internals in error responses', async () => {
    const { app } = setup();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});

describe('PDF links', () => {
  it('serves a stored PDF by id and 404s for guessable names', async () => {
    const { app } = setup();
    const id = fileStore.save(Buffer.from('%PDF-1.7 test'));
    const ok = await request(app).get(`/pdfs/${id}`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toContain('application/pdf');
    expect((await request(app).get('/pdfs/Khata_Ramesh.pdf')).status).toBe(404);
    expect((await request(app).get('/pdfs/..%2F..%2F.env')).status).toBe(404);
  });
});

describe('PDF content', () => {
  it('embeds a font that can draw ₹ (Helvetica printed "¹")', async () => {
    await seedPrice('2x1½', 31.5);
    const pdf = await generatePricingPdf(ORG);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('DejaVuSans');
    expect(pdf.toString('latin1')).not.toContain('/Helvetica');
  });

  it('builds a multi-page khata for a long ledger', async () => {
    const party = await pool.query(`INSERT INTO parties (organization_id, name, type) VALUES ($1, 'Big Buyer', 'customer') RETURNING id`, [ORG]);
    for (let i = 0; i < 80; i++) {
      await pool.query(
        `INSERT INTO transactions (organization_id, party_id, transaction_type, total_amount, outstanding_balance, status)
         VALUES ($1, $2, 'dispatch', 1000, 1000, 'confirmed')`,
        [ORG, party.rows[0].id]
      );
    }
    const pdf = await generateKhataPdf(ORG, { id: party.rows[0].id, type: 'party', name: 'Big Buyer' });
    const pages = (pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length;
    expect(pages).toBeGreaterThan(1);
  });
});

describe('health', () => {
  it('reports database status', async () => {
    const { app } = setup();
    const res = await request(app).get('/health');
    expect(res.body).toMatchObject({ status: 'OK', db: 'up' });
  });
});

// keep vi imported for future spies
void vi;
