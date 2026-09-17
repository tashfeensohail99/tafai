# capture-service — Railway deploy runbook

Event-triggered face capture. The NVR pushes an XML alert outbound to this
service; this service pulls full-res JPEGs back from the NVR over ISAPI, detects
faces locally, and forwards the best one to the tafai backend as a
Hikvision-shaped multipart POST — the already-working `/hik/<secret>` ingest path.

```
NVR (192.168.18.16, office LAN)
  │  1. event XML  ── outbound POST ──▶  capture-service (Railway)
  │                                        │
  │  ◀── 2. ISAPI snapshot pull (digest) ──┘   GET /ISAPI/Streaming/channels/{901,1001}/picture
  │                                        │
  │                                        │  3. InsightFace detect, keep biggest face
  │                                        ▼
  │                       4. multipart POST ▶ tafai backend /hik/<secret>
```

Step 2 is the reason the router needs a port forward: it is an **inbound**
connection to the NVR, and it is the only inbound connection in the whole design.

---

## 0. Prerequisite — change the NVR password before it is exposed

The NVR's current password is weak and is about to be reachable from the public
internet. **Change it first.** Internet-facing Hikvision devices are
continuously credential-stuffed by automated botnets; the well-known default and
weak admin passwords are in every scanner's wordlist. Use a long random password,
set it on the NVR, and put that value into `NVR_PASS` on Railway.

This is a blocker, not a recommendation. Do not open the port forward first and
change the password later.

---

## 1. Railway service setup

Create a new service in the existing tafai Railway project:

- **Root directory:** `apps/capture-service`
- **Builder:** Dockerfile (picked up automatically from `railway.json`)

Build takes roughly 5–10 minutes; most of it is `pip install` of onnxruntime +
opencv and the `bake_models.py` step that downloads the buffalo_l pack into the
image. Baking at build time is deliberate — a cold start that had to download
~300MB before it could detect anything would miss the person who triggered the
event.

**Memory:** buffalo_l on CPU sits around 0.5–1 GB RSS. Give the service **at
least 1 GB**, same as face-worker. Below that it will OOM during detection, and
the symptom looks like random restarts rather than an obvious memory error.

### Environment variables

Names below are read directly by `main.py` — they are exact, not illustrative.

| var | example | secret? | meaning |
|---|---|:--:|---|
| `NVR_HOST` | `203.0.113.45:47821` | no | **`host:port`** of the NVR as seen from the internet — the public IP (or DDNS name) plus the external port you forward in step 3. Not the LAN address. |
| `NVR_USER` | `admin` | no | NVR digest-auth user. Defaults to `admin`. |
| `NVR_PASS` | `<the new password>` | **YES** | NVR digest-auth password, post step 0. |
| `TAFAI_API` | `https://tafai-backend-production.up.railway.app` | no | Base URL of the tafai backend. No trailing slash (one is stripped anyway). |
| `HIK_INGEST_SECRET` | `<same value as the backend>` | **YES** | Used **in both directions**: it is the path segment this service forwards to (`{TAFAI_API}/hik/<secret>`) *and* the secret the NVR must use when pushing to *this* service (`/hik/<secret>`). It must equal the backend's `HIK_INGEST_SECRET` or forwarding 403s. |
| `CHANNEL_MAP` | `{"41":{"direction":"IN","name":"entry"},"42":{"direction":"OUT","name":"exit"}}` | no | Keys are the NVR's **own** channel IDs including the +32 offset. See the offset note below. |
| `MIN_FACE_PX` | `100` | no | Faces narrower than this are dropped. Load-bearing — see §6. |
| `DEBOUNCE_SEC` | `6` | no | Minimum seconds between snapshot pulls per channel. |
| `SNAPSHOT_BURST` | `3` | no | Snapshots pulled per event; the best face across the burst wins. |
| `SNAPSHOT_GAP_MS` | `350` | no | Gap between the burst's snapshots. |
| `CAPTURE_EVENT_TYPES` | `face,unkown,unknown,vmd,motion` | no | Substring, case-insensitive match against the event's `<eventType>`. Default already covers the known values. |
| `FACE_DET_SIZE` | `640` | no | SCRFD detector input size. Baked default. |
| `EVENT_RING_SIZE` | `100` | no | How many recent decisions `/api/events` keeps in memory. |
| `PORT` | `8000` | no | Railway injects this. **Set it explicitly to `8000` if you use the TCP proxy in §5** — the proxy needs a fixed target port. |

