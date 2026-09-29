# What changed in the `hardening` branch, and why

This is a study guide. For every change: **the problem**, **the fix**, **how it works**, **where the code is**, and **how to explain it in an interview**.

---

## Part 1 — Security

### 1. Stolen Twilio credentials via fake media URLs (SSRF)
**Problem.** The webhook read `MediaUrl0` from the request body, and `downloadMedia` fetched that URL with our Twilio SID + auth token in the `Authorization` header. Anyone could POST a fake "voice note" whose URL pointed to their own server and receive our credentials.

**Fix.** `services/media.service.ts`
- `isAllowedTwilioMediaUrl()` only accepts `https://api.twilio.com/2010-04-01/Accounts/...` — no other host, port, protocol or `user@host` tricks.
- Twilio answers media URLs with a redirect to its CDN. We follow that redirect **manually** (`redirect: 'manual'`) and do **not** send the credentials to the redirect target.
- Downloads are capped at 16 MB and time out after 30 s.

**Interview line:** "I found an SSRF bug where user-controlled input decided where our server sent its credentials. I fixed it with a strict allow-list and by handling redirects manually so credentials only ever go to Twilio's API host."

### 2. Anyone could send messages to the bot
**Problem.** No check that requests came from Twilio, and no check on who the sender was. A stranger could create entries, reply "yes" to your father's entries, change prices, or request any customer's khata.

**Fix — two layers.**
1. `middleware/twilio-signature.ts`: Twilio signs every request with HMAC-SHA1 over the full URL + POST params, using our auth token. We recompute it with `twilio.validateRequest` and return **403** if it doesn't match. The URL is built from `PUBLIC_BASE_URL` because Render terminates HTTPS in front of us (our server sees `http://`, Twilio signed `https://`).
2. `services/members.service.ts` + table `organization_members`: the sender's phone must be registered. Their **organisation comes from the phone number**, instead of the hard-coded `DEFAULT_ORG_ID`. This is what makes the app actually multi-tenant.

