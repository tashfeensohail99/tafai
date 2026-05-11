# Copilot Instructions - Tashfeen AI Platform

These instructions apply to all code and documentation work in this repository. Also follow the full project standards in `DEVELOPMENT_STANDARDS.md`.

## Project Identity

This repository is for the Tashfeen Immigration Solutions AI Platform, an enterprise-grade overseas consultancy/immigration CRM and automation system.

Use only Tashfeen terminology:

- client
- lead
- consultant
- case
- visa/service
- target country
- documentation
- processing
- finance
- appointment
- partner/referral
- WhatsApp
- client portal
- document requirement
- client document
- activity timeline

Do not use unrelated terms such as candidate, worker, manpower, recruitment, employer, job order, or recruitment order.

## Approved Architecture

Use the approved Version 1 architecture:

- Web portals: Next.js / React / TypeScript.
- Backend: NestJS / Node.js modular monolith.
- Database: PostgreSQL.
- ORM/query layer: Prisma or approved ORM.
- Queue/jobs: Redis + BullMQ.
- AI worker: Python FastAPI.
- Storage: S3-compatible private object storage.
- Mobile: Flutter.
- Deployment: Dockerized local, staging/UAT, and production.

Do not introduce microservices unless explicitly approved. Keep Version 1 as a clean modular monolith with a separate AI worker service.

## Engineering Principles

Build this as a long-term business platform, not a demo. Avoid shortcut code, temporary hacks, screen-only logic, copy-paste modules, and hidden assumptions.

Every module must prioritize:

- clean architecture
- strict typing
- server-side security
- validation
- RBAC and ownership checks
- audit logging
- activity timeline where useful
- reusable components
- predictable APIs
- database consistency
- maintainable naming
- staging-tested changes

## Backend Rules

NestJS backend modules should use:

- controller
- service
- repository/data access
- DTOs
- validators
- permission guards
- audit logging
- tests where practical

Controllers receive requests, validate DTOs, check guards, call services, and return responses. Business logic belongs in services. Database queries belong in repositories/data access.

Every protected API must define:

- request body
- response body
- validation rules
- permission key
- ownership/access rules
- audit log behavior
- possible errors

Use predictable REST-style routes such as:

- POST /leads
- GET /leads
- GET /leads/:id
- PATCH /leads/:id
- POST /leads/:id/assign
- POST /leads/:id/convert
- GET /clients/:id/timeline
- POST /documents/upload
- POST /documents/:id/review
- POST /payments/:id/verify

## RBAC And Security

Frontend permission hiding is not security. Backend must always check:

1. The user is authenticated.
2. The user has the required permission key.
3. The user owns or is allowed to access the record.
4. The current status allows the action.

Use permission keys like:

- leads.view_all
- leads.view_assigned
- leads.create
- leads.assign
- leads.convert
- clients.view_assigned
- documents.verify
- finance.verify_payment
- reports.export
- audit.view
- settings.manage

Never expose public document URLs. Use private S3-compatible storage and short-lived signed URLs after permission checks.

Never commit API keys, database URLs, WhatsApp tokens, AI keys, SMTP passwords, private keys, or production credentials.

## Audit And Timeline

Audit every sensitive action:

- login/logout and failed login
- user/role/permission changes
- lead assignment/reassignment/conversion/rejection
- client profile update
- case status update
- department handover
- document upload/view/review/reject/replacement
- payment/invoice/receipt/refund changes
- report export
- WhatsApp message sent
- AI output reviewed
- admin setting change
- device access change
- attendance manual override

Audit log fields should include actor_user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent, and created_at.

Lead/client/case screens should have readable activity timelines for staff visibility. Audit logs and timelines are separate concepts and both are needed.

## Database Rules

PostgreSQL is the source of truth. Important business tables should include id, created_at, updated_at, created_by_user_id, updated_by_user_id, deleted_at where needed, status where workflow applies, and ownership fields such as client_id, lead_id, case_id, assigned_employee_id, department_id, partner_id, and branch_id.

