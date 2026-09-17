"""RTSP face bridge + local web console, in one process.

This is scripts/rtsp_bridge.py (same camera threads, same detection loop, same
Hikvision-shaped multipart POST to /hik/<secret>) with an HTTP layer bolted on
so an operator can *see* what the bridge sees: live video with the detected face
boxed and measured, the knobs that decide whether a face gets posted, and the
resulting capture events / attendance coming back out of the tafai backend.

    apps/face-worker/.venv/Scripts/python.exe apps/backend/scripts/bridge_server.py

Then open http://localhost:8080/ .

Design notes for the non-obvious parts are inline, but the three that bite
hardest, up front:

  * OPENCV_FFMPEG_CAPTURE_OPTIONS=rtsp_transport;tcp MUST be set before cv2 is
    imported. Over the default UDP transport H.264 frames arrive torn and the
    detector scores garbage.
  * The RTSP password contains '@' (hik@1122). Unencoded, the first '@'
    terminates the userinfo and the host parses as "1122@192.168.18.2", so the
    stream silently never opens. URL-encoding is not cosmetic here.
  * One thread per camera does nothing but drain the socket and keep the NEWEST
    frame. OpenCV buffers RTSP internally, so if you only read when you want to
    detect you process video that is seconds stale.
"""

import io
import json
import os
import re
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote

# ── must precede `import cv2` (see module docstring) ────────────────────────
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402
import requests  # noqa: E402
import uvicorn  # noqa: E402
from fastapi import Body, FastAPI, HTTPException, Query, Request  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse  # noqa: E402

HERE = Path(__file__).resolve().parent
ENV_PATH = HERE.parent / ".env"          # apps/backend/.env
DASHBOARD = HERE / "dashboard.html"

PKT = timezone(timedelta(hours=5))

# channelID must match FACE_CHANNEL_MAP in apps/backend/.env. Hikvision numbers
# IP channels +32, so D9=41 (entry/IN) and D10=42 (exit/OUT). Keeping those
# numbers means this bridge and a real NVR push land on the same mapping.
CAMERAS = [
    {"name": "D9-entry", "ip": "192.168.18.2", "channel": 41, "direction": "IN"},
    {"name": "D10-exit", "ip": "192.168.18.3", "channel": 42, "direction": "OUT"},
]

RTSP_USER = "admin"
RTSP_PASSWORD = "hik@1122"

BACKEND = "http://localhost:3001"
ADMIN_EMAIL = "admin@tashfeen.com"
ADMIN_PASSWORD = "Admin@123456"

DEFAULTS = {"minFace": 55, "cooldown": 6.0, "fps": 3.0}

# The console listens on 8080 per the contract; BRIDGE_PORT only exists so a
# second instance can be brought up beside a running one for testing.
PORT = int(os.environ.get("BRIDGE_PORT", "8080"))


# ── .env ────────────────────────────────────────────────────────────────────
def load_env(path: Path) -> Dict[str, str]:
    """Tiny KEY=VALUE reader. Secrets live in apps/backend/.env, never in source.

    Deliberately dumb: no interpolation, no export handling — just enough to
    pick up HIK_INGEST_SECRET and the STORAGE_* block without dragging in a
    dotenv dependency the face-worker venv does not have.
    """
    out: Dict[str, str] = {}
    if not path.exists():
        return out
    for raw in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key] = val
    return out


ENV = load_env(ENV_PATH)
HIK_SECRET = ENV.get("HIK_INGEST_SECRET", "devsecret123")
# STORAGE_* is read here so the console can report/extend to bucket access
# later; capture JPEGs themselves are proxied through the backend (which already
# holds the signed-URL logic), so we never hand bucket creds to the browser.
STORAGE = {k: v for k, v in ENV.items() if k.startswith("STORAGE_")}


