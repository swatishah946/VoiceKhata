import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDeps, Deps, handleIncomingMessage, IncomingMessageJob } from '../../src/workers/handlers';
import * as Ledger from '../../src/services/ledger.service';
import type { Extraction } from '../../src/lib/extraction';
import { ORG, OWNER, pool, resetDb } from '../helpers/db';

/** "hisab" and "X ka balance kitna hai" over WhatsApp, against the real database. */

let seq = 0;
const sid = () => `SMrep${String(++seq).padStart(20, '0')}`;

function deps(ai: unknown) {
  const sent: string[] = [];
  const d: Deps = {
    ...defaultDeps,
    messenger: { sendText: vi.fn(async (_t: string, m: string) => void sent.push(m)), sendPdf: vi.fn() },
    extractFromText: vi.fn(async () => ai),
  };
  return { d, sent };
}
const text = (t: string): IncomingMessageJob => ({ messageSid: sid(), phone: OWNER, organizationId: ORG, kind: 'text', text: t });

async function confirmed(e: Partial<Extraction>) {
  await Ledger.createPending(ORG, OWNER, sid(), { intent: 'TRANSACTION', confidence_level: 1, ...e } as Extraction);
  await Ledger.confirmPending(ORG, OWNER);
}

beforeEach(resetDb);

describe('"hisab" — today\'s summary', () => {
  it('answers from the database without calling the AI', async () => {
    await confirmed({ transaction_type: 'dispatch', party_name: 'Siddhi Stone', sqft_quantity: 1000, unit_rate: 31.5 });
    await confirmed({ transaction_type: 'payment', party_name: 'Siddhi Stone', amount: 10000 });
    await confirmed({ transaction_type: 'worker_advance', worker_name: 'Mohan', amount: 500 });

    const { d, sent } = deps(null);
    expect(await handleIncomingMessage(text('Aaj ka hisab'), d)).toBe('summary_sent');
    expect(d.extractFromText).not.toHaveBeenCalled();
    const msg = sent[0];
    expect(msg).toContain('Dispatch: 1 entry · ₹31,500.00');
    expect(msg).toContain('Payment aaya: 1 entry · ₹10,000.00');
    expect(msg).toContain('Worker advance: ₹500.00');
    expect(msg).toContain('Market me kul baaki: *₹21,500.00*');
    expect(msg).toContain('1. Siddhi Stone — ₹21,500.00');
  });

  it('works on an empty ledger', async () => {
    const { d, sent } = deps(null);
    await handleIncomingMessage(text('hisab'), d);
    expect(sent[0]).toContain('Dispatch: 0 entry · ₹0.00');
    expect(sent[0]).not.toContain('Sabse zyada baaki');
  });
});

describe('"X ka balance kitna hai"', () => {
  beforeEach(async () => {
    await confirmed({ transaction_type: 'dispatch', party_name: 'Ramesh Traders', sqft_quantity: 100, unit_rate: 50 });
    await confirmed({ transaction_type: 'payment', party_name: 'Ramesh Traders', amount: 1000 });
    await confirmed({ transaction_type: 'payment', party_name: 'Advance Wala', amount: 2500 });
    await confirmed({ transaction_type: 'worker_advance', worker_name: 'Mohan Loader', amount: 800 });
    await pool.query(`INSERT INTO parties (organization_id, name, type) VALUES ($1, 'Rameshwar Stone', 'customer')`, [ORG]);
  });

  it('customer who owes us', async () => {
    const { d, sent } = deps({ intent: 'GET_BALANCE', person_name: 'Ramesh Traders' });
    expect(await handleIncomingMessage(text('Ramesh Traders ka balance'), d)).toBe('balance_sent');
    expect(sent[0]).toContain('*Ramesh Traders* se ₹4,000.00 lena baaki hai.');
    expect(sent[0]).toContain('Aakhri payment:');
  });

  it('customer who paid in advance', async () => {
    const { d, sent } = deps({ intent: 'GET_BALANCE', person_name: 'Advance Wala' });
    await handleIncomingMessage(text('x'), d);
    expect(sent[0]).toContain('₹2,500.00 advance jama hai');
  });

  it('customer with nothing due', async () => {
    const { d, sent } = deps({ intent: 'GET_BALANCE', person_name: 'Rameshwar Stone' });
    await handleIncomingMessage(text('x'), d);
    expect(sent[0]).toContain('hisab barabar hai');
  });

  it('worker advance', async () => {
    const { d, sent } = deps({ intent: 'GET_BALANCE', person_name: 'Mohan' });
    await handleIncomingMessage(text('x'), d);
    expect(sent[0]).toContain('*Mohan Loader* par ₹800.00 advance baaki hai.');
  });

  it('ambiguous name → asks which one; unknown → not found', async () => {
    const amb = deps({ intent: 'GET_BALANCE', person_name: 'Ramesh' });
    expect(await handleIncomingMessage(text('Ramesh ka balance'), amb.d)).toBe('balance_ambiguous');
    const none = deps({ intent: 'GET_BALANCE', person_name: 'Zebra Marbles' });
    expect(await handleIncomingMessage(text('x'), none.d)).toBe('balance_not_found');
  });

  it('balance questions are read-only: low AI confidence still gets an answer', async () => {
    const { d } = deps({ intent: 'GET_BALANCE', person_name: 'Ramesh Traders', confidence_level: 0.2 });
    expect(await handleIncomingMessage(text('x'), d)).toBe('balance_sent');
  });
});
