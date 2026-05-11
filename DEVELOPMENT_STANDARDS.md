# Tashfeen AI Platform - Development Standards And System Instructions

These instructions are mandatory for the Tashfeen Immigration Solutions AI Platform. The platform is a serious long-term business system for leads, clients, immigration cases, documents, WhatsApp communication, payments, appointments, AI outputs, employees, departments, reports, and mobile users.

Build it as an enterprise-grade operational platform, not a quick website or demo.

## 1. Non-Negotiable Principles

- No shortcut code, temporary hacks, or screen-only logic.
- No frontend-only security.
- No public document URLs.
- No production secrets in code.
- No AI final decisions.
- No WhatsApp app call recording promise.
- No mixed terminology from other projects.
- No hard-coded colors inside feature components.
- No hard-coded business logic where admin configuration is expected.
- No direct production changes without deployment process.
- No new scope without written change request.
- No milestone completion without UAT checklist.

Every module must follow:

- Clean architecture.
- Clear naming.
- Strict typing.
- Server-side security.
- Audit logging.
- Proper validation.
- Reusable components.
- Database consistency.
- Predictable APIs.
- Readable code.
- No project mixing.
- Configurable business logic where appropriate.

## 2. Approved Terminology

Use only Tashfeen-specific terminology:

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

Do not use unrelated project terminology:

- candidate
- worker
- manpower
- recruitment
- employer
- job order
- recruitment order
- random user type
- temp table
- final_final_table
- test2
- new_module_latest

## 3. Approved Architecture

Use the approved architecture for Version 1:

- Web portals: Next.js / React / TypeScript.
- Backend: NestJS / Node.js modular monolith.
- Database: PostgreSQL as source of truth.
- ORM/query layer: Prisma or approved ORM.
- Queue/jobs: Redis + BullMQ.
- AI/OCR/transcription workers: Python FastAPI.
- Document storage: S3-compatible private storage.
- Mobile app: Flutter for Android/iOS.
- Deployment: Dockerized staging and production.

Do not create microservices for Version 1 unless there is a real approved reason later. Use a strong modular monolith with clear internal module boundaries.

## 4. Backend Rules

Every backend module must have:

- controller
- service
- repository/data access
- DTOs
- validators
- permission guards
- audit logging
- tests where practical

Example modules:

- auth
- users
- roles
- departments
- leads
- client cases
- documents
- appointments
- WhatsApp
- finance
- reports
- AI jobs
- attendance
- devices
- audit logs

Controllers should only:

- receive request
- validate DTO
- check permission/guard
- call service
- return response

Services contain business rules. Repositories handle database queries. Do not put business logic directly inside controllers.

## 5. Frontend Rules

Frontend must use reusable components. Do not repeat UI code screen by screen.

Required shared components:

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

All screens must be role-aware. Frontend permission hiding is for UX only; backend must still enforce every permission.

## 6. TypeScript Rules

Use strict TypeScript.

Do:

- use strict types
- use DTOs
- use typed API responses
- use Zod or equivalent validation for forms
- keep shared types in a shared package if monorepo is used
- fix TypeScript errors instead of ignoring them

Do not:

- use `any` as a habit
- pass raw untyped API data around
- disable strict mode
- ignore TypeScript errors
- use random object shapes without types

## 7. Database Rules

PostgreSQL is the source of truth.

Every important business table should include:

- id
- created_at
- updated_at
- created_by_user_id where applicable
- updated_by_user_id where applicable
- deleted_at where soft delete is needed
- status where workflow applies
- ownership fields where access is scoped

Important ownership fields:

- client_id
- lead_id
- case_id
- assigned_employee_id
- department_id
- partner_id
- branch_id

Before creating a table, consider:

- access control
- audit trail
- reporting
- indexes
- future search/filtering
- soft delete
- data ownership

Required indexes:

- client phone
- client email
- lead phone
- lead email
- lead status
- assigned employee
- case status
- document status
- payment status
- appointment date
- audit entity lookup
- activity timeline lookup

## 8. API Rules

Use predictable REST-style APIs first.

Examples:

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

Every API must define:

- request body
- response body
- validation rules
- permission key
- audit log behavior
- possible error responses

Do not create random naming patterns. Do not expose internal database structure directly if it creates security or maintenance risk.

## 9. Permission And RBAC Rules

Every protected action needs a permission key.

Examples:

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

Backend must check:

1. Is the user logged in?
2. Does the user have the permission?
3. Does the user own or have access to this record?
4. Is this action allowed for the current status?

Do not rely only on hidden frontend buttons.

## 10. Audit Logging Rules

