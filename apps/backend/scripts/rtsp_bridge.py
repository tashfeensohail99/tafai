"""Pull faces off RTSP streams and feed them into the existing NVR ingest path.

The Hikvision alarm server on this hardware sends event XML with no JPEG, so the
push path can never carry a face (see tashfeen-nvr-hardware notes). This bridge
replaces only the frame SOURCE: it reads the camera streams directly, finds
faces itself, and POSTs each one to /hik/<secret> in exactly the multipart shape
the NVR would have used. Everything downstream — dedup, embedding, matching,
direction mapping, punch creation — is the already-proven code path, untouched.

    apps/face-worker/.venv/Scripts/python.exe scripts/rtsp_bridge.py

Ctrl-C to stop. One thread per camera keeps only the newest frame, because
OpenCV buffers RTSP and you otherwise process video that is seconds stale.
"""

import argparse
import os
import sys
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

# Force TCP: over UDP, H.264 frames arrive torn and the detector sees garbage.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
import requests  # noqa: E402

PKT = timezone(timedelta(hours=5))

# channelID must match FACE_CHANNEL_MAP in the backend .env. Hikvision numbers
# IP channels +32, so D9=41 (entry) and D10=42 (exit); we keep those numbers so
# the map works for both this bridge and any real NVR push.
CAMERAS = [
    {"name": "D9-entry", "ip": "192.168.18.2", "channel": 41},
    {"name": "D10-exit", "ip": "192.168.18.3", "channel": 42},
]


def build_multipart(jpeg: bytes, channel: int) -> tuple[bytes, str]:
    """Byte-identical in shape to what the NVR posts, so the parser is unchanged."""
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


class Camera(threading.Thread):
    """Continuously drains one RTSP stream, keeping only the newest frame."""

    def __init__(self, cfg, user, password):
        super().__init__(daemon=True)
        self.cfg = cfg
        # The password contains '@' (hik@1122). Unencoded, the first '@'
        # terminates the userinfo and the host parses as "1122@192.168.18.2",
        # so the stream silently fails to open. quote() is not optional here.
        self.url = (
            f"rtsp://{quote(user, safe='')}:{quote(password, safe='')}"
            f"@{cfg['ip']}:554/Streaming/Channels/101"
        )
        self.frame = None
        self.lock = threading.Lock()
        self.alive = False
        self.stop_flag = threading.Event()

    def run(self):
        backoff = 1
        while not self.stop_flag.is_set():
            cap = cv2.VideoCapture(self.url, cv2.CAP_FFMPEG)
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            if not cap.isOpened():
                self.alive = False
                print(f"  [{self.cfg['name']}] cannot open stream, retry in {backoff}s")
                self.stop_flag.wait(backoff)
                backoff = min(backoff * 2, 20)
                continue

            print(f"  [{self.cfg['name']}] connected")
            self.alive = True
            backoff = 1
            misses = 0
            while not self.stop_flag.is_set():
                ok, f = cap.read()
                if not ok:
                    misses += 1
                    if misses > 30:
                        print(f"  [{self.cfg['name']}] stream stalled, reconnecting")
                        break
                    continue
                misses = 0
                with self.lock:
                    self.frame = f
            cap.release()
            self.alive = False

    def latest(self):
        with self.lock:
            return None if self.frame is None else self.frame.copy()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--user", default="admin")
    ap.add_argument("--password", default="hik@1122")
    ap.add_argument("--api", default="http://localhost:3001")
    ap.add_argument("--secret", default="devsecret123")
    ap.add_argument("--min-face", type=int, default=55,
                    help="ignore faces smaller than this (px) — too small to match")
    ap.add_argument("--cooldown", type=float, default=6.0,
                    help="seconds between posts per camera")
    ap.add_argument("--fps", type=float, default=3.0, help="detection rate")
    args = ap.parse_args()

    print("\n  loading InsightFace (buffalo_l, CPU) — takes ~15s ...")
    from insightface.app import FaceAnalysis
    app = FaceAnalysis(name="buffalo_l", providers=["CPUExecutionProvider"])
    # Detector only; the backend worker does the embedding, so we just gate on
    # "is there a big enough face here".
    app.prepare(ctx_id=-1, det_size=(640, 640))
    print("  ready\n")

    cams = [Camera(c, args.user, args.password) for c in CAMERAS]
    for c in cams:
        c.start()

    url = f"{args.api}/hik/{args.secret}"
    last_post = {c.cfg["name"]: 0.0 for c in cams}
    sent = 0
    interval = 1.0 / max(args.fps, 0.5)

    print(f"  posting to {url}")
    print("  Ctrl-C to stop\n")
    try:
        while True:
            time.sleep(interval)
            for cam in cams:
                frame = cam.latest()
                if frame is None:
                    continue
                now = time.time()
                if now - last_post[cam.cfg["name"]] < args.cooldown:
                    continue

                faces = app.get(frame)
                if not faces:
                    continue
                # Biggest face in frame; ignore distant passers-by.
                big = max(faces, key=lambda f: (f.bbox[2] - f.bbox[0]))
                w = int(big.bbox[2] - big.bbox[0])
                if w < args.min_face:
                    continue

                ok, buf = cv2.imencode(".jpg", frame,
                                       [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                if not ok:
                    continue
                body, ctype = build_multipart(buf.tobytes(), cam.cfg["channel"])
                try:
                    r = requests.post(url, data=body,
                                      headers={"Content-Type": ctype}, timeout=20)
                    sent += 1
                    last_post[cam.cfg["name"]] = now
                    ts = datetime.now(PKT).strftime("%H:%M:%S")
                    print(f"  {ts}  {cam.cfg['name']:9s} face {w}px  -> HTTP {r.status_code}  (#{sent})")
                except Exception as e:
                    print(f"  post failed: {e}")
    except KeyboardInterrupt:
        print("\n  stopping ...")
        for c in cams:
            c.stop_flag.set()
        print(f"  sent {sent} face(s).\n")


if __name__ == "__main__":
    main()
