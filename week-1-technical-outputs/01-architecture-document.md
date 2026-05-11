# Week 1 Architecture Document - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Draft for Week 1 review
Source documents: ai.txt, agreement.txt, plan.txt, DEVELOPMENT_STANDARDS.md

## 1. Architecture Decision

Use the approved Version 1 architecture:

- Web portals: Next.js, React, TypeScript.
- Backend API: NestJS, Node.js, modular monolith.
- Database: PostgreSQL.
- ORM/query layer: Prisma or approved ORM.
- Queue/jobs: Redis and BullMQ.
- AI worker: Python FastAPI.
- Object storage: S3-compatible private storage.
- Mobile app: Flutter for Android and iOS.
- Deployment: Dockerized local, staging/UAT, and production.

Do not split the Version 1 platform into microservices. Keep the backend as a modular monolith with strict internal boundaries and a separate AI worker process for slow AI/OCR/transcription work.

## 2. System Context

The platform supports daily Tashfeen Immigration Solutions operations:

- Lead capture and assignment.
- Client and case lifecycle management.
- WhatsApp communication and human handover.
- Appointments and reminders.
- Document requirements, uploads, reviews, replacements, and expiry checks.
- Processing stages and department handovers.
- Finance, invoices, receipts, installments, refunds, and verification.
- Partner/referral submissions and limited tracking.
- Reports, exports, audit logs, and activity timelines.
- AI-assisted OCR, summaries, transcripts, screening, interviews, and business plan drafts.
- Employee/client Flutter mobile access.
- Basic Phase 2 attendance, device registry, and operational monitoring.

## 3. Main Runtime Components

### Web Portals

Next.js hosts role-aware portals:

- Admin portal.
- Employee portal.
- Client portal.
- Partner/referral portal.

Frontend permission hiding improves UX only. The backend remains the source of security enforcement.

### Backend API

NestJS exposes REST-style APIs and owns business rules, validation, RBAC, ownership checks, audit events, and activity timeline writes.

Core backend modules:

- auth
- users
- roles
- departments
- branches
- partners/referrals
- leads
- clients
- cases
- documents
- appointments
- communications/WhatsApp
- finance
- reports
- AI jobs
- notifications
- audit logs
- activity timeline
- attendance
- devices
- integrations
- settings

Each module should use controller, service, repository/data access, DTOs, validators, guards, audit logging, and tests where practical.

### PostgreSQL

PostgreSQL is the source of truth for all operational data. Tables must include ownership, audit, status, and reporting fields where useful.

Key data ownership dimensions:

- branch_id
- department_id
- assigned_employee_id
- client_id
- lead_id
- case_id
- partner_id

### Redis And BullMQ

Redis and BullMQ handle slow or retryable tasks:

- WhatsApp sends and webhook retry.
- Email/push notifications.
- Appointment reminders.
- OCR/document classification.
- AI summaries and generated drafts.
- Voice transcription.
- Report exports.
- Scheduled cleanup and status checks.

Request/response APIs must enqueue slow work instead of blocking the user.

### AI Worker

Python FastAPI worker consumes queued jobs and returns structured outputs to the backend. AI outputs are assistive only and must be reviewable by staff.

AI worker jobs:

- OCR extraction.
- Document classification.
- Expiry detection.
- Duplicate/unclear/wrong-document flags.
- WhatsApp/voice note transcript support.
- Call and interview summaries.
- Business plan draft generation.
- Suggested replies and screening summaries.

AI must never approve documents, reject clients, make final legal/immigration/financial decisions, or bypass staff review.

### Private Object Storage

Client documents, proofs, receipts, call recordings, and generated PDFs must live in private S3-compatible storage. Files are accessed only through short-lived signed URLs after backend permission checks.

No public document URLs are allowed.

### Flutter Mobile App

Flutter consumes the same backend APIs and server-side permissions. Mobile Version 1 focuses on:

