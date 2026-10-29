# Sales demo environment

A separate, live deployment of this CRM for sales calls: a continuously
synced, **pseudonymised** mirror of production plus a **live WhatsApp lane**
where a prospect messages a demo number from their own phone and watches the
real AI assistant reply inside the demo inbox.

Nothing in the demo can reach a real customer: every outbound channel is
blocked at the send step (`DEMO_MODE=true`), only the live-lane number is
allowed out, and no document / image / voice bytes are ever copied.

| Piece | Where |
|---|---|
| Masking library + tests | `apps/backend/src/modules/demo/masking.ts`, `masking.spec.ts` |
| Sync engine, rules, tests | `apps/backend/src/modules/demo/sync/` |
| Leak check | `apps/backend/src/modules/demo/leak-check.ts` |
| DEMO_MODE switch | `apps/backend/src/common/demo-mode.ts` (guards in `whatsapp/meta/*`, `email`, `push`) |
| Public `/config`, prospect links, admin endpoints | `apps/backend/src/modules/demo/demo.controller.ts` |
| CLIs | `npm run demo:sync`, `npm run demo:leak-check`, `npm run demo:seed` (apps/backend) |
| Frontend | banner `components/layout/DemoBanner.tsx`, `lib/runtime-config.ts`, media placeholders in `WhatsAppChatPanel.tsx`, `/demo/enter`, `/admin/settings/demo` |

## 1. Architecture

```
production Postgres (Supabase)  ──read-only role `demo_reader`──▶  sync (inside demo backend, every 3 min)
                                                                         │ masks every identifier
                                                                         ▼
                                                           demo Postgres (Railway, project tafai-demo)
                                                                         ▲
   prospect's phone ──WhatsApp──▶ Meta test number ──webhook──▶ demo backend ──AI (demo OpenAI key)──▶ reply
```

* **Masking is deterministic** (HMAC with `DEMO_MASK_SALT`): the same real
  lead always gets the same fake name / phone / email across every table, so
  routing, dedup and the 24-hour window logic keep working. Phones are
  permuted with a format-preserving bijection (same country, same length,
  same style), so unique columns stay unique and nothing collides.
* **Text is scrubbed** (message bodies, notes, AI replies, transcripts,
  JSON payloads): emails, phone numbers, CNICs, the lead's own name tokens,
  staff names and the real brand are replaced. Any text column without an
  explicit rule still goes through the scrubber by default.
* **Media is never copied.** Image / document / voice rows keep a
  `demo:placeholder` marker; the UI blurs them and shows the scrubbed
  transcript for voice notes. The backend serves a neutral SVG for the
  placeholder and a 404 for anything else.
* **Self-healing:** small/editable tables (leads, threads, clients,
  appointments, follow-ups, staff…) are re-copied every run and prospect
  edits are overwritten; big append-only tables (messages, AI runs,
  notifications, timeline) sync incrementally and are fully re-synced /
  pruned every `DEMO_SYNC_FULL_EVERY_MINUTES`. Live-lane rows and the demo
  logins are never pruned.
* **Staff** are aliased deterministically; use `DEMO_STAFF_KEEP` /
  `DEMO_STAFF_ALIASES` to keep or pin specific identities. Synced staff are
  parked OFFLINE so live-lane chats round-robin to the demo agent. Every
  synced account's password hash is replaced with an unusable one.
* **Never synced:** audit logs, login sessions, reset tokens, device tokens,
  webhook events, API keys, lead imports, Meta lead-form submissions,
  agreements, HR / payroll / attendance / face data, the databank,
  judicial review, processing documents.

## 2. Environment variables (demo backend)

No secrets in this file. Values live in the Railway service variables.