Every important action must create an audit log.

Audit these actions:

- login/logout
- failed login
- user creation/update/deactivation
- role/permission changes
- lead assignment/reassignment
- lead conversion/rejection
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

Audit log should store:

- actor_user_id
- action
- entity_type
- entity_id
- old_values
- new_values
- ip_address
- user_agent
- created_at

No sensitive workflow should exist without audit.

## 11. Activity Timeline Rules

Each lead, client, and case should have a readable activity timeline.

Timeline should show:

- lead created
- assigned to consultant
- WhatsApp conversation started
- appointment booked
- document requested
- document uploaded
- document verified/rejected
- case moved to processing
- payment received
- case status changed
- AI summary generated
- handover completed

Audit log is for system/legal tracking. Timeline is for staff visibility. Both are needed.

## 12. Security Rules

Security is mandatory.

Required:

- HTTPS only
- secure password hashing using Argon2id or bcrypt
- short-lived access tokens
- refresh token rotation
- HttpOnly cookies for web where possible
- secure token storage for Flutter
- server-side RBAC
- ownership checks
- signed URLs for files
- private document storage
- no public document links
- rate limiting on auth and webhooks
- failed login protection
- environment secrets outside code
- separate staging and production secrets
- 2FA-ready admin design
- daily backups
- restore testing before handover

Never commit:

- API keys
- database URLs
- WhatsApp tokens
- AI keys
- SMTP passwords
- private keys
- production credentials

## 13. File And Document Rules

Documents are sensitive.

Rules:

- store files in private S3-compatible bucket
- never expose direct public URLs
- generate signed URLs only after permission check
- signed URLs should expire quickly
- store file metadata in database
- support document versions
- do not overwrite old files silently
- log document views and reviews
- validate file type and size
- reject dangerous file types
- keep document status clear

Document statuses:

- uploaded
- under_review
- verified
- rejected
- expired
- missing
- replacement_requested
- manual_review_required

## 14. AI Rules

AI must assist, not decide.

AI modules may include:

- AI messaging suggestion
- document classification
- OCR extraction
- voice note transcription
- call summary
- interview summary
- business plan generation
- social content draft

Every AI output should store:

- input reference
- job type
- provider/model
- prompt/template version
- output
- status
- reviewed_by_user_id
- review_status
- created_at
- error if failed

Do not let AI approve documents, reject clients, give final legal advice, or make final immigration decisions.

## 15. WhatsApp Rules

WhatsApp must follow Meta API rules.

Build:

- webhook receiver
- message storage
- template manager
- bot flow state machine
- human handover
- conversation history
- error logs
- retry logic

Do not promise:

- guaranteed template approval
- guaranteed Meta approval
- WhatsApp app call recording
- unlimited marketing messages
- automation outside Meta policy

WhatsApp app calls should not be treated as reliably recordable. Recordable calls should use SIP/telephony provider.

## 16. Queue And Job Rules

Use queue jobs for slow or external work.

Queue these:

- WhatsApp sending
- email sending
- appointment reminders
- document OCR
- AI summaries
- interview processing
- business plan generation
- report exports
- push notifications
- webhook retries

Every job should track:

- status
- attempts
- retry rules
- error message
- created_at
- processed_at
- completed_at
- failed_at

Do not run slow AI/OCR tasks directly inside request/response APIs.

## 17. UI/UX Quality Rules

The UI should be professional CRM/operations style.

Do:

- keep dashboards clean
- use tables with filters
- use consistent status badges
- show loading/empty/error states
- make forms clear
- use confirmation modals for risky actions
- show audit/timeline where useful
- make screens fast for daily office work
- support light and dark theme from day one
- use design tokens

Do not:

- build decorative landing-page style admin screens
- hard-code colors inside components
- create inconsistent button styles
- create confusing navigation
- hide important statuses
- make staff click too many times for daily actions

## 18. Theme Rules

Light and dark theme must be supported from day one.

Use design tokens/CSS variables for:

- background
- surface
- text
- muted text
- border
- primary
- action
- accent
- success
- warning
- error
- info
- shadows
- radius
- spacing

Components must use tokens, not direct hex values. User theme preference should be saved where possible.

## 19. Mobile App Rules

Flutter app must use the same backend APIs and server permissions.

Mobile v1 should focus on:

- employee login
- client login
- employee dashboard
- client dashboard
- assigned leads/tasks
- case status
- document upload
- appointments
- notifications
- attendance check-in/out basic

Do not overload mobile v1 with every admin feature.

## 20. DevOps Rules

Use proper environments:

- local
- staging/UAT
- production

Required:

