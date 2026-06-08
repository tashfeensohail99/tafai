# Sales Team App — Backend API Checklist

The API surface the mobile **Sales Team App** consumes. Production base URL:
`https://backend-production-5a89.up.railway.app`. All times are UTC on the wire;
business "day" logic (reminders, follow-up buckets, availability) is computed in
**Asia/Karachi (PKT, UTC+5)** on the backend.

## Conventions

- **Auth:** `Authorization: Bearer <jwt>` on every call except the public
  email-verification endpoint. The JWT carries the user's roles + permissions
  (baked at login); the backend authorises per-endpoint.
- **Scoping:** a salesperson only ever sees/edits their **own** leads,
  follow-ups and appointments (assigned-to or created-by). Holders of the
  `*.view_all` permission see everything. This is enforced **server-side** — the
  app cannot widen its own scope.
- **Errors:** standard HTTP — `401` (no/!valid token), `403` (lacks
  permission), `404` (not found **or** not in your scope — existence is not
  leaked), `409` (conflict, e.g. double-booking), `400` (validation).

---

## 1. Auth & session

| Method | Path | Notes |
|---|---|---|
| POST | `/auth/login` | `{ email, password }` → `{ accessToken, … }`. Token embeds permissions. |
| GET | `/auth/me` | Current user + roles/permissions (confirm against the live list). |

> The app must **not** store the password; keep only the JWT (secure storage) and
> re-login on 401.

## 2. Push device registration  ·  *new (SP2)*

| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/devices/register` | `{ token, platform: ANDROID\|IOS\|WEB, deviceInfo? }` | Call on login + on FCM token refresh. Upsert by token. |
| DELETE | `/devices/:token` | — | Call on logout. Scoped to the caller. |
| GET | `/devices` | — | The caller's registered devices. |

> Push delivery rides on the in-app notification rail: **every** notification the
> bell shows is also delivered to registered devices via FCM (no-op until an
> `fcm` service-account key is configured in Admin → API Keys). Triggers:
> appointment reminder/booked, follow-up due/overdue, lead assigned/reassigned,
> agreement approved/changes-requested, WhatsApp activity.

## 3. Notifications (bell)

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications?limit=` | Latest N for the caller. |
| GET | `/notifications/unread-count` | `{ count }` — badge. |
| PATCH | `/notifications/:id/read` | Mark one read. |
| POST | `/notifications/read-all` | Mark all read. |

`type` values the app should handle: `APPOINTMENT_REMINDER`, `APPOINTMENT_BOOKED`,
`FOLLOWUP_DUE`, `FOLLOWUP_OVERDUE`, `LEAD_ASSIGNED`, `AGREEMENT_APPROVED`,
`AGREEMENT_CHANGES_REQUESTED`, plus WhatsApp activity. Each has a `link` (relative
path) for deep-linking.

## 4. Leads

| Method | Path | Notes |
|---|---|---|
| GET | `/leads` | List (scoped). Filters: `status`, `assignedEmployeeId`, `branchId`, `sourceChannel`, `serviceInterest`, `targetCountry`, date range, `search`, `fromCsv`. |
| GET | `/leads/dashboard-summary` | One-shot counts + 5 recent — use for the home screen (avoid fetching all leads). |
| GET | `/leads/my-stats` | Per-agent sidebar counters + SLA. |
| GET | `/leads/:id` | Lead detail (scoped; 404 if not yours). |
| POST | `/leads` | Create. **Validate phone (10–15 digits) + email format client-side** (SP8); backend also validates. `priority` is now an enum: **`HOT` \| `WARM` \| `COLD`**. |
| PATCH | `/leads/:id` | Update (own lead only). Marking `status: LOST` stamps `lostAt`; `DUPLICATE`/`LOST` raise dedicated audit events. |
| POST | `/leads/:id/assign` | Reassign (own lead). Notifies the new assignee. |
| POST | `/leads/:id/convert` | Lead → Client. **Requires a verified email** (SP5) — send verification first. |
| POST | `/leads/:id/send-email-verification` | Email the lead a verification link. |

**Lead files:** `POST /leads/:id/files` (multipart, 10 MB cap),
`GET /leads/:id/files`, `GET /leads/:id/files/:fileId/url` (signed URL; access is
audited), `DELETE /leads/:id/files/:fileId`.

## 5. Follow-ups  ·  *buckets + pagination new (SP3)*

| Method | Path | Notes |
|---|---|---|
| GET | `/follow-ups` | **`?bucket=overdue\|today\|upcoming`** (PKT; bucket ⇒ OPEN) and **`?page=&limit=`** (limit ≤ 100). Body is the items array; **`X-Total-Count`** header has the total. Also: `status`, `leadId`, `assignedEmployeeId`, `dueFrom/dueTo`, `search`. |
| GET | `/follow-ups/:id` | Detail (scoped). |
| POST | `/follow-ups` | Create `{ leadId, title, dueAt, … }`. |
| PATCH | `/follow-ups/:id` | Update. |
| POST | `/follow-ups/:id/complete` | `{ outcomeNotes? }`. |
| POST | `/follow-ups/:id/reschedule` | **new (SP4)** — `{ dueAt }`; re-arms the reminder. |

> The home screen's "due today / overdue / upcoming" lists map 1:1 to `bucket=`.

## 6. Appointments  ·  *availability + reschedule new (SP4)*

| Method | Path | Notes |
|---|---|---|
| GET | `/appointments` | List (scoped). Filters incl. `scheduledFrom/scheduledTo`, `status`. |
| GET | `/appointments/availability?employeeId=&date=` | **new** — office-hours window (09:00–18:00 PKT), busy intervals, and open 30-min `freeSlots`. Use before booking. |
| GET | `/appointments/:id` | Detail. |
| POST | `/appointments` | Create. **Rejects a double-booking with `409`.** Optional `sendWhatsAppConfirmation`. |
| PATCH | `/appointments/:id` | Update. |
| POST | `/appointments/:id/reschedule` | **new** — `{ scheduledAt, durationMinutes? }`; double-book checked; re-arms the reminder. |
| POST | `/appointments/:id/cancel` | `{ cancellationReason? }`. |

## 7. Appointment requests (bot-captured)

| Method | Path | Notes |
|---|---|---|
| GET | `/appointment-requests` | Pending requests inbox (confirm exact path/filters against the controller). |
| — | (confirm/decline + take-over) | Mirror the web sales flow. |

## 8. WhatsApp (chat)

The app's chat tab reuses the existing WhatsApp endpoints (inbox list, per-lead
thread, send message/template, media). Inbound activity already produces bell +
push notifications. *(Map exact paths from the `whatsapp` module before building
the chat screen — large surface, intentionally not duplicated here.)*

## 9. Agreements (read-mostly for sales)

`GET /agreements` + detail for the lead's agreement; status transitions
(submit/approve/changes/sent/signed) are Finance-driven and now emit
`AGREEMENT_STATUS_CHANGED` audit events + notify the sales author.

---

## Open items before app GA

1. **Confirm `/auth/me` + appointment-requests exact shapes** against the live
   controllers (left intentionally loose above).
2. **FCM service-account key** must be added in Admin → API Keys (`provider: fcm`)
   for push to actually deliver; until then `/devices/*` succeed but no push is
   sent (by design).
3. **APNs:** delivered via FCM's APNs bridge — upload the APNs key in the Firebase
   console; **no backend change** required.
4. **Responsive web parity** (the `<600px` sales pages) is a separate frontend
   task tracked under SP8.
