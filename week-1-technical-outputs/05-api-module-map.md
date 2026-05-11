# Week 1 API Module Map - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Draft for Week 1 review

This document maps the backend API surface for planning. Detailed DTO schemas, response bodies, validation rules, and tests should be finalized during Week 2 module implementation.

## API Rules

Every protected endpoint must define:

- request body
- response body
- validation rules
- permission key
- ownership/access rules
- status transition rules where applicable
- audit log behavior
- possible errors

Use predictable REST-style routes. Do not expose internal database structure directly where it creates security or maintenance risk.

## Common Error Responses

- 400 validation_failed
- 401 unauthenticated
- 403 forbidden
- 404 not_found
- 409 conflict
- 422 invalid_state_transition
- 429 rate_limited
- 500 internal_error

## Module Map

### Auth

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| POST | /auth/login | public | login/failed_login | Rate limit; return tokens/session safely |
| POST | /auth/logout | auth.logout | logout | Invalidate current session/token |
| GET | /auth/me | authenticated | no | Return current user roles and permissions |
| POST | /auth/password-reset/request | public | password_reset_requested | Rate limit |
| POST | /auth/password-reset/complete | public | password_reset_completed | Token validation |
| POST | /auth/refresh | authenticated | no | Refresh session/token |

### Users, Roles, Departments

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /users | users.view | optional | Filter by role department status branch |
| POST | /users | users.create | user_created | Create employee/client/partner portal account as allowed |
| GET | /users/:id | users.view | optional | Backend scope check |
| PATCH | /users/:id | users.update | user_updated | Safe profile update rules |
| POST | /users/:id/deactivate | users.deactivate | user_deactivated | Cannot deactivate last super admin |
| GET | /roles | roles.view | optional | List roles and permissions |
| POST | /roles | roles.manage | role_created | Validate permission keys |
| PATCH | /roles/:id | roles.manage | role_updated | Audit old/new values |
| DELETE | /roles/:id | roles.manage | role_deleted | Prevent deletion if assigned unless safe migration |
| GET | /departments | branches.manage | optional | Department tree |
| POST | /departments | branches.manage | department_created | Audit change |
| PATCH | /departments/:id | branches.manage | department_updated | Audit change |

### Leads

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| POST | /leads | leads.create | lead_created | Manual/partner lead creation; duplicate checks |
| GET | /leads | leads.view_all or leads.view_assigned | optional | Scope by permission assignment department branch |
| GET | /leads/:id | leads.view_assigned | optional | Ownership check required |
| PATCH | /leads/:id | leads.update | lead_updated | Status transition and allowed field checks |
| POST | /leads/:id/assign | leads.assign | lead_assigned | Audit old/new assigned employee |
| POST | /leads/:id/reassign | leads.assign | lead_reassigned | Reason required |
| POST | /leads/:id/convert | leads.convert | lead_converted | Creates client/case; duplicate check |
| POST | /leads/:id/reject | leads.reject | lead_rejected | Reason required |
| GET | /leads/:id/timeline | clients.timeline.view | no | Readable timeline not raw audit |
| POST | /leads/import | leads.create | lead_imported | Validate CSV/import source |
| GET | /leads/export | leads.export | report_exported | Export log required |

### Partners And Referrals

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| POST | /partners | partners.manage | partner_created | Create partner account/referral code |
| GET | /partners | partners.manage | optional | Admin only |
| GET | /partners/:id | partners.manage | optional | Scope check |
| PATCH | /partners/:id | partners.manage | partner_updated | Audit status/access changes |
| POST | /partners/:id/deactivate | partners.manage | partner_deactivated | Audit required |
| POST | /referrals | leads.create | referral_created | Partner creates safe referral lead |
| GET | /referrals | partners.view_referrals | optional | Partner own only or admin all |
| GET | /referrals/:id | partners.view_referrals | optional | Limited safe status for partner |

### Clients And Cases

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /clients | clients.view_all or clients.view_assigned | optional | Scope by role/assignment/department |
| GET | /clients/:id | clients.view_assigned or clients.view_own | optional | Client sees own only |
| PATCH | /clients/:id | clients.update | client_updated | Sensitive changes audited |
| GET | /clients/:id/timeline | clients.timeline.view | no | Client-safe filtering when portal user |
| GET | /cases | cases.view_all or cases.view_assigned | optional | Department queue filters |
| POST | /cases | cases.update_status | case_created | Usually created by lead conversion |
| GET | /cases/:id | cases.view_assigned | optional | Backend ownership check |
| PATCH | /cases/:id | cases.update_status | case_updated | Status transition rules |
| POST | /cases/:id/handover | cases.handover | case_handover | Reason and target department required |
| POST | /cases/:id/escalate | cases.escalate | case_escalated | Notify manager/admin |
| POST | /cases/:id/notes | cases.update_status | case_note_created | Internal/client-visible flag required |

### Documents

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /document-requirements | documents.view_assigned | optional | Filter by service and target country |
| POST | /document-requirements | settings.manage | document_requirement_created | Admin config |
| PATCH | /document-requirements/:id | settings.manage | document_requirement_updated | Audit old/new |
| POST | /documents/upload | documents.upload | document_uploaded | Private storage; enqueue OCR/classification |
| GET | /documents | documents.view_assigned or documents.view_all | optional | Scope by client/case/department |
| GET | /documents/:id | documents.view_assigned | document_viewed | May audit sensitive views |
| POST | /documents/:id/signed-url | documents.view_assigned | file_signed_url_created | Short-lived signed URL only |
| POST | /documents/:id/review | documents.review | document_reviewed | Add notes/status suggestion |
| POST | /documents/:id/verify | documents.verify | document_verified | Audit required |
| POST | /documents/:id/reject | documents.reject | document_rejected | Reason required |
| POST | /documents/:id/request-replacement | documents.reject | document_replacement_requested | Notify client |

