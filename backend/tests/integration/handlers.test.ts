import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultDeps, Deps, handleIncomingMessage, IncomingMessageJob } from '../../src/workers/handlers';
import { AiError } from '../../src/services/ai.service';
import { ORG, OWNER, partyBalance, pool, resetDb, seedPrice } from '../helpers/db';

/**
 * End-to-end worker flow with the real database and ledger, but fake
 * WhatsApp/AI/media (no network). This is what your father experiences.
 */

let seq = 0;
function makeDeps(ai: unknown | (() => unknown)) {
  const sent: string[] = [];
  const pdfs: Array<{ caption: string; bytes: number }> = [];
  const deps: Deps = {
    ...defaultDeps,
    messenger: {
      sendText: vi.fn(async (_to: string, text: string) => void sent.push(text)),
      sendPdf: vi.fn(async (_to: string, pdf: Buffer, caption: string) => void pdfs.push({ caption, bytes: pdf.length })),
    },
    extractFromText: vi.fn(async () => (typeof ai === 'function' ? (ai as () => unknown)() : ai)),
    extractFromImage: vi.fn(async () => (typeof ai === 'function' ? (ai as () => unknown)() : ai)),
    transcribeAudio: vi.fn(async () => 'Siddhi Stone ko 5000 sqft bheja'),
    downloadMedia: vi.fn(async () => ({ buffer: Buffer.from('OggS'), mimeType: 'audio/ogg' })),
  };
  return { deps, sent, pdfs };
}

function text(t: string): IncomingMessageJob {
  return { messageSid: `SM${String(++seq).padStart(32, '0')}`, phone: OWNER, organizationId: ORG, kind: 'text', text: t };
}

const DISPATCH = {
  intent: 'TRANSACTION', transaction_type: 'dispatch', party_name: 'Siddhi Stone', stone_type: '2x1½',
  sqft_quantity: 5000, unit_rate: 31.5, loading_charge: 1500, confidence_level: 0.95,
};

beforeEach(resetDb);

