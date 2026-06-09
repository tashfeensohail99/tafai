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

The AI bot captures booking intents (day / time / modality) into `AppointmentRequest`
rows; sales reviews them here, then books the real appointment from the chat.

| Method | Path | Notes |
|---|---|---|
| GET | `/sales/appointment-requests` | Inbox. `?status=PENDING\|CONFIRMED\|REJECTED\|EXPIRED` (default **PENDING**), `?search=` (name/phone). Scoped: `appointments.view_all` sees all; otherwise only the caller's assigned leads. Each row embeds the linked lead (name / phone / assigned agent). |
| PATCH | `/sales/appointment-requests/:id/reject` | Decline a PENDING request. |

> **No "confirm" endpoint** — to book, open the thread and create the appointment
> via `POST /appointments` (§6); the bot's auto-CONFIRMED handshake then closes the
> request. **Take over** the AI on that chat with `POST /whatsapp/threads/:id/take-over` (§8).

## 8. WhatsApp (chat)

**Threads** — base `/whatsapp/threads`:

| Method | Path | Notes |
|---|---|---|
| GET | `/whatsapp/threads` | Inbox list (scoped). Filters: `contacted`, `uncontacted`, `needsReply`, `followUpDue`, `assignedToMe`, `unassigned`, `employeeId`, `search`, `limit`, `cursor`. Sorted action-required first, then newest real activity. |
| GET | `/whatsapp/threads/stats` | Tab-badge counts (total / uncontacted / followUpDue …). |
| GET | `/whatsapp/threads/by-lead/:leadId` | The thread for a given lead (chat tab on a lead screen). |
| GET | `/whatsapp/threads/:id` | Thread detail. |
| GET | `/whatsapp/threads/:id/list-item` | Re-fetch one row (realtime patch). |
| POST | `/whatsapp/threads/:id/read` | Mark the thread read (clears unread). |
| POST | `/whatsapp/threads/:id/ai-toggle` | Turn the AI bot on/off for this chat. |
| POST | `/whatsapp/threads/:id/take-over` | Human takes over (stops the bot). |
| POST | `/whatsapp/threads/:id/reassign` | Reassign the chat's lead. |
| GET | `/whatsapp/threads/:id/appointment-requests` | Bot-captured requests on this thread. |
| GET | `/whatsapp/threads/:threadId/messages/:messageId/media` | Signed media for a media message. |

**Messages** — base `/whatsapp/threads/:threadId/messages`:

| Method | Path | Notes |
|---|---|---|
| GET | `` (base) | Message history (paginated). |
| POST | `/text` | Free-form text. **Only inside the 24h window** (else `400` — use a template). |
| POST | `/template` | Approved template (`templateName`, `language`, `components`). Works outside the window. |
| POST | `/media` | Send image / document / etc. |

Inbound activity already produces bell + push notifications. Realtime updates ride the
existing WhatsApp socket (`whatsapp.message.new`, `…message.status`, `…thread.updated`).
A failed send carries `errorCode` + `errorTitle` (e.g. Meta `131042` = billing) — surface it.

## 9. Agreements (read-mostly for sales)

`GET /agreements` + detail for the lead's agreement; status transitions
(submit/approve/changes/sent/signed) are Finance-driven and now emit
`AGREEMENT_STATUS_CHANGED` audit events + notify the sales author.

---

## Open items before app GA

1. ✅ **Done:** `/auth/me` enriched (`mustChangePassword` + `employee`), `POST /auth/password/change` added, forgot‑password emails wired (web `/reset-password` page), and the appointment‑requests + WhatsApp chat paths are confirmed above (§7–§8). The auth + chat contract is now accurate.
2. **FCM service-account key** must be added in Admin → API Keys (`provider: fcm`)
   for push to actually deliver; until then `/devices/*` succeed but no push is
   sent (by design).
3. **APNs:** delivered via FCM's APNs bridge — upload the APNs key in the Firebase
   console; **no backend change** required.
4. **Responsive web parity** (the `<600px` sales pages) is a separate frontend
   task tracked under SP8.
