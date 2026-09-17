"""Download + cache the buffalo_l pack (SCRFD det_10g + ArcFace w600k_r50) into
the image at build time, so the running container never downloads at cold start.
Retries because the insightface model host is occasionally flaky.

Copied verbatim from apps/face-worker/bake_models.py so both services bake the
same pack the same way — do not let these drift.

This service only ever runs DETECTION (it decides "is there a big enough face in
this snapshot"); the embedding is done by face-worker on the backend side. The
recognition module is still baked so the pack on disk is identical to
face-worker's and a future change here needs no image rebuild strategy of its own.
"""
import time

from insightface.app import FaceAnalysis

for attempt in range(1, 6):
    try:
        app = FaceAnalysis(name="buffalo_l", allowed_modules=["detection", "recognition"])
        app.prepare(ctx_id=-1, det_size=(640, 640))
        print("buffalo_l baked OK")
        break
    except Exception as e:  # noqa: BLE001
        print(f"bake attempt {attempt}/5 failed: {e}")
        if attempt == 5:
            raise
        time.sleep(5)