# ── Hikvision-shaped multipart (verbatim from rtsp_bridge.py) ───────────────
def build_multipart(jpeg: bytes, channel: int) -> tuple:
    """Byte-identical in SHAPE to what the NVR posts, so the parser is unchanged.

    Everything downstream of /hik — dedup, embedding, matching, direction
    mapping, punch creation — is the already-proven path. We only replace the
    frame source, so this envelope must not drift.
    """
    now = datetime.now(PKT)
    alert = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<EventNotificationAlert version="2.0" '
        'xmlns="http://www.hikvision.com/ver20/XMLSchema">\n'
        "  <ipAddress>192.168.18.16</ipAddress>\n"
        f"  <channelID>{channel}</channelID>\n"
        f"  <dateTime>{now.strftime('%Y-%m-%dT%H:%M:%S')}+05:00</dateTime>\n"
        "  <activePostCount>1</activePostCount>\n"
        "  <eventType>faceCapture</eventType>\n"
        "  <eventState>active</eventState>\n"
        "  <eventDescription>Face Capture</eventDescription>\n"
        f"  <uuid>{uuid.uuid4()}</uuid>\n"
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


# ── camera thread ───────────────────────────────────────────────────────────
class Camera(threading.Thread):
    """Continuously drains one RTSP stream, keeping only the newest frame.

    Never raises out of run(): a camera that is unplugged just loops on its
    reconnect backoff with alive=False, so a dead camera can never take the
    server down (or stall the other camera).
    """

    def __init__(self, cfg: dict, user: str, password: str):
        super().__init__(daemon=True, name=f"cam-{cfg['name']}")
        self.cfg = cfg
        # quote() is load-bearing: the password contains '@'.
        self.url = (
            f"rtsp://{quote(user, safe='')}:{quote(password, safe='')}"
            f"@{cfg['ip']}:554/Streaming/Channels/101"
        )
        self.frame = None
        self.lock = threading.Lock()
        self.alive = False
        self.stop_flag = threading.Event()
        # Published by whoever last ran the detector on this camera, so the
        # MJPEG view and /api/status agree without detecting twice.
        self.last_box: Optional[tuple] = None      # (x1, y1, x2, y2)
        self.last_box_at: float = 0.0
        self.last_face_px: Optional[int] = None
        self.last_post_at: Optional[str] = None

    def run(self) -> None:
        backoff = 1
        while not self.stop_flag.is_set():
            try:
                cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
                try:
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                except Exception:
                    pass
                if not cap.isOpened():
                    self.alive = False
                    cap.release()
                    self.stop_flag.wait(backoff)
                    backoff = min(backoff * 2, 20)
                    continue

                print(f"  [{self.cfg['name']}] connected", flush=True)
                self.alive = True
                backoff = 1
                misses = 0
                while not self.stop_flag.is_set():
                    ok, f = cap.read()
                    if not ok:
                        misses += 1
                        if misses > 30:
                            print(f"  [{self.cfg['name']}] stalled, reconnecting", flush=True)
                            break
                        continue
                    misses = 0
                    with self.lock:
                        self.frame = f
                cap.release()
            except Exception as e:                        # never kill the thread
                print(f"  [{self.cfg['name']}] error: {e}", flush=True)
                self.stop_flag.wait(backoff)
                backoff = min(backoff * 2, 20)
            finally:
                self.alive = False

    def latest(self):
        with self.lock:
            return None if self.frame is None else self.frame.copy()


