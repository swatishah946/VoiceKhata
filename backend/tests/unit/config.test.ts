import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

/** The server must refuse to start with missing or weak secrets (no public fallbacks). */
const good = {
  DATABASE_URL: 'postgres://u:p@db/x',
  JWT_SECRET: 'x'.repeat(48),
  DASHBOARD_PASSWORD_HASH: '$2a$12$abcdefghijklmnopqrstuv',
  TWILIO_AUTH_TOKEN: 'tok',
};

describe('startup configuration', () => {
  it('accepts a complete production environment', () => {
    const c = loadConfig({ ...good, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://vk.onrender.com/' });
    expect(c.isProduction).toBe(true);
    expect(c.publicBaseUrl).toBe('https://vk.onrender.com'); // trailing slash trimmed (signature URLs must match)
    expect(c.TWILIO_VALIDATE_SIGNATURE).toBe(true); // secure by default
    expect(c.PORT).toBe(3000);
  });

  it.each([
    ['DATABASE_URL missing', { DATABASE_URL: undefined }, /DATABASE_URL/],
    ['JWT_SECRET missing', { JWT_SECRET: undefined }, /JWT_SECRET/],
    ['JWT_SECRET too short (the old dev fallback)', { JWT_SECRET: 'super_secret_voicekhata_key' }, /at least 32/],
    ['no dashboard password at all', { DASHBOARD_PASSWORD_HASH: undefined }, /DASHBOARD_PASSWORD/],
    ['plain password too short (the old default)', { DASHBOARD_PASSWORD_HASH: undefined, DASHBOARD_PASSWORD: 'voicekhat' }, /DASHBOARD_PASSWORD/],
    ['signature check on but no Twilio token', { TWILIO_AUTH_TOKEN: undefined }, /TWILIO_AUTH_TOKEN/],
    ['invalid PUBLIC_BASE_URL', { PUBLIC_BASE_URL: 'not a url' }, /PUBLIC_BASE_URL/],
    ['confidence outside 0..1', { AI_MIN_CONFIDENCE: '1.5' }, /AI_MIN_CONFIDENCE/],
  ])('refuses to start: %s', (_name, override, message) => {
    expect(() => loadConfig({ ...good, ...override })).toThrow(message);
  });

  it('allows turning the signature check off only explicitly (local testing)', () => {
    const c = loadConfig({ ...good, TWILIO_AUTH_TOKEN: undefined, TWILIO_VALIDATE_SIGNATURE: 'false' });
    expect(c.TWILIO_VALIDATE_SIGNATURE).toBe(false);
  });

  it('falls back to Render\'s URL, then localhost', () => {
    expect(loadConfig({ ...good, RENDER_EXTERNAL_URL: 'https://x.onrender.com' }).publicBaseUrl).toBe('https://x.onrender.com');
    expect(loadConfig({ ...good, PORT: '4000' }).publicBaseUrl).toBe('http://localhost:4000');
  });

  it('parses the CORS allow-list', () => {
    const c = loadConfig({ ...good, CORS_ORIGINS: 'https://a.app, https://b.app ,' });
    expect(c.corsOrigins).toEqual(['https://a.app', 'https://b.app']);
  });

  it('test mode never uses DATABASE_URL (so tests cannot touch production data)', () => {
    const c = loadConfig({ DATABASE_URL: 'postgres://PRODUCTION/db', TEST_DATABASE_URL: 'postgres://h/voicekhata_test' }, true);
    expect(c.DATABASE_URL).toBe('postgres://h/voicekhata_test');
  });
});