The service **refuses to start** if `NVR_HOST`, `TAFAI_API`, `HIK_INGEST_SECRET`,
`NVR_PASS` or `CHANNEL_MAP` are missing. That is intentional: a green healthcheck
on a service that silently drops every event is a worse failure than a crash.
Check the deploy logs for `FATAL: missing/invalid configuration`.

### The +32 channel offset

Hikvision numbers IP channels starting at 33. The camera the NVR's UI calls
**D9** reports `<channelID>41</channelID>` in its event XML, and **D10** reports
`42`. They are never 9 and 10 in the event payload. ISAPI snapshots want the
*physical* channel as `<channel><stream>`, so the service strips the 32 and maps
`41 → 901` (entry, IN) and `42 → 1001` (exit, OUT).

`CHANNEL_MAP` keys must therefore be **41 and 42**, not 9 and 10. Getting this
wrong is the single most common failure here, and it is silent: unmapped channels
are dropped without a log line (deliberately — every camera on the NVR posts to
this endpoint, and logging them all would flush the event ring).

---

## 2. Verify the ISP is not doing CGNAT — do this before touching the router

If the ISP puts the connection behind Carrier-Grade NAT, **port forwarding cannot
work at all**, no matter how the router is configured. Check before spending time
on router config.

1. In the router's admin UI, find the **WAN IP address** (often under Status,
   WAN, or Internet).
2. From any device on that same network, open `https://ifconfig.me` (or
   `https://whatismyip.com`) to get the **public IP**.
3. Compare:

| WAN IP shows | verdict |
|---|---|
| Same as the public IP | Good — port forwarding will work. |
| `100.64.x.x` – `100.127.x.x` | **CGNAT.** Port forwarding cannot work. |
| `10.x.x.x`, `172.16–31.x.x`, `192.168.x.x` | Double NAT or CGNAT — either another router is upstream, or the ISP is NATing. Port forwarding cannot work from here. |
| Any other public address, but different from step 2 | Something upstream is NATing. Treat as CGNAT. |

**If it is CGNAT**, the options, roughly in order of preference:

- **Ask the ISP for a public/static IP.** In Pakistan (PTCL, Nayatel, StormFiber,
  Transworld) this is normally available as a small monthly add-on on business
  plans. This is the cleanest fix and keeps the architecture exactly as designed.
- **Run an outbound tunnel** (Cloudflare Tunnel, Tailscale, ngrok) from an
  always-on machine on the office LAN, exposing `192.168.18.16:80`. This needs no
  inbound port and defeats CGNAT.
  Be honest about the tradeoff: **this requires a machine sitting in the office
  running 24/7.** If such a machine has to exist anyway, running the existing
  local bridge (`apps/backend/scripts/bridge_server.py`) on it is simpler than
  Railway + tunnel + port forward, because it removes the WAN round-trip from the
  capture path entirely. The Railway design's whole advantage is that it needs no
  on-site machine; a tunnel gives that advantage back.
- **Mobile/LTE backup links are almost always CGNAT** and will not work.

---

## 3. Router port forward

Forward one external port to the NVR:

| field | value |
|---|---|
| External / WAN port | **`47821`** (see below — pick any high port, not 80) |
| Internal / LAN IP | `192.168.18.16` |
| Internal / LAN port | `80` |
| Protocol | TCP |

Then set `NVR_HOST` on Railway to `<public-ip>:47821`.

**Use a high, non-standard external port — not 80, not 8080.** Opportunistic
scanners sweep the entire IPv4 space against 80, 443, 8000, 8080 and the known
Hikvision ports continuously; anything answering on those gets found and probed
within hours. A random high port does not make the device secure — a determined
scan of all 65535 ports still finds it — but it removes essentially all of the
drive-by automated traffic, which is the overwhelming majority of what hits an
exposed device. It is noise reduction, and it is worth doing, but it is not a
substitute for step 0.

**Also give the NVR a static LAN address.** If `192.168.18.16` is a DHCP lease,
the NVR will eventually get a different address and the forward will point at
nothing. Set a DHCP reservation or configure the address statically on the NVR.

