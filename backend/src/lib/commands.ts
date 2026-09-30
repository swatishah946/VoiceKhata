/**
 * Recognises short WhatsApp replies that are commands rather than new entries.
 *
 * Before: only the exact words "yes", "haan", "sahi hai"... were recognised, so
 * "Haan ji", "ha", "ok" or "👍" went to Gemini as a brand new message.
 * Now we normalise the text and also accept an optional reference code,
 * e.g. "yes K7Q2" confirms that specific entry.
 */

export type CommandKind = 'confirm' | 'cancel' | 'undo' | 'help' | 'summary';

export interface ParsedCommand {
  kind: CommandKind;
  ref?: string; // 4-char entry reference, uppercase
}

const CONFIRM = [
  'yes', 'y', 'ha', 'haa', 'haan', 'han', 'haanji', 'haji', 'ji', 'jihaan', 'hanji',
  'sahi', 'sahihai', 'theek', 'theekhai', 'thik', 'thikhai', 'ok', 'okay', 'confirm',
  'done', 'hasahi', 'haansahi', 'haanjisahi', 'okhai', '👍', '✅', 'हाँ', 'हां', 'सही', 'ठीकहै',
];
const CANCEL = [
  'no', 'n', 'nahi', 'nahin', 'na', 'nai', 'galat', 'galathai', 'cancel', 'edit',
  'rehnedo', '❌', '👎', 'नहीं', 'गलत',
];
const UNDO = ['undo', 'wapas', 'wapaslo', 'reverse', 'hatao', 'deletelast'];
const HELP = ['help', 'madad', 'menu', '?'];
// Today's summary, answered from the database without an AI call
const SUMMARY = ['hisab', 'hisaab', 'aajkahisab', 'aajkahisaab', 'summary', 'report', 'aajkareport', 'totals', 'हिसाब', 'आजकाहिसाब'];

// Same alphabet as generateRefCode (no 0/O/1/I)
const REF_RE = /^[A-HJ-NP-Z2-9]{4}$/;

function toKey(tokens: string[]): string {
  const joined = tokens.join('').toLowerCase();
  if (joined === '?') return joined;
  // drop punctuation, keep letters, digits, emoji and Devanagari
  return joined.replace(/[.,!।?'"\-]/g, '');
}

function classify(key: string): CommandKind | null {
  if (CONFIRM.includes(key)) return 'confirm';
  if (CANCEL.includes(key)) return 'cancel';
  if (UNDO.includes(key)) return 'undo';
  if (HELP.includes(key)) return 'help';
  if (SUMMARY.includes(key)) return 'summary';
  return null;
}

export function parseCommand(text: string | null | undefined): ParsedCommand | null {
  if (!text) return null;
  const raw = text.trim();
  if (raw.length === 0 || raw.length > 40) return null; // long messages are entries, not commands

  const tokens = raw.split(/\s+/);

  // 1. Whole message is a command ("haan ji", "ha sahi")
  const whole = classify(toKey(tokens));
  if (whole) return { kind: whole };

  // 2. Command followed by a reference code ("yes K7Q2", "no #K7Q2")
  if (tokens.length > 1) {
    const last = tokens[tokens.length - 1].replace(/^#/, '').toUpperCase();
    if (REF_RE.test(last)) {
      const kind = classify(toKey(tokens.slice(0, -1)));
      if (kind === 'confirm' || kind === 'cancel') return { kind, ref: last };
    }
  }
  return null;
}

/** Short human-friendly reference for a pending entry (no 0/O/1/I confusion). */
export function generateRefCode(rand: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(rand() * alphabet.length)];
  return out;
}
