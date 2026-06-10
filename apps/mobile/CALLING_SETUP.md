# In-app voice calling (Android) — setup & operation

The Tashfeen mobile app now has a real WebRTC softphone for WhatsApp Business
Calling, ported from the proven web `CallDock`. It reuses the existing backend
signaling, call-control REST API, and the live coturn TURN server — the same
infrastructure the web CRM already calls clients with.

> **Scope:** Android only (per request). iOS is intentionally not built — there
> is no `ios/` project, CallKit/PushKit, or APNs VoIP wiring.

---

## What works with zero extra setup

These need **nothing** beyond the existing backend + TURN (already live):

- **Outbound calls** — open a WhatsApp chat → tap the **Call** icon in the
  header. The app captures the mic, negotiates WebRTC, and rings the customer.
- **Inbound calls while the app is open (foreground)** — the app holds a
  Socket.IO connection to `/whatsapp/realtime`; when a call is routed to the
  signed-in rep, a full-screen ring screen appears with Accept / Decline.
- Mute, speaker toggle, in-call timer, hang-up.

The non-trickle ICE handshake (Meta requirement) and the DigitalOcean coturn
TURN relay are handled exactly as on the web client.

---

## What needs Firebase (background / locked-screen ringing)

Ringing when the app is **backgrounded or the phone is locked** is delivered by
a high-priority **FCM data push** that wakes the app and shows a native
incoming-call screen (Android Telecom / `ConnectionService`, via
`flutter_callkit_incoming`).

The code is fully wired and **degrades to a no-op until Firebase is configured**
— so the app builds and runs today; background ringing simply stays off until
you do the steps below. (Foreground calling above is unaffected.)

### 1. Add a Firebase config to the app (one-time)

From `apps/mobile`, the easiest path:

```bash
dart pub global activate flutterfire_cli
flutterfire configure          # pick/create a Firebase project, select Android
```

This drops `android/app/google-services.json`, applies the
`com.google.gms.google-services` Gradle plugin, and generates
`lib/firebase_options.dart`.

Manual alternative: place your `google-services.json` in `android/app/`, add
`id("com.google.gms.google-services")` to `android/app/build.gradle.kts`
plugins, and `id("com.google.gms.google-services") version "4.4.2" apply false`
to `android/settings.gradle.kts` plugins.

The app's package name is **`com.tashfeengroup.tafsheen_mobile`** — register
exactly that in Firebase.

### 2. Give the backend the FCM key (one-time)

The server sends pushes via FCM HTTP v1 using a Google **service-account JSON**.
Upload it in the CRM: **Admin → API Keys → provider `fcm`**. (The backend
`PushService` already reads it from there; no env var or redeploy needed.)

> Until both 1 and 2 are done, `PushService.sendCallInvite` is a silent no-op
> and the device never registers a token — everything else still works.

### 3. Rebuild & install

```bash
flutter build apk --release
```

After a rep logs in, the app registers its FCM token (`POST /devices/register`)
and the backend rings that device on the next inbound call — even when locked.

---

## Build requirements

- **JDK 17** is required (the `flutter_webrtc` / `flutter_callkit_incoming`
  plugins pin a Java 17 toolchain). Already configured on this machine via
  `flutter config --jdk-dir="C:\Program Files\Microsoft\jdk-17.0.18.8-hotspot"`.
  On a fresh machine, install a JDK 17 and point Flutter at it the same way.
- `minSdk` is 23 (WebRTC requirement).

---

## How it's wired (for maintainers)

| Concern | Location |
| --- | --- |
| State machine + WebRTC lifecycle | `lib/features/calls/application/call_controller.dart` |
| REST (ice / outbound / answer / reject / hangup / recording / device) | `lib/features/calls/data/call_api.dart` |
| Socket.IO signaling | `lib/features/calls/data/realtime_service.dart` |
| FCM + CallKit bridge | `lib/features/calls/data/push_service.dart` |
| Ring + in-call UI | `lib/features/calls/presentation/call_overlay.dart` |
| Global mount / socket+push lifecycle | `lib/features/calls/presentation/call_host.dart` |
| Backend data-push for ringing | `apps/backend/src/modules/push/push.service.ts` (`sendCallInvite` / `sendCallCancel`) wired in `webhook-ingest.processor.ts` |

Foreground rings come from the socket; background rings come from the FCM data
push → CallKit. The two never double-ring (foreground FCM only honours
cancellations). A customer hang-up before answer fires a `call_cancelled` push
that dismisses the native ring.

---

## Known limitation — call recording

WhatsApp Business Calling media is peer-to-peer (relayed via TURN); the server
is not in the media path, so recording can only happen on the device. The web
client mixes both sides with the Web Audio API. On Android, `flutter_webrtc`'s
`MediaRecorder` can capture a single channel best-effort (uploaded to
`POST /whatsapp/calls/{id}/recording` on hang-up) but **cannot reliably mix the
mic + remote audio into one track**. Treat mobile recording as best-effort. For
guaranteed two-way recordings, route media through a media server / SFU — a
larger architectural change tracked separately.

---

## Testing checklist

1. Log in as a rep with a linked Employee (rings target the per-employee room).
2. **Outbound:** open a chat → Call → the customer's WhatsApp rings → talk.
3. **Inbound, app open:** have the customer call → ring screen → Accept → talk.
4. **Inbound, app backgrounded (after Firebase setup):** lock the phone → call →
   native incoming-call screen rings → Accept → app opens into the call.
5. **Cancel:** customer hangs up before you answer → the ring dismisses.