describe('WhatsApp conversation flow', () => {
  it('voice note → summary → "haan ji" → ledger updated', async () => {
    const { deps, sent } = makeDeps(DISPATCH);

    const audio: IncomingMessageJob = {
      ...text(''), kind: 'audio', text: undefined,
      mediaUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME', mediaType: 'audio/ogg',
    };
    expect(await handleIncomingMessage(audio, deps)).toBe('pending_created');
    expect(deps.transcribeAudio).toHaveBeenCalled();
    expect(sent[0]).toContain('Ref:');
    expect(sent[0]).toContain('₹1,57,500.00'); // 5000 × 31.5
    expect(sent[0]).toContain('₹1,59,000.00'); // + loading 1500
    expect(sent[0]).toContain('🆕');

    expect(await handleIncomingMessage(text('Haan ji'), deps)).toBe('confirmed');
    expect(sent[1]).toContain('✅ Confirmed');
    expect(await partyBalance('Siddhi Stone')).toMatchObject({ outstanding: 159000 });

    // the transcript is saved with the entry (used to build the real-message accuracy eval)
    const saved = await pool.query(`SELECT transcription_text FROM transactions`);
    expect(saved.rows[0].transcription_text).toBe('Siddhi Stone ko 5000 sqft bheja');
  });

  it('"no" cancels and "undo" reverses', async () => {
    const { deps, sent } = makeDeps(DISPATCH);
    await handleIncomingMessage(text('entry 1'), deps);
    expect(await handleIncomingMessage(text('nahi'), deps)).toBe('cancelled');

    await handleIncomingMessage(text('entry 2'), deps);
    await handleIncomingMessage(text('yes'), deps);
    expect(await handleIncomingMessage(text('undo'), deps)).toBe('undone');
    expect(await partyBalance('Siddhi Stone')).toMatchObject({ outstanding: 0 });
    expect(sent.at(-1)).toContain('↩️');
  });

  it('"yes" with nothing pending gets a clear reply', async () => {
    const { deps, sent } = makeDeps(DISPATCH);
    expect(await handleIncomingMessage(text('yes'), deps)).toBe('nothing_pending');
    expect(sent[0]).toContain('Koi pending entry nahi');
    expect(deps.extractFromText).not.toHaveBeenCalled(); // commands never cost an AI call
  });

  it('missing details → asks again, creates nothing', async () => {
    const { deps, sent } = makeDeps({ ...DISPATCH, unit_rate: null });
    expect(await handleIncomingMessage(text('Siddhi ko maal bheja'), deps)).toBe('rejected_missing');
    expect(sent[0]).toContain('rate');
    expect((await pool.query('SELECT 1 FROM transactions')).rowCount).toBe(0);
  });

  it('low AI confidence → asks to repeat, creates nothing', async () => {
    const { deps, sent } = makeDeps({ ...DISPATCH, confidence_level: 0.3 });
    expect(await handleIncomingMessage(text('...'), deps)).toBe('rejected_low_confidence');
    expect(sent[0]).toContain('dobara');
    expect((await pool.query('SELECT 1 FROM transactions')).rowCount).toBe(0);
  });

  it('garbage AI output → "not understood", creates nothing', async () => {
    const { deps } = makeDeps({ intent: 'TRANSACTION', transaction_type: 'dispatch', unit_rate: -5 });
    expect(await handleIncomingMessage(text('x'), deps)).toBe('not_understood');
  });

  it('a retried job (same MessageSid) does not create a duplicate entry', async () => {
    const { deps } = makeDeps(DISPATCH);
    const job = text('entry');
    await handleIncomingMessage(job, deps);
    await handleIncomingMessage(job, deps);
    expect((await pool.query('SELECT 1 FROM transactions')).rowCount).toBe(1);
  });

  it('rate-limit errors are re-thrown so the queue retries later', async () => {
    const { deps } = makeDeps(() => {
      throw new AiError('429', true, 429);
    });
    await expect(handleIncomingMessage(text('x'), deps)).rejects.toThrow('429');
  });

  it('non-retryable AI errors reply instead of retrying', async () => {
    const { deps, sent } = makeDeps(() => {
      throw new AiError('bad json', false);
    });
    expect(await handleIncomingMessage(text('x'), deps)).toBe('not_understood');
    expect(sent).toHaveLength(1);
  });

  it('price update changes the rate and sends the new price list PDF', async () => {
    await seedPrice('2x1½', 31.5);
    const { deps, pdfs } = makeDeps({ intent: 'UPDATE_PRICE', updated_stone_type: '2x1.5', updated_rate: 32, confidence_level: 0.9 });
    expect(await handleIncomingMessage(text('2x1.5 ka rate 32 kar do'), deps)).toBe('price_updated');
    expect(pdfs[0].caption).toContain('₹31.5 → *₹32*');
    expect(pdfs[0].bytes).toBeGreaterThan(1000);
  });

  it('khata: exact name → PDF; ambiguous → asks which one; unknown → not found', async () => {
    for (const n of ['Ramesh Traders', 'Rameshwar Stone']) {
      await pool.query(`INSERT INTO parties (organization_id, name, type) VALUES ($1, $2, 'customer')`, [ORG, n]);
    }
    const exact = makeDeps({ intent: 'GET_KHATA', person_name: 'Ramesh Traders' });
    expect(await handleIncomingMessage(text('Ramesh Traders ka khata'), exact.deps)).toBe('khata_sent');

    const ambiguous = makeDeps({ intent: 'GET_KHATA', person_name: 'Ramesh' });
    expect(await handleIncomingMessage(text('Ramesh ka khata'), ambiguous.deps)).toBe('khata_ambiguous');
    expect(ambiguous.sent[0]).toContain('1. ');
    expect(ambiguous.deps.messenger.sendPdf).not.toHaveBeenCalled();

    const unknown = makeDeps({ intent: 'GET_KHATA', person_name: 'Zebra' });
    expect(await handleIncomingMessage(text('Zebra ka khata'), unknown.deps)).toBe('khata_not_found');
  });

  it('help needs no AI call', async () => {
    const { deps, sent } = makeDeps(DISPATCH);
    expect(await handleIncomingMessage(text('help'), deps)).toBe('help');
    expect(sent[0]).toContain('undo');
  });

  it('unsupported media gets a polite reply', async () => {
    const { deps, sent } = makeDeps(DISPATCH);
    expect(await handleIncomingMessage({ ...text(''), kind: 'other' }, deps)).toBe('unsupported');
    expect(sent[0]).toContain('voice note');
  });
});