# ── face detector, hot-swappable between CPU and CUDA ───────────────────────
class Detector:
    """Wraps InsightFace so the execution provider can be switched at runtime.

    onnxruntime does NOT fail when you ask for CUDAExecutionProvider on a box
    with no CUDA — it silently falls back to CPU. Reporting only what was
    requested would therefore lie about where inference is running, so we always
    report requested AND the session's actual provider list.

    All model access goes through `self.lock`, so /api/exec can rebuild the
    model while the detection loop and the MJPEG view are running without
    either of them touching a half-constructed FaceAnalysis.
    """

    def __init__(self, mode: str = "cpu"):
        self.lock = threading.Lock()
        self.requested = mode
        self.app = None
        self.load(mode)

    @staticmethod
    def _providers_for(mode: str) -> List[str]:
        # CUDA first, CPU appended: onnxruntime needs a usable fallback in the
        # list or it errors out instead of degrading.
        return ["CUDAExecutionProvider", "CPUExecutionProvider"] if mode == "gpu" \
            else ["CPUExecutionProvider"]

    def load(self, mode: str) -> None:
        from insightface.app import FaceAnalysis
        providers = self._providers_for(mode)
        app = FaceAnalysis(name="buffalo_l", providers=providers)
        # Detector only — the backend face-worker computes the embedding. We
        # just gate on "is there a big enough face in this frame".
        app.prepare(ctx_id=0 if mode == "gpu" else -1, det_size=(640, 640))
        with self.lock:
            self.app = app
            self.requested = mode

    def switch(self, mode: str) -> None:
        """Rebuild the model, keeping the old one if the new one fails to load.

        The new FaceAnalysis is built BEFORE the old one is dropped, so a failed
        load leaves a working detector and the camera threads never see a null
        model. The cost is a transient double model footprint — on a memory-tight
        box the swap can fail with onnxruntime's "Arena alloc failed", which is
        precisely why the rollback exists and why the caller gets a 500 with the
        real message instead of a dead detector.
        """
        previous_app, previous_mode = self.app, self.requested
        try:
            self.load(mode)
        except Exception:
            with self.lock:
                self.app, self.requested = previous_app, previous_mode
            raise

    def active_providers(self) -> List[str]:
        """What onnxruntime is ACTUALLY executing on (not what we asked for)."""
        with self.lock:
            app = self.app
        if app is None:
            return []
        try:
            for key in ("detection", "recognition"):
                model = app.models.get(key)
                sess = getattr(model, "session", None)
                if sess is not None:
                    return list(sess.get_providers())
        except Exception:
            pass
        return []

    def available_providers(self) -> List[str]:
        try:
            import onnxruntime
            return list(onnxruntime.get_available_providers())
        except Exception:
            return []

    def biggest_face(self, frame):
        """Returns (bbox_tuple, width_px) for the largest face, or (None, None)."""
        with self.lock:
            app = self.app
        if app is None or frame is None:
            return None, None
        try:
            faces = app.get(frame)
        except Exception:
            return None, None
        if not faces:
            return None, None
        big = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]))
        x1, y1, x2, y2 = (int(v) for v in big.bbox[:4])
        return (x1, y1, x2, y2), int(x2 - x1)


# ── backend client: login once, cache the token, re-login on 401 ────────────
class BackendClient:
    """Server-side proxy to the tafai NestJS API.

    The bearer token never leaves this process — the dashboard talks only to
    localhost:8080 and this class attaches credentials on the way out.
    """

    def __init__(self, base: str, email: str, password: str):
        self.base = base.rstrip("/")
        self.email = email
        self.password = password
        self.token: Optional[str] = None
        self.lock = threading.Lock()

    def login(self) -> Optional[str]:
        try:
            r = requests.post(
                f"{self.base}/auth/login",
                json={"email": self.email, "password": self.password},
                timeout=15,
            )
            if r.status_code >= 400:
                print(f"  backend login failed: HTTP {r.status_code}", flush=True)
                return None
            data = r.json()
            token = data.get("accessToken") or data.get("access_token") or data.get("token")
            with self.lock:
                self.token = token
            return token
        except Exception as e:
            print(f"  backend login error: {e}", flush=True)
            return None

    def _headers(self) -> Dict[str, str]:
        with self.lock:
            tok = self.token
        return {"Authorization": f"Bearer {tok}"} if tok else {}

    def request(self, method: str, path: str, **kw) -> requests.Response:
        """One transparent re-login retry on 401 — tokens expire, the console
        is long-lived, and the operator should never see an auth blip."""
        kw.setdefault("timeout", 30)
        url = f"{self.base}{path}"
        headers = dict(kw.pop("headers", {}) or {})
        headers.update(self._headers())
        r = requests.request(method, url, headers=headers, **kw)
        if r.status_code == 401:
            if self.login():
                headers.update(self._headers())
                r = requests.request(method, url, headers=headers, **kw)
        return r

    def up(self) -> bool:
        try:
            # Any HTTP answer means Nest is listening; / is an unmapped 404.
            requests.get(f"{self.base}/", timeout=3)
            return True
        except Exception:
            return False


