# capture-service

Event-triggered NVR snapshot puller. Turns an image-less Hikvision alarm push
into a full-resolution face JPEG on the backend's already-working `/hik` ingest.

## Why it exists

The office NVR (Hikvision DS-7616NXI-K1, FW V4.73.110) **cannot send images**.
Its alarm-server integration is XML-only — there is no Capture linkage and no
image field anywhere in the `httpHosts` schema. So the "NVR pushes a face JPEG"
design that `/hik` was built for is not available on this hardware.

It can, however, do two things that together are enough:

1. POST an event alert **outbound** to any URL (no port forwarding, no VPN).
2. Serve a full-res JPEG **on demand** over ISAPI, if asked.

So we invert the flow:

```
NVR  --(1) XML alert, outbound------------>  capture-service (Railway)
     <-(2) ISAPI snapshot pull, 2-3 shots--
                                             (3) detect faces, keep the biggest
     tafai backend  <--(4) Hikvision-shaped multipart, /hik/<secret>
```

Idle bandwidth is ~zero. A person-pass costs ~100KB. Quality stays at
2560x1440, which matters more than anything else here: **face size determines
whether recognition works at all** (measured: 58px wide → 0.04 similarity,
227px → 0.844).

Compare: continuous RTSP is ~6 Mbps sustained over the office uplink; snapshot
polling is ~0.5 Mbps sustained and still misses people between polls.

Everything downstream of `/hik` — dedup, embedding, matching, direction mapping,
punch creation — is untouched. This service only replaces the frame *source*.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/hik/{secret}` | Where the NVR's alarm push lands. Verifies the secret, parses the alert, debounces, spawns a background capture. **Always returns 200** (403 only on a bad secret). |
| `GET` | `/api/status` | Service / backend / NVR health, effective config, counters, per-channel last-seen face size. |
| `GET` | `/api/events?limit=` | Last 100 decisions from this service's own ring buffer. |
| `GET` | `/api/snapshot?channel=41` | Proxies one live JPEG (console preview). |
| `GET` | `/health` | Railway healthcheck. Does **not** touch the NVR. |

`/api/events` rows look like:

```json
{ "ts": "2026-07-20T14:03:11+05:00", "channelId": 42, "direction": "OUT",
  "eventType": "Unkown", "facePx": 214, "action": "forwarded" }
```

`action` is one of `forwarded` | `too-small` | `no-face` | `pull-failed`.
**`facePx` is the number to look at first** when debugging — it separates a
camera-placement problem from a model or gallery problem.

## Environment

| Var | Required | Default | Notes |
|---|:-:|---|---|
| `NVR_HOST` | yes | — | `host:port` of the forwarded NVR port. |
| `NVR_USER` | | `admin` | |
| `NVR_PASS` | yes | — | HTTP **digest** auth. |
| `TAFAI_API` | yes | — | Backend base URL, no trailing slash. |
| `HIK_INGEST_SECRET` | yes | — | Must match the backend's value. Used both to authenticate the NVR's push to us and to address `/hik/<secret>` on the way out. |
| `CHANNEL_MAP` | | `{"41":{"direction":"IN"},"42":{"direction":"OUT"}}` | JSON. Keys are the NVR's own channel IDs (**+32 offset included**). Optional per-entry `stream` and `name`. |
| `CAPTURE_EVENT_TYPES` | | `face,unkown,unknown,vmd,motion` | Comma list, matched case-insensitively as substrings. |
| `MIN_FACE_PX` | | `100` | Minimum face width to forward. |
| `DEBOUNCE_SEC` | | `6` | Per channel. |
| `SNAPSHOT_BURST` | | `3` | Frames per event. |
| `SNAPSHOT_GAP_MS` | | `350` | Spacing within the burst. |
| `FACE_DET_SIZE` | | `640` | SCRFD detector input. |
| `EVENT_RING_SIZE` | | `100` | In-memory event buffer. |
| `PORT` | | `8000` | Injected by Railway. |

Missing `NVR_HOST`, `NVR_PASS`, `TAFAI_API` or `HIK_INGEST_SECRET` is **fatal at
startup**, with the reason printed. A service that can't reach the NVR or can't
address the backend should never serve a green healthcheck while silently
dropping every event.

Nothing secret ever appears in a response body — `/api/status` reports the NVR
host only, never the user, password, or ingest secret.

## The three things that will bite you

**The +32 channel offset.** Hikvision NVRs number IP channels from 33. The
camera the UI calls "D9" reports `channelID 41` in its event XML; "D10" reports
`42`. They are *never* 9 and 10 in the payload. ISAPI snapshots want the
physical channel instead: `(ch - 32) * 100 + 1`, so 41 → `901` and 42 → `1001`.

**`Unkown` is a face-capture event.** That is Hikvision's own typo, on the wire,
in this firmware. Face capture events are labelled `Unkown`; motion is `VMD`.
Both are in the default `CAPTURE_EVENT_TYPES`. Do not "fix" the spelling.

**The min-face gate is load-bearing.** Below ~100px the embedding is noise. One
camera also has a marketing banner with a printed face in view that detects at a
constant ~57px — without the gate, that banner would punch in every few seconds
forever.

## Running locally

```bash
cd apps/capture-service
python -m venv .venv && .venv/Scripts/activate      # Windows
pip install -r requirements.txt

export NVR_HOST=192.168.18.16
export NVR_USER=admin
export NVR_PASS=...
export TAFAI_API=http://localhost:3001
export HIK_INGEST_SECRET=devsecret123

python main.py          # or: uvicorn main:app --host 0.0.0.0 --port 8000
```

InsightFace takes ~15s to load at startup; it is loaded **once**, not per
request. On first run it also downloads the `buffalo_l` pack.

Check it came up:

```bash
curl localhost:8000/health
curl localhost:8000/api/status | jq
curl -o test.jpg "localhost:8000/api/snapshot?channel=41"
```

Simulate an NVR alert without an NVR (this still tries a real snapshot pull, so
point `NVR_HOST` at a reachable NVR or expect `pull-failed`):

```bash
curl -X POST localhost:8000/hik/devsecret123 \
  -H 'Content-Type: application/xml' \
  --data '<EventNotificationAlert>
            <channelID>42</channelID>
            <dateTime>2026-07-20T14:03:11+05:00</dateTime>
            <eventType>Unkown</eventType>
            <uuid>test-1</uuid>
          </EventNotificationAlert>'

curl localhost:8000/api/events | jq
```

Note the debounce: a second identical POST within `DEBOUNCE_SEC` is accepted
with a 200 and deliberately does nothing.

## Deploying

Build context is `apps/capture-service` (set the Railway service root
directory here), same as `apps/face-worker`. Point the NVR's alarm server at
`https://<service>.up.railway.app/hik/<HIK_INGEST_SECRET>` and expose the NVR's
HTTP port so Railway can pull snapshots back.

> A `Dockerfile` and `railway.json` are **not yet written** for this service —
> model the Dockerfile on `apps/face-worker/Dockerfile` (it already installs the
> opencv/onnxruntime system libs and bakes the `buffalo_l` pack into the image
> so there is no runtime download). The `CMD` differs only in the module path:
> `uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1`. Keep
> `--workers 1`: a second worker would double the model's memory and give each
> copy its own debounce state, so a burst would forward twice.