### Demo switches
| Variable | Purpose |
|---|---|
| `DEMO_MODE=true` | Blocks every outbound send (WhatsApp, Messenger, email, push); exposes `demoMode` on `GET /config`; enables `/demo/access/redeem`. |
| `DEMO_LIVE_PHONE_NUMBER_IDS` | Comma list of Meta `phone_number_id`s allowed to send (the live lane). Everything else is blocked even in demo. |
| `DEMO_LIVE_DISPLAY_NUMBER` | The demo number as shown to prospects (banner text). |
| `BRAND_NAME`, `BRAND_SHORT_NAME` | Brand used by the AI prompts / WhatsApp copy (e.g. "Northstar Immigration Consultants"). |
| `DEMO_LOGIN_DOMAIN` | Domain of the demo logins (`demo.admin@…`, `demo.agent@…`). |
| `DEMO_ADMIN_PASSWORD`, `DEMO_AGENT_PASSWORD` | Only needed when running `demo:seed`. |
| `DEMO_OPENAI_API_KEY` | Only for `demo:seed`: stored encrypted in the demo DB as the active OpenAI key. |
| `DEMO_LIVE_WABA_ID`, `DEMO_LIVE_PHONE_NUMBER_ID`, `DEMO_LIVE_ACCESS_TOKEN`, `DEMO_LIVE_DISPLAY_NUMBER` | Only for `demo:seed`: creates the live-lane channel row. |

### Sync
| Variable | Purpose |
|---|---|
| `DEMO_SYNC_ENABLED=true` | Start the in-process timer. Off → on-demand only (`POST /demo/admin/sync`, CLI). |
| `DEMO_SYNC_SOURCE_DATABASE_URL` | **Read-only** production connection (`demo_reader` role, session-mode pooler, `sslmode=require`). |
| `DEMO_SYNC_TARGET_DATABASE_URL` | Optional; defaults to `DIRECT_URL` / `DATABASE_URL` (the demo DB). |
| `DEMO_MASK_SALT` | Secret salt. Rotating it re-keys every fake identity (run a full sync afterwards). |
| `DEMO_SYNC_INTERVAL_MINUTES` (3) | Incremental cadence. |
| `DEMO_SYNC_FULL_EVERY_MINUTES` (60) | Full run with pruning. |
| `DEMO_BRAND_NAME`, `DEMO_BRAND_SHORT`, `DEMO_EMAIL_DOMAIN`, `DEMO_BRAND_TOKENS`, `DEMO_DEFAULT_COUNTRY` | Masker config (defaults: Northstar Immigration Consultants / `northstar-demo.example` / PK). |
| `DEMO_STAFF_KEEP` | Comma list of real staff emails to keep unmasked. |
| `DEMO_STAFF_ALIASES` | JSON `{ "real@email": { "firstName": "..", "lastName": "..", "email": ".." } }`. |
| `DEMO_PROTECTED_USER_IDS` | Extra user ids never pruned (the demo admin/agent ids are built in). |

### Background jobs to switch off in the demo (all exist in the codebase)
`WINDOW_SAVER_ENABLED=false CLIENT_NUDGE_ENABLED=false RECEPTION_SWEEPER_ENABLED=false WA_DAILY_REPORT_ENABLED=false JR_NOTIFY_ENABLED=false JR_DEADLINE_SWEEPER_ENABLED=false STATUS_SWEEPER_ENABLED=false SERVICE_HEALTH_SENTINEL_ENABLED=false CALLS_SWEEPER_ENABLED=false WHATSAPP_ENABLE_CALLING=false CSV_DRIP_BACKFILL=off DOC_AI_ENABLED=false WHATSAPP_WEBHOOK_RETENTION_ENABLED=false DATABANK_*_ENABLED=false PROCESSING_EMAIL_NOTIFY_ENABLED=false WA_MARK_READ_META=false`
and keep the assistant multi-turn: `AI_BOT_CONVERSATION_ENABLED=true AI_BOT_BROCHURES_ENABLED=false`.