- Docker setup
- CI/CD pipeline
- environment variables
- database migrations
- backup plan
- rollback plan
- health checks
- error logging
- queue failure alerts
- production deployment checklist

Do not deploy directly from a developer laptop to production without process.

## 21. Testing Rules

Minimum tests should cover:

- auth login/logout
- RBAC permission blocking
- lead creation
- duplicate lead detection
- lead assignment
- WhatsApp webhook handling
- appointment booking
- document upload
- document review
- case handover
- payment verification
- report export
- client access isolation
- partner access isolation
- employee assigned-only access
- signed file URL access

Before every milestone, run the UAT checklist.

## 22. Error Handling Rules

Do:

- return clear API error messages
- log internal errors
- avoid exposing secrets
- show user-friendly frontend messages
- handle provider/API failure gracefully
- mark blocked integrations clearly

Do not:

- show raw stack traces to users
- silently fail
- lose failed webhook data
- ignore failed jobs
- crash screens without fallback

## 23. Business Logic Configuration Rules

Important business logic should be configurable where admin may need changes.

Configurable examples:

- lead statuses
- case statuses
- document requirements
- appointment types
- departments
- roles
- services
- countries
- message templates
- payment statuses

Do not hard-code everything into code if admin may need to change it later.

## 24. Design System And Shared Component Library

All repeated UI must come from a central design system and shared component library.

Before building full screens, create one shared system for:

- labels
- buttons
- badges
- tables
- forms
- modals
- sidebars
- cards
- icons
- colors
- spacing
- typography
- status styles
- empty/loading/error states

### 24.1 Recommended Structure

```text
packages/ui/
  components/
    Button.tsx
    Badge.tsx
    StatusBadge.tsx
    DataTable.tsx
    Input.tsx
    Select.tsx
    Textarea.tsx
    Modal.tsx
    Card.tsx
    Tabs.tsx
    Timeline.tsx
    FileUpload.tsx
    DocumentPreview.tsx
    EmptyState.tsx
    LoadingState.tsx
    ErrorState.tsx
    ConfirmationDialog.tsx

  tokens/
    colors.ts
    spacing.ts
    typography.ts
    radius.ts
    shadows.ts
    statusColors.ts

  config/
    leadStatus.ts
    caseStatus.ts
    documentStatus.ts
    paymentStatus.ts
    appointmentStatus.ts
    navigation.ts
    permissions.ts
```

### 24.2 Design Tokens

All colors, spacing, radius, typography, shadows, and status colors must come from tokens.

Example:

```ts
export const statusTokens = {
  lead: {
    new: { label: "New", color: "info" },
    duplicate_review: { label: "Duplicate Review", color: "warning" },
    assigned: { label: "Assigned", color: "info" },
    contacted: { label: "Contacted", color: "primary" },
    follow_up: { label: "Follow-Up", color: "warning" },
    hot: { label: "Hot", color: "danger" },
    warm: { label: "Warm", color: "warning" },
    cold: { label: "Cold", color: "muted" },
    converted: { label: "Converted", color: "success" },
    rejected: { label: "Rejected", color: "danger" },
    closed: { label: "Closed", color: "muted" }
  }
}
```

Screens should use:

```tsx
<StatusBadge type="lead" status={lead.status} />
```

Not:

```tsx
<span className="bg-red-500 text-white">Hot</span>
```

### 24.3 Button Standards

Required button variants:

- primary
- secondary
- outline
- ghost
- destructive
- success
- warning
- link

Required button sizes:

- sm
- md
- lg
- icon

Use:

```tsx
<Button variant="primary" size="md">Create Lead</Button>
<Button variant="destructive" size="sm">Reject Document</Button>
<Button variant="outline" size="sm">View Timeline</Button>
```

Do not create random button styles on every page.

### 24.4 Status Badge Standards

Create one reusable `StatusBadge` for:

- lead status
- case status
- document status
- payment status
- appointment status
- task status
- referral status
- AI job status

Statuses must come from central config, not hardcoded per screen.

### 24.5 Form Components

Create shared form components:

- TextInput
- PhoneInput
- EmailInput
- Select
- MultiSelect
- DatePicker
- TimePicker
- Textarea
- FileInput
- SearchInput
- CurrencyInput
- StatusSelect
- CountrySelect
- ServiceSelect
- EmployeeSelect
- DepartmentSelect

Each field should support:

- label
- placeholder
- helper text
- error message
- required state
- disabled state
- loading state

### 24.6 DataTable Standards

Create one reusable `DataTable` supporting:

- search
- filters
- sorting
- pagination
- column visibility
- row actions
- bulk actions where needed
- loading state
- empty state
- export button where allowed
- permission-based actions

