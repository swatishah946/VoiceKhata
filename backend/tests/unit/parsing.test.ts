import { describe, expect, it } from 'vitest';
import { generateRefCode, parseCommand } from '../../src/lib/commands';
import { normalizeStoneType, stoneSizeKey } from '../../src/lib/stone';
import { maskPhone, normalizePhone, toWhatsAppAddress } from '../../src/lib/phone';
import { formatDateIST } from '../../src/lib/time';

describe('commands: yes / no / undo parsing', () => {
  it.each(['yes', 'Yes', 'YES!', 'haan', 'Haan ji', 'ha', 'ok', 'theek hai', 'sahi hai', 'ha sahi', '👍', '✅', 'हाँ'])(
    '"%s" confirms',
    (t) => expect(parseCommand(t)).toEqual({ kind: 'confirm' })
  );

  it.each(['no', 'nahi', 'Nahin', 'galat', 'cancel', '❌', 'नहीं'])('"%s" cancels', (t) =>
    expect(parseCommand(t)).toEqual({ kind: 'cancel' })
  );

  it('accepts a reference code after yes / no', () => {
    expect(parseCommand('yes K7Q2')).toEqual({ kind: 'confirm', ref: 'K7Q2' });
    expect(parseCommand('no #k7q2')).toEqual({ kind: 'cancel', ref: 'K7Q2' });
  });

  it('does not mistake a word for a reference code', () => {
    expect(parseCommand('ha sahi')).toEqual({ kind: 'confirm' });
    expect(parseCommand('yes done')).toBeNull();
  });

  it('recognises undo and help', () => {
    expect(parseCommand('undo')).toEqual({ kind: 'undo' });
    expect(parseCommand('help')).toEqual({ kind: 'help' });
    expect(parseCommand('?')).toEqual({ kind: 'help' });
  });

  it('leaves real entries for the AI', () => {
    expect(parseCommand('Ramesh se 50000 aaya')).toBeNull();
    expect(parseCommand('yes Ramesh ko 500 sqft bheja rate 30 wala')).toBeNull();
    expect(parseCommand('')).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });

  it('generates 4-char codes without confusing characters', () => {
    for (let i = 0; i < 200; i++) expect(generateRefCode()).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
  });
});

describe('stone size normalisation', () => {
  it.each([
    ['2x1½', '2x1½'],
    ['2 x 1.5', '2x1½'],
    ['2 by 1 1/2', '2x1½'],
    ['2×1½ Polish', '2x1½polish'],
    ['2½ x 2', '2½x2'],
    ['2.5x2', '2½x2'],
  ])('%s → %s', (input, expected) => expect(normalizeStoneType(input)).toBe(expected));

  it('matches on size only', () => {
    expect(stoneSizeKey('2x1½ Polish')).toBe(stoneSizeKey('2 x 1.5'));
    expect(stoneSizeKey('3x2')).not.toBe(stoneSizeKey('2x3'));
    expect(stoneSizeKey(undefined)).toBe('');
  });
});

describe('phone numbers', () => {
  it('normalises Twilio and local formats to E.164', () => {
    expect(normalizePhone('whatsapp:+919876543210')).toBe('+919876543210');
    expect(normalizePhone('9876543210')).toBe('+919876543210');
    expect(normalizePhone('0091 98765-43210')).toBe('+919876543210');
    expect(normalizePhone('919876543210')).toBe('+919876543210');
  });

  it('rejects garbage', () => {
    expect(normalizePhone('hello')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(() => toWhatsAppAddress('abc')).toThrow();
  });

  it('masks numbers for logs', () => {
    expect(maskPhone('+919876543210')).toBe('+91******3210');
    expect(maskPhone(null)).toBe('unknown');
  });
});

describe('dates are shown in IST', () => {
  it('an entry at 01:00 IST (19:30 UTC the day before) shows the IST date', () => {
    expect(formatDateIST('2026-03-14T19:30:00Z')).toBe('15 Mar 2026');
  });
});

describe('summary command', () => {
  it.each(['hisab', 'Hisaab', 'aaj ka hisab', 'Aaj Ka Hisaab!', 'summary', 'हिसाब'])('"%s" asks for today\'s summary', (t) =>
    expect(parseCommand(t)).toEqual({ kind: 'summary' })
  );
  it('"Ramesh ka hisab bhejo" is a khata request for the AI, not the summary', () => {
    expect(parseCommand('Ramesh ka hisab bhejo')).toBeNull();
  });
});
