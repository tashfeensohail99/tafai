"""InsightFace embedding engine for the intag online face-attendance worker.

Ports the on-prem Summit box's recognition setup (buffalo_l: SCRFD detector +
ArcFace w600k_r50) so faces embed into the SAME 512-d, L2-normalized space and
one gallery serves both surfaces. Unlike the Summit box, matching happens in
Postgres/pgvector on the NestJS side — this worker only detects + embeds.
"""
import os
import warnings

import cv2
import numpy as np

warnings.filterwarnings("ignore", category=FutureWarning)

# Detector input size. Summit uses 480 for a fixed doorway; 640 is safer for the
# varied NVR snapshots (full scene vs cropped face). Tune with FACE_DET_SIZE.
DET_SIZE = int(os.getenv("FACE_DET_SIZE", "640"))
INSIGHTFACE_ROOT = os.getenv("INSIGHTFACE_ROOT", os.path.expanduser("~/.insightface"))

_app = None


def get_app():
    """Lazy-load buffalo_l (detection + recognition only) on CPU."""
    global _app
    if _app is None:
        from insightface.app import FaceAnalysis

        # Build into a local first — only cache once prepare() fully succeeds, so a
        # transient failure doesn't leave a half-initialized model cached forever.
        app = FaceAnalysis(
            name="buffalo_l",
            root=INSIGHTFACE_ROOT,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        # ctx_id<0 = CPU. det_size must match the SCRFD input.
        app.prepare(ctx_id=-1, det_size=(DET_SIZE, DET_SIZE))
        _app = app
    return _app


def warmup():
    """Build the model + run one dummy inference so the first real request is fast."""
    app = get_app()
    app.get(np.zeros((DET_SIZE, DET_SIZE, 3), dtype=np.uint8))
    return active_providers()


def active_providers():
    try:
        if _app is None:
            return []
        provs = set()
        for m in getattr(_app, "models", {}).values():
            sess = getattr(m, "session", None)
            if sess is not None:
                provs.update(sess.get_providers())
        return sorted(provs)
    except Exception:
        return []


def _decode_bgr(data: bytes):
    """Decode arbitrary image bytes (incl. progressive/pjpeg from Hikvision) to
    a BGR numpy array — the format insightface/OpenCV expects. Feeding RGB would
    yield embeddings incompatible with the stored gallery."""
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)  # -> BGR, or None on garbage
    return img


def embed_faces(data: bytes):
    """Detect + embed every face in an image. Returns dicts sorted largest-first:
    {embedding: 512 floats (unit vector), bbox: [x1,y1,x2,y2], det_score, area}."""
    img = _decode_bgr(data)
    if img is None:
        raise ValueError("could not decode image bytes")
    faces = get_app().get(img)
    out = []
    for f in faces:
        bbox = [float(x) for x in np.asarray(f.bbox).tolist()]
        emb = np.asarray(f.normed_embedding, dtype=np.float32)
        out.append(
            {
                "embedding": emb.tolist(),
                "bbox": bbox,
                "det_score": float(f.det_score),
                "area": (bbox[2] - bbox[0]) * (bbox[3] - bbox[1]),
            }
        )
    out.sort(key=lambda o: o["area"], reverse=True)
    return out
