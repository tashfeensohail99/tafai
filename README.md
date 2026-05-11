# Tashfeen Immigration Solutions AI Platform

Enterprise-grade immigration consultancy CRM and automation system.

## Stack

| Layer | Technology |
|---|---|
| Web Frontend | Next.js / React / TypeScript |
| Backend API | NestJS / Node.js modular monolith |
| Database | PostgreSQL |
| ORM | Prisma |
| Queue / Jobs | Redis + BullMQ |
| AI Worker | Python FastAPI |
| Storage | S3-compatible (MinIO for local) |
| Mobile | Flutter |
| Containers | Docker / Docker Compose |

## Repository Structure

```
tafsheen/
├── apps/
│   ├── backend/          # NestJS API server
│   ├── frontend/         # Next.js web portals
│   ├── ai-worker/        # Python FastAPI AI/OCR worker
│   └── mobile/           # Flutter Android/iOS app
├── packages/
│   ├── shared-types/     # Shared TypeScript types
│   └── shared-utils/     # Shared utilities
├── infra/
│   ├── docker/           # Dockerfiles
│   └── nginx/            # Nginx config
├── docker-compose.yml    # Local development stack
└── .env.example          # Required environment variables
```

## Local Development

### Prerequisites

- Docker Desktop
- Node.js 20+
- pnpm 8+
- Python 3.11+
- Flutter 3.x SDK

### Start Local Stack

```bash
cp .env.example .env
docker-compose up -d
```

This starts: PostgreSQL, Redis, MinIO.

### Backend

```bash
cd apps/backend
pnpm install
pnpm run db:migrate
pnpm run db:seed
pnpm run start:dev
```

Backend runs at: http://localhost:3001

### Frontend

```bash
cd apps/frontend
pnpm install
pnpm run dev
```

Frontend runs at: http://localhost:3000

### AI Worker

```bash
cd apps/ai-worker
python -m venv .venv
.venv/Scripts/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

AI worker runs at: http://localhost:8000

## Environment Variables

See `.env.example` for all required variables.
Never commit `.env` files containing real credentials.

## Branch Strategy

- `main` — production-ready, protected
- `develop` — integration branch, protected
- `feature/<ticket-id>-<slug>` — feature branches
- `fix/<ticket-id>-<slug>` — bug fix branches
- `hotfix/<slug>` — urgent production patches

Rules:
- No direct push to `main` or `develop`
- All changes via pull request
- PR requires at least one review before merge

## Standards

See `DEVELOPMENT_STANDARDS.md` for mandatory engineering standards.

## Health Check

GET /health — backend health endpoint (no auth required).