# ── detection loop (the actual bridge) ──────────────────────────────────────
class Bridge(threading.Thread):
    """rtsp_bridge.py's main loop, made start/stop-able and live-tunable."""

    def __init__(self, cams: List[Camera], detector: Detector, post_url: str):
        super().__init__(daemon=True, name="bridge")
        self.cams = cams
        self.detector = detector
        self.post_url = post_url
        self.running = threading.Event()
        self.quit = threading.Event()
        self.sent = 0
        self.cfg_lock = threading.Lock()
        self.min_face = int(DEFAULTS["minFace"])
        self.cooldown = float(DEFAULTS["cooldown"])
        self.fps = float(DEFAULTS["fps"])
        self.last_post: Dict[str, float] = {c.cfg["name"]: 0.0 for c in cams}

    def config(self) -> Dict[str, Any]:
        with self.cfg_lock:
            return {"minFace": self.min_face, "cooldown": self.cooldown, "fps": self.fps}

    def set_config(self, min_face=None, cooldown=None, fps=None) -> Dict[str, Any]:
        with self.cfg_lock:
            if min_face is not None:
                self.min_face = max(10, min(600, int(min_face)))
            if cooldown is not None:
                self.cooldown = max(0.0, min(300.0, float(cooldown)))
            if fps is not None:
                self.fps = max(0.2, min(15.0, float(fps)))
        return self.config()

    def run(self) -> None:
        while not self.quit.is_set():
            if not self.running.is_set():
                self.running.wait(0.25)
                continue
            cfg = self.config()
            time.sleep(1.0 / max(cfg["fps"], 0.2))
            if not self.running.is_set():
                continue
            for cam in self.cams:
                try:
                    self._tick(cam, cfg)
                except Exception as e:                    # one bad frame != dead loop
                    print(f"  bridge tick error ({cam.cfg['name']}): {e}", flush=True)

    def _tick(self, cam: Camera, cfg: Dict[str, Any]) -> None:
        frame = cam.latest()
        if frame is None:
            return
        now = time.time()
        if now - self.last_post.get(cam.cfg["name"], 0.0) < cfg["cooldown"]:
            return

        box, width = self.detector.biggest_face(frame)
        if box is None:
            return
        # Publish for the MJPEG overlay + /api/status, even if it is too small —
        # "face seen but only 38px" is exactly what the operator needs to know.
        cam.last_box, cam.last_box_at, cam.last_face_px = box, now, width
        if width < cfg["minFace"]:
            return

        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
        if not ok:
            return
        body, ctype = build_multipart(buf.tobytes(), cam.cfg["channel"])
        try:
            r = requests.post(self.post_url, data=body, headers={"Content-Type": ctype}, timeout=20)
            self.sent += 1
            self.last_post[cam.cfg["name"]] = now
            cam.last_post_at = datetime.now(PKT).isoformat()
            ts = datetime.now(PKT).strftime("%H:%M:%S")
            print(f"  {ts}  {cam.cfg['name']:9s} face {width}px -> HTTP {r.status_code} (#{self.sent})",
                  flush=True)
        except Exception as e:
            print(f"  post failed: {e}", flush=True)


# ── wiring ──────────────────────────────────────────────────────────────────
cams: List[Camera] = [Camera(c, RTSP_USER, RTSP_PASSWORD) for c in CAMERAS]
cam_by_channel = {c.cfg["channel"]: c for c in cams}
detector: Optional[Detector] = None
bridge: Optional[Bridge] = None
backend = BackendClient(BACKEND, ADMIN_EMAIL, ADMIN_PASSWORD)

api = FastAPI(title="tafai RTSP bridge console")


@api.exception_handler(HTTPException)
async def http_error(_req: Request, exc: HTTPException):
    """Contract: errors are always JSON {"error": ...}, never an HTML 500 page."""
    detail = exc.detail if isinstance(exc.detail, str) else json.dumps(exc.detail)
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@api.exception_handler(Exception)
async def any_error(_req: Request, exc: Exception):
    return JSONResponse({"error": f"{type(exc).__name__}: {exc}"}, status_code=500)


