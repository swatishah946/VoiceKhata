import { formatINR } from '../lib/money';
import type { PendingEntry } from '../services/ledger.service';

/**
 * Every WhatsApp reply text in one place, so wording is consistent and testable.
 */

const TYPE_LABEL: Record<string, string> = {
  dispatch: 'Dispatch (Maal bheja)',
  payment: 'Payment received',
  worker_advance: 'Worker advance',
  freight_payment: 'Freight payment',
};

export function pendingSummary(e: PendingEntry): string {
  const lines: string[] = [];
  lines.push(`📄 *Nayi entry — confirm karein* (Ref: *${e.refCode}*)`);
  lines.push('');
  lines.push(`*Type:* ${TYPE_LABEL[e.transactionType] || e.transactionType}`);

  if (e.counterparty) {
    const who = e.transactionType === 'worker_advance' ? 'Worker' : e.transactionType === 'freight_payment' ? 'Transporter' : 'Party';
    let line = `*${who}:* ${e.counterparty.name}`;
    if (e.counterparty.isNew) line += '  🆕 _(naya naam, confirm par banega)_';
    else if (e.counterparty.spokenName.toLowerCase() !== e.counterparty.name.toLowerCase())
      line += `  _(aapne bola: "${e.counterparty.spokenName}")_`;
    lines.push(line);
  }

  if (e.transactionType === 'dispatch') {
    if (e.stoneType) lines.push(`*Stone:* ${e.stoneType}`);
    if (e.pieces) lines.push(`*Pieces:* ${e.pieces}`);
    lines.push(`*Quantity:* ${e.sqft} sqft × ₹${e.rate}/sqft = ${formatINR(e.subtotal)}`);
    if (e.loading) lines.push(`*Loading:* +${formatINR(e.loading)}`);
    if (e.packing) lines.push(`*Packing:* +${formatINR(e.packing)}`);
    if (e.tax) lines.push(`*Tax ${e.taxPercent}%:* +${formatINR(e.tax)}`);
    if (e.freight) lines.push(`*Freight (minus):* −${formatINR(e.freight)}`);
    lines.push('');
    lines.push(`*Total Bill:* ${formatINR(e.total)}`);
    if (e.priceWarning) {
      const w = e.priceWarning;
      lines.push('');
      lines.push(
        `⚠️ *Rate check:* price list me ₹${w.masterRate} hai, aapne ₹${w.spokenRate} bola (${w.diffPercent > 0 ? '+' : ''}${w.diffPercent}%). Dhyan se dekh lein.`
      );
    }
  } else {
    lines.push(`*Amount:* ${formatINR(e.amount)}`);
  }

  lines.push('');
  lines.push('Kya yeh sahi hai?');
  lines.push(`👉 *Yes* likhein confirm karne ke liye`);
  lines.push(`👉 *No* likhein cancel karne ke liye`);
  if (e.otherPendingCount > 0) {
    lines.push('');
    lines.push(`ℹ️ ${e.otherPendingCount} aur entry pending hai. Kisi khaas entry ke liye likhein: *yes ${e.refCode}*`);
  }
  return lines.join('\n');
}

export const MSG = {
  confirmed: (e: PendingEntry) =>
    `✅ Confirmed! (Ref ${e.refCode}) Khata update ho gaya.` +
    (e.otherPendingCount > 0 ? `\nℹ️ Abhi ${e.otherPendingCount} aur entry pending hai.` : '') +
    `\nGalti ho to *undo* likhein.`,
  cancelled: (e: PendingEntry) => `❌ Entry ${e.refCode} cancel kar di. Sahi details ke saath naya message bhejein.`,
  undone: (e: PendingEntry) =>
    `↩️ Pichli entry (Ref ${e.refCode}${e.counterparty ? `, ${e.counterparty.name}` : ''}) hata di gayi. Balance wapas theek kar diya.`,
  nothingPending: '❌ Koi pending entry nahi mili (24 ghante se purani entries apne aap expire ho jaati hain).',
  nothingToUndo: '❌ Pichle 24 ghante me aapki koi confirmed entry nahi mili jise hataya ja sake.',
  missingFields: (missing: string[]) =>
    `🤔 Entry poori samajh nahi aayi. Yeh details missing hain: *${missing.join(', ')}*.\nKripya poori detail ke saath dobara bhejein.`,
  lowConfidence:
    '🤔 Awaaz saaf nahi aayi / details pakki nahi hain. Kripya dobara thoda dheere aur saaf bolkar bhejein.',
  notUnderstood: '🤔 Message samajh nahi aaya. Kripya dobara bhejein, ya *help* likhein.',
  failed: '⚠️ Maaf kijiye, abhi entry process nahi ho payi (server issue). Kripya 2 minute baad dobara bhejein.',
  unsupportedMedia: 'ℹ️ Abhi sirf voice note, text aur bill ki photo samajh sakta hoon.',
  priceUpdated: (name: string, oldPrice: number | null, newPrice: number) =>
    oldPrice === null
      ? `✅ Naya stone *${name}* price list me joda: ₹${newPrice}/sqft. Latest price list neeche hai.`
      : `✅ *${name}* ka rate ₹${oldPrice} → *₹${newPrice}*/sqft kar diya. Latest price list neeche hai.`,
  priceList: 'Sir, yeh rahi latest price list. Aap isey customer ko forward kar sakte hain.',
  khata: (name: string) => `Sir, yeh raha *${name}* ka khata statement.`,
  khataNotFound: (name: string) => `❌ "${name}" naam ka koi khata nahi mila. Poora naam likh kar dobara bhejein.`,
  khataWhichOne: (name: string, options: string[]) =>
    `🤔 "${name}" se milte-julte ${options.length} naam mile:\n` +
    options.map((o, i) => `${i + 1}. ${o}`).join('\n') +
    `\nPoora naam likh kar dobara bhejein, jaise: "${options[0]} ka khata bhejo".`,
  help:
    '🙏 *VoiceKhata — kaise use karein*\n\n' +
    '🎤 Voice note ya text bhejein, jaise:\n' +
    '• "Siddhi Stone ko 5000 sqft 2x1½ bheja, rate 31.5, loading 1500"\n' +
    '• "Ramesh se 50000 payment aaya"\n' +
    '• "Mohan ko 2000 advance diya"\n' +
    '• "2x1½ ka rate 32 kar do"\n' +
    '• "price list bhejo" / "Ramesh ka khata bhejo"\n\n' +
    '✅ *yes* = confirm   ❌ *no* = cancel   ↩️ *undo* = pichli entry hatao',
};
