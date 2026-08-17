# intag face-worker — InsightFace ArcFace embedding service (CPU).
# Build context = apps/face-worker (set the Railway service root directory here).
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    OMP_NUM_THREADS=1 \
    INSIGHTFACE_ROOT=/root/.insightface \
    FACE_DET_SIZE=640

# System libs: build tools (any transitive sdist), opencv runtime (libglib),
# onnxruntime OpenMP (libgomp), TLS + wget for the model download.
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

COPY app ./app
COPY bake_models.py .

# Bake the buffalo_l pack into the image (no runtime download).
RUN python bake_models.py

EXPOSE 8000
# Railway injects $PORT. Single worker keeps CPU inference memory bounded.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
