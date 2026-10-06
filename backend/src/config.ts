import dotenv from 'dotenv';
import { z } from 'zod';

const isTest = process.env.NODE_ENV === 'test';

// Never load .env during tests: it may point at the real (production) database.
if (!isTest) dotenv.config({ quiet: true });

/**
 * All environment configuration lives here and is validated once at startup.
 *
 * Why: the old code had fallbacks like `JWT_SECRET || 'super_secret_...'`.
 * If a variable was ever missing on Render, the app silently used a secret
 * that is visible on GitHub. Now the server refuses to start instead.
 */

const schema = z.object({
  NODE_ENV: z.string().default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().int().default(6380),

  // Auth
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters (use a random string)'),
  DASHBOARD_PASSWORD_HASH: z.string().optional(), // bcrypt hash (preferred)
  DASHBOARD_PASSWORD: z.string().min(10).optional(), // plain fallback, min 10 chars
  JWT_EXPIRES_IN: z.string().default('7d'),

  // Which organisation the dashboard login belongs to (single-owner MVP)
  DEFAULT_ORG_ID: z.string().uuid().default('00000000-0000-0000-0000-000000000000'),

  // Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_PHONE_NUMBER: z.string().default('+14155238886'),
  // Set to "false" ONLY for local testing with fake payloads
  TWILIO_VALIDATE_SIGNATURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  // Public URL of this backend (Twilio signs requests against it and downloads PDFs from it)
  PUBLIC_BASE_URL: z.string().url().optional(),
  RENDER_EXTERNAL_URL: z.string().url().optional(),

  // AI
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash'),
  GEMINI_FALLBACK_MODEL: z.string().default('gemini-2.5-flash'),
  GROQ_API_KEY: z.string().optional(),
  AI_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  PRICE_VARIANCE_WARN_PCT: z.coerce.number().min(0).default(10),

  // CORS: comma separated list of allowed dashboard origins
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:3000,http://localhost:3001,https://voice-khata.vercel.app'),
});

const testDefaults: Record<string, string> = {
  DATABASE_URL: 'postgres://postgres@127.0.0.1:5433/voicekhata_test',
  JWT_SECRET: 'test_secret_that_is_long_enough_for_hs256_signing',
  DASHBOARD_PASSWORD: 'test-password-123',
  TWILIO_AUTH_TOKEN: 'test_auth_token',
  TWILIO_ACCOUNT_SID: 'ACtest',
  PUBLIC_BASE_URL: 'https://voicekhata.test',
  GEMINI_API_KEY: 'test_gemini_key',
  GROQ_API_KEY: 'test_groq_key',
  GEMINI_MODEL: 'gemini-3.5-flash',
  GEMINI_FALLBACK_MODEL: 'gemini-2.5-flash',
};

/** Validates an environment. Exported so the fail-fast rules can be unit tested. */
export function loadConfig(env: NodeJS.ProcessEnv, testMode = false) {
  // Tests only ever use TEST_DATABASE_URL, so they can never touch real data.
  const raw = testMode
    ? { ...env, ...testDefaults, DATABASE_URL: env.TEST_DATABASE_URL || testDefaults.DATABASE_URL }
    : env;
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`❌ Invalid environment configuration:\n${problems}\nSee backend/.env.example`);
  }

  const cfg = parsed.data;

  if (!cfg.DASHBOARD_PASSWORD_HASH && !cfg.DASHBOARD_PASSWORD) {
    throw new Error(
      '❌ Set DASHBOARD_PASSWORD_HASH (recommended, run `npm run hash-password`) or DASHBOARD_PASSWORD.'
    );
  }

  if (cfg.TWILIO_VALIDATE_SIGNATURE && !cfg.TWILIO_AUTH_TOKEN) {
    throw new Error('❌ TWILIO_AUTH_TOKEN is required to verify webhook signatures.');
  }

  const publicBaseUrl = (cfg.PUBLIC_BASE_URL || cfg.RENDER_EXTERNAL_URL || `http://localhost:${cfg.PORT}`).replace(
    /\/$/,
    ''
  );

  return {
    ...cfg,
    publicBaseUrl,
    corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    isProduction: cfg.NODE_ENV === 'production',
    isTest: testMode,
  };
}

export const config = loadConfig(process.env, isTest);
export type AppConfig = typeof config;