Use it for leads, clients, documents, processing queue, payments, appointments, employees, partners/referrals, and reports.

### 24.7 Dashboard Components

Create shared dashboard components:

- KpiCard
- MetricCard
- QueueCard
- AlertCard
- ActivityCard
- ChartCard
- DepartmentSummaryCard

### 24.8 Modal Standards

Create shared modals:

- ConfirmationDialog
- AssignmentModal
- HandoverModal
- DocumentReviewModal
- PaymentVerificationModal
- AppointmentModal
- AddNoteModal
- RejectReasonModal
- EscalationModal

Risky actions must use confirmation or reason modals.

### 24.9 Navigation Config

Sidebar/menu items must come from central config and respect permission keys.

Example:

```ts
export const adminNavigation = [
  { label: "Dashboard", href: "/admin/dashboard", permission: "reports.view_dashboard" },
  { label: "Leads", href: "/admin/leads", permission: "leads.view_all" },
  { label: "Documents", href: "/admin/documents", permission: "documents.view_all" },
  { label: "Finance", href: "/admin/finance", permission: "finance.view" }
]
```

Do not hard-code sidebar items directly inside layout files.

### 24.10 PermissionGate

Create a `PermissionGate` component:

```tsx
<PermissionGate permission="leads.assign">
  <Button>Assign Lead</Button>
</PermissionGate>
```

Frontend permission hiding improves UX only. Backend must still enforce permissions.

### 24.11 Empty, Loading, And Error States

Every screen must have:

- loading state
- empty state
- error state

Example:

```tsx
<LoadingState message="Loading leads..." />

<EmptyState
  title="No leads found"
  description="New leads will appear here when received from WhatsApp, website, or social campaigns."
/>

<ErrorState
  title="Could not load documents"
  description="Please try again or contact admin if the issue continues."
/>
```

Do not leave blank white screens.

### 24.12 Icons

Use one icon library only.

Recommended:

- lucide-react for web.
- Flutter equivalent icon set for mobile.

Do not mix random icon libraries unless approved.

### 24.13 Business Labels

Some labels should come from backend/database because admin may change them later.

Backend-configurable:

- services
- countries
- lead statuses
- case statuses
- document requirements
- appointment types
- departments
- branches
- message templates
- payment statuses

Frontend-static:

- button variants
- component sizes
- spacing
- typography
- theme tokens
- layout components

## 25. Recommended Frontend Folder Structure

```text
apps/web/
  app/
    admin/
    employee/
    client/
    partner/

  components/
    layout/
    forms/
    tables/
    feedback/
    modals/
    navigation/
    timeline/
    documents/
    reports/

  config/
    navigation.ts
    statuses.ts
    permissions.ts

  lib/
    api/
    auth/
    validation/
    utils/

  styles/
    tokens.css
    globals.css

packages/ui/
  Button.tsx
  Badge.tsx
  StatusBadge.tsx
  DataTable.tsx
  Card.tsx
  Modal.tsx
  Input.tsx
```

## 26. Design System Deliverables Before Full UI Development

Prepare these before full screen development:

1. Color tokens.
2. Typography tokens.
3. Spacing/radius/shadow tokens.
4. Button component.
5. Badge/StatusBadge component.
6. Input/select/textarea components.
7. DataTable component.
8. Modal/dialog component.
9. Card/KPI card components.
10. Timeline component.
11. FileUpload component.
12. Empty/loading/error states.
13. Sidebar/topbar layout.
14. PermissionGate component.
15. Light/dark theme implementation.

## 27. Definition Of Done

A task is not complete until:

- code is written
- code is reviewed
- permission checks are added
- validation is added
- audit/timeline is added where needed
- error handling is added
- UI states are added
- tested on staging
- acceptance criteria passed
- no obvious security issue remains

## 28. Development Order

Do not start with AI, WhatsApp, or fancy dashboards first.

Correct order:

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

## 29. Project Management Rules

Every task must have:

- module
- description
- owner
- priority
- dependency
- acceptance criteria
- milestone
- status

Use board statuses:

- Backlog
- Ready for Development
- In Progress
- Code Review
- Testing
- UAT
- Approved
- Blocked
- Change Request

No verbal scope changes. Every change must be documented.

## 30. Final Instruction

Build this system like another senior developer will audit it later.

Every decision should be explainable. Every sensitive action should be logged. Every user should only see what they are allowed to see. Every module should be maintainable. Every screen should support real daily office work.

We are not building a demo. We are building the operational backbone for Tashfeen Immigration Solutions.
