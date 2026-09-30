import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it, vi } from 'vitest';
import { downloadTwilioMedia, isAllowedTwilioMediaUrl, MediaError, MAX_MEDIA_BYTES } from '../../src/services/media.service';
import { FileStore } from '../../src/services/file-store';

const GOOD = 'https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages/MM1/Media/ME1';

describe('media URL allow-list (SSRF / credential-leak fix)', () => {
  it('allows Twilio media URLs', () => {
    expect(isAllowedTwilioMediaUrl(GOOD)).toBe(true);
  });

  it.each([
    'https://attacker.example.com/steal',
    'http://api.twilio.com/2010-04-01/Accounts/AC/Messages/MM/Media/ME',
    'https://api.twilio.com.evil.com/2010-04-01/Accounts/x',
    'https://evil.com@api.twilio.com/2010-04-01/Accounts/x',
    'https://api.twilio.com:8443/2010-04-01/Accounts/x',
    'https://api.twilio.com/other/path',
    'http://169.254.169.254/latest/meta-data/',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('blocks %s', (url) => {
    expect(isAllowedTwilioMediaUrl(url)).toBe(false);
  });

  it('never sends credentials to a non-Twilio URL', async () => {
    const fetchMock = vi.fn();
    await expect(downloadTwilioMedia('https://attacker.example.com/x', fetchMock as any)).rejects.toBeInstanceOf(MediaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends credentials to Twilio only, not to the CDN it redirects to', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: 'https://media.twiliocdn.com/abc' } }))
      .mockResolvedValueOnce(new Response(Buffer.from('OggS...'), { status: 200, headers: { 'content-type': 'audio/ogg' } }));

    const out = await downloadTwilioMedia(GOOD, fetchMock as any);
    expect(out.mimeType).toBe('audio/ogg');
    expect(out.buffer.toString()).toBe('OggS...');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toMatch(/^Basic /);
    expect(fetchMock.mock.calls[1][1].headers).toBeUndefined();
  });

  it('refuses oversized files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('x', { status: 200, headers: { 'content-length': String(MAX_MEDIA_BYTES + 1) } })
    );
    await expect(downloadTwilioMedia(GOOD, fetchMock as any)).rejects.toThrow(/too large/);
  });
});

describe('short-lived PDF links (public ledger PDFs fix)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vk-files-'));

  it('stores under a random 128-bit id and serves it back', () => {
    const store = new FileStore(dir);
    const id = store.save(Buffer.from('%PDF-1.7'));
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(fs.readFileSync(store.resolve(id)!).toString()).toBe('%PDF-1.7');
  });

  it('ids are not guessable (no names, no timestamps)', () => {
    const store = new FileStore(dir);
    const ids = new Set(Array.from({ length: 50 }, () => store.save(Buffer.from('x'))));
    expect(ids.size).toBe(50);
  });

  it.each(['../../.env', 'Khata_Ramesh', 'Khata_Ramesh.pdf', '..%2F..%2Fsecret', ''])('rejects "%s"', (id) => {
    expect(new FileStore(dir).resolve(id)).toBeNull();
  });

  it('expires and deletes old files', () => {
    const store = new FileStore(dir, 1000);
    const id = store.save(Buffer.from('x'));
    const file = path.join(dir, `${id}.pdf`);
    const old = new Date(Date.now() - 5000);
    fs.utimesSync(file, old, old);
    expect(store.resolve(id)).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});