Consider access control, audit trail, reporting, indexes, filtering, soft delete, and data ownership before creating tables.

Required indexes include client/lead phone and email, lead status, assigned employee, case status, document status, payment status, appointment date, audit entity lookup, and activity timeline lookup.

## Frontend And Design System

Use a shared design system and UI component library. Do not create random buttons, badges, tables, forms, modals, cards, labels, or status styles on each screen.

Required shared components include:

- AppShell
- Sidebar
- Topbar
- DataTable
- FilterBar
- StatusBadge
- Timeline
- FileUpload
- DocumentPreview
- NotesPanel
- AssignmentModal
- HandoverModal
- ConfirmationDialog
- NotificationCenter
- EmptyState
- LoadingState
- ErrorState
- PermissionGate

Use central design tokens for colors, spacing, radius, typography, shadows, and status colors.

Light and dark theme support is required from day one. Do not hard-code colors in feature components. User theme preference should be saved where possible.

Use one icon library for web, preferably lucide-react. Use the Flutter equivalent icon set for mobile.

## Status And Business Labels

Status badges must come from central config, not one-off JSX.

Examples:

- `<StatusBadge type="lead" status={lead.status} />`
- `<StatusBadge type="document" status="verified" />`

Do not write one-off status spans like `bg-red-500` directly in screens.

Backend-configurable labels include services, countries, lead statuses, case statuses, document requirements, appointment types, departments, branches, message templates, and payment statuses.

## AI Rules

AI assists only. AI must not approve documents, reject clients, give final legal/immigration/financial advice, or make final decisions.

AI jobs and outputs should store input reference, job type, provider/model, prompt/template version, output, status, reviewed_by_user_id, review_status, created_at, and error if failed.

Run slow AI/OCR/transcription work through Redis/BullMQ jobs and the Python FastAPI worker. Do not execute slow AI/OCR work directly inside request/response APIs.

## WhatsApp And Integrations

WhatsApp must follow Meta API rules. Build webhook receiver, message storage, template manager, bot flow state machine, human handover, conversation history, error logs, and retry logic.

Do not promise guaranteed Meta approval, guaranteed template approval, WhatsApp app call recording, unlimited marketing messages, or automation outside Meta policy.

Recordable calls should use a SIP/telephony provider with proper consent; WhatsApp app calls are not treated as reliably recordable.

## Mobile Rules

Flutter uses the same backend APIs and server-side permissions.

Mobile v1 focuses on employee login, client login, employee dashboard, client dashboard, assigned leads/tasks, case status, document upload, appointments, notifications, and attendance check-in/out basic.

Do not overload mobile v1 with every admin feature.

## DevOps And Testing

Use local, staging/UAT, and production environments. Use Docker, CI/CD, environment variables, migrations, backups, rollback plan, health checks, error logging, queue failure alerts, and production deployment checklist.

Minimum tests should cover auth, RBAC blocking, lead creation, duplicate check, assignment, WhatsApp webhook handling, appointment booking, document upload/review, case handover, payment verification, report export, client isolation, partner isolation, employee assigned-only access, and signed file URL access.

A task is not done until code is reviewed, validation/security/audit are handled where needed, UI states exist, staging testing passes, and acceptance criteria are met.

## Development Order

Follow this order unless a written plan says otherwise:

1. Architecture.
2. ERD/schema.
3. Auth.
4. RBAC.
5. Users/departments.
6. Audit logs.
7. File storage.
8. Admin shell.
9. Employee shell.
10. Lead/client base.
11. Lead assignment.
12. WhatsApp.
13. Appointments.
14. Client portal.
15. Documents.
16. Processing.
17. Finance.
18. Reports.
19. AI modules.
20. Flutter completion.
21. Phase 2 basic.
22. Testing and deployment.

## Final Rule

Build this system like another senior developer will audit it later. Every sensitive action should be logged, every user should only see what they are allowed to see, and every screen should support real daily office work.