- Employee login.
- Client login.
- Employee dashboard.
- Client dashboard.
- Assigned leads/tasks.
- Case status.
- Document upload.
- Appointments.
- Notifications.
- Attendance check-in/out basic.

## 4. Data Flow Examples

### Lead Intake Flow

1. Lead arrives from WhatsApp, Facebook/Instagram, website form, partner/referral, or manual entry.
2. Backend creates lead with source, campaign, service, target country, and consent details.
3. Assignment engine assigns lead by service/country/workload or admin assigns manually.
4. Audit log records lead creation and assignment.
5. Activity timeline records readable lead lifecycle event.
6. Employee receives notification and works from assigned queue.

### Document Review Flow

1. Client uploads document from portal/mobile or staff uploads on behalf of client.
2. Backend stores file privately and creates client_document record.
3. Backend enqueues OCR/classification job.
4. AI worker returns suggested category, extracted fields, expiry, and quality flags.
5. Documentation officer reviews result and verifies/rejects/requests replacement.
6. Backend writes audit log and activity timeline.
7. Client receives WhatsApp/email/app notification if action is needed.

### Case Handover Flow

1. Sales/consultant converts qualified lead to client/case.
2. Backend checks permission, ownership, and current lead status.
3. Case is created and assigned to documentation or processing department.
4. Handover note and attachments are saved.
5. Audit log captures conversion and handover.
6. Activity timeline shows readable lifecycle movement for staff.

### AI Job Flow

1. User or system triggers AI-supported task.
2. Backend validates permission and creates ai_job record.
3. Job is queued in BullMQ.
4. AI worker processes task and stores output/status.
5. Staff reviews output and sets review_status.
6. Sensitive AI output review is audited.

## 5. Security Model

Required controls:

- Authenticated API access for all protected routes.
- Permission key check per protected action.
- Ownership/department/branch scoping per record.
- Status transition checks before workflow actions.
- Password hashing and secure reset flow.
- Session timeout and MFA-ready structure.
- Audit logs for sensitive actions.
- Signed URLs for files only after permission check.
- No secrets in repository.
- Separate local/staging/production env vars.
- Rate limiting for login, password reset, public forms, webhooks where practical.

## 6. Audit And Activity Timeline

Audit logs are immutable technical records for security and compliance.

Activity timelines are readable business history shown on lead/client/case screens.

Both are required.

Audit examples:

- login/logout and failed login.
- user/role/permission changes.
- lead assignment/reassignment/conversion/rejection.
- client profile update.
- case status update.
- department handover.
- document upload/view/review/reject/replacement.
- payment/invoice/receipt/refund changes.
- report export.
- WhatsApp message sent.
- AI output reviewed.
- admin setting change.
- device access change.
- attendance manual override.

## 7. Deployment Environments

Use three environment levels:

- Local development: Docker Compose where practical.
- Staging/UAT: client testing and milestone acceptance.
- Production: final live environment after approval.

Each environment needs separate credentials, database, storage bucket/prefix, Redis, API base URL, and webhook configuration.

## 8. Version 1 Boundaries

Included:

- Full operational CRM foundation.
- Admin/employee/client/partner portals.
- Flutter employee/client app basics.
- WhatsApp and communication workflows subject to Meta access.
- AI assistive workflows subject to provider access.
- Private documents and signed URL access.
- Reports, audit, activity timeline, and UAT process.

Not included without change request:

- Full ERP/accounting/payroll replacement.
- Advanced endpoint control or enterprise MDM.
- Guaranteed Meta approval or template approval.
- Guaranteed WhatsApp app call recording.
- Final legal/immigration/financial decision automation.
- Advanced biometric/GPS attendance enforcement.

## 9. Week 2 Coding Gate

Week 2 coding can begin only after approval of:

- Architecture document.
- Architecture diagram.
- ERD draft.
- RBAC matrix.
- API module map.
- UI sitemap.
- Design system starter.
- DevOps/staging plan.
- Repository/project board setup.
- Week 2 backlog.