If the router supports it, additionally restrict the forward to Railway's egress
addresses. Railway does not publish a stable static egress IP range on standard
plans, so in practice this usually is not possible — do not block on it.

---

## 4. Point the NVR's alarm server at the capture service

On the NVR: **Configuration → Network → Advanced Settings → Alarm Server**
(exact path varies by firmware; on V4.73.110 it is under the HTTP alarm/listening
host settings), then enable the face-capture and/or motion events to be sent to it
under **Event → Linkage Method → Notify Surveillance Center**.

Destination: `/hik/<HIK_INGEST_SECRET>` on the capture service.

### Read this before configuring the URL — Railway converts HTTP POST to GET

This is documented Railway edge behaviour, and it breaks the naive setup:

> Plain HTTP GET requests to port 80 are redirected to HTTPS.
> **Plain HTTP POST requests to port 80 are redirected to HTTPS as GET requests.**
> — Railway, *Public Networking → Specs & Limits*

So if the NVR pushes plain **HTTP** to `capture-service.up.railway.app`, the POST
arrives at the service as a **GET with no body**. The event XML is gone. The
symptom is `/api/events` showing `pull-failed` with note
`no EventNotificationAlert in body`, or nothing at all.

There are two ways through, and which one you need depends on whether this
firmware's alarm client can do TLS:

**Option A — HTTPS, if the firmware supports it.** Point the alarm server at the
`https://` Railway domain, port 443. Cleanest if it works.

*Unverified:* I have not confirmed that DS-7616NXI-K1 V4.73.110's alarm-server
client can do HTTPS, or that it can validate a Let's Encrypt chain. Hikvision
alarm-server clients on firmware of this generation are frequently HTTP-only.
Try this first, but expect it to fail.

**Option B — Railway TCP Proxy (the reliable fallback).** A TCP proxy gives you a
raw `host:port` (e.g. `shuttle.proxy.rlwy.net:15140`) that is **not** TLS-terminated
by Railway's HTTP edge, so a plain HTTP POST passes through untouched.

1. Service → Settings → Networking → **TCP Proxy**, target port `8000`.
2. Set `PORT=8000` explicitly on the service so the app binds the port the proxy
   targets.
3. Configure the NVR alarm server with the proxy host and port, protocol HTTP,
   path `/hik/<secret>`.

Railway supports an HTTP domain and a TCP proxy on the same service, so you keep
the `https://` domain for the console/API and use the TCP proxy purely for the
NVR push.

*Unverified:* I have not tested a Hikvision alarm push through a Railway TCP
proxy. The mechanism is sound — raw TCP passthrough to the container port — but
confirm it on the day with §5 before declaring the deploy done.

Whichever option you use, the path must carry the secret:
`/hik/<HIK_INGEST_SECRET>`. A wrong secret returns 403; everything else returns
200 by design, because Hikvision treats any non-2xx as a delivery failure and
retries aggressively enough to bury both this service and the NVR's own event queue.

---

## 5. Confirm it works, end to end

Work outward. Each step isolates one link in the chain, so the first one that
fails tells you where the problem is.

**5.1 — Service is alive and configured**

```bash
curl https://<capture-service>.up.railway.app/health
```

**5.2 — Railway can reach the NVR (proves the port forward + CGNAT check)**

```bash
curl -s https://<capture-service>.up.railway.app/api/status | jq '.nvr, .backend, .config.detectorReady'
```

Want `nvr.reachable: true`, `backend.up: true`, `detectorReady: true`.

- `nvr.reachable: false` → port forward, CGNAT, NVR LAN IP changed, or wrong
  `NVR_PASS`. Retry §2 and §3.
- `detectorReady: false` → read `config.detectorError`. The service deliberately
  stays up with a broken detector so you can see the reason rather than watching
  a crash loop.

**5.3 — Snapshot pull works (proves digest auth + channel mapping)**

```bash
curl -o entry.jpg "https://<capture-service>.up.railway.app/api/snapshot?channel=41"
curl -o exit.jpg  "https://<capture-service>.up.railway.app/api/snapshot?channel=42"
```

Use the **event** channel IDs `41` and `42`. A 404 listing the known channels
means `CHANNEL_MAP` is wrong (probably 9/10 instead of 41/42). A 503 means the
NVR did not answer — channel offline or the NVR is unreachable.

