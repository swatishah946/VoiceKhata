import { config } from '../config';

/**
 * Downloading media that Twilio tells us about.
 *
 * SECURITY FIX (SSRF / credential leak): the old code fetched whatever URL was in
 * `MediaUrl0` of the webhook body and attached our Twilio SID + auth token as
 * Basic auth. Anyone could POST a fake webhook pointing at their own server and
 * receive our credentials. Now we only ever send credentials to Twilio's own
 * API host over HTTPS, and we cap the download size.
 */

const ALLOWED_MEDIA_HOSTS = new Set(['api.twilio.com']);
export const MAX_MEDIA_BYTES = 16 * 1024 * 1024; // WhatsApp's own limit for audio/images

export function isAllowedTwilioMediaUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      ALLOWED_MEDIA_HOSTS.has(u.hostname.toLowerCase()) &&
      u.port === '' &&
      u.username === '' &&
      u.password === '' &&
      u.pathname.startsWith('/2010-04-01/Accounts/')
    );
  } catch {
    return false;
  }
}

export class MediaError extends Error {}

export async function downloadTwilioMedia(
  mediaUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ buffer: Buffer; mimeType: string }> {
  if (!isAllowedTwilioMediaUrl(mediaUrl)) {
    throw new MediaError('Refusing to download media from a non-Twilio URL');
  }
  const auth = Buffer.from(`${config.TWILIO_ACCOUNT_SID}:${config.TWILIO_AUTH_TOKEN}`).toString('base64');

  // Twilio answers media URLs with a redirect to its CDN. Follow it manually so the
  // Authorization header is sent ONLY to api.twilio.com, never to the redirect target.
  const first = await fetchImpl(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });

  let response = first;
  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location');
    if (!location) throw new MediaError('Twilio redirect without location');
    const target = new URL(location, mediaUrl);
    if (target.protocol !== 'https:') throw new MediaError('Refusing non-HTTPS media redirect');
    response = await fetchImpl(target.toString(), { signal: AbortSignal.timeout(30_000) });
  }

  if (!response.ok) {
    throw new MediaError(`Failed to download Twilio media: HTTP ${response.status}`);
  }

  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_MEDIA_BYTES) throw new MediaError('Media file too large');

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_MEDIA_BYTES) throw new MediaError('Media file too large');

  const mimeType = (response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim();
  return { buffer, mimeType };
}
