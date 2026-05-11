# Week 1 DevOps And Staging Plan - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Draft for Week 1 review

## Environment Strategy

Use three environment levels:

1. Local development.
2. Staging/UAT.
3. Production.

Staging must exist before milestone UAT. Production changes require release checklist and approval.

## Recommended Local Setup

Local services:

- web app: Next.js
- backend API: NestJS
- AI worker: Python FastAPI
- PostgreSQL
- Redis
- S3-compatible local storage emulator or dev bucket

Use Docker Compose where practical so new developers can start consistently.

## Recommended Staging Setup

Staging services:

- Web app hosting for admin/employee/client/partner portals.
- Backend API service.
- AI worker service.
- Queue worker service if separate from API runtime.
- Managed PostgreSQL or protected VM/container database.
- Redis instance.
- Private object storage bucket.
- Staging domain/subdomains.
- HTTPS/SSL.
- Separate environment variables.

Suggested subdomains:

- admin-staging.tashfeen-domain
- client-staging.tashfeen-domain
- api-staging.tashfeen-domain

Final domains should be confirmed by client.

## Production Setup

Production should be created only after staging validation.

Production requirements:

- HTTPS everywhere.
- Separate production database.
- Separate production object storage.
- Separate production Redis.
- Secrets stored outside source code.
- Backup policy active.
- Error monitoring active.
- Queue failure alerts active.
- Webhook endpoints configured with provider verification.
- Release rollback plan ready.

## Repository And Branching

Recommended repository model:

- Monorepo preferred for Version 1 if team is comfortable.
- Separate apps/packages inside one repository.

Suggested branch flow:

- main: production-ready code.
- develop: staging integration branch.
- feature/*: task branches.
- hotfix/*: urgent production fixes.

Required checks before merge:

- lint
- type check
- unit tests where available
- migration check for backend changes
- build check
- code review

## CI/CD Pipeline

Minimum CI stages:

1. Install dependencies.
2. Lint.
3. Type check.
4. Run tests.
5. Build web app.
6. Build backend.
7. Validate database migrations.
8. Build Docker images where used.
9. Deploy to staging from develop.
10. Manual approval for production deployment from main.

## Secrets And Environment Variables

Never commit secrets.

Expected secret categories:

- DATABASE_URL
- REDIS_URL
- JWT/session secrets
- object storage keys
- WhatsApp/Meta credentials
- email/SMTP credentials
- AI/OCR provider keys
- telephony credentials
- Firebase credentials
- payment gateway credentials if used

Each environment must have separate credentials.

## Database Migration Rules

- Use reviewed migration files.
- Never edit production database manually without logged approval.
- Backup before risky production migrations.
- Test migrations on staging first.
- Define rollback steps for high-risk migrations.

## Backup Plan

Minimum:

- Daily PostgreSQL backup.
- Object storage retention/versioning where provider supports it.
- Periodic restore test.
- Backup access limited to authorized technical administrators.
- Backup status monitored.

## Monitoring And Alerts

Monitor:

- API health.
- Web app availability.
- Database health.
- Redis/queue health.
- Failed jobs.
- Webhook failures.
- Error logs.
- Slow requests.
- Storage usage.
- Failed login spikes.

## Provider Decisions Needed

Client/team must confirm:

- GitHub/GitLab repository location.
- Hosting/cloud provider.
- Domain/DNS access.
- PostgreSQL provider.
- Redis provider.
- S3-compatible object storage provider.
- Email/SMTP provider.
- Meta Business Manager access.
- WhatsApp Business number.
- AI/OCR provider.
- SIP/telephony provider if calls are required.
- Firebase account.
- Google Play Console and Apple Developer accounts.

## Staging Acceptance

Staging is ready when:

- Web app opens on HTTPS staging URL.
- Backend health check passes.
- Database connection works.
- Redis queue test passes.
- Private file upload and signed URL test passes.
- Auth login smoke test passes.
- Audit log write test passes.
- Environment variables are separate from production.
- Basic rollback/deploy process is documented.

## Week 2 DevOps Deliverables

- Repository created.
- Branch protection agreed.
- Docker/local setup draft.
- Staging provider chosen.
- Initial CI pipeline skeleton.
- Database/Redis/storage selected.
- Environment variable inventory.
- Health check endpoint.
