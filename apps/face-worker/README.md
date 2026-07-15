# intag face-worker

Stateless Python service that turns an image into an **ArcFace 512-d embedding**,
used by the NestJS backend for online face-attendance:

- **Enrollment** — admin uploads employee photos → backend → `/embed` → stores the
  512-d vector in `core.face_enrollments` (pgvector).
- **Recognition** — the Hikvision NVR pushes a face snapshot → backend → `/embed`
  → nearest-neighbour match in Postgres (`<=>` cosine) → attendance punch.

It runs the **same `buffalo_l` pack** (SCRFD `det_10g` + ArcFace `w600k_r50`) as the
on-prem Summit box, so both share one embedding space. Matching is **not** done
here — it happens in pgvector on the backend. This service holds no gallery, no DB.

## API

- `GET /health` → `{status, model, dim, det_size, providers}`
- `POST /embed` — body = raw image bytes (`application/octet-stream`), auth =
  `Authorization: Bearer $AI_WORKER_API_KEY`. Query `largest_only=true` (default)
  returns only the biggest face. Response:
  `{ count, faces: [{ embedding: number[512], bbox, det_score, area }] }`

## Env

| var | default | meaning |
|---|---|---|
| `AI_WORKER_API_KEY` | _(empty = open, dev only)_ | shared bearer token |
| `FACE_DET_SIZE` | `640` | SCRFD detector input size |
| `PORT` | `8000` | injected by Railway |
| `OMP_NUM_THREADS` | `1` | bounds CPU inference memory |

## Run locally

```bash
pip install -r requirements.txt
python bake_models.py          # one-time model download
uvicorn app.main:app --port 8000
```

## Deploy (Railway)

Its own service, root directory `apps/face-worker`, Dockerfile build. Size ≥1 GB
RAM (buffalo_l CPU ≈ 0.5–1 GB RSS). Set `AI_WORKER_API_KEY`; the backend calls it
via `AI_WORKER_URL` on the private network.
