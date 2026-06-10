# Tafsheen Sales App — Build Progress

Living checklist for the Flutter **Sales Team** app build. Architecture: **plain Dart,
no code generation** (manual `fromJson`, plain Riverpod `Provider`/`StateNotifier`, Dio,
GoRouter). The app builds & runs with `flutter pub get` only — **no `build_runner`**.

> **Verification:** Flutter **3.35.7** (Dart 3.9.2) is installed on this machine at
> `D:\flutter`. Every slice is gated on `flutter analyze` before moving on:
> ```
> /d/flutter/bin/flutter analyze   # from apps/mobile
> ```
> **Baseline — P0–P2 + P3 data layer: ✅ `No issues found!`**
>
> **✅ Builds + runs on the Android emulator (2026-06-10)** — login screen confirmed rendering.
>
> **Working Android build recipe (this machine = Win11 25H2 + VS 2026):**
> - Flutter **3.44.1** (upgraded from 3.35) → Gradle **9.1** + AGP **9.0.1**. Old Gradle 8.12
>   hit a memory-mapped lock-file bug on Win11 25H2 ("Unexpected lock protocol… found 0");
>   only the newer Gradle clears it.
> - `PUB_CACHE=D:\pubcache` — must be on the **same drive** as the project (else Kotlin's
>   incremental compiler can't relativize C:↔D: paths).
> - `android/gradle.properties`: `org.gradle.jvmargs=-Xmx2048M` + `kotlin.incremental=false`.
> - SDK at `D:\Android\Sdk`, `GRADLE_USER_HOME=D:\gh9`.
> - `flutter build apk --debug --dart-define=API_BASE_URL=<prod>` → `adb install -r …app-debug.apk`.
> - **Release:** `flutter build apk --release --dart-define=API_BASE_URL=<prod>` → `app-release.apk`
>   (52.7 MB, AOT, far faster cold-start). Currently **debug-signed** (template default) — add a
>   real upload keystore + signingConfig before a Play Store build. First release build can fail
>   transiently under concurrent Gradle load; a clean retry succeeds.
>
> Authored against the live API contract: `docs/sales-team-app-api.md` +
> `apps/mobile/API_AUTH_CONTRACT.md`.

## Phases

- [x] **P0 — Foundation** — codegen-free router + auth state + shared UI states + error mapping
- [x] **P1 — Auth** — bootstrap/refresh-on-start, login, forgot-password, forced change-password
- [x] **P2 — App shell** — bottom-nav scaffold (Home/Leads/Follow-ups/Appointments/Chat) + profile menu
- [~] **P3 — Leads** — ✅ data layer; ✅ list (search + status filter + states + pull-to-refresh) + **New-lead FAB → create form**; ✅ detail (read view, send email-verification, change-status) + **edit** (prefilled form), **convert-to-client** (verified-email gate → offer to send verification), **Call / WhatsApp / Email quick-actions** (url_launcher + manifest `<queries>`). Verified on emulator. ⏳ remaining: file attachments (upload/view/delete — needs file_picker) + manager reassign + lead-WhatsApp tab.
- [x] **P4 — Home dashboard** — ✅ greeting + live KPI cards (my-stats) + pipeline strip + recent leads (dashboard-summary) + shimmer loading + pull-to-refresh. Verified on emulator with real prod data (667 leads).
- [x] **P5 — Follow-ups** — ✅ Overdue/Today/Upcoming segmented buckets, cards (contact icon + due-date color + priority), one-tap **Complete** (outcome note) + **Reschedule** (date/time picker), states + pull-to-refresh. Verified on emulator with real overdue items.
- [x] **P6 — Appointments** — ✅ Upcoming/Past list (PKT times + status + location + relative), **Book** FAB (searchable lead picker → type/title/location/WhatsApp-confirm → create), **availability slot picker** (14-day strip + free 30-min slots, booked excluded, times rendered in PKT), **reschedule** (same picker) + **cancel** (reason), and 409 double-book → "next free slot" (`suggestedAt`) suggestion dialog. Verified on emulator with real data (16 open · 2 booked).
- [x] **P7 — Appointment requests** — ✅ pending inbox (lead + captured intent day/time + modality + verbatim raw text + assigned agent), **Reject**, **Book** (reuses the availability slot picker → links `appointmentRequestId` so the request auto-confirms). Surfaced via a "N booking requests from chats" banner on the Appointments tab (shown only when pending>0). Analyze/test clean.
- [~] **P8 — WhatsApp chat** — ✅ inbox mirrors the web exactly: **All / Open / Uncontacted** tabs with live `/threads/stats` counts (verified 657 / 447 / 210 on prod), Due-follow-ups chip, search, **awaiting-reply "Reply" badges** + green unread counts, awaiting pinned first, cursor pagination, pull-to-refresh; ✅ thread view: message bubbles (inbound/outbound, media placeholders, status ticks read/delivered/sent/failed), load-older, **send text** (24h-window guarded → banner outside window), **AI on/off toggle** + **take-over**, mark-read on open, open-lead. Verified on emulator with real prod chats (incl. Roman-Urdu + voice/photo). ⏳ remaining: send **template** + **media** (needs file_picker) + realtime socket (FCM-driven refresh covers it for now).
- [x] **P9 — Notifications** — ✅ bell **badge** (live unread count, 30s poll) + screen (per-type icons, unread highlight + dot, relative time), **mark-read on tap** + **mark-all**, **deep-link** routing (lead→detail; appointments/follow-ups/chat→tab switch via `shellIndexProvider`). Verified on emulator (badge **999+**, real WhatsApp-activity feed).
- [ ] **P10 — Agreements** — list + detail (read-mostly) + pdf-url
- [ ] **P11 — Push (FCM)** — device register/refresh/unregister + foreground/background handlers (needs native Firebase config — vendor)
- [~] **P12 — Polish** — ✅ loading/error/empty/forbidden states across every screen, **16 unit tests** (`flutter test`), final `flutter analyze` → **No issues found!**, and the **release APK builds** (`app-release.apk` 52.7 MB, AOT — cold-starts in **<12s** vs ~25s for debug, demonstrated on the emulator). ⏳ optional: manual dark-mode toggle (system dark is already themed), basic attendance check-in.

## Testing
- **Unit suite (`flutter test`) — 16 passing:** parsers (int/string/date coercion), **PKT formatting** (timezone-independent office-hours rendering), **error-mapper** (409→`ConflictError` w/ `suggestedAt`, 401/403/404/400-validation/network), and **domain `fromJson`** for Lead, Appointment, WhatsappThread, ThreadStats(`open=total−uncontacted`), AppNotification, AppointmentRequest.
- Every feature is also gated on `flutter analyze` (**No issues found!**) + a debug build + emulator screenshot against **live prod** data.

## Notes
- Scoping is server-enforced; UI gates with `AuthUser.hasPermission(key)` for UX only.
- Times are UTC on the wire; business-day logic (buckets/availability) is PKT on the backend.
- Push delivers to registered devices once the `fcm` key is set in Admin → API Keys (done).
