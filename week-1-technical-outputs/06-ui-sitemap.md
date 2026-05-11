# Week 1 UI Sitemap - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Draft for Week 1 review

This sitemap defines the first navigation structure for admin, employee, client, partner/referral, and Flutter mobile experiences.

## UI Principles

- Build the actual work system first, not a marketing landing page.
- Use shared AppShell, Sidebar, Topbar, DataTable, FilterBar, StatusBadge, Timeline, FileUpload, DocumentPreview, NotesPanel, modals, and states.
- Light and dark theme must work from day 1.
- Frontend permission hiding is UX only. Backend must enforce every action.
- Feature screens must not hard-code colors or one-off status badges.
- All empty, loading, error, forbidden, and no-results states must be included.
- Use Tashfeen terminology only: client, lead, consultant, case, visa/service, target country, documentation, processing, finance, appointment, partner/referral, WhatsApp, client portal.

## Global Shell

Shared shell elements:

- Topbar: search, notifications, theme toggle, user menu.
- Sidebar: role-based navigation.
- Breadcrumbs: for nested records.
- PermissionGate: hide actions unavailable to current role.
- Global confirmation dialog.
- Global toast/notification pattern.
- Session timeout handling.
- Forbidden screen.
- Error boundary/state.

## Admin Portal Sitemap

### Dashboard

- Operations overview.
- Leads summary.
- Open cases.
- Pending documents.
- Appointments today.
- Overdue payments.
- Employee activity snapshot.
- Integration health snapshot.

### Leads

- All leads inbox.
- Lead detail.
- Lead assignment/reassignment.
- Lead duplicate review.
- Source/campaign filters.
- Lead timeline.
- Lead import/export.

### Clients And Cases

- Client list.
- Client profile.
- Client timeline.
- Case list.
- Case detail.
- Case stage board.
- Department handover.
- Escalations.

### Documents

- Document review overview.
- Client document checklist.
- Document preview.
- OCR/classification result panel.
- Verification/rejection/replacement actions.
- Expiring/missing document views.

### WhatsApp And Communications

- Supervisor inbox.
- Conversation detail.
- Bot/human handover.
- Message templates.
- Bot flows.
- Voice note transcript viewer.
- Communication history by client.

### Appointments

- Admin calendar.
- Employee calendar view.
- Appointment type settings.
- Booking/reschedule/cancel.
- Reminder status.

### Finance

- Finance dashboard.
- Payment queue.
- Payment detail.
- Invoice generator.
- Receipt management.
- Installments.
- Refund workflow.
- Revenue reports.

### Partners/Referrals

- Partner list.
- Partner detail.
- Referral submissions.
- Referral status tracking.
- Optional commission/notes view.

### Reports

- Daily operations.
- Lead source/conversion.
- Employee performance.
- Appointment report.
- Document report.
- Case processing report.
- Revenue report.
- Export logs.

### Administration

- Users.
- Roles and permissions.
- Departments.
- Branches.
- Services.
- Target countries.
- Status configuration.
- Document requirements.
- Message templates.
- Integration settings.
- Security settings.
- Audit logs.

### Phase 2 Basic

- Device registry.
- Attendance dashboard.
- Leave/overtime basics.
- Social campaigns.
- Content drafts and approvals.
- Basic enterprise operations/settings.

## Employee Portal Sitemap

### Common Employee Screens

- My dashboard.
- My work queue.
- My notifications.
- Client/lead profile.
- Communication panel.
- Notes panel.
- Activity timeline.
- Task handover.
- Daily work report.

### Sales/Consultant

- Assigned leads.
- Lead detail.
- Screening form.
- Hot/warm/cold priority.
- WhatsApp reply and AI suggested reply.
- Appointment booking.
- Document request.
- Convert/reject lead.
- Handover to documentation/processing.
- Sales performance summary.

### Documentation

- Document queue.
- Client document checklist.
- Document preview.
- AI/OCR result review.
- Missing/expired/rejected/replacement views.
- Notify client templates.
- Handover to processing.
- Documentation performance report.

### Processing

- Converted case queue.
- Case stage board.
- Application detail review.
- Processing notes.
- Proof/receipt upload.
- Missing information request.
- Submit/update/close/escalate actions.
- Processing performance report.

### Finance

- Payment queue.
- Client payment profile.
- Add payment received.
- Verify payment.
- Invoice and receipt screens.
- Installment tracker.
- Refund request/complete.
- Revenue and overdue payment reports.

### Support/Call Center

- Ticket/follow-up queue.
- Missed call list.
- Appointment confirmation.
- Client query reply.
- Escalation.
- Ticket resolved/closed.

### Marketing

- Social lead dashboard.
- Campaign list.
- Lead qualification/routing.
- AI content idea generator.
- Caption/script draft.
- Content calendar.
- Approval before posting.
- Basic analytics.

## Client Portal Sitemap

- Client login/password reset or OTP.
- Client dashboard.
- Case status.
- Case timeline.
- Required document checklist.
- Document upload.
- Missing information form.
- Appointment history/upcoming appointments.
- Payment and receipts.
- Assigned consultant details.
- Notifications.
- Profile settings.

Client portal must show only the client's own records and client-safe timeline events.

## Partner/Referral Portal Sitemap

- Partner login/password reset.
- Partner dashboard.
- New referral submission.
- Referral list.
- Referral detail with safe limited status.
- Optional commission/earning summary if approved.
- Partner profile/settings.
- Notifications.
- Referral terms acknowledgement.
- Contact admin/support.

Partner portal must never expose full client documents, private case notes, audit logs, or unrelated referrals.

## Flutter Mobile Sitemap

### Shared

- Splash.
- Login.
- Forgot password.
- Notification permission prompt.
- Theme preference.

### Employee Mobile

- Employee dashboard.
- Assigned leads/tasks.
- Lead/client detail.
- WhatsApp/contact actions through approved backend flows.
- Appointment alerts.
- Case status view.
- Document upload/view where permitted.
- Push notifications.
- Attendance check-in/check-out basic.

### Client Mobile

- Client dashboard.
- Case status.
- Required documents.
- Camera/file document upload.
- Appointment history/upcoming appointments.
- Notifications.
- Payment/receipt view.
- Consultant details.

## Common Record Page Layout

For lead/client/case pages:

- Header: name, status, owner, priority, service, target country.
- Action bar: permission-based actions.
- Summary panel: key fields.
- Tabs: timeline, notes, documents, communication, appointments, finance, AI outputs, audit-safe history where allowed.
- Right panel: next actions, assigned employee, reminders, risk flags.

## Required UI States

Every data screen needs:

- LoadingState.
- ErrorState.
- EmptyState.
- ForbiddenState.
- NoResultsState.
- Saving/disabled action state.
- Confirmation dialog for destructive/sensitive actions.
- Validation messages.
- Audit-impact warning for sensitive actions where useful.

## Week 2 UI Deliverables

- AppShell wireframe.
- Sidebar route tree by role.
- Login screen wireframe.
- Admin dashboard wireframe.
- Lead list/detail wireframe.
- Client profile wireframe.
- Document review wireframe.
- Design system component inventory.
