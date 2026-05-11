# Week 1 Technical Output Index - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Week 1 started

This folder contains the first Week 1 technical handoff package for the Tashfeen Immigration Solutions AI Platform.

## Purpose

Use this package to start official technical review before Week 2 coding. The files convert the master plan and development standards into practical architecture, security, API, UI, DevOps, and backlog outputs.

Week 2 production workflow coding should not begin until the approval items below are reviewed.

## Files In This Package

1. 01-architecture-document.md
   - Main technical architecture decision document.
   - Confirms Next.js, NestJS modular monolith, PostgreSQL, Redis/BullMQ, Python FastAPI AI worker, private S3-compatible storage, Flutter, and Dockerized environments.

2. 02-architecture-diagram.mmd
   - Mermaid architecture diagram showing web portals, mobile app, backend API, PostgreSQL, Redis, private storage, AI worker, WhatsApp, social leads, email, push, telephony, and providers.

3. 03-erd-draft.md
   - Database/entity draft with Mermaid ERD and required indexes.
   - Includes organization, identity, leads, clients, cases, documents, communication, finance, AI, audit, activity timeline, devices, attendance, and settings.

4. 04-rbac-permission-matrix.csv
   - Role/permission matrix for Super Admin, Admin/Manager, Sales/Consultant, Documentation, Processing, Finance, Support, Marketing, Client, and Partner/Referral.
   - Defines server-side permission keys and ownership rules.

5. 05-api-module-map.md
   - REST-style API module map.
   - Covers auth, users, roles, leads, referrals, clients, cases, documents, WhatsApp, appointments, finance, AI jobs, reports, audit, notifications, devices, attendance, integrations, and settings.

6. 06-ui-sitemap.md
   - Admin, employee, client, partner/referral, and Flutter mobile sitemap.
   - Defines common layouts, role-aware navigation, record page patterns, and required UI states.

7. 07-design-system-starter.md
   - Design tokens, status badge config, shared component list, theme requirements, and frontend structure recommendation.
   - Confirms light/dark theme from day 1.

8. 08-devops-staging-plan.md
   - Local, staging/UAT, and production environment plan.
   - Includes repository, CI/CD, secrets, backups, monitoring, deployment, and staging acceptance criteria.

9. 09-week-1-4-backlog.csv
   - Board-ready Week 1-4 backlog.
   - Can be imported into GitHub Projects, ClickUp, Trello, Jira, Linear, or a spreadsheet.

10. 10-risk-and-blocker-register.csv
   - Week 1 risk and blocker register.
   - Tracks owner, due week, impact, and mitigation for project blockers.

## Review Order

Recommended review order:

1. Architecture document.
2. ERD draft.
3. RBAC permission matrix.
4. API module map.
5. UI sitemap.
6. Design system starter.
7. DevOps/staging plan.
8. Week 1-4 backlog.
9. Risk/blocker register.

## Week 1 Approval Checklist

Before Week 2 coding starts, approve or revise:

- Architecture document.
- Architecture diagram.
- ERD draft.
- RBAC permission matrix.
- API module map.
- UI sitemap.
- Design system starter.
- DevOps/staging plan.
- Week 1-4 backlog.
- Risk/blocker register.
- Development standards.
- Corrected agreement amount and payment schedule.

## Client Decisions Still Needed

The project still needs confirmation of:

- Final signed agreement DOCX/PDF corrected to CAD 10,500.
- Payment schedule CAD 2,000 / 2,000 / 2,000 / 2,500 / 2,000.
- Project start date.
- Main approver and backup approver.
- Communication channel.
- Services list.
- Target countries list.
- Departments and employee list.
- Roles and permission adjustments.
- Lead, case, document, payment, and appointment statuses.
- Document requirements by service and country.
- WhatsApp/email/message templates.
- Hosting, domain, Meta, WhatsApp, SMTP, AI/OCR, storage, Redis, Firebase, app store, and telephony access.

## Immediate Next Actions

1. Send this folder plus DEVELOPMENT_STANDARDS.md to the dev/team.
2. Import 09-week-1-4-backlog.csv into the chosen project board.
3. Review 10-risk-and-blocker-register.csv and assign owners.
4. Confirm the Week 2 coding gate using week-2-coding-gate-checklist.txt in the workspace root.
5. Regenerate agreement.docx and agreement.pdf from corrected agreement.txt before signing or sharing externally.

## Important Commercial Note

agreement.txt is corrected to CAD 10,500. The original agreement.docx and agreement.pdf still need regeneration or manual update before signing because binary originals may still contain old commercial wording.
