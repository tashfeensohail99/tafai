# WhatsApp Calling — Complete Audit (Enterprise vs Ours)

_Audit date: 2026-07-01. Method: 11-agent review — 5 reading our backend/web/mobile call code, 4 researching the Meta WhatsApp Business Calling API + WebRTC/TURN standard (96 sources), 1 synthesis, 1 adversarial verification of every finding against the actual code. Symptom in focus: **calls answer, then drop ~5–6 seconds later.**_

---

## 1. Executive summary

Our WhatsApp Business Calling stack is **functionally complete and unusually well-built for a single-tenant CRM**: full inbound **and** outbound WebRTC lifecycle over Meta's Graph call-control, HMAC-verified queue-first webhook ingest with idempotency, per-rep socket targeting, FCM/CallKit background ringing, browser **and** Flutter clients, recording + Whisper transcription, and a shared identity/assignment engine.

The dominant production problem — **"answers then drops after ~5–6 seconds"** — is **not** a Meta/API problem. It is a **media-path (WebRTC) problem with two compounding, confirmed defects**:

1. **No reachable TURN relay on restrictive networks.** TURN was historically advertised STUN/UDP+TCP-3478 only, with **no TLS-TURN on port 443** (documented as the "definitive fix" in `docs/turn-tls-setup.md`, not yet deployed). Reps on CGNAT / UDP-blocking corporate or mobile networks never get a `relay` candidate, so media comes up on a fragile direct path that dies at the first NAT rebinding.
2. **The web client kills the call on the first transient blip.** `CallDock.tsx` treats WebRTC state `disconnected` (a *recoverable* state) identically to terminal `failed`/`closed` and tears down instantly — **no grace window, no `restartIce()`**. The 5–6s mark is the textbook ICE **consent-freshness** window (RFC 7675: STUN keepalives every 5s); a normal recoverable blip becomes a hard drop.

The mobile app **already does the right thing** (20s reconnect grace, `call_controller.dart:417`), which proves the web path is the regression.

> **The single highest-leverage fix:** deploy **TLS-TURN on 443** *and* make the web client treat `disconnected` as transient (grace + ICE restart). Ship both together — the relay gives a survivable path; the disconnect-handling change lets a 5–6s blip recover instead of killing the call.

Everything else (CDR/quality telemetry, orphaned-call cleanup, ephemeral TURN creds, terminate-reason parsing, outbound ACL, permission lifecycle, recording consent) is **reliability/observability/compliance hardening** — important, but **not** the cause of the drop.

---

## 2. How WE do it today

**Topology:** the browser/Flutter app is the WebRTC peer; the backend is a thin **signaling relay** to Meta's Graph call-control. **No media server in the path** — audio is peer-to-peer over STUN/TURN.

**Inbound:** Meta webhook → HMAC-verified, NUL-stripped, persisted to `whatsAppWebhookEvent`, enqueued to `WEBHOOK_INGEST` with `jobId = webhookEventId` (idempotent) → `webhook-ingest.processor` resolves/creates the contact under a per-phone in-memory lock, upserts the thread, creates a `RINGING` call row with the stored `sdpOffer`, runs the shared **sticky → round-robin → after-hours** assignment engine (`forLiveCall=true`), and rings **only the assigned rep** via a per-employee Socket.IO room + high-priority FCM data push. The rep's `CallDock` fetches the offer + ICE servers (`GET /whatsapp/calls/ice`), does `getUserMedia → RTCPeerConnection → setRemoteDescription(offer) → createAnswer → waitForIce (non-trickle, 5s cap) → POST /answer`; the backend relays `accept + sdpAnswer` to Meta via `cloud-client.respondToCall`.

**Outbound:** rep is the offerer → `POST /outbound` → `cloud-client.initiateCall(action=connect)` → the customer's SDP answer arrives on the `whatsapp.call.answered` socket event → `setRemoteDescription(answer)`.

**Teardown:** `/hangup` → `respondToCall(terminate)`; a caller hangup arrives as a webhook `terminate` → `CALL_ENDED` socket event + FCM cancel.

**ICE config** (`app.config.ts:71-94`): STUN always (Google default); TURN added **only if `TURN_URLS` is set**, auto-expanded to `udp+tcp` for plain `turn:` and `tcp` for `turns:`. **Permission** is stored per-thread (`callPermissionStatus/ExpiresAt`) as a best-effort hint; Meta is the source of truth at initiation. **Recording** is best-effort client-side Web Audio mix → S3 → async Whisper. **Mobile** reuses the same backend + coturn and adds `CallForegroundService` + wake/Wi-Fi locks + a 20s reconnect grace.

---

## 3. The enterprise / Meta gold standard