Unknown senders get a 200 (so Twilio doesn't retry) but nothing is processed.

**Interview line:** "Authentication of a webhook is different from user auth — you authenticate the *platform* by verifying its signature, then authorise the *user* by their phone number."

### 3. Customer ledgers were publicly downloadable
**Problem.** PDFs were copied into a public folder named `Khata_<Name>.pdf`. Anyone could guess `…/pdfs/Khata_Ramesh.pdf`.

**Fix.** `services/file-store.ts`
- PDFs are built **in memory**; for Twilio to fetch them we store them under a **random 128-bit id** (`crypto.randomBytes(16)`), e.g. `/pdfs/9f2c…e1`.
- The route validates the id with a strict regex (this also blocks path traversal like `../../.env`) and files **expire after 30 minutes**; a timer cleans old files.

**Interview line:** "Twilio needs a public URL, so I used capability URLs: unguessable, short-lived links — the same idea as S3 pre-signed URLs."

### 4. Secrets with public fallbacks
**Problem.** `JWT_SECRET || 'super_secret_voicekhata_key_for_dev'` and a default password `voicekhata2026`, both visible on GitHub. If a variable was missing on Render, anyone could forge a token or log in. No rate limit on login.

**Fix.**
- `src/config.ts`: every environment variable is validated with **Zod** at startup. Missing/weak secrets (JWT secret < 32 chars) → the server **refuses to start** with a clear message ("fail fast").
- Password stored as a **bcrypt hash** (`npm run hash-password`); if a plain password is used, it's compared in **constant time** (`crypto.timingSafeEqual`).
- `express-rate-limit`: 5 failed logins per IP per 15 minutes → 429.
- JWT verify pins `algorithms: ['HS256']` (blocks `alg: none` tricks). CORS only allows the dashboard origins. `trust proxy` is set so rate limiting sees the real client IP behind Render.
- Tests also never load `.env` and refuse to run on a database whose name doesn't contain "test", so `npm test` can never wipe production data.

---

## Part 2 — Ledger correctness (money)

### 5. Duplicate entries (idempotency wasn't implemented)
**Problem.** The README claimed idempotency, but the code only *computed* a hash and never checked it. If our webhook was slow, Twilio retried and a second transaction was created.

**Fix — three layers**, each cheap:
1. `processed_messages` table: `INSERT … ON CONFLICT (message_sid) DO NOTHING RETURNING`. If nothing is returned, we've seen this message → ignore. If enqueuing then fails, we delete the row and return 500 so Twilio's retry can succeed.
2. BullMQ `jobId = MessageSid` → the queue drops duplicate jobs.
3. `createPending` looks up the message id first, and a **unique index** on `transactions.whatsapp_message_id` is the final backstop (a `23505` unique-violation is caught and the existing entry is returned).

**Interview line:** "At-least-once delivery means every handler must be idempotent. I made the database the source of truth with a unique key, so correctness doesn't depend on timing."

### 6. "Yes" confirmed the wrong entry
**Problem.** "Yes" confirmed the newest pending entry in the **whole organisation** — not necessarily the sender's, and not necessarily the one he meant.

**Fix.** `ledger.service.ts → confirmPending`
- Each pending entry stores `requested_by_phone` and a 4-character `ref_code` (no confusing 0/O/1/I).
- "yes" confirms **the sender's** latest pending entry; "yes K7Q2" confirms that exact one. Pending entries expire after 24 h.
- The summary message tells him if other entries are also pending.
- `lib/commands.ts` understands many ways of saying yes/no: "haan ji", "ha", "theek hai", 👍, "नहीं" …

### 7. Race conditions when confirming
**Fix.** Confirmation runs inside **one DB transaction** (`withTransaction` in `db/index.ts`): the entry is locked with `SELECT … FOR UPDATE`, balances are updated with `INSERT … ON CONFLICT DO UPDATE` (atomic upsert), then the status changes. If anything fails, everything rolls back. A test fires two "yes" at the same instant and checks the money is applied once — and it **fails** if you remove `FOR UPDATE`.

### 8. AI output was trusted blindly
**Problem.** Gemini's JSON went straight into the math. `"25 rupaye"`, negative numbers or missing fields silently produced wrong bills. `confidence_level` was requested but never used.

**Fix.** `lib/extraction.ts`
- Zod schema: cleans numbers (`"₹1,50,000"` → 150000), rejects negatives and absurd values (> ₹10 crore), normalises casing, treats "null"/"unknown" as missing.
- Per-type required fields (dispatch needs party, sqft, rate; payment needs party and amount…). Missing → WhatsApp reply naming exactly what's missing.
- Money-changing entries below `AI_MIN_CONFIDENCE` (0.6) → "please repeat". Read-only requests (price list, khata) aren't blocked.
- Gemini is called in **JSON mode** (`responseMimeType: application/json`, temperature 0), and the user's words are wrapped in `<message>` tags with an instruction to treat them as data (prompt-injection guard).

**Interview line:** "LLM output is untrusted input. I validate it at the boundary exactly like I'd validate a form submission — and there's still a human confirmation step before money moves."

### 9. Floating-point money
**Fix.** `lib/money.ts` does all arithmetic in **integer paise**. `0.1 + 0.2` is exactly `0.30`. The dispatch rule (subtotal + loading + packing, tax on that, minus freight) is one pure function with its own unit tests.

### 10. Bills couldn't be reconstructed
**Problem.** Loading, packing, tax and stone type were used in the calculation but never saved.
**Fix.** New columns (`packing_charge`, `tax_percentage`, `tax_amount`, `stone_type_text`), all written on every entry.

### 11. Rate check against the price list
The README claimed the price list was used; it wasn't. Now `createPending` looks up the stone size in `stone_types` (sizes are normalised: "2 x 1.5", "2x1½", "2 by 1 1/2" all match — `lib/stone.ts`). If the spoken rate differs by more than 10 %, the summary shows ⚠️ with both rates.

### 12. Wrong person, duplicate parties
- Name lookup uses PostgreSQL **pg_trgm** trigram similarity. "Sidhhi Stone" is matched to the existing "Siddhi Stone" only if there is **one clear winner**; the summary shows "(aapne bola: …)" so he can see it.
- For "Ramesh ka khata bhejo" with two Rameshes, the bot **asks which one** instead of sending a random customer's ledger.
- New parties/workers are created only when an entry is **confirmed**, so a cancelled mis-hearing doesn't leave junk names behind.

### 13. Undo + audit trail
- `undo` reverses the sender's last confirmed entry (within 24 h) by applying the opposite balance change in one transaction, and marks it `reversed`.
- Every confirm / cancel / undo / price change goes into `audit_logs` (who, what, old → new). Price changes also go into `stone_price_history`.

---

## Part 3 — Things your father would notice

| Problem | Fix |
|---|---|
| "₹" printed as "¹" in every PDF (Helvetica can't draw it) | Embedded DejaVu Sans font (`backend/assets/fonts`) |
| Dates wrong between 12:00–5:30 AM (server is in UTC) | All display dates formatted in `Asia/Kolkata`; DB session forced to UTC; "this month" computed in IST |
| Silence when something failed | Final job failure → "server issue, 2 minute baad bhejein"; clear messages for missing details / unclear audio |
| Long khata ran off the page | Page breaks with repeated header, running balance column, stone/sqft details |
| Cancelled entries shown as "Pending" on the dashboard | Status badges for Cancelled / Undone |
| Wrong password on login just reloaded the page | 401 on the login call no longer triggers the redirect; 429 shows "too many attempts" |
| No way to learn commands | `help` message |

---

## Part 4 — Engineering quality

- **Structure:** `app.ts` builds the Express app with the queue **injected** (`createApp({ enqueue })`), so tests run without Redis. `workers/handlers.ts` receives all side effects (WhatsApp, AI, media) as injectable `deps` — the tests pass fakes. This is dependency injection in its simplest form.
- **Queue:** BullMQ's built-in `limiter` (12 jobs/min) replaced a fixed 4-second `sleep` after every job; concurrency 1 keeps messages in order; non-retryable errors use `UnrecoverableError` so they don't retry 5 times.
- **Build:** real `tsc` build (`dist/`), `npm run typecheck` — before, production ran `ts-node --transpile-only`, which **never checks types**.
- **Graceful shutdown** on SIGTERM (Render sends it on every deploy).
- **Migrations:** `npm run migrate` applies `schema.sql` + numbered files in `migrations/`, recorded in `schema_migrations`; all idempotent.
- **Housekeeping:** `backend/.gitignore` was saved as UTF-16, so git ignored it (that's why a PDF got committed); removed 4 unused dependencies; the old `test-webhook.ts` sent Meta's payload format to a Twilio route (it always got 400) — replaced by `npm run simulate`, which sends a properly **signed** Twilio request.

---

## Part 5 — Tests (156)

| File | What it proves |
|---|---|
| `tests/unit/money.test.ts` | paise math, the dispatch billing rule, rounding |
| `tests/unit/extraction.test.ts` | AI output cleaning, required fields, confidence gate |
| `tests/unit/parsing.test.ts` | yes/no/undo in Hinglish/Hindi/emoji, stone sizes, phone numbers, IST dates |
| `tests/unit/security.test.ts` | SSRF allow-list, credentials never sent to redirects, PDF link ids/expiry/path traversal |
| `tests/unit/ai-clients.test.ts` | Gemini JSON mode, prompt-injection wrapping, retry vs fallback, Whisper upload |
| `tests/integration/ledger.test.ts` | the ledger on real Postgres: idempotency, per-sender confirm, ref codes, **concurrent confirm**, expiry, undo, fuzzy names, audit, price history |
| `tests/integration/handlers.test.ts` | the full WhatsApp conversation with fake AI/WhatsApp |
| `tests/integration/http.test.ts` | forged/missing/tampered signatures → 403, unknown senders, replayed messages, SSRF in webhook, login lockout, forged JWTs, CORS, org isolation, PDF font + pagination |

A good habit I followed: **break the code on purpose and check a test fails**. Turning off signature validation fails 3 tests; removing `FOR UPDATE` fails the concurrency test. That's how you know the tests actually guard something.

---

## Part 6 — Measuring numbers for your résumé

Only put numbers on your résumé that **you** measured on **your** setup:

1. **Tests & coverage:** `npm run test:coverage` → test count and the "All files" line %.
2. **Webhook latency:** `npm run bench -- 2000 20` → p50/p95 ack time and requests/sec. (Measured in my sandbox: 2,000 signed requests, 0 failures, p95 ≈ 71 ms, ~460 req/s. Your laptop will differ — run it yourself.)
3. **AI accuracy:** collect 50–100 of your father's real voice notes/messages → put the transcripts and the correct answers in `backend/eval/dataset.json` (same format as `dataset.sample.json`) → `npm run eval`. Reports intent accuracy, exact-match %, per-field accuracy and how many wrong answers the validator caught. **Don't quote results from the synthetic sample.**
4. **Real usage:** once your father uses it, `SELECT status, COUNT(*) FROM transactions GROUP BY status;` gives entries confirmed vs cancelled — a real "N entries recorded over M weeks" line.

Example résumé bullets (fill the brackets with your own measurements):
- Built a voice-first WhatsApp ledger (Node.js, BullMQ, PostgreSQL, Gemini, Whisper) used by a family stone-trading business; [N] entries recorded in [M] weeks.
- Hardened webhook ingestion with Twilio signature verification, 3-layer idempotency and SSRF-safe media handling; [p95] ms acknowledgement at [X] req/s.
- Designed an LLM-output validation layer (Zod + confidence gating + price-list checks) achieving [X]% intent accuracy on [N] real Hinglish messages.
- Wrote 156 unit/integration tests (Vitest, Supertest, real Postgres) with [X]% coverage, CI-gated via GitHub Actions.
