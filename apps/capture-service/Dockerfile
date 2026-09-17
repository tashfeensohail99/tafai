# intag capture-service — NVR event listener + ISAPI snapshot puller (CPU).
# Build context = apps/capture-service (set the Railway service root directory here).
#
# Shape deliberately mirrors apps/face-worker/Dockerfile: same base, same system
# libs, same baked buffalo_l pack, same uvicorn CMD. The only real difference is
# that this service also talks HTTP DIGEST to the NVR, which needs no extra
# system packages (httpx.DigestAuth is pure Python).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    INSIGHTFACE_ROOT=/root/.insightface \
    FACE_DET_SIZE=640

# System libs: build tools (any transitive sdist), opencv runtime (libglib/libgl),
# onnxruntime OpenMP (libgomp), TLS + wget for the model download.
# NOTE: no ffmpeg/RTSP codecs here — this service pulls still JPEGs over ISAPI,
# it never opens a video stream. If that ever changes, ffmpeg must be added.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake \
      libglib2.0-0 libgomp1 libgl1 \
      ca-certificates wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# numpy + Cython first so any sdist in the tree builds against them.
RUN pip install --no-cache-dir numpy==1.26.4 Cython==3.0.11

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Bake the buffalo_l pack into the image (no runtime download). Without this the
# first NVR event after a cold start would race a ~300MB model download from a
# flaky host, and the snapshot would be stale by the time detection was ready.
#
# This deliberately runs BEFORE the app code is copied (face-worker does it
# after). The bake only depends on the installed packages, so putting it here
# means editing main.py reuses the cached model layer instead of re-downloading
# ~300MB from a flaky host on every code change.
COPY bake_models.py .
RUN python bake_models.py

# Flat layout: main.py at the service root (NOT app/main.py like face-worker —
# this service is a single module, so the uvicorn target below is main:app).
COPY main.py .
COPY console.html .

EXPOSE 8000
# Railway injects $PORT. Single worker keeps CPU inference memory bounded and
# means exactly one buffalo_l instance is resident (each worker would load its
# own copy, ~0.5-1GB each).
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