- **Meta WhatsApp Business Calling API** (GA April 2026) over WebRTC: SDP offer/answer with call-control `connect / pre_accept / accept / reject / terminate`; **Opus mandatory** (G.711 for PSTN interop); **DTLS-SRTP**; at-least-once idempotent webhooks; per-contact **call-permission** (≈1/day, 2/week prod) auto-revoked after 4 missed calls or a 7-day negative-feedback pause.
- **Media reliability** — RFC 8445 (ICE) + RFC 7675 (consent freshness: 5s STUN keepalive / 30s expiry) + RFC 8656 (TURN): production coturn on **UDP/TCP 3478 AND TLS 5349/443** (443 traverses corporate DPI + carrier UDP blocks — **~85% of enterprise networks need a relay**), relay port range **49152–65535** open, **short-lived HMAC TURN-REST credentials**, `realm = FQDN`.
- **Recovery:** monitor **both** `iceConnectionState` and `connectionState`; treat `disconnected` as **transient** (auto-recover 5–25s), only `failed` as terminal; `restartIce()` on loss with a ~40s window before hangup.
- **Observability:** per-call **CDR** with `getStats()` polled every 100–200ms (MOS, RTT, jitter, loss, bytes each way, **candidate-pair type** host/srflx/relay, `dtlsState`); alert on stalls *before* a state change.
- **Architecture:** managed TURN/SFU tier with failover, **orphaned-call cleanup** (session timeout ~60s + state-sync cron), **monotonic** call state machine, explicit **recording-consent** gateway in regulated markets.

---

## 4. The 5–6s disconnect — root-cause analysis

> Verification note: the RFC 7675 "5–6s consent-freshness window" is the **explanatory mechanism** (it matches the symptom exactly); our code does not directly *instrument* consent-freshness, so the actionable root causes are the two confirmed code/infra defects below. This was downgraded to "partial" only on the point of direct instrumentation, not on the diagnosis.

Ranked causes (likelihood, evidence, fix):