@api.get("/")
def index():
    if not DASHBOARD.exists():
        return JSONResponse({"error": f"dashboard.html not found at {DASHBOARD}"}, status_code=404)
    return FileResponse(str(DASHBOARD), media_type="text/html")


@api.get("/api/status")
def status():
    return {
        "bridge": {
            "running": bool(bridge and bridge.running.is_set()),
            "sent": bridge.sent if bridge else 0,
            **(bridge.config() if bridge else DEFAULTS),
        },
        "exec": exec_state(),
        "backend": {"up": backend.up()},
        "cameras": [
            {
                "name": c.cfg["name"],
                "ip": c.cfg["ip"],
                "channel": c.cfg["channel"],
                "direction": c.cfg["direction"],
                "connected": bool(c.alive),
                "lastFacePx": c.last_face_px,
                "lastPostAt": c.last_post_at,
            }
            for c in cams
        ],
    }


def exec_state() -> Dict[str, Any]:
    """requested vs active: onnxruntime silently falls back to CPU, so both."""
    if detector is None:
        return {"requested": "cpu", "active": [], "available": []}
    return {
        "requested": detector.requested,
        "active": detector.active_providers(),
        "available": detector.available_providers(),
    }


def _cam_or_404(channel: int) -> Camera:
    cam = cam_by_channel.get(int(channel))
    if cam is None:
        raise HTTPException(404, f"unknown channel {channel}")
    return cam


