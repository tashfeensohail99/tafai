# New-post → Staff Engagement Alert

**Status:** shipped (backend + web admin). Companion to the team social-engagement
verification feature (`docs/social-engagement-verification.md`).

## Goal

When a new company post goes live on Facebook or Instagram, automatically notify
staff to go **like & comment**. This drives the engagement the verification
engine then confirms — the alert and the scoreboard are the visible "teeth" of
the policy. (Reality unchanged: only IG comments auto-verify today; likes are
never verifiable. Admin copy stays honest; employee-facing alert copy just says
"like & comment now".)

## Detection

`SocialAlertPollerService` (setInterval, boot-delayed, non-overlapping, unref'd;
`SOCIAL_ALERT_POLLER_ENABLED`, `SOCIAL_ALERT_POLL_INTERVAL_MIN` default 10) calls
`SocialAlertService.runPoll()`:
- Reuses `SocialGraphService` (page-token resolution from `/me/accounts` + FB
  `/posts` + IG `/media`) — the same client the verification sweep uses.
- **Dedupe:** `social_post_alerts` ledger, unique `(platform, externalId)`; each
  post alerts at most once.
- **No back-blast:** only posts with `postedAt >= enabledAt` (stamped the moment
  alerts are switched on) **and** within the freshness window
  (`SOCIAL_ALERT_MAX_POST_AGE_HOURS`, default 24) ever alert.
- **Quiet hours** (PKT): posts seen during the window are *deferred* (not
  recorded), so they alert once the window ends — still bounded by the freshness
  window.
- Master on/off is a DB flag (`social_alert_config`), **default OFF** — nothing
  is sent until an admin enables it. A webhook could replace polling later.

## Targeting

By **department** (`Department.name`): admin picks which teams get alerted
(default = every active department). Recipients = active employees in those
departments whose user account is `ACTIVE`, deduped by user.

## Channels (reuse existing infra)

- **Email** — per recipient via the MXRoute `EmailService` (no shared To: line).
- **In-app bell + mobile push** — one `NotificationsService.create()` per
  recipient (writes the bell row and fans out to FCM/web push).
- **Banner** — one org-wide `SystemAlert` row (`social_post_<platform>_<id>`,
  severity `info`) that every web shell's existing `SystemAlertBanner` renders;
  auto-expired after `SOCIAL_ALERT_BANNER_TTL_HOURS` (default 8).

Each alert carries the post caption snippet + a tap-to-open link to the post.
Channels are admin-selectable (default = all three).

## Admin (web, Marketing portal)

`/marketing/engagement/alerts` (`social.alerts.manage`): master toggle, platform
/ channel / department selection, optional quiet hours, a **Poll now** button,
and a recent-alert log. Nav item hidden without the permission. Permission synced
by `scripts/sync-social-alerts-perms.ts` (super_admin / admin / marketing).

## Data model (additive, `core`)

- `SocialAlertConfig` — singleton: `enabled`, `enabledAt`, `departments[]`,
  `platforms[]` (reuses `SocialPlatform`), `channels[]`, `quietStartHour`,
  `quietEndHour`.
- `SocialPostAlert` — dedupe ledger: `(platform, externalId)` unique, `alertedAt`,
  `recipients`, `bannerAlertKey`.

## Env

`SOCIAL_ALERT_POLLER_ENABLED` (default on), `SOCIAL_ALERT_POLL_INTERVAL_MIN` (10),
`SOCIAL_ALERT_MAX_POST_AGE_HOURS` (24), `SOCIAL_ALERT_BANNER_TTL_HOURS` (8). The
feature still does nothing until the DB config is enabled by an admin.

## Later

Webhook-driven detection (FB `feed` + IG `comments`/media webhooks) instead of
polling; per-employee "you haven't engaged with the last N posts" nudges;
thumbnail images in the email/banner.
