# Team Social-Engagement Verification

**Status:** Phase 1 (backend + web) — this PR.
**Owner area:** Marketing portal (management-facing), `core` DB schema (employee-centric).
**Author:** engineering, 2026-10-29.

## 1. Problem

Team members are required, as a work duty, to like & comment on the company's own
Facebook / Instagram posts. Today they "prove" it by screenshotting their
like/comment and dropping it in a WhatsApp group; a manager eyeballs the
screenshots. This is slow, unauditable, and trivially faked (edit a screenshot,
reuse an old one, comment-then-delete).

**Goal:** replace the screenshot ritual with *API-backed* verification — confirm
via the Meta Graph API that a rep's comment actually exists on the post — and
turn it into a tracked KPI with a per-rep scoreboard.

> Out of scope here: the customer-facing comment→DM auto-reply bot. That is a
> separate, later build (see `tafai-messenger-integration` / the "automation
> bridge" note). Nothing in this PR touches it.

## 2. Hard capability limits (verified live via the `diag-social-*` scripts)

These are platform rules, not implementation gaps, and they shape the whole design:

| Signal | What the Graph API returns on OUR OWN posts | Verifiable? |
|---|---|---|
| **IG comment** | `username` + `text` + `timestamp` | ✅ **Fully** — username → employee handle. Passive, no screenshot. |
| **FB comment** | `text` + `timestamp` only. Author `from{}` is silently stripped (needs *Page Public Content Access*, a narrowly-granted App-Review feature we do not have). | ⚠️ **Text only** — we can confirm the comment text exists on the post, but cannot prove *which* rep wrote it. |
| **Likes / reactions (FB & IG)** | count only; no per-user list | ❌ **Not verifiable by any app** (hard Meta rule since 2018). |

Design consequences:
- **IG** → fully **passive auto-verification**. A scheduled sweep reads comments,
  matches `username` to a registered employee handle, and books a `VERIFIED` record.
- **FB** → a rep **submits a claim** ("this post + the text I commented", optional
  screenshot). The backend confirms the text exists among the post's comments →
  `TEXT_VERIFIED_AUTHOR_UNCONFIRMED`, else `NOT_FOUND`. The screenshot is kept as
  secondary evidence only; it is never "validated".
- **Likes** → surfaced in the UI as **UNVERIFIABLE**, explicitly. We do **not**
  fake-verify likes. The KPI measures comments.

## 3. Meta access (reused, nothing new)

- Token: the existing system-user token via `MetaCredentialsService` (env override
  `META_PAGE_ACCESS_TOKEN`). It already holds every needed scope
  (`pages_read_engagement`, `pages_read_user_content`, `instagram_basic`,
  `instagram_manage_comments`, …).
- New-Pages-experience requires a **Page** access token for reads — a user/system
  token errors 190/2069032. So the sweep first resolves each page's own token from
  `GET /me/accounts` and uses it for that page's `/posts`, `/{post}/comments`,
  `/{ig}/media`, `/{media}/comments`. (Same pattern as the diag scripts.)
- Pages: *Tashfeen Immigration Solutions* (`1158058817393430`, no IG) and
  *Tashfeen Barristers & Solicitors* (`1733724466923934`, IG
  `@tashfeen_barristers_solicitors` / `17841404317164823`). Discovered dynamically
  from `/me/accounts` + each page's `instagram_business_account`, so new pages are
  picked up automatically.

## 4. Data model (additive, `core` schema)

**Employee** — new nullable columns (social-handle registry):
- `instagramHandle String?` — normalised lowercase, no `@`. **This is what makes IG verification possible.**
- `facebookProfileUrl String?` — reference only (FB author is unprovable).
- `facebookDisplayName String?` — reference only.

**`SocialPost`** (cache of swept posts; powers the per-post view + the FB-claim post picker):
`id, platform, pageId, externalId, permalink, caption, postedAt, lastSweptAt, createdAt`
— unique `(platform, externalId)`.

**`SocialEngagement`** (the verified/claimed record = the proof):
`id, employeeId, platform, status, source, postExternalId, postUrl, commentExternalId?, commentText, commentedAt?, screenshotKey?, claimedByUserId?, note?, createdAt, updatedAt`
- unique `(platform, commentExternalId)` → **idempotent**: a sweep never double-credits the same comment (Postgres treats NULL `commentExternalId` as distinct, so unmatched claims coexist).
- `rawCommentId` + `commentedAt` are stored verbatim as proof.

Enums:
- `SocialPlatform { INSTAGRAM, FACEBOOK }`
- `SocialEngagementStatus { VERIFIED, TEXT_VERIFIED_AUTHOR_UNCONFIRMED, NOT_FOUND, PENDING }`
- `SocialEngagementSource { AUTO_SWEEP, REP_CLAIM }`

## 5. Verification engine (backend)

`SocialGraphService` — page-token resolution + the four read patterns (reused from diags).
`SocialSweepService` — scheduled (`setInterval`, boot-delayed, non-overlapping, env-gated) + on-demand:
1. Resolve pages from `/me/accounts`.
2. For each FB page: pull posts in the last `N` days → upsert `SocialPost`; pull each post's comments (text only) → re-check any `PENDING` FB claims for that post (text match → `TEXT_VERIFIED`, else leave for grace, then `NOT_FOUND`).
3. For the IG account: pull media in the last `N` days → upsert `SocialPost`; pull each media's comments → for every comment whose `username` matches a registered `instagramHandle`, **upsert** a `SocialEngagement(VERIFIED, AUTO_SWEEP)` keyed on `commentExternalId` (idempotent).
`SocialClaimService` — FB claim submission verifies **synchronously** at submit time (fetch that post's comments, normalised substring match on the text) → `TEXT_VERIFIED` / `NOT_FOUND`; if comments can't be fetched right now → `PENDING` (the sweep retries).

Env flags: `SOCIAL_ENGAGEMENT_SWEEP_ENABLED` (default on), `SOCIAL_ENGAGEMENT_SWEEP_DAYS` (default 14), `SOCIAL_ENGAGEMENT_SWEEP_INTERVAL_MIN` (default 180). No-ops quietly when no token resolves.

## 6. API (`/admin/social-engagement`, JWT + PermissionGuard)

| Method | Path | Permission | Purpose |
|---|---|---|---|
| GET | `/scoreboard` | `social.engagement.view` | per-rep counts (VERIFIED / TEXT_VERIFIED / UNVERIFIABLE note), window |
| GET | `/engagements` | `social.engagement.view` | detail list (proof): comment id, text, ts, post url |
| GET | `/posts` | `social.engagement.view` | recent swept posts (per-post view + claim picker) |
| GET | `/status` | `social.engagement.view` | token/page health + the capability matrix for the UI banner |
| GET | `/handles` | `social.engagement.manage` | employees + their handles |
| PATCH | `/handles/:employeeId` | `social.engagement.manage` | set IG handle / FB url / FB name |
| POST | `/claims` (multipart) | `social.engagement.submit` | submit an FB claim (+ optional screenshot) |
| POST | `/sweep` | `social.engagement.manage` | trigger a manual sweep |

Permissions synced by `scripts/sync-social-engagement-perms.ts` (additive, idempotent — never `prisma db seed` in prod). Grants: `view`+`manage`+`submit` → super_admin, admin, marketing; `view` → sales_manager; `submit` → sales, sales_manager.

## 7. Web (Marketing portal)

- **Team Engagement** `/marketing/engagement` — scoreboard (per-rep, this-week / window), a clear **VERIFIED vs TEXT-VERIFIED vs UNVERIFIABLE** legend, a per-post breakdown, and a "Log a Facebook comment" action (claim modal: employee + post + text + optional screenshot).
- **Social Handles** `/marketing/engagement/handles` — the registry editor (manage perm only).
- Client helper `lib/social-engagement.ts`.

The UI states plainly that **likes/reactions cannot be system-verified** and that
**FB comments are text-verified, not author-proven**, so management reads the numbers correctly.

## 7a. Public self-submit intake (ONE shared link, no login)

So the registry can be populated at scale, there is **one shared link** sent to the whole team. Each employee identifies themselves by their **work email** (no per-person links — a single URL everyone uses):

- **Page:** `/onboarding/social-handles` (top-level public route, mobile-first). Step 1: enter work email → it's matched (case-insensitive) to the employee's user account, confirming their name and prefilling any existing handles. Step 2: fields **Instagram (required)**, Facebook, LinkedIn, TikTok, YouTube, each with a live **Open profile ↗** link to confirm it loads before saving. Copy states plainly we verify comments, not likes.
- **Identity by email, not token:** the shared link carries no secret; the email maps to exactly one `Employee` (via its `UserAccount`), and a submission only ever writes that employee's social-handle columns. An unknown email returns a clear "we couldn't find you — use your company email or contact admin". (This replaced an earlier per-employee signed-link design, by product decision — one shared link is simpler to roll out.)
- **Endpoints (public, no auth, throttled via `ThrottlerGuard`):** `POST /public/social-handles/lookup` (email → name + prefill) and `POST /public/social-handles/submit` (email + handles → upsert).
- **Validation/normalization** (`social-normalize.ts`, server-authoritative): accepts a handle **or** a full URL per platform, strips `@`/trailing slashes/query params, and returns a canonical openable URL (IG/TikTok also keep a handle). Malformed input is rejected with a clear per-platform message. We only assert the link is **well-formed and opens** — not that the profile exists (no free existence API for LinkedIn/FB/TikTok; IG existence is confirmed downstream by the comment-verification engine). The same normalizer backs the admin editor.
- **New columns (additive):** Employee `linkedinUrl`, `tiktokHandle`, `youtubeChannelUrl`, `socialHandlesSubmittedAt`.
- **Platforms collected:** Instagram (required), Facebook, LinkedIn, TikTok, **YouTube**. YouTube is *collection only* for now. A future phase can **verify** YouTube engagement — the YouTube Data API exposes the commenter's channel identity on our own videos, so YT is verifiable like IG (unlike FB, which stays text-only); that phase needs the YT Data API + Google OAuth and is out of scope here.
- **Admin monitor:** the **Social Handles** page shows the one shared link (copy / open), per-rep submission timestamp, an **Open ↗** link per platform, who's still missing an IG handle, and a per-row **Edit** modal.

## 8. Later phases (not in this PR)

- **Rep self-service** claim entry in the sales shell + the Flutter mobile app
  (reps submit their own FB claims / see their own score). Backend endpoints are
  already role-agnostic, so this is UI-only.
- IG comment **replies** (Phase 1 sweeps top-level comments).
- Optional: nudge/report for reps who haven't engaged this week.