def _annotate(frame, cam: Camera, max_width: Optional[int] = None):
    """Green box + pixel width, so the operator can see live whether faces are
    big enough to clear minFace without reading the log.

    The reported width is always in SOURCE pixels, even when the frame has been
    downscaled for the browser — it is the number minFace is compared against,
    so showing a scaled-down value would make the gate look wrong.
    """
    box = cam.last_box if (time.time() - cam.last_box_at) < 1.5 else None
    if max_width and frame.shape[1] > max_width:
        scale = max_width / float(frame.shape[1])
        frame = cv2.resize(frame, (max_width, int(frame.shape[0] * scale)),
                           interpolation=cv2.INTER_AREA)
        if box:
            box = tuple(int(v * scale) for v in box)
    if box:
        x1, y1, x2, y2 = box
        width = cam.last_face_px or (x2 - x1)
        min_face = bridge.config()["minFace"] if bridge else DEFAULTS["minFace"]
        colour = (0, 200, 0) if width >= min_face else (0, 165, 255)
        cv2.rectangle(frame, (x1, y1), (x2, y2), colour, 2)
        cv2.putText(frame, f"{width}px", (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, colour, 2)
    return frame


@api.get("/api/video")
def video(channel: int = Query(...)):
    cam = _cam_or_404(channel)

    def gen():
        # ~10fps is plenty for a monitoring view and leaves CPU for detection.
        last_detect = 0.0
        while True:
            time.sleep(0.1)
            frame = cam.latest()
            if frame is None:
                continue
            # If the bridge is stopped nobody else is detecting, so run our own
            # at a deliberately low rate (2/s) — enough for a live box, cheap
            # enough not to starve the detection loop of the model lock.
            now = time.time()
            if (bridge is None or not bridge.running.is_set()) and now - last_detect > 0.5:
                last_detect = now
                box, width = detector.biggest_face(frame) if detector else (None, None)
                if box is not None:
                    cam.last_box, cam.last_box_at, cam.last_face_px = box, now, width
            # Downscaled for the browser: these are 2560x1440 cameras, so a
            # full-res MJPEG is ~450 KB/frame (4.5 MB/s at 10fps) — needless
            # bandwidth and JPEG-encode CPU for a monitoring view.
            ok, buf = cv2.imencode(".jpg", _annotate(frame, cam, max_width=960),
                                   [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if not ok:
                continue
            jpeg = buf.tobytes()
            yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                   b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


@api.get("/api/snapshot")
def snapshot(channel: int = Query(...)):
    cam = _cam_or_404(channel)
    frame = cam.latest()
    if frame is None:
        raise HTTPException(503, f"{cam.cfg['name']} has no frame yet (camera unreachable?)")
    ok, buf = cv2.imencode(".jpg", _annotate(frame, cam), [int(cv2.IMWRITE_JPEG_QUALITY), 90])
    if not ok:
        raise HTTPException(500, "jpeg encode failed")
    return Response(buf.tobytes(), media_type="image/jpeg")


@api.post("/api/config")
def set_config(payload: Dict[str, Any] = Body(default={})):
    if bridge is None:
        raise HTTPException(503, "bridge not ready")
    try:
        cfg = bridge.set_config(
            min_face=payload.get("minFace"),
            cooldown=payload.get("cooldown"),
            fps=payload.get("fps"),
        )
    except (TypeError, ValueError) as e:
        raise HTTPException(400, f"bad config value: {e}")
    return {"ok": True, **cfg}


@api.post("/api/exec")
def set_exec(payload: Dict[str, Any] = Body(default={})):
    mode = str(payload.get("mode", "")).lower()
    if mode not in ("cpu", "gpu"):
        raise HTTPException(400, 'mode must be "cpu" or "gpu"')
    if detector is None:
        raise HTTPException(503, "detector not ready")
    if mode == "gpu" and "CUDAExecutionProvider" not in detector.available_providers():
        # Load it anyway (onnxruntime will fall back), but the response's
        # "active" list will show CPU — which is the point of reporting both.
        print("  note: CUDAExecutionProvider not available; expect CPU fallback", flush=True)
    try:
        detector.switch(mode)
    except Exception as e:
        raise HTTPException(500, f"could not load model on {mode}: {e}")
    return exec_state()


@api.post("/api/bridge")
def bridge_control(payload: Dict[str, Any] = Body(default={})):
    if bridge is None:
        raise HTTPException(503, "bridge not ready")
    action = str(payload.get("action", "")).lower()
    if action == "start":
        bridge.running.set()
    elif action == "stop":
        bridge.running.clear()
    else:
        raise HTTPException(400, 'action must be "start" or "stop"')
    return {"running": bridge.running.is_set()}


# ── data endpoints: proxied to the tafai backend ────────────────────────────
DIRECTION_BY_CHANNEL = {str(c["channel"]): c["direction"] for c in CAMERAS}


@api.get("/api/events")
def events(limit: int = 30, matchedOnly: bool = False):
    r = backend.request("GET", "/attendance/face/events",
                        params={"limit": limit, "matchedOnly": str(matchedOnly).lower()})
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"backend /attendance/face/events: {r.text[:300]}")
    rows = r.json()
    out = []
    for row in rows:
        ch = row.get("channelId")
        out.append({
            "id": row.get("id"),
            "channelId": ch,
            # The backend stores the raw channel; direction is our mapping, and
            # showing it saves the operator translating 41/42 in their head.
            "direction": DIRECTION_BY_CHANNEL.get(str(ch)),
            "status": row.get("status"),
            "similarity": row.get("similarity"),
            "capturedAt": row.get("capturedAt"),
            "employee": row.get("employeeName"),
            "hasImage": bool(row.get("hasImage")),
        })
    return out


@api.get("/api/events/{event_id}/image")
def event_image(event_id: str):
    """Proxy the JPEG. The bucket is private and the backend already owns the
    signed fetch, so we stream its bytes rather than duplicating S3 creds here."""
    r = backend.request("GET", f"/attendance/face/events/{event_id}/image")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"no image for event {event_id}")
    return Response(r.content, media_type=r.headers.get("Content-Type", "image/jpeg"))


@api.get("/api/employees")
def employees():
    r = backend.request("GET", "/attendance/face/enrolled")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"backend /attendance/face/enrolled: {r.text[:300]}")
    return [
        {
            "id": e.get("employeeId"),
            "name": e.get("name"),
            "code": e.get("code"),
            "samples": e.get("samples", 0),
        }
        for e in r.json()
    ]