### Communications And WhatsApp

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| POST | /webhooks/whatsapp | webhook_secret | whatsapp_webhook_received | Verify Meta signature/token |
| GET | /conversations | communications.view_assigned or communications.view_all | optional | Scope by assignment/department |
| GET | /conversations/:id | communications.view_assigned | optional | Backend scope check |
| POST | /conversations/:id/messages | communications.send_whatsapp | whatsapp_message_sent | Template/opt-in checks |
| POST | /conversations/:id/handover | communications.handover | conversation_handover | Bot to human or employee transfer |
| GET | /whatsapp/templates | communications.manage_templates | optional | Template list |
| POST | /whatsapp/templates | communications.manage_templates | whatsapp_template_created | Meta approval status tracked |
| PATCH | /whatsapp/templates/:id | communications.manage_templates | whatsapp_template_updated | Audit required |
| GET | /bot-flows | settings.manage | optional | Flow definitions |
| POST | /bot-flows | settings.manage | bot_flow_created | Version flows where practical |

### Appointments

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /appointments | appointments.view_assigned or appointments.view_all | optional | Calendar filters |
| POST | /appointments | appointments.book | appointment_booked | Check availability and appointment type |
| GET | /appointments/:id | appointments.view_assigned | optional | Client own only if portal user |
| PATCH | /appointments/:id | appointments.manage | appointment_updated | Audit reschedule/status changes |
| POST | /appointments/:id/cancel | appointments.manage | appointment_cancelled | Reason required |
| POST | /appointments/:id/reminders | appointments.manage | appointment_reminder_scheduled | Queue reminders |

### Finance

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /payments | finance.view_all or finance.view_related | optional | Scope by client/case/role |
| POST | /payments | finance.create_payment | payment_created | Finance/admin only |
| GET | /payments/:id | finance.view_related | optional | Client sees approved visible fields only |
| PATCH | /payments/:id | finance.create_payment | payment_updated | Audit required |
| POST | /payments/:id/verify | finance.verify_payment | payment_verified | Audit required |
| POST | /payments/:id/refund | finance.refund | refund_created | Approval workflow |
| POST | /invoices | finance.manage_invoice | invoice_created | Numbering rules required |
| GET | /invoices/:id | finance.view_related | optional | Client own approved invoice only |
| POST | /receipts | finance.manage_invoice | receipt_created | Link to payment |

### AI Jobs

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| POST | /ai/jobs | ai_jobs.create | ai_job_created | Enqueue only; do not block request |
| GET | /ai/jobs | ai_outputs.review | optional | Scope by entity and role |
| GET | /ai/jobs/:id | ai_outputs.review | optional | Show prompt/output only to allowed staff |
| POST | /ai/jobs/:id/review | ai_outputs.review | ai_output_reviewed | Human review status required |
| POST | /ai/business-plans | ai_jobs.create | ai_job_created | Generated draft only |
| GET | /ai/business-plans/:id | ai_outputs.review | optional | Versioned output |

### Reports, Audit, Notifications

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /reports/operations | reports.view | optional | Role scoped metrics |
| GET | /reports/leads | reports.view | optional | Source/campaign/conversion filters |
| GET | /reports/finance | reports.view | optional | Finance/admin only for sensitive data |
| GET | /reports/export | reports.export | report_exported | Export log required |
| GET | /audit-logs | audit.view | optional | Admin/super admin only |
| GET | /notifications | authenticated | optional | Current user notifications |
| POST | /notifications/broadcast | notifications.manage | notification_broadcast_created | Role/recipient scoping |

### Devices And Attendance - Phase 2 Basic

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /devices | devices.manage | optional | Employee device registry |
| POST | /devices | devices.manage | device_created | Policy required before activation |
| PATCH | /devices/:id | devices.manage | device_updated | Audit access changes |
| POST | /attendance/check-in | attendance.check_in_out | attendance_check_in | Policy required |
| POST | /attendance/check-out | attendance.check_in_out | attendance_check_out | Policy required |
| GET | /attendance | attendance.view_team | optional | Department scoped |
| POST | /attendance/:id/override | attendance.override | attendance_override | Audit required |

### Integrations And Settings

| Method | Route | Permission | Audit | Notes |
| --- | --- | --- | --- | --- |
| GET | /settings/services | settings.manage | optional | Admin configuration |
| POST | /settings/services | settings.manage | service_created | Audit required |
| GET | /settings/countries | settings.manage | optional | Admin configuration |
| POST | /settings/countries | settings.manage | country_created | Audit required |
| GET | /settings/statuses | settings.manage | optional | Lead/case/document/payment statuses |
| POST | /settings/statuses | settings.manage | status_config_updated | Audit required |
| GET | /integrations | integrations.manage | optional | Do not return secrets |
| PATCH | /integrations/:provider | integrations.manage | integration_updated | Store secrets in env/secret manager only |

## Week 2 API Deliverables

During Week 2, the dev team should produce:

- OpenAPI/Swagger draft.
- DTO request/response definitions for auth, users, RBAC, leads, clients, cases, documents, appointments, communications, finance, AI jobs, audit.
- Validation rules for each create/update endpoint.
- Permission guard strategy.
- Ownership guard strategy.
- Audit event enum.
- Error response format.