Open the JPEGs. They should be 2560x1440, roughly 32KB.

**5.4 — The NVR actually reaches us**

Walk past the entry camera, then:

```bash
curl -s https://<capture-service>.up.railway.app/api/events | jq '.[0:5]'
```

If this stays empty, the NVR is not delivering. In order of likelihood: the
HTTP-POST-to-GET problem from §4; "Notify Surveillance Center" not ticked on the
event; wrong path/secret (a 403 would not appear here at all).

**5.5 — Punches land in tafai**

An event with `"action": "forwarded"` means we posted to the backend. Confirm the
other end via the backend's `/attendance/face/events`, which is where matching,
similarity and punch creation actually happen. This service does **not** know
whether a punch was created — it only knows whether it forwarded a face.

---

## 6. Reading `facePx` — diagnosing "detected but never matches"

`/api/events` returns newest-first rows of **this service's own decisions**:

```json
{
  "ts": "2026-07-20T14:03:11+05:00",
  "channelId": 41,
  "direction": "IN",
  "eventType": "Unkown",
  "facePx": 227,
  "action": "forwarded",
  "note": null
}
```

`facePx` is the **width in pixels of the biggest face** found in the snapshot.
It is the number that decides whether recognition can work at all.

| `action` | meaning | what to do |
|---|---|---|
| `forwarded` | Face passed the gate and was posted to the backend. | If no punch appears, the problem is downstream — enrollment or the similarity threshold, not capture. |
| `too-small` | A face was found but `facePx < MIN_FACE_PX`. | See below. |
| `no-face` | Snapshots pulled, no face detected. | Camera angle, lighting, or the person was past the frame by the time the burst fired. Try raising `SNAPSHOT_BURST`. |
| `pull-failed` | Could not get a usable snapshot, or could not forward. Read `note`. | Usually NVR unreachable, or the §4 body problem (`no EventNotificationAlert in body`). |

**Measured on this hardware:** a 58px face scored 0.04 similarity — effectively
noise. A 227px face scored 0.844 — a confident match. Face size is the dominant
variable; below roughly 100px, matching does not work regardless of how good the
lighting is. That is why `MIN_FACE_PX` defaults to 100 and why forwarding smaller
faces is not a kindness — it just fills the backend with unmatchable events.

**The "detected but never matches" pattern:** events show `forwarded` with
`facePx` in the 100–130 range and the backend reports low similarity. The face is
passing the gate but is still too small to match reliably. Fix the camera, not
the threshold — move it closer to the door, or narrow its field of view. Lowering
`MIN_FACE_PX` makes the log look busier and changes nothing about whether people
get recognised.

**The banner trap:** one camera has a marketing banner in view that yields a
constant ~57px face. With `MIN_FACE_PX` set below about 60, that banner triggers
a forward on every single event, burns the debounce window, and crowds real
people out of the event ring. If you see a steady stream of `forwarded` events at
a suspiciously constant `facePx` with nobody in the office, that is what you are
looking at. Keep the gate at 100.

---

## Known gaps

- **`console.html` is not served.** The file is in the image, but `main.py`
  registers no route for it — the routes are `/health`, `/api/status`,
  `/api/events`, `/api/snapshot` and `/hik/{secret}`. The operator console is
  therefore not reachable on the deployed service. Either add a route or drop the
  file; right now it is dead weight.
- **`/api/status`, `/api/events` and `/api/snapshot` are unauthenticated.** On a
  public Railway domain that means anyone with the URL can pull a live JPEG from
  the office camera. `/api/status` deliberately leaks no credentials (host only,
  never user/password/secret), but `/api/snapshot` is a live image feed. Put an
  API key on these before this is considered production-ready.
- **Single uvicorn worker.** Deliberate — one buffalo_l instance, bounded memory.
  Detection runs in a 2-thread executor with a 2-permit semaphore on NVR pulls, so
  two doors are fine. More cameras would need rethinking, not just more workers.
- Whether this firmware can do HTTPS (§4 Option A) and whether a Hikvision alarm
  push traverses a Railway TCP proxy (§4 Option B) are both **untested**. The
  HTTP-POST-to-GET behaviour itself is documented and certain; the workarounds are
  not yet proven on this hardware.