@api.post("/api/enroll")
def enroll(payload: Dict[str, Any] = Body(default={})):
    employee_id = str(payload.get("employeeId") or "").strip()
    if not employee_id:
        raise HTTPException(400, "employeeId is required")
    try:
        channel = int(payload.get("channel"))
    except (TypeError, ValueError):
        raise HTTPException(400, "channel must be a camera channel number")
    count = max(1, min(15, int(payload.get("count") or 5)))
    cam = _cam_or_404(channel)
    if cam.latest() is None:
        raise HTTPException(503, f"{cam.cfg['name']} has no frame (camera unreachable?)")

    captured, quality, errors = 0, [], []
    for i in range(count):
        if i:
            # Spaced so the shots are genuinely different frames — N copies of
            # one pose is a worse enrollment than a handful of varied ones.
            time.sleep(0.6)
        frame = cam.latest()
        if frame is None:
            errors.append("no frame")
            continue
        ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 92])
        if not ok:
            errors.append("encode failed")
            continue
        try:
            r = backend.request(
                "POST", "/attendance/face/enroll",
                data={"employeeId": employee_id},
                files={"photo": (f"enroll-{i + 1}.jpg", io.BytesIO(buf.tobytes()), "image/jpeg")},
            )
        except Exception as e:
            errors.append(str(e))
            continue
        if r.status_code >= 400:
            body = r.text[:200]
            try:
                body = r.json().get("message", body)
            except Exception:
                pass
            errors.append(f"shot {i + 1}: {body}")
            continue
        captured += 1
        try:
            d = r.json()
            q = d.get("detScore", d.get("quality"))
            if q is not None:
                quality.append(round(float(q), 3))
        except Exception:
            pass

    msg = f"captured {captured}/{count} sample(s) from {cam.cfg['name']}"
    if errors:
        msg += " — " + "; ".join(errors[:3])
    return {"ok": captured > 0, "captured": captured, "quality": quality, "message": msg}


@api.delete("/api/employees/{employee_id}/enrollments")
def clear_enrollments(employee_id: str):
    r = backend.request("DELETE", f"/attendance/face/enrollments/{employee_id}")
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"backend clear enrollments: {r.text[:300]}")
    return {"ok": True}


@api.get("/api/attendance")
def attendance(date: Optional[str] = None):
    if date and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(400, "date must be YYYY-MM-DD")
    params = {"date": date} if date else {}
    r = backend.request("GET", "/attendance/daily", params=params)
    if r.status_code >= 400:
        raise HTTPException(r.status_code, f"backend /attendance/daily: {r.text[:300]}")
    data = r.json()
    rows = data.get("rows", data) if isinstance(data, dict) else data
    return [
        {
            "employee": row.get("name"),
            "code": row.get("code"),
            "checkInAt": row.get("checkInAt"),
            "checkOutAt": row.get("checkOutAt"),
            "status": row.get("status"),
        }
        for row in rows
    ]


# ── entrypoint ──────────────────────────────────────────────────────────────
def main() -> None:
    global detector, bridge

    print(f"\n  env: {ENV_PATH} ({len(ENV)} keys, {len(STORAGE)} STORAGE_*)", flush=True)
    print("  loading InsightFace (buffalo_l, CPU) — takes ~15s ...", flush=True)
    detector = Detector("cpu")
    print(f"  active providers: {detector.active_providers()}", flush=True)

    for c in cams:
        c.start()

    if backend.login():
        print(f"  backend {BACKEND}: logged in as {ADMIN_EMAIL}", flush=True)
    else:
        # Not fatal: the console must still come up so the operator can see the
        # cameras and fix the backend, rather than facing a dead port.
        print(f"  backend {BACKEND}: LOGIN FAILED — data endpoints will 4xx", flush=True)

    bridge = Bridge(cams, detector, f"{BACKEND}/hik/{HIK_SECRET}")
    bridge.start()
    bridge.running.set()

    print(f"  console: http://localhost:{PORT}/\n", flush=True)
    try:
        # 127.0.0.1, not 0.0.0.0: this console has no auth of its own and holds
        # an admin bearer token, so it must not be reachable off-box.
        uvicorn.run(api, host="127.0.0.1", port=PORT, log_level="warning")
    finally:
        if bridge:
            bridge.quit.set()
        for c in cams:
            c.stop_flag.set()


if __name__ == "__main__":
    sys.exit(main())
