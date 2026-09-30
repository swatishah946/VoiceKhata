import fs from 'fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WhatsAppService } from '../../src/services/whatsapp.service';
import { fileStore } from '../../src/services/file-store';
import { MSG, pendingSummary } from '../../src/workers/messages';

// Fake Twilio SDK: records every message instead of sending it (vi.mock is hoisted above the imports)
const create = vi.hoisted(() => vi.fn(async (_msg: Record<string, unknown>) => ({ sid: 'SMfake' })));
vi.mock('twilio', () => ({ default: vi.fn(() => ({ messages: { create } })) }));


beforeEach(() => create.mockClear());

describe('WhatsApp sender', () => {
  it('sends text from our number to the normalised recipient', async () => {
    await WhatsAppService.sendText('9876543210', 'hello');
    expect(create).toHaveBeenCalledWith({ from: 'whatsapp:+14155238886', to: 'whatsapp:+919876543210', body: 'hello' });
  });

  it('truncates very long messages below WhatsApp\'s 1600-char limit', async () => {
    await WhatsAppService.sendText('+919876543210', 'x'.repeat(5000));
    const body = create.mock.calls[0][0].body as string;
    expect(body.length).toBe(1500);
    expect(body.endsWith('…')).toBe(true);
  });

  it('refuses to send to an invalid number', async () => {
    await expect(WhatsAppService.sendText('abc', 'x')).rejects.toThrow('Invalid phone');
    expect(create).not.toHaveBeenCalled();
  });

  it('sends a PDF through a private short-lived link on our public URL', async () => {
    await WhatsAppService.sendPdf('+919876543210', Buffer.from('%PDF-1.7 khata'), 'Khata');
    const msg = create.mock.calls[0][0] as { mediaUrl: string[]; body: string };
    expect(msg.body).toBe('Khata');
    const url = new URL(msg.mediaUrl[0]);
    expect(url.origin).toBe('https://voicekhata.test');
    const id = url.pathname.replace('/pdfs/', '');
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(fs.readFileSync(fileStore.resolve(id)!).toString()).toBe('%PDF-1.7 khata');
  });

  it('lets Twilio errors propagate so the job is retried (no silent failure)', async () => {
    create.mockRejectedValueOnce(new Error('Twilio 503'));
    await expect(WhatsAppService.sendText('+919876543210', 'x')).rejects.toThrow('Twilio 503');
  });
});

describe('WhatsApp message wording', () => {
  const base = {
    id: 'x', refCode: 'K7Q2', loading: 0, packing: 0, taxPercent: 0, tax: 0, freight: 0,
    subtotal: 0, total: 0, amount: 0, priceWarning: null, otherPendingCount: 0, duplicate: false,
  };

  it('dispatch summary lists every charge, the total and the rate warning', () => {
    const text = pendingSummary({
      ...base, transactionType: 'dispatch', stoneType: '2x1½', pieces: 120, sqft: 5000, rate: 25,
      counterparty: { id: 'p', name: 'Siddhi Stone', isNew: false, spokenName: 'Sidhhi Stone' },
      subtotal: 125000_00, loading: 1500_00, packing: 500_00, taxPercent: 5, tax: 6350_00, freight: 2000_00, total: 131350_00,
      priceWarning: { masterRate: 31.5, spokenRate: 25, diffPercent: -20.6 }, otherPendingCount: 2,
    });
    for (const s of ['Ref: *K7Q2*', 'Siddhi Stone', 'aapne bola: "Sidhhi Stone"', 'Pieces:* 120', '₹1,25,000.00',
      'Loading:* +₹1,500.00', 'Packing:* +₹500.00', 'Tax 5%:* +₹6,350.00', 'Freight (minus):* −₹2,000.00',
      'Total Bill:* ₹1,31,350.00', 'price list me ₹31.5', '(-20.6%)', '2 aur entry pending', 'yes K7Q2']) {
      expect(text).toContain(s);
    }
  });

  it('marks new names and labels workers / transporters correctly', () => {
    const w = pendingSummary({ ...base, transactionType: 'worker_advance', amount: 2000_00,
      counterparty: { id: null, name: 'Mohan', isNew: true, spokenName: 'Mohan' } });
    expect(w).toContain('*Worker:* Mohan  🆕');
    expect(w).toContain('*Amount:* ₹2,000.00');
    const t = pendingSummary({ ...base, transactionType: 'freight_payment', amount: 1,
      counterparty: { id: 'p', name: 'Shiv Roadlines', isNew: false, spokenName: 'shiv roadlines' } });
    expect(t).toContain('*Transporter:* Shiv Roadlines');
    expect(t).not.toContain('aapne bola'); // same name, different case → no note
  });

  it('price update message covers new and existing stones', () => {
    expect(MSG.priceUpdated('7x2', null, 70)).toContain('Naya stone *7x2*');
    expect(MSG.priceUpdated('2x1½', 31.5, 32)).toContain('₹31.5 → *₹32*');
  });

  it('confirmation mentions other pending entries and how to undo', () => {
    const e = { ...base, transactionType: 'payment', counterparty: null } as any;
    expect(MSG.confirmed(e)).toContain('undo');
    expect(MSG.confirmed({ ...e, otherPendingCount: 1 })).toContain('1 aur entry pending');
    expect(MSG.undone({ ...e, counterparty: { name: 'Ramesh' } })).toContain('Ramesh');
  });
});