### Standard backend variables (same as production, own values)
`DATABASE_URL`, `DIRECT_URL`, `REDIS_URL` (own Postgres + Redis — never
production's), `JWT_SECRET`, `JWT_REFRESH_SECRET`, `WHATSAPP_ENCRYPTION_KEY`
(a NEW key — production tokens are never copied), `META_APP_ID`,
`META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `META_GRAPH_API_VERSION`,
`APP_URL`, `FRONTEND_URL`, `CORS_ALLOWED_ORIGINS`, `PORT`, `TZ`.
SMTP / storage / Supabase / doc-parser variables are intentionally unset.

### Frontend (build args of `apps/frontend/Dockerfile`)
`NEXT_PUBLIC_API_URL=https://demo-api.<domain>`,
`NEXT_PUBLIC_BRAND_NAME="Northstar Immigration Consultants"`,
`NEXT_PUBLIC_DEMO_MODE=true` (the banner also switches on from `/config` at runtime).

## 3. Deployment (Railway project `tafai-demo`)

Services: `Postgres` (pgvector enabled), `Redis`, `backend` (root
`Dockerfile`, port 3001, runs `prisma migrate deploy` on boot), `frontend`
(`apps/frontend/Dockerfile`, port 3000). Custom domains
`demo-api.summitautomates.com` → backend, `demo.summitautomates.com` → frontend
(CNAMEs on Hostinger). The `*.up.railway.app` domains keep working as a fallback.

Deploy from the feature branch with the CLI (the services are not connected
to GitHub; connect them in the Railway dashboard if you prefer auto-deploys):

```bash
railway up --service backend   # from the repo root
railway up --service frontend  # from apps/frontend
```

Set-up order on a fresh database:
1. Schema. **`prisma migrate deploy` alone is not enough**: production's schema
   is ahead of the migrations folder (migration `20260513000000_…` even fails on
   an empty database, and ~80 tables / ~1,400 columns exist only via `db push`).
   The demo database was therefore built like this (demo DB only — never run
   any of it against production):
   ```bash
   # from apps/backend, DATABASE_URL/DIRECT_URL = the DEMO database
   npx prisma migrate deploy                     # applies what it can
   npx prisma migrate diff --from-url "$DATABASE_URL" \
       --to-schema-datamodel prisma/schema.prisma --script > /tmp/drift.sql
   psql "$DATABASE_URL" -1 -v ON_ERROR_STOP=1 -f /tmp/drift.sql   # (tables must be empty)
   for m in $(ls prisma/migrations | grep -v lock); do npx prisma migrate resolve --applied "$m"; done
   npx prisma migrate deploy                     # → "No pending migrations" (boot is a no-op)
   ```
   The sync engine also adds any enum value production has that the demo lacks
   before every run.
2. `npm run demo:sync -- --full` (or wait for the timer / `POST /demo/admin/sync {"full":true}`).
3. `npm run demo:seed` with `DEMO_ADMIN_PASSWORD`, `DEMO_AGENT_PASSWORD`,
   `DEMO_OPENAI_API_KEY`, `DEMO_LIVE_*` set → demo logins, OpenAI key, live-lane channel.
4. `npm run demo:leak-check` — must print `LEAK CHECK PASSED`.

Running the CLIs inside the backend container: `railway ssh --service backend`
then `node dist/modules/demo/cli/sync.js --full`, `…/seed.js`, `…/leak-check.js`.

## 4. Live lane (Meta test number)

**Status: parked.** The lane is wired in code but switched off until a demo
number exists. Exactly six values turn it on (all set on the demo backend
service, then one `demo:seed` run):

| # | Value | Where it comes from | Where it goes |
|---|---|---|---|
| 1 | WABA id | Meta app → WhatsApp → API Setup → *WhatsApp Business Account ID* | `DEMO_LIVE_WABA_ID` (seed) |
| 2 | Phone number id | same page → *Phone number ID* of the test number | `DEMO_LIVE_PHONE_NUMBER_ID` (seed) **and** `DEMO_LIVE_PHONE_NUMBER_IDS` (backend) |
| 3 | The number itself | same page → *From* | `DEMO_LIVE_DISPLAY_NUMBER` (seed + backend; shown in the banner) |
| 4 | Permanent access token | Business Settings → System users → Generate token (`whatsapp_business_messaging`, `whatsapp_business_management`) | `DEMO_LIVE_ACCESS_TOKEN` (seed; stored encrypted) |
| 5 | App secret | Meta app → App settings → Basic | `META_APP_SECRET` (+ `META_APP_ID`) on the backend |
| 6 | OpenAI key for the demo | OpenAI dashboard (a separate key, never production's) | `DEMO_OPENAI_API_KEY` (seed; stored encrypted) |

Then point the Meta webhook at `https://demo-api.summitautomates.com/whatsapp/webhooks/meta`
with verify token = `META_WEBHOOK_VERIFY_TOKEN`, and **before every call add the
prospect's phone to the test number's recipient list** (step 6 below).

1. Meta for Developers → the Summit app → **WhatsApp → API Setup**. Note the
   *WhatsApp Business Account ID*, the test number's *Phone number ID* and the
   number itself.
2. Create a permanent token: Business Settings → System users → add user →
   assign the app + WABA → *Generate token* with
   `whatsapp_business_messaging` and `whatsapp_business_management`.
3. Set on the demo backend: `DEMO_LIVE_PHONE_NUMBER_IDS=<phone number id>`,
   `DEMO_LIVE_DISPLAY_NUMBER=<+1 555 …>`, `META_APP_ID`, `META_APP_SECRET`
   (App settings → Basic). Redeploy.
4. Run `demo:seed` with `DEMO_LIVE_WABA_ID`, `DEMO_LIVE_PHONE_NUMBER_ID`,
   `DEMO_LIVE_ACCESS_TOKEN`, `DEMO_LIVE_DISPLAY_NUMBER` → creates the
   `WhatsAppChannel` row (token encrypted with the demo's key).
5. Webhook: WhatsApp → Configuration → Callback URL
   `https://demo-api.summitautomates.com/whatsapp/webhooks/meta`, Verify token =
   `META_WEBHOOK_VERIFY_TOKEN`; subscribe to `messages`.
6. **Before every call:** API Setup → *To* → **Manage phone number list** →
   add the prospect's phone (max 5 numbers on a test number; they receive a
   one-time code). Only listed numbers can message the test number.
7. The prospect texts the number; the AI replies within seconds; the
   conversation appears in the demo inbox (threads on this channel are never
   masked and never synced back to production).

## 5. Demo logins and prospect links

* `demo.admin@<DEMO_LOGIN_DOMAIN>` — full admin.
* `demo.agent@<DEMO_LOGIN_DOMAIN>` — sales inbox agent.
* Per-prospect links: `/admin/settings/demo` → *New prospect link* (role,
  validity in hours, optional max uses). The link
  `https://demo.<domain>/demo/enter?t=…` signs the visitor straight in; every
  redemption is logged (time, IP, user agent); *Revoke* kills the link and the
  sessions it opened. Links expire on their own (default 48 h).

## 6. Safety checks

* `npm run demo:leak-check` scans every text/JSON column of every table in
  the demo DB for production phones, emails, national ids and full names
  (read live from the read-only role). Non-zero exit on any hit.
* `apps/backend/src/modules/demo/masking.spec.ts` and `sync/engine.spec.ts`
  (needs a local Postgres at `DEMO_TEST_PG_URL`) cover determinism,
  phone bijection, text scrubbing, pruning with live-lane exclusions and
  incremental watermarks.
* Outbound block test: in the demo inbox, reply on any synced thread → the
  message shows as *sent* with a `wamid.demo-…` id and the backend log reads
  `[demo] …`; the backend never calls graph.facebook.com for it.

## 7. Consent

Even masked, the data derives from the client's production. Keep Tashfeen's
written consent for using pseudonymised data in sales demonstrations on file
before showing the demo to third parties.