1. **🔴 HIGH — No reachable TURN relay** (TURN STUN/UDP-only; no TLS-TURN:443). On CGNAT/UDP-blocking networks the browser gathers only host+srflx, media limps up on a fragile path, the NAT binding expires ~5–30s in, consent-freshness STUN fails at ~5–6s → drop.
   _Evidence:_ `app.config.ts:78-93` adds TURN only when `TURN_URLS` set; `docs/turn-tls-setup.md` calls TLS-on-443 the still-pending "definitive fix"; `probe-calls-health.ts:9-11` prints `TURN_URLS` as **NOT SET** by default and counts inbound calls ≤8s as a TURN-failure proxy.
   _Fix:_ deploy coturn TLS-TURN:443 per `docs/turn-tls-setup.md` (DNS A record + Let's Encrypt cert + `tls-listening-port=443` + open relay range 49152–65535 on **both** the VPS firewall and the cloud security group); set `TURN_URLS=turns:turn.tashfeengroup.com:443?transport=tcp,turn:168.144.100.20:3478`; verify a `type=relay` candidate appears from a real rep network.

2. **🔴 HIGH — Web client tears down on transient `disconnected`** (no grace, no `restartIce()`).
   _Evidence:_ `CallDock.tsx:328` (outbound) and `:441` (inbound): `else if (st === 'failed' || st === 'closed' || st === 'disconnected') teardown();`. No `oniceconnectionstatechange` listener; `restartIce()` never called. Mobile does it correctly (`call_controller.dart:417`, 20s grace + "Reconnecting…").
   _Fix:_ on `disconnected`, `setPhase('reconnecting')`, start a ~15–20s grace timer, call `pc.restartIce()` and renegotiate through `/answer`; teardown only on `failed`/`closed` or grace expiry. Mirror mobile.

3. **🟡 MEDIUM — Incomplete ICE set** because `waitForIce`'s 5s cap fires before the (slow) TURN relay candidate is gathered; the non-trickle SDP relayed to Meta then lacks the relay pair.
   _Evidence:_ `CallDock.tsx:31-47` resolves unconditionally after 5000ms regardless of relay presence; mobile (`call_controller.dart:445-475`) waits for a `typ relay` candidate + 800ms quiet before the backstop.
   _Fix:_ make web `waitForIce` relay-aware (resolve early on a `type=relay` candidate; extend the cap to 8–10s when TURN is configured; log whether a relay candidate made it into the SDP).

4. **🟢 LOW — Fire-and-forget answer relay, no retry.** A transient blip between the rep's accept and `respondToCall` reaching Meta loses the accept → Meta never gets the SDP answer → it tears the leg down.
   _Evidence:_ `calls.service.ts:77` awaits `respondToCall` once; `cloud-client.ts:418-423` throws with no retry/backoff.
   _Fix:_ bounded exponential-backoff retry (50/100/200ms) around accept+terminate; surface a real error to the dock on persistent failure.

5. **🟢 LOW — No backend auto-terminate when the rep's tab/socket drops** → customer leg lingers; rep perceives a drop with no clean teardown.
   _Evidence:_ `realtime.gateway.ts:139` `handleDisconnect` is a no-op; no orphaned-call sweep; no `RINGING`/`ANSWERED` TTL.
   _Fix:_ track call ownership per socket; on disconnect, terminate any `ANSWERED` call the rep owned (debounced); add an hourly orphaned-call sweep + `RINGING` TTL.

**Primary fix = #1 + #2 shipped together.**

---

## 5. Gap analysis (vs enterprise standard)

| ID | Area | Sev | Enterprise does | We do | Effort |
|----|------|-----|-----------------|-------|--------|
| **TURN-1** | Media / TURN relay | 🔴 critical | coturn UDP/TCP 3478 **+ TLS 5349/443**, relay range open; ~85% of nets need relay | TURN only if `TURN_URLS` set, historically 3478-only; TLS-443 documented, not deployed | M |
| **DISC-1** | Disconnect / teardown (web) | 🔴 critical | `disconnected` = transient; `restartIce()` + ~40s retry | `disconnected` bucketed with `failed`/`closed` → instant teardown; no `restartIce()` | M |
| **OBS-1** | Observability / CDR | 🟠 high | per-call `getStats()` CDR (MOS, RTT, jitter, loss, candidate-pair type, dtlsState) | no `getStats()` anywhere; only duration; ≤8s proxy | M |
| **REL-1** | Orphaned-call cleanup | 🟠 high | terminate leg on unclean disconnect; session TTL + state-sync cron; monotonic state | `handleDisconnect` no-op; no sweep; no `RINGING` TTL → zombie calls | M |
| **TURN-2** | TURN credentials | 🟠 high | short-lived HMAC TURN-REST creds, rotated, refresh on 401 | static `TURN_USERNAME/CREDENTIAL`, no rotation/expiry | M |
| **DISC-2** | Teardown (Meta relay) | 🟠 high | idempotent terminate w/ bounded retry/backoff | single-shot `respondToCall`, no retry | S |
| **INB-1** | Pre-accept / terminate reason | 🟡 med | `pre_accept` early media; parse terminate reason; ring latency | no `pre_accept` (silence pre-answer); reason not stored; no ring latency | M |
| **OUT-1** | Outbound authorization | 🟡 med | per-thread ACL + window/permission pre-flight | `/outbound` only `JwtAuthGuard` — any rep can dial any thread; no pre-check | S |
| **PERM-1** | Call-permission lifecycle | 🟡 med | enforced state w/ expiry sweeps + audit trail + rate guard | best-effort hints, optimistic, no sweep, no audit, no rate guard | M |
| **REC-1** | Recording — consent & capture | 🟡 med | consent gateway; server-side/independent archival | client-side mix, no consent, lost on crash, no server copy | L |
| **WEB-1** | Web audio verify & glare | 🟡 med | verify remote audio plays; glare guard; mic pre-check | hidden `<audio>` no error handlers; no glare guard; no mic pre-check | M |
| **MOB-1** | Mobile audio session / AEC | 🟡 med | VOICE_COMMUNICATION mode + focus; AEC/NS/AGC; Bluetooth routing | no explicit audio mode; no AEC/NS/AGC; speaker/earpiece only; fixed 20s timer | M |
| **MOB-2** | Mobile crash recovery / telemetry | 🟢 low | persist call context; Crashlytics per-OEM; transport fallback | no cold-start recovery; `debugPrint` only; no polling fallback | M |
| **REL-2** | Distributed phone lock | 🟢 low | Redis distributed lock for per-contact critical sections | in-memory `Map` per process — breaks on multi-instance scale-out | S |

_Verify also flagged: no hold-time limit to end stuck `RINGING` calls if both sides disconnect ungracefully — folded into REL-1._

---

## 6. What we already do well

- **Queue-first, idempotent webhook ingest** — HMAC-verified, NUL-stripped, persisted for forensics, deduped by `jobId=webhookEventId`. Exactly the enterprise at-least-once pattern.
- **Per-rep socket targeting** — rings only the assigned rep (per-employee room), not a broadcast — correct for confidential calls.
- **Robust inbound identity** — blocks contacted/blocked customers before any ring, serializes per-phone against duplicate-lead races, reuses the shared sticky→round-robin→after-hours engine.
- **Mobile already handles transient disconnects** (20s grace + "Reconnecting…") — the pattern the web client still needs.
- **Mobile VoIP robustness on budget Android** — `CallForegroundService` + `PARTIAL_WAKE_LOCK` + `WIFI_MODE_FULL_HIGH_PERF` defeat MTK/Transsion power-save kills; `singleTask` avoids the double-engine CallKit bug; re-entrancy latch prevents double-answer.
- **Sound TURN transport strategy where deployed** — `turn:` auto-expanded to udp+tcp, `turns:` pinned tcp; the definitive TLS-443 step is already documented.
- **Bidirectional calling fully built** — inbound + outbound with Meta's permission gate + FCM/CallKit background ringing on locked devices.
- **Recording + Whisper** decoupled from the call (never blocks teardown), admin playback gated to managers.
- **Audit coverage** on call mutations (`@Audit` HIGH on outbound/permission/recording; recording access logged as `SENSITIVE_READ`).
- **`answer()` idempotent** against double-accept (`ConflictException` if already `ANSWERED`/`ENDED`).
- **Missed-call auto-recovery** — unanswered inbound triggers an AI booking-callback within the 24h window (deduped hourly).

---

## 7. Prioritized roadmap

### Phase 1 — Stop the 5–6s drop (this week)
- **TURN-1** — deploy TLS-TURN:443 per `docs/turn-tls-setup.md`; set `TURN_URLS` with the `turns:443` entry; verify a `type=relay` candidate from a real rep network. _(infra/ops)_
- **DISC-1** — `CallDock.tsx`: `disconnected` → grace window (~15–20s) + `pc.restartIce()` + "reconnecting" UI; teardown only on `failed`/`closed` or grace expiry; add `oniceconnectionstatechange`. _(code)_
- **DISC-2** — bounded exponential-backoff retry around `respondToCall` accept+terminate. _(code)_

_Rationale: these three are the direct, compounding causes — a reachable relay gives a survivable path, transient-disconnect handling lets the consent-freshness blip recover, and the retry closes the accept-loss race._

### Phase 2 — See what's happening (1–2 weeks)
- **OBS-1** — `getStats()` polling (~200ms) → per-call CDR (candidate-pair type, RTT, jitter, loss, bytes, last ICE state, terminate cause) on the call row + in CallsConsole; alert on `relay=absent` / high loss.
- **REL-1** — socket-disconnect → terminate owned `ANSWERED` call (debounced) + hourly orphaned-call sweep + `RINGING` TTL.
- **INB-1** — parse/persist terminate reason; derive ring/answer latency from `RINGING→ANSWERED`.
- **MOB-2** — Crashlytics call-failure telemetry keyed by device/OEM.

### Phase 3 — Reliability & security hardening (this month)
- **TURN-2** — ephemeral HMAC TURN-REST creds with TTL + client refresh on 401.
- **OUT-1** — per-thread ACL on `/outbound` + window/permission pre-flight.
- **PERM-1** — permission expiry sweeper + audit-event trail + request-rate guard.
- **REL-2** — Redis distributed per-phone lock before any horizontal scale-out.

### Phase 4 — Quality & compliance polish
- **MOB-1** — VOICE_COMMUNICATION audio mode + focus + AEC/NS/AGC + Bluetooth routing + state-tied reconnect.
- **WEB-1** — remote-audio playback verification, mic pre-check, glare guard.
- **INB-1 (cont.)** — `pre_accept` early media so callers don't hear silence pre-answer.
- **REC-1** — recording-consent gateway + server-side/chunked recording so client crashes don't lose audio.

---

## 8. Verification summary

Adversarial pass over the top claims (read against the actual code): **6 of 8 confirmed**, **2 partial**:
- ✅ Confirmed: web instant-teardown on `disconnected` (`CallDock.tsx:328,441`); TURN TLS-443 not deployed (`docs/turn-tls-setup.md`, `app.config.ts:78-93`); blunt 5s ICE gather vs mobile's relay-aware (`call_controller.dart:445-475`); no `getStats()` anywhere; `handleDisconnect` no-op + no `RINGING` TTL (`realtime.gateway.ts:139`); static TURN creds; single-shot `respondToCall` no retry (`calls.service.ts:77`, `cloud-client.ts:418-423`).
- ⚠️ Partial: the "RFC 7675 5–6s" link is inferred from the symptom, not directly instrumented (the fix is unaffected); ICE-restart absence confirmed (it's simply never called).
- ➕ Missed-then-added: no hold-time limit for stuck `RINGING` calls (folded into REL-1).

_96 primary/secondary sources consulted (Meta calling docs, RFC 8445/7675/8656, coturn docs, BSP/Twilio engineering writeups)._
