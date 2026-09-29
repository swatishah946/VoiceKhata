# Deploying the `hardening` branch

`main` keeps working exactly as before until you merge. Do these steps **in order** when you are ready (ideally not right before an interview). Total time: about 20 minutes.

## 1. Back up the database
Supabase → Database → Backups (or `pg_dump "$DATABASE_URL" > backup.sql`). The migration only *adds* things, but always back up before touching a ledger.

## 2. Run the migration against Supabase
From your laptop, in `backend/`, with `DATABASE_URL` set to the Supabase connection string:
```bash
npm install
npm run migrate
```
It is safe to run more than once. It adds tables/columns/indexes and enables `pg_trgm`; it never drops or deletes anything.
If it prints *"Duplicate whatsapp_message_id rows exist"*, the old code created duplicates on Twilio retries. Everything else still applies; look at those rows in the dashboard, cancel the extras, then re-run.

## 3. Register who may use the bot (IMPORTANT)
The new version **ignores messages from unknown numbers**. Before deploying, register your father's WhatsApp number (and anyone else who should use it):
```bash
npm run add-member -- +91XXXXXXXXXX "Papa" owner
npm run add-member -- +91YYYYYYYYYY "Munshi" staff     # optional
```

## 4. Environment variables on Render
| Variable | What to put |
|---|---|
| `JWT_SECRET` | 32+ random chars: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DASHBOARD_PASSWORD_HASH` | output of `npm run hash-password -- "a long password"` (then remove `DASHBOARD_PASSWORD`) |
| `PUBLIC_BASE_URL` | your Render URL, e.g. `https://voicekhata-yqsj.onrender.com` (no trailing slash). Must match the Twilio webhook URL's origin exactly, or every webhook gets 403. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `DATABASE_URL`, `REDIS_URL` | same as today |
| `GEMINI_FALLBACK_MODEL` | optional; default `gemini-2.5-flash` — check it's still offered in Google AI Studio |
| `CORS_ORIGINS` | optional; defaults include `https://voice-khata.vercel.app` |
| `NODE_ENV` | `production` |

If anything required is missing, the service will **refuse to start** and the Render log says exactly which variable. That is intentional.

## 5. Render build/start commands
The backend is now compiled with `tsc` instead of running TypeScript directly:
- **Build command:** `npm ci && npm run build`
- **Start command:** `npm start` (runs `node dist/index.js`)

## 6. Merge and verify
1. Merge the pull request (Render and Vercel redeploy).
2. `https://<render-url>/health` → `{"status":"OK","db":"up"}`.
3. From your father's phone send **help** → he should get the help message.
4. Send a small test entry, reply **yes**, check the dashboard, then send **undo**.

## Rolling back
Revert the merge commit on GitHub (Render redeploys the old code) and set the Render build/start commands back to what they were. The database changes are additive, so the old code keeps working with the migrated database.
