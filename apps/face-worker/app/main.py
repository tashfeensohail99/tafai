"""intag face-worker — FastAPI service that turns an image into ArcFace 512-d
embeddings. Called by the NestJS backend for both enrollment (admin-uploaded
photos) and recognition (Hikvision NVR face-capture snapshots). Stateless: it
holds no gallery and no DB — matching is done in Postgres/pgvector on the
backend. Auth is a shared bearer token (AI_WORKER_API_KEY)."""
import os
import secrets

from fastapi import FastAPI, Header, HTTPException, Request

from . import recognition

API_KEY = os.getenv("AI_WORKER_API_KEY", "")
# Cap request body size so a caller can't exhaust memory on this single-worker box.
MAX_IMAGE_BYTES = int(os.getenv("FACE_MAX_IMAGE_BYTES", str(12 * 1024 * 1024)))

app = FastAPI(title="intag face-worker", version="1.0.0")


def _check_auth(authorization: str | None) -> None:
    # Unconfigured key = open (local dev only). Production always sets one.
    if not API_KEY:
        return
    expected = f"Bearer {API_KEY}"
    try:
        ok = bool(authorization) and secrets.compare_digest(authorization, expected)
    except TypeError:
        # compare_digest rejects non-ASCII str — treat as unauthorized, not a 500.
        ok = False
    if not ok:
        raise HTTPException(status_code=401, detail="unauthorized")


@app.on_event("startup")
def _startup() -> None:
    if not API_KEY:
        print("[face-worker] WARNING: AI_WORKER_API_KEY is unset — /embed is UNAUTHENTICATED. Set it in production.")
    # Warm the model at boot so the first real request isn't a cold ~5s load.
    try:
        recognition.warmup()
    except Exception as e:  # pragma: no cover - boot best-effort
        print(f"[face-worker] warmup failed (will lazy-load on first request): {e}")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "model": "buffalo_l",
        "dim": 512,
        "det_size": recognition.DET_SIZE,
        "providers": recognition.active_providers(),
    }


@app.post("/embed")
async def embed(
    request: Request,
    authorization: str | None = Header(default=None),
    largest_only: bool = True,
):
    """Embed faces in the raw image bytes of the request body (JPEG/PNG; the
    caller sends the NVR snapshot or an enrollment photo as application/octet-
    stream). Returns faces sorted largest-first; `largest_only` keeps just the
    biggest (the person at the camera) — the default for attendance."""
    _check_auth(authorization)
    # Reject oversized bodies early (by header, then by actual size).
    cl = request.headers.get("content-length")
    if cl and cl.isdigit() and int(cl) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    data = await request.body()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    if not data:
        raise HTTPException(status_code=400, detail="empty body — send raw image bytes")
    try:
        faces = recognition.embed_faces(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:  # model/inference failure
        raise HTTPException(status_code=500, detail=f"embedding failed: {e}")
    if largest_only:
        faces = faces[:1]
    return {"count": len(faces), "faces": faces}
