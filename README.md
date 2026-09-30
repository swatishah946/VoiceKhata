# 🎙️ VoiceKhata
**AI-powered WhatsApp ledger for local Indian businesses**

![CI](https://github.com/swatishah946/VoiceKhata/actions/workflows/ci.yml/badge.svg)
![Next.js](https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white)

> **Live Dashboard Demo:** [https://voice-khata.vercel.app/](https://voice-khata.vercel.app/)

Traditional businesses (stone merchants, wholesalers, hardware shops) don't have time to open an ERP on the shop floor. With VoiceKhata the owner just sends a **WhatsApp voice note** in Hindi/Hinglish — *"Siddhi Stone ko 5000 sqft 2x1½ bheja, rate 31.5, loading 1500"* — and gets back a bill summary to confirm. After a "yes", the ledger is updated, and he can ask for a customer's khata or the price list as a PDF at any time.

Built for my father's stone trading business in Kota.

---

## 📸 Showcase

### WhatsApp bot (Twilio WhatsApp Sandbox)
<div style="display: flex; flex-wrap: wrap; gap: 20px;">
  <img src="readmeimages/whtsp_ss1.jpeg" alt="WhatsApp Interface 1" width="300"/>
  <img src="readmeimages/wtsp_ss2.jpeg" alt="WhatsApp Interface 2" width="300"/>
</div>

### Next.js dashboard
<img src="readmeimages/nextjsdashboard.png" alt="Next.js Dashboard" width="700"/>

---

## 🏗️ Architecture

```mermaid
graph TD
    A[Owner on WhatsApp] -->|voice note / text / bill photo| B(Twilio WhatsApp API)
    B -->|signed webhook| C[Express webhook]
    C -->|1. verify X-Twilio-Signature<br/>2. sender must be registered<br/>3. MessageSid idempotency| D[(Redis + BullMQ queue)]
    C -->|200 OK, p95 ≈ 50 ms| B
    D --> E[Worker]
    E -->|audio| F[Groq Whisper large-v3-turbo<br/>speech → text]
    F --> G[Gemini Flash<br/>intent + entities as JSON]
    E -->|text / image| G
    G --> H[Zod validation + confidence check]
    H -->|pending entry| I[(PostgreSQL)]
    I -->|summary + Ref code| A
    A -->|"yes / no / undo"| E
    E -->|confirm = one DB transaction| I
    E -->|PDFKit, in memory| J[Short-lived random PDF link]
    J --> B
    I --> K[Next.js dashboard<br/>JWT-protected REST API]
```

**Message flow:** webhook → queue → (transcribe) → extract → validate → *pending* entry → owner replies **yes** → balances updated atomically. Nothing touches the ledger without a human confirmation.

---

## 📊 Results (measured)

| What | Result | How it was measured |
|---|---|---|
| Automated tests | **293** (237 backend · 40 frontend · 16 browser E2E) | `npm test`, `npm run test:e2e`; all run in GitHub Actions on every push |
| Code coverage | **~97%** backend lines · **~93%** frontend lines | `npm run test:coverage`; CI fails below the minimum thresholds |
| Ledger invariants | **7,000+** random operation sequences, 0 failures after the fix | property-based test (fast-check) against real PostgreSQL |
| Pure-function properties | **18,000** generated inputs (9 properties × 2,000) | `tests/unit/properties.test.ts` |
| Duplicate protection | **0 duplicates** from 3,000 deliveries (1,000 messages × 3 concurrent retries) | `npm run bench -- 3000 30 3` |
| Webhook acknowledgement | **p50 ≈ 28 ms · p95 ≈ 50 ms · ~640 req/s**, 0 errors over 2,000 signed requests | `npm run bench -- 2000 20` (median of 3 runs, one laptop-class machine, real Postgres) |
| Security issues fixed | **8** (see below), each with a test that fails if the fix is removed | `tests/unit/security.test.ts`, `tests/integration/http.test.ts` |
| Bugs caught by the new tests | **4**: an undo race (property test), a stone-size parsing bug, a hidden login error, an unlabelled mobile menu button (E2E) | commit history of the `hardening` branch |

> AI extraction accuracy isn't reported yet: it should be measured on real, hand-labelled messages (`npm run eval`), not on the synthetic sample set.

---

## 🔧 What was fixed

**Security**
1. **SSRF / credential leak:** the webhook downloaded any URL it was sent *with Twilio credentials attached*. Now only `api.twilio.com`, and credentials are never forwarded on redirects.
2. **Unsigned webhook:** anyone could post fake WhatsApp messages. Now every request's Twilio signature is verified.
3. **No sender check:** any WhatsApp number could create entries, confirm them or read ledgers. Now only registered numbers, each mapped to its own organisation.
4. **Public ledger PDFs:** customer statements sat at guessable URLs (`Khata_<Name>.pdf`). Now random, 30-minute links.
5–6. **Public fallback secrets:** a hard-coded JWT secret and a default dashboard password were in the repo. The server now refuses to start without strong secrets.
7. **Password brute force:** login is now rate-limited, and the password is stored as a bcrypt hash.
8. **Open CORS:** the API accepted requests from any website; now only the dashboard's origin.

Also guarded in new code: CSV/spreadsheet-formula injection in exports, prompt injection in AI input, cross-organisation access on every endpoint.

**Ledger correctness**
- Twilio retries created **duplicate entries**: the README claimed idempotency but nothing enforced it.
- "Yes" confirmed the **newest entry in the whole business**, not the sender's own.
- Money used **floating-point math**; loading, packing, tax and stone type were **never saved**.
- AI output went into the bill **unvalidated**, and the price list was never checked.
- **₹ printed as "¹"** in every PDF; dates were **UTC instead of IST**.
- `undo` could reverse the wrong entry under concurrent confirmations (found by the property test).

---

## 🚀 Technical highlights

### Reliable webhook ingestion
- The webhook only verifies, deduplicates and enqueues, then answers Twilio immediately; all AI work runs in a **BullMQ** worker with exponential backoff and a rate limiter sized to Gemini's free tier.
- **Idempotency at three levels:** a `processed_messages` table (first writer wins on the Twilio `MessageSid`), the BullMQ `jobId`, and a unique index on `transactions.whatsapp_message_id`. Twilio retries never create duplicate entries.
- Jobs are processed strictly in arrival order so a quick "yes" can never overtake the voice note it confirms. If a job fails permanently, the owner is told on WhatsApp instead of hearing nothing.

### AI pipeline with guard-rails
- **Groq Whisper** (large-v3-turbo) transcribes Hindi/Hinglish audio; **Gemini Flash** returns intent + entities in JSON mode (primary and fallback models configurable).
- AI output is never trusted directly: a **Zod** schema cleans numbers ("₹1,50,000", "25 rupaye"), rejects negatives and absurd values, checks required fields per entry type, and rejects money-changing entries below a confidence threshold with a "please repeat" reply.
- The spoken rate is compared with the master **price list**; a large difference is flagged in the confirmation message.
- User text is passed to the model as delimited data with an instruction never to follow instructions inside it.

### Correct ledger
- All money math in **integer paise** (no floating-point drift); every bill component (loading, packing, tax, freight, stone type) is stored so any bill can be reconstructed.
- `yes` / `no` act on the **sender's own** pending entry (or a specific one via a 4-character reference code); pending entries expire after 24 h; `undo` reverses the last confirmed entry.
- Confirmation runs in a single PostgreSQL transaction with `SELECT … FOR UPDATE` and `INSERT … ON CONFLICT` upserts — concurrent confirmations cannot double-count.
- Fuzzy name matching with **pg_trgm** ("Sidhhi Stone" → existing "Siddhi Stone"); ambiguous khata requests get a "which one?" list instead of a guess.
- Every confirm, cancel, undo and price change is written to an **audit log**; price changes also to price history.

### Security
- Twilio **request-signature verification**; only registered phone numbers (per organisation) can use the bot — which is also what makes it multi-tenant.
- Media is downloaded only from `api.twilio.com` over HTTPS, and credentials are never forwarded to redirects (prevents SSRF / credential exfiltration).
- PDFs are generated in memory and served through **random 128-bit, 30-minute links** — never guessable file names.
- Startup **fails fast** if secrets are missing or weak; dashboard password stored as a **bcrypt** hash; login **rate-limited**; JWT algorithm pinned; CORS restricted to known origins; phone numbers masked in logs.

### Daily use
- WhatsApp: **"hisab"** → today's summary (no AI call), **"Ramesh ka balance kitna hai"** → instant balance, **"undo"**, **"help"**.
- Dashboard: confirm/cancel pending entries, a khata page per party/worker with PDF download, today's totals, CSV export for the accountant (protected against spreadsheet-formula injection).
- `npm run reconcile` checks every balance against the transactions and can rebuild them.

### PDFs for real customers
- PDFKit with an embedded Unicode font (renders **₹** correctly), IST dates, running balance, and automatic page breaks for long ledgers.

---

## 🧪 Testing

**293 automated tests** in four layers, all run by GitHub Actions on every push:

| Layer | Tools | What it covers |
|---|---|---|
| Backend unit + integration (237) | Vitest, Supertest, **real PostgreSQL + Redis** | money math, AI-output validation, the ledger, WhatsApp flows, queue retries, webhook/API security |
| **Property-based** | fast-check | 7,000+ random sequences of entries / "yes" / "no" / "undo" / retries / simultaneous confirms. Balances must always equal the sum of confirmed transactions. |
| Frontend (40) | Vitest, React Testing Library | login, dashboard, confirm/cancel, khata page, downloads, auth guard |
| End-to-end (16) | Playwright, desktop + mobile | real browser → Next.js → Express → Postgres |

Coverage: ~97% of backend lines, ~93% of frontend lines, enforced by minimum thresholds in CI.

The property-based test found a real bug no hand-written test had caught: when two confirmations overlapped, `undo` could reverse the wrong entry, because `confirmed_at` recorded when the database transaction *started* rather than when the entry was confirmed.

```bash
cd backend
npm test                       # needs Postgres (TEST_DATABASE_URL); Redis optional (TEST_REDIS_URL)
npm run test:coverage
PROPERTY_RUNS=1000 npm test    # more random ledger sequences
npm run reconcile              # check live balances against transactions (read-only)

cd ../frontend
npm test                       # component tests
npm run test:e2e               # browser tests (starts backend + frontend itself)
```

**Load test** (webhook acknowledgement latency): `npm run bench -- 2000 20`. Add a third argument to replay every message, e.g. `npm run bench -- 3000 30 3`, which must show `duplicatesQueued: 0`.
**AI accuracy eval** (hand-labelled messages): `npm run eval`

---

## ⚙️ Running locally

```bash
docker compose up -d                       # Postgres :5432, Redis :6380
cd backend
cp .env.example .env                       # fill in secrets
npm install
npm run migrate                            # schema + migrations (idempotent)
npm run seed:prices                        # default stone price list
npm run add-member -- +91XXXXXXXXXX "Papa" owner   # allow a WhatsApp number
npm run dev

# in another terminal: send a signed fake WhatsApp message
npm run simulate -- +91XXXXXXXXXX "Ramesh se 5000 payment aaya"
npm run simulate -- +91XXXXXXXXXX "yes"
```

Frontend: `cd frontend && npm install && NEXT_PUBLIC_API_URL=http://localhost:3000/api npm run dev -- -p 3001`

See [`docs/DEPLOYING-HARDENING.md`](docs/DEPLOYING-HARDENING.md) before deploying this version over an existing installation.

---

## 🛠️ Stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS
- **Backend:** Node.js, Express 5, TypeScript, Zod
- **Database:** PostgreSQL (Supabase) with pg_trgm
- **Queue:** Redis (Upstash) + BullMQ
- **AI:** Groq Whisper large-v3-turbo (speech-to-text), Google Gemini Flash (extraction)
- **Messaging:** Twilio WhatsApp API
- **Testing / CI:** Vitest, Supertest, fast-check (property-based), React Testing Library, Playwright, GitHub Actions

---
*Built with ❤️ for Indian small businesses.*
