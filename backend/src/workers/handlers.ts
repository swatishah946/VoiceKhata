import { UnrecoverableError } from 'bullmq';
import { config } from '../config';
import { parseCommand } from '../lib/commands';
import { validateExtraction } from '../lib/extraction';
import { maskPhone } from '../lib/phone';
import { AiError, extractFromImage, extractFromText } from '../services/ai.service';
import * as Ledger from '../services/ledger.service';
import { downloadTwilioMedia, MediaError } from '../services/media.service';
import * as Pdf from '../services/pdf.service';
import { transcribeAudio } from '../services/whisper.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { MSG, pendingSummary } from './messages';

/**
 * What the webhook puts on the queue. The sender has ALREADY been verified
 * (Twilio signature + registered member) before a job is created.
 */
export interface IncomingMessageJob {
  messageSid: string;
  phone: string; // E.164
  organizationId: string;
  kind: 'text' | 'audio' | 'image' | 'other';
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
}

/** Everything with side effects is injectable, so tests can replace it. */
export const defaultDeps = {
  messenger: WhatsAppService,
  extractFromText,
  extractFromImage,
  transcribeAudio,
  downloadMedia: downloadTwilioMedia,
  ledger: Ledger,
  pdf: Pdf,
};
export type Deps = typeof defaultDeps;

export type HandlerOutcome =
  | 'confirmed' | 'cancelled' | 'undone' | 'nothing_pending' | 'help'
  | 'pending_created' | 'price_updated' | 'price_list_sent' | 'khata_sent'
  | 'khata_not_found' | 'khata_ambiguous' | 'rejected_missing' | 'rejected_low_confidence'
  | 'not_understood' | 'unsupported';

export async function handleIncomingMessage(job: IncomingMessageJob, deps: Deps = defaultDeps): Promise<HandlerOutcome> {
  const { phone, organizationId: org, messageSid } = job;
  const reply = (text: string) => deps.messenger.sendText(phone, text);

  // 1. Short commands: yes / no / undo / help
  if (job.kind === 'text') {
    const cmd = parseCommand(job.text);
    if (cmd?.kind === 'confirm') {
      const r = await deps.ledger.confirmPending(org, phone, cmd.ref);
      await reply(r.status === 'done' ? MSG.confirmed(r.entry) : MSG.nothingPending);
      return r.status === 'done' ? 'confirmed' : 'nothing_pending';
    }
    if (cmd?.kind === 'cancel') {
      const r = await deps.ledger.cancelPending(org, phone, cmd.ref);
      await reply(r.status === 'done' ? MSG.cancelled(r.entry) : MSG.nothingPending);
      return r.status === 'done' ? 'cancelled' : 'nothing_pending';
    }
    if (cmd?.kind === 'undo') {
      const r = await deps.ledger.undoLastConfirmed(org, phone);
      await reply(r.status === 'done' ? MSG.undone(r.entry) : MSG.nothingToUndo);
      return r.status === 'done' ? 'undone' : 'nothing_pending';
    }
    if (cmd?.kind === 'help') {
      await reply(MSG.help);
      return 'help';
    }
  }

  // 2. Understand the message with AI
  let raw: unknown;
  try {
    if (job.kind === 'text') {
      raw = await deps.extractFromText(job.text || '');
    } else if (job.kind === 'audio') {
      const media = await deps.downloadMedia(job.mediaUrl!);
      const transcript = await deps.transcribeAudio(media.buffer, media.mimeType);
      console.log(`🗣️ transcribed ${transcript.length} chars for ${maskPhone(phone)}`);
      if (!transcript) {
        await reply(MSG.lowConfidence);
        return 'rejected_low_confidence';
      }
      raw = await deps.extractFromText(transcript);
    } else if (job.kind === 'image') {
      const media = await deps.downloadMedia(job.mediaUrl!);
      raw = await deps.extractFromImage(media.buffer, media.mimeType);
    } else {
      await reply(MSG.unsupportedMedia);
      return 'unsupported';
    }
  } catch (err) {
    if (err instanceof AiError && !err.retryable) {
      await reply(MSG.notUnderstood);
      return 'not_understood';
    }
    if (err instanceof MediaError) throw new UnrecoverableError(err.message);
    throw err; // retryable (rate limit, network) → BullMQ backs off and tries again
  }

  // 3. Validate before touching money
  const v = validateExtraction(raw, config.AI_MIN_CONFIDENCE);
  if (!v.ok) {
    if (v.reason === 'missing_fields') {
      await reply(MSG.missingFields(v.missing!));
      return 'rejected_missing';
    }
    if (v.reason === 'low_confidence') {
      await reply(MSG.lowConfidence);
      return 'rejected_low_confidence';
    }
    await reply(MSG.notUnderstood);
    return 'not_understood';
  }
  const data = v.data;

  // 4. Act on the intent
  switch (data.intent) {
    case 'TRANSACTION': {
      const entry = await deps.ledger.createPending(org, phone, messageSid, data);
      await reply(pendingSummary(entry));
      return 'pending_created';
    }
    case 'UPDATE_PRICE': {
      const r = await deps.ledger.updateStonePrice(org, phone, data.updated_stone_type!, data.updated_rate!);
      await deps.messenger.sendPdf(phone, await deps.pdf.generatePricingPdf(org), MSG.priceUpdated(r.name, r.oldPrice, r.newPrice));
      return 'price_updated';
    }
    case 'GET_PDF': {
      await deps.messenger.sendPdf(phone, await deps.pdf.generatePricingPdf(org), MSG.priceList);
      return 'price_list_sent';
    }
    case 'GET_KHATA': {
      const candidates = await deps.ledger.findPeople(org, data.person_name!);
      const person = deps.ledger.pickPerson(candidates);
      if (!person) {
        if (candidates.length) {
          await reply(MSG.khataWhichOne(data.person_name!, candidates.map((c) => c.name)));
          return 'khata_ambiguous';
        }
        await reply(MSG.khataNotFound(data.person_name!));
        return 'khata_not_found';
      }
      await deps.messenger.sendPdf(phone, await deps.pdf.generateKhataPdf(org, person), MSG.khata(person.name));
      return 'khata_sent';
    }
  }
}
