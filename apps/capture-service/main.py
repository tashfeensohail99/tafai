"""intag/tafai capture-service — event-triggered NVR snapshot puller.

WHY THIS SERVICE EXISTS
-----------------------
The office NVR (Hikvision DS-7616NXI-K1, FW V4.73.110) cannot push images. Its
alarm-server integration is XML-only: there is no Capture linkage and no image
field anywhere in the httpHosts schema, so the "push a face JPEG to a URL" path
that the backend's /hik ingest was built for simply does not exist on this box.

But the NVR can do two things, and together they are enough:

  (a) POST an event alert OUTBOUND to an arbitrary URL. Outbound means no port
      forwarding, no inbound firewall hole, no VPN.
  (b) Serve a full-resolution JPEG on demand over ISAPI, if you ask it.

So: the NVR tells us "something happened on channel 42", and we immediately
reach back and pull the actual picture. That inverts the data flow but keeps the
image quality — 2560x1440, ~32KB per JPEG.

Why not the obvious alternatives:
  * Continuous RTSP over the office WAN link is ~6 Mbps sustained, forever.
  * Snapshot polling is ~0.5 Mbps sustained, forever, and still misses people
    between polls.
  * Event-triggered pull is ~0 bytes when nobody is there and ~100KB per
    person-pass. It is also higher quality than either, because we pull the
    full-res still rather than decoding a compressed video frame.

Everything downstream of us — dedup, embedding, matching, direction mapping,
punch creation — is the already-proven /hik path in the NestJS backend. We do
not change it. We only replace the frame SOURCE, and we hand the backend a
Hikvision-shaped multipart identical to what a capable NVR would have sent.
(See apps/backend/scripts/rtsp_bridge.py: build_multipart() here is the same
envelope, deliberately.)
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import sys
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple

import httpx
from fastapi import FastAPI, Query, Request
from fastapi.responses import JSONResponse, Response

PKT = timezone(timedelta(hours=5))


# ─────────────────────────────────────────────────────────────────────────────
# Config — strictly from env. No secrets in source, no secrets in any response.
# ─────────────────────────────────────────────────────────────────────────────
def _int_env(name: str, default: int) -> int:
    raw = os.getenv(name, "")
    try:
        return int(raw) if raw.strip() else default
    except ValueError:
        print(f"[capture] {name}={raw!r} is not an integer, using {default}", flush=True)
        return default


NVR_HOST = os.getenv("NVR_HOST", "").strip()          # "host:port" — port-forwarded
NVR_USER = os.getenv("NVR_USER", "admin").strip()
NVR_PASS = os.getenv("NVR_PASS", "")
TAFAI_API = os.getenv("TAFAI_API", "").strip().rstrip("/")
HIK_INGEST_SECRET = os.getenv("HIK_INGEST_SECRET", "")

MIN_FACE_PX = _int_env("MIN_FACE_PX", 100)
DEBOUNCE_SEC = float(os.getenv("DEBOUNCE_SEC", "6") or 6)
SNAPSHOT_BURST = max(1, _int_env("SNAPSHOT_BURST", 3))
SNAPSHOT_GAP_MS = max(0, _int_env("SNAPSHOT_GAP_MS", 350))

# ISAPI /picture serves the LOW-RES sub-stream (measured: 704x576 on this
# firmware) unless you ask for a resolution — regardless of what the channel
# actually records (2560x1440 here). At 704x576 a face in the doorway lands
# ~45px and is rejected by MIN_FACE_PX, which is why every pull was logged
# "too-small" and nothing ever reached the backend. Asking explicitly returns
# the full frame (measured: 1920x1088) — ~2.7x wider, so that same doorway face
# is ~120px and clears the gate. Set either to 0 to fall back to the old
# (sub-stream) behaviour.
SNAPSHOT_WIDTH = _int_env("SNAPSHOT_WIDTH", 2560)
SNAPSHOT_HEIGHT = _int_env("SNAPSHOT_HEIGHT", 1440)
PORT = _int_env("PORT", 8000)
DET_SIZE = _int_env("FACE_DET_SIZE", 640)
RING_SIZE = max(10, _int_env("EVENT_RING_SIZE", 100))

# Hikvision labels FACE CAPTURE events "Unkown" — that is Hikvision's own typo,
# not ours, and it is what this firmware actually emits (verified on the wire).
# Motion is "VMD". Both are worth a snapshot, so both are in the default list.
# Matching is substring + case-insensitive so "faceCapture", "VMD", "Unkown" and
# any firmware variant all land. Do not "fix" the spelling — the NVR won't.
_DEFAULT_EVENT_TYPES = "face,unkown,unknown,vmd,motion"
CAPTURE_EVENT_TYPES = [
    t.strip().lower()
    for t in os.getenv("CAPTURE_EVENT_TYPES", _DEFAULT_EVENT_TYPES).split(",")
    if t.strip()
]


def _load_channel_map() -> Dict[int, Dict[str, Any]]:
    """CHANNEL_MAP: {"41": {"direction": "IN"}, "42": {"direction": "OUT"}}

    The keys are the NVR's OWN channel IDs, +32-offset included (see
    _stream_for_channel). An entry may also carry "stream" to override the
    derived ISAPI stream id, and "name" for logging.
    """
    raw = os.getenv("CHANNEL_MAP", "").strip()
    if not raw:
        raw = '{"41":{"direction":"IN"},"42":{"direction":"OUT"}}'
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise RuntimeError(f"CHANNEL_MAP is not valid JSON: {e}") from e
    out: Dict[int, Dict[str, Any]] = {}
    for key, val in parsed.items():
        try:
            ch = int(key)
        except (TypeError, ValueError) as e:
            raise RuntimeError(f"CHANNEL_MAP key {key!r} is not a channel number") from e
        if not isinstance(val, dict):
            raise RuntimeError(f"CHANNEL_MAP[{key}] must be an object")
        out[ch] = {
            "direction": str(val.get("direction", "IN")).upper(),
            "stream": int(val["stream"]) if val.get("stream") is not None else None,
            "name": val.get("name") or f"ch{ch}",
        }
    return out


CHANNEL_MAP: Dict[int, Dict[str, Any]] = _load_channel_map()


def _stream_for_channel(ch: int) -> int:
    """Map an event channelID to the ISAPI streaming channel id.

    THE +32 OFFSET IS THE SINGLE MOST COMMON WAY TO GET THIS WRONG.

    Hikvision NVRs number IP (network) channels starting at 33, so the camera
    the UI calls "D9" reports channelID 41 in its event XML, and "D10" reports
    42. They are NEVER 9 and 10 in the event payload.

    ISAPI snapshots, meanwhile, want the *physical* channel in the form
    <channel><stream> — channel 9 main stream = 901, channel 10 main = 1001.

    So: strip the +32 to get the physical channel, then *100+1 for main stream.
        41 -> (41-32)*100+1 = 901   (entry, IN)
        42 -> (42-32)*100+1 = 1001  (exit, OUT)
    """
    cfg = CHANNEL_MAP.get(ch) or {}
    if cfg.get("stream"):
        return int(cfg["stream"])
    return (ch - 32) * 100 + 1


# ─────────────────────────────────────────────────────────────────────────────
# In-memory state. Bounded — this process runs for weeks without a restart.
# ─────────────────────────────────────────────────────────────────────────────
EVENTS: Deque[Dict[str, Any]] = deque(maxlen=RING_SIZE)
STATS = {"events": 0, "pulls": 0, "forwarded": 0, "rejected": 0}
_last_pull_at: Dict[int, float] = {}      # channelID -> monotonic ts (debounce)
_channel_state: Dict[int, Dict[str, Any]] = {}
_inflight: set = set()                    # strong refs so tasks aren't GC'd mid-flight

# InsightFace is CPU-bound and holds the GIL only partially; running it inline
# would stall the event loop for hundreds of ms per frame while other events are
# arriving. Two workers is enough for two doors and keeps memory bounded.
EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="detect")
# Hard ceiling on concurrent NVR pulls. The NVR is a small appliance across a
# consumer uplink; hammering it with parallel ISAPI requests makes it drop them.
PULL_SEM = asyncio.Semaphore(2)

_detector = None                          # insightface FaceAnalysis, loaded once
_detector_error: Optional[str] = None
_nvr_probe: Dict[str, Any] = {"at": 0.0, "reachable": False}

_http: Optional[httpx.AsyncClient] = None


def _record(channel_id: int, event_type: str, face_px: Optional[int], action: str,
            note: Optional[str] = None) -> None:
    row = {
        "ts": datetime.now(PKT).isoformat(),
        "channelId": channel_id,
        "direction": (CHANNEL_MAP.get(channel_id) or {}).get("direction"),
        "eventType": event_type,
        "facePx": face_px,
        "action": action,
    }
    if note:
        row["note"] = note
    EVENTS.append(row)
    st = _channel_state.setdefault(channel_id, {})
    st["lastAction"] = action
    st["lastAt"] = row["ts"]
    if face_px is not None:
        st["lastFacePx"] = face_px
    if action == "forwarded":
        st["lastForwardedAt"] = row["ts"]
    # The face pixel width is the single most useful diagnostic in this whole
    # system: 58px measured 0.04 similarity, 227px measured 0.844. If matching
    # is failing, this number tells you whether it is a camera-placement problem
    # or a model/gallery problem. Always log it.
    print(
        f"[capture] ch{channel_id} ({row['direction']}) {event_type!r} "
        f"face={face_px if face_px is not None else '-'}px -> {action}"
        + (f" ({note})" if note else ""),
        flush=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Event XML parsing
# ─────────────────────────────────────────────────────────────────────────────
# Regex rather than ElementTree on purpose: the alert XML carries a default
# namespace (http://www.hikvision.com/ver20/XMLSchema) that some firmwares emit,
# some omit, and at least one emits with a stray BOM. Tag-name regexes are
# immune to all of that, and we only need four scalar fields.
def _tag(xml: str, name: str) -> Optional[str]:
    m = re.search(rf"<(?:\w+:)?{name}[^>]*>(.*?)</(?:\w+:)?{name}>", xml,
                  re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else None


def _parse_alert(xml: str) -> Dict[str, Any]:
    ch_raw = _tag(xml, "channelID") or _tag(xml, "dynChannelID")
    try:
        channel_id = int(ch_raw) if ch_raw is not None else None
    except ValueError:
        channel_id = None
    return {
        "channelId": channel_id,
        "eventType": _tag(xml, "eventType") or "",
        "dateTime": _tag(xml, "dateTime") or "",
        "uuid": _tag(xml, "uuid") or "",
    }


def _event_type_wanted(event_type: str) -> bool:
    et = (event_type or "").strip().lower()
    if not et:
        return False
    return any(tok in et for tok in CAPTURE_EVENT_TYPES)


_DT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


def _normalize_datetime(raw: str) -> str:
    """Pass the NVR's own capture time through when it is well-formed.

    It is the real moment the person was at the door; our clock is a Railway
    container's. If it is missing or malformed we fall back to now, because the
    backend parses this field and a garbage value would drop the whole event.
    """
    raw = (raw or "").strip()
    if _DT_RE.match(raw):
        return raw
    return datetime.now(PKT).strftime("%Y-%m-%dT%H:%M:%S+05:00")


# ─────────────────────────────────────────────────────────────────────────────
# Hikvision-shaped multipart — the envelope the backend's /hik already parses.
# Shape copied from apps/backend/scripts/rtsp_bridge.py: an XML part named
# "Event_Type" (application/xml) and a JPEG part named "Picture" (image/jpeg,
# NO filename attribute — Hikvision omits it and the Nest parser keys on that).
# ─────────────────────────────────────────────────────────────────────────────
def build_multipart(jpeg: bytes, channel: int, when: str,
                    event_uuid: str) -> Tuple[bytes, str]:
    alert = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<EventNotificationAlert version="2.0" '
        'xmlns="http://www.hikvision.com/ver20/XMLSchema">\n'
        f"  <channelID>{channel}</channelID>\n"
        f"  <dateTime>{when}</dateTime>\n"
        "  <activePostCount>1</activePostCount>\n"
        # Always "faceCapture" regardless of what tripped the alert. Downstream
        # is proven against this exact value, and the trigger (motion vs the
        # "Unkown" face event) is irrelevant once we have confirmed a face
        # ourselves — we only forward frames that passed the detector.
        "  <eventType>faceCapture</eventType>\n"
        "  <eventState>active</eventState>\n"
        "  <eventDescription>Face Capture</eventDescription>\n"
        f"  <uuid>{event_uuid}</uuid>\n"
        "</EventNotificationAlert>"
    ).encode()

    b = "----HikvisionBoundary" + uuid.uuid4().hex[:12]
    CRLF = b"\r\n"
    body = b"".join([
        f"--{b}\r\n".encode(),
        b'Content-Disposition: form-data; name="Event_Type"\r\n',
        b"Content-Type: application/xml\r\n\r\n",
        alert,
        CRLF + f"--{b}\r\n".encode(),
        b'Content-Disposition: form-data; name="Picture"\r\n',
        b"Content-Type: image/jpeg\r\n\r\n",
        jpeg,
        CRLF + f"--{b}--\r\n".encode(),
    ])
    return body, f"multipart/form-data; boundary={b}"


# ─────────────────────────────────────────────────────────────────────────────
# Detection — loaded ONCE at startup (~15s), never per request.
# ─────────────────────────────────────────────────────────────────────────────
def _load_detector():
    global _detector, _detector_error
    from insightface.app import FaceAnalysis

    app = FaceAnalysis(
        name="buffalo_l",
        root=os.getenv("INSIGHTFACE_ROOT", os.path.expanduser("~/.insightface")),
        # Detection only. The backend's face-worker owns embedding; we just need
        # to answer "is there a big enough face in this JPEG".
        allowed_modules=["detection"],
        providers=["CPUExecutionProvider"],
    )
    app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))  # ctx_id<0 = CPU
    _detector = app
    _detector_error = None
    return app


def _biggest_face_px(jpeg: bytes) -> Optional[int]:
    """Width in px of the largest face in this JPEG, or None if there is none.

    Runs in the thread pool — never call from the event loop directly.
    """
    if _detector is None:
        return None
    import cv2
    import numpy as np

    arr = np.frombuffer(jpeg, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)   # -> BGR, or None on garbage
    if img is None:
        return None
    faces = _detector.get(img)
    if not faces:
        return None
    big = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]))
    return int(big.bbox[2] - big.bbox[0])


# ─────────────────────────────────────────────────────────────────────────────
# NVR access
# ─────────────────────────────────────────────────────────────────────────────
def _nvr_auth() -> httpx.DigestAuth:
    # This firmware is configured for HTTP DIGEST, not Basic. Sending Basic gets
    # a 401 with a WWW-Authenticate: Digest challenge and nothing else.
    return httpx.DigestAuth(NVR_USER, NVR_PASS)


async def _fetch_snapshot(stream: int) -> Optional[bytes]:
    """One full-res JPEG from the NVR, or None. Never raises.

    The resolution query params are what make this actually full-res — without
    them the NVR returns its low-res sub-stream frame (see SNAPSHOT_WIDTH).
    """
    assert _http is not None
    url = f"http://{NVR_HOST}/ISAPI/Streaming/channels/{stream}/picture"
    if SNAPSHOT_WIDTH > 0 and SNAPSHOT_HEIGHT > 0:
        url += (f"?videoResolutionWidth={SNAPSHOT_WIDTH}"
                f"&videoResolutionHeight={SNAPSHOT_HEIGHT}")
    try:
        r = await _http.get(url, auth=_nvr_auth())
    except Exception as e:
        print(f"[capture] snapshot ch-stream {stream} failed: {type(e).__name__}: {e}",
              flush=True)
        return None
    if r.status_code != 200:
        print(f"[capture] snapshot ch-stream {stream} HTTP {r.status_code}", flush=True)
        return None
    data = r.content
    # A 200 with an XML body is the NVR's way of saying "channel offline".
    if not data or data[:2] != b"\xff\xd8":
        print(f"[capture] snapshot ch-stream {stream} was not a JPEG "
              f"({len(data)} bytes)", flush=True)
        return None
    return data


async def _probe_nvr(max_age: float = 15.0) -> bool:
    """Cheap reachability check for /api/status, cached so polling the status
    endpoint cannot itself become a load source on the NVR."""
    now = time.monotonic()
    if now - _nvr_probe["at"] < max_age:
        return bool(_nvr_probe["reachable"])
    reachable = False
    if NVR_HOST and _http is not None:
        try:
            r = await _http.get(
                f"http://{NVR_HOST}/ISAPI/System/deviceInfo",
                auth=_nvr_auth(),
                timeout=httpx.Timeout(4.0),
            )
            reachable = r.status_code < 500
        except Exception:
            reachable = False
    _nvr_probe["at"] = now
    _nvr_probe["reachable"] = reachable
    return reachable


async def _forward(jpeg: bytes, channel_id: int, when: str, event_uuid: str) -> int:
    assert _http is not None
    body, ctype = build_multipart(jpeg, channel_id, when, event_uuid)
    url = f"{TAFAI_API}/hik/{HIK_INGEST_SECRET}"
    r = await _http.post(url, content=body, headers={"Content-Type": ctype},
                         timeout=httpx.Timeout(30.0))
    return r.status_code


# ─────────────────────────────────────────────────────────────────────────────
# The worker: pull a burst, keep the best face, forward it.
# ─────────────────────────────────────────────────────────────────────────────
async def _capture(channel_id: int, event_type: str, when: str,
                   event_uuid: str) -> None:
    stream = _stream_for_channel(channel_id)
    loop = asyncio.get_running_loop()

    async with PULL_SEM:
        STATS["pulls"] += 1
        best_jpeg: Optional[bytes] = None
        best_px = -1
        got_any_frame = False

        # A burst rather than a single shot: the alert fires when the person
        # ENTERS the scene, which is often before they are facing the camera or
        # close enough. Three frames ~350ms apart covers the walk-in.
        for i in range(SNAPSHOT_BURST):
            if i:
                await asyncio.sleep(SNAPSHOT_GAP_MS / 1000.0)
            jpeg = await _fetch_snapshot(stream)
            if jpeg is None:
                continue
            got_any_frame = True
            try:
                px = await loop.run_in_executor(EXECUTOR, _biggest_face_px, jpeg)
            except Exception as e:
                print(f"[capture] detection error on ch{channel_id}: "
                      f"{type(e).__name__}: {e}", flush=True)
                continue
            if px is not None and px > best_px:
                best_px, best_jpeg = px, jpeg

        if not got_any_frame:
            STATS["rejected"] += 1
            _record(channel_id, event_type, None, "pull-failed",
                    f"no JPEG from stream {stream}")
            return
        if best_jpeg is None:
            STATS["rejected"] += 1
            _record(channel_id, event_type, None, "no-face")
            return

        # THE MIN-FACE GATE IS LOAD-BEARING, NOT COSMETIC.
        # Below ~100px wide the ArcFace embedding is noise: measured 58px -> 0.04
        # similarity against a correct enrollment, 227px -> 0.844. Worse, one
        # camera looks at a marketing banner with a printed face on it that
        # detects at a constant ~57px; without this gate that banner would punch
        # in every few seconds forever. Forwarding a too-small face does not
        # merely fail to match, it poisons the event log.
        if best_px < MIN_FACE_PX:
            STATS["rejected"] += 1
            _record(channel_id, event_type, best_px, "too-small",
                    f"min {MIN_FACE_PX}px")
            return

        try:
            status = await _forward(best_jpeg, channel_id, when, event_uuid)
        except Exception as e:
            STATS["rejected"] += 1
            _record(channel_id, event_type, best_px, "pull-failed",
                    f"forward failed: {type(e).__name__}: {e}")
            return

        if status >= 400:
            STATS["rejected"] += 1
            _record(channel_id, event_type, best_px, "pull-failed",
                    f"backend HTTP {status}")
            return
        STATS["forwarded"] += 1
        _record(channel_id, event_type, best_px, "forwarded",
                f"backend HTTP {status}, {len(best_jpeg)} bytes")


def _spawn(coro) -> None:
    """Fire-and-forget with a strong reference, so the task is not garbage
    collected mid-await (asyncio only holds weak refs to running tasks)."""
    task = asyncio.create_task(coro)
    _inflight.add(task)
    task.add_done_callback(_inflight.discard)


# ─────────────────────────────────────────────────────────────────────────────
# App
# ─────────────────────────────────────────────────────────────────────────────
app = FastAPI(title="tafai capture-service", version="1.0.0")

OK = JSONResponse({"ok": True})


def _validate_config() -> List[str]:
    problems = []
    if not NVR_HOST:
        problems.append("NVR_HOST is required (e.g. \"1.2.3.4:8016\" — the forwarded NVR port)")
    if not TAFAI_API:
        problems.append("TAFAI_API is required (e.g. \"https://api.example.up.railway.app\")")
    if not HIK_INGEST_SECRET:
        problems.append("HIK_INGEST_SECRET is required (must match the backend's value)")
    if not NVR_PASS:
        problems.append("NVR_PASS is required (NVR digest-auth password)")
    if not CHANNEL_MAP:
        problems.append("CHANNEL_MAP resolved to no channels")
    return problems


@app.on_event("startup")
async def _startup() -> None:
    global _http, _detector_error

    problems = _validate_config()
    if problems:
        # Fail loudly and immediately. A capture service with no NVR address or
        # no ingest secret can never do anything useful, and silently serving a
        # green healthcheck while dropping every event is the worst outcome.
        msg = "\n".join(f"  - {p}" for p in problems)
        print(f"\n[capture] FATAL: missing/invalid configuration:\n{msg}\n", flush=True)
        raise RuntimeError("capture-service misconfigured; see log above")

    _http = httpx.AsyncClient(
        # Every ISAPI call crosses the public internet to a small appliance on a
        # consumer uplink. Unbounded timeouts here would pile up tasks until the
        # container OOMs; these are deliberately short.
        timeout=httpx.Timeout(connect=6.0, read=15.0, write=15.0, pool=5.0),
        limits=httpx.Limits(max_connections=8, max_keepalive_connections=4),
        follow_redirects=False,
    )

    print(f"[capture] NVR {NVR_HOST} as {NVR_USER!r} (digest)", flush=True)
    print(f"[capture] forwarding to {TAFAI_API}/hik/<secret>", flush=True)
    print(f"[capture] channels: "
          + ", ".join(f"{ch}->{_stream_for_channel(ch)} ({c['direction']})"
                      for ch, c in sorted(CHANNEL_MAP.items())), flush=True)
    print(f"[capture] eventTypes={CAPTURE_EVENT_TYPES} minFace={MIN_FACE_PX}px "
          f"debounce={DEBOUNCE_SEC}s burst={SNAPSHOT_BURST}@{SNAPSHOT_GAP_MS}ms",
          flush=True)

    # ~15s. Doing this once here rather than per request is the difference
    # between a 200ms capture and a 15s one that misses the person entirely.
    print("[capture] loading InsightFace (buffalo_l, CPU) ...", flush=True)
    try:
        await asyncio.get_running_loop().run_in_executor(EXECUTOR, _load_detector)
        print("[capture] detector ready", flush=True)
    except Exception as e:
        # Not fatal: keep serving /health and /api/status so the operator can
        # see WHY nothing is being forwarded instead of staring at a crash loop.
        _detector_error = f"{type(e).__name__}: {e}"
        print(f"[capture] DETECTOR FAILED TO LOAD: {_detector_error}", flush=True)


@app.on_event("shutdown")
async def _shutdown() -> None:
    if _http is not None:
        await _http.aclose()
    EXECUTOR.shutdown(wait=False)


@app.post("/hik/{secret}")
async def hik(secret: str, request: Request) -> Response:
    """The NVR's alarm push lands here.

    ALWAYS 200 (except on a bad secret). Hikvision treats any non-2xx as a
    delivery failure and retries the alert aggressively — a single 500 turns
    into a retry storm that buries the service and the NVR's own event queue.
    So we acknowledge instantly and do every fallible thing (snapshot pull,
    detection, forwarding) in a background task. A bad secret still gets 403,
    because that is a misconfiguration the operator needs to see loudly and a
    retry storm from an unauthorized source is not our problem to absorb.
    """
    if not secrets.compare_digest(secret, HIK_INGEST_SECRET):
        return JSONResponse({"error": "forbidden"}, status_code=403)

    STATS["events"] += 1

    # Body shape varies by firmware: most post multipart/form-data with an XML
    # part, some post a bare application/xml body. Handle both.
    xml = ""
    ctype = request.headers.get("content-type", "")
    try:
        if ctype.lower().startswith("multipart/"):
            form = await request.form()
            for value in form.values():
                if hasattr(value, "read"):        # UploadFile part
                    raw = await value.read()
                    text = raw.decode("utf-8", "replace")
                else:
                    text = str(value)
                if "EventNotificationAlert" in text:
                    xml = text
                    break
        else:
            xml = (await request.body()).decode("utf-8", "replace")
    except Exception as e:
        _record(-1, "?", None, "pull-failed", f"unparseable body: {type(e).__name__}")
        return OK

    if "EventNotificationAlert" not in xml:
        _record(-1, "?", None, "pull-failed", "no EventNotificationAlert in body")
        return OK

    alert = _parse_alert(xml)
    channel_id = alert["channelId"]
    event_type = alert["eventType"] or "?"

    if channel_id is None or channel_id not in CHANNEL_MAP:
        # Every camera on the NVR reports here; we only care about the two doors.
        # Silent (not ring-buffered) — otherwise unmapped channels would flood
        # the 100-slot buffer and hide the events that matter.
        return OK

    if not _event_type_wanted(event_type):
        return OK

    # DEBOUNCE. One person walking past produces a continuous stream of alerts —
    # motion fires many times a second and the face event repeats for as long as
    # the face is in frame. Without this, a single person-pass would trigger
    # thirty snapshot bursts (ninety ISAPI pulls) and thirty near-identical
    # forwards. One burst per person-pass is what we want; DEBOUNCE_SEC is sized
    # to roughly the time it takes to walk through the door.
    now = time.monotonic()
    last = _last_pull_at.get(channel_id, 0.0)
    if now - last < DEBOUNCE_SEC:
        return OK
    _last_pull_at[channel_id] = now

    if _detector is None:
        _record(channel_id, event_type, None, "pull-failed",
                f"detector unavailable: {_detector_error}")
        return OK

    _spawn(_capture(
        channel_id,
        event_type,
        _normalize_datetime(alert["dateTime"]),
        alert["uuid"] or str(uuid.uuid4()),
    ))
    return OK


@app.get("/health")
async def health() -> Dict[str, Any]:
    # Deliberately does NOT touch the NVR. Railway's healthcheck must reflect
    # "this process is alive", not "the office internet is up" — otherwise a
    # router reboot in Rawalpindi restarts the container in a loop.
    return {"ok": True}


@app.get("/api/status")
async def status() -> Dict[str, Any]:
    backend_up = False
    if _http is not None and TAFAI_API:
        try:
            # Any HTTP answer means Nest is listening; / is an unmapped 404.
            r = await _http.get(f"{TAFAI_API}/", timeout=httpx.Timeout(5.0))
            backend_up = r.status_code < 500
        except Exception:
            backend_up = False

    return {
        "service": "up",
        "backend": {"up": backend_up, "api": TAFAI_API},
        # Host only — never the user, never the password, never the ingest
        # secret. This endpoint is unauthenticated.
        "nvr": {"reachable": await _probe_nvr(), "host": NVR_HOST},
        "config": {
            "minFacePx": MIN_FACE_PX,
            "debounceSec": DEBOUNCE_SEC,
            "snapshotBurst": SNAPSHOT_BURST,
            "snapshotGapMs": SNAPSHOT_GAP_MS,
            "snapshotRes": (f"{SNAPSHOT_WIDTH}x{SNAPSHOT_HEIGHT}"
                            if SNAPSHOT_WIDTH > 0 and SNAPSHOT_HEIGHT > 0 else "nvr-default"),
            "captureEventTypes": CAPTURE_EVENT_TYPES,
            "detSize": DET_SIZE,
            "detectorReady": _detector is not None,
            "detectorError": _detector_error,
        },
        "stats": dict(STATS),
        "channels": [
            {
                "channelId": ch,
                "name": cfg["name"],
                "direction": cfg["direction"],
                "stream": _stream_for_channel(ch),
                "lastFacePx": _channel_state.get(ch, {}).get("lastFacePx"),
                "lastAction": _channel_state.get(ch, {}).get("lastAction"),
                "lastAt": _channel_state.get(ch, {}).get("lastAt"),
                "lastForwardedAt": _channel_state.get(ch, {}).get("lastForwardedAt"),
            }
            for ch, cfg in sorted(CHANNEL_MAP.items())
        ],
    }


@app.get("/api/events")
async def events(limit: int = Query(50, ge=1, le=500)) -> List[Dict[str, Any]]:
    """Our OWN activity, not the backend's. This answers "did the NVR tell us
    anything, and what did we decide" — which is a different question from
    "did a punch get created", and the one you need first when debugging."""
    rows = list(EVENTS)[-limit:]
    rows.reverse()      # newest first
    return rows


@app.get("/api/snapshot")
async def snapshot(channel: int = Query(...)) -> Response:
    """Live preview for the operator console. Pulls one frame on demand."""
    if channel not in CHANNEL_MAP:
        return JSONResponse(
            {"error": f"unknown channel {channel}",
             "known": sorted(CHANNEL_MAP.keys())},
            status_code=404,
        )
    jpeg = await _fetch_snapshot(_stream_for_channel(channel))
    if jpeg is None:
        return JSONResponse(
            {"error": f"no snapshot from channel {channel} (NVR unreachable "
                      f"or channel offline)"},
            status_code=503,
        )
    return Response(jpeg, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


if __name__ == "__main__":
    import uvicorn

    try:
        uvicorn.run(app, host="0.0.0.0", port=PORT, log_level="info")
    except RuntimeError as e:
        print(f"[capture] {e}", flush=True)
        sys.exit(1)
