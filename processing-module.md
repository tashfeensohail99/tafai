# Processing Module — System Design
**Tashfeen Immigration Solutions · Independent Technical Plan**
**Prepared:** May 2026 · For internal comparison before build

---

## Table of Contents

1. [Module Overview](#1-module-overview)
2. [Two-Side Architecture](#2-two-side-architecture)
3. [Processing Roles and Permissions](#3-processing-roles-and-permissions)
4. [Case Stage Workflow](#4-case-stage-workflow)
5. [Document States and Lifecycle](#5-document-states-and-lifecycle)
6. [Processing Dashboard — Officer View](#6-processing-dashboard--officer-view)
7. [Processing Intake from Finance](#7-processing-intake-from-finance)
8. [Case Detail / Processing Workspace](#8-case-detail--processing-workspace)
9. [Document Checklist System](#9-document-checklist-system)
10. [Client Document Upload Flow](#10-client-document-flow)
11. [Missing Document Tracking](#11-missing-document-tracking)
12. [Client Reminders System](#12-client-reminders-system)
13. [Expired and Expiring Document Detection](#13-expired-and-expiring-document-detection)
14. [Document Verification and Rejection Reasons](#14-document-verification-and-rejection-reasons)
15. [Correction Request Flow](#15-correction-request-flow)
16. [Case Stage Transitions — Business Rules](#16-case-stage-transition-rules)
17. [Client Communication from Processing](#17-client-communication-from-processing)
18. [Internal Notes and Task Assignment](#18-internal-notes-and-task-assignment)
19. [Client Portal — Processing Side](#19-client-portal--processing-side)
20. [Processing Reports](#20-processing-reports)
21. [Completed / Closed Case Archive](#21-completed--closed-case-archive)
22. [Backend Data Model](#22-backend-data-model)
23. [API Map](#23-api-map)
24. [Critical Backend Rules](#24-critical-backend-rules)
25. [UI Direction — Design System](#25-ui-direction--design-system)
26. [Phase-wise Build Plan](#26-phase-wise-build-plan)

---

## 1. Module Overview

Processing is the **core service delivery module**. It begins the moment
Finance sends a verified, receipt-confirmed payment to Processing and ends
when a case is either completed (approved), closed (rejected/cancelled), or
archived.

Unlike Sales (relationship) and Finance (money), Processing is about
**government compliance, document control, and service execution**. Every
action must be tracked, every document versioned, every deadline visible.

### Hard boundaries

| Rule | Enforcement |
|------|-------------|
| Processing cannot start until Finance sends the case | Backend guard — `processing_cases` cannot be created until `finance_handover_queue.status = 'sent'` |
| Case cannot move to `READY_FOR_SUBMISSION` until all required documents are accepted and no critical expired documents remain | Backend guard — checked at transition time, not just UI |
| All document access is via signed URLs only | No public storage paths ever |
| Every document review decision is immutable (append-only) | No update/delete on review decisions table |
| Every stage change is logged | `processing_audit_log` entry mandatory |

---

## 2. Two-Side Architecture

This module serves two distinct user groups with different interfaces:

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROCESSING MODULE                            │
│                                                                 │
│   PROCESSING TEAM SIDE          │   CLIENT PORTAL SIDE         │
│   (/processing/*)               │   (/portal/*)                │
│                                 │                              │
│   • Dashboard                   │   • My Case overview         │
│   • Intake queue                │   • Document upload          │
│   • Case workspace              │   • Document status          │
│   • Document review             │   • Missing items list       │
│   • Internal notes              │   • Reminder inbox           │
│   • Task assignment             │   • Messages from officer    │
│   • Stage management            │   • Case timeline            │
│   • Reports                     │   • Appointment requests     │
│   • Archive                     │   • Notifications            │
└─────────────────────────────────────────────────────────────────┘
```

Both sides use the **same backend APIs** and **same RBAC system**. The client
portal never exposes officer-internal notes, processing strategy, or other
clients' data.

---

## 3. Processing Roles and Permissions

### Role definitions

| Role | Description |
|------|-------------|
| `processing_officer` | Assigned to cases, reviews documents, communicates with clients |
| `processing_senior` | Does everything an officer does + can reassign cases, override decisions |
| `processing_manager` | Full processing visibility, reports, audit, department config |
| `processing_admin` | Manages checklist templates, document requirements, system config |
| `client` | Client portal only — uploads docs, views their own case, sends messages |

### Permission keys

```
processing.intake.view               — see the intake queue
processing.intake.acknowledge        — claim/acknowledge a new case
processing.case.view_assigned        — view cases assigned to you
processing.case.view_all             — view all cases (manager)
processing.case.assign               — assign/reassign case officer
processing.case.update_stage         — change case stage
processing.document.review           — accept/reject documents
processing.document.waive            — mark a document as waived
processing.document.request          — send correction/missing request to client
processing.note.create               — add internal note
processing.note.view_all             — view all internal notes including manager-only
processing.task.create               — create internal task
processing.task.assign               — assign task to colleague
processing.communication.send        — send message to client
processing.report.view               — view processing reports
processing.report.export             — export reports
processing.archive.view              — view completed/closed case archive
processing.checklist.manage          — manage document requirement templates
```

---

## 4. Case Stage Workflow

```
INTAKE_PENDING
     │
     ▼ (Officer acknowledges)
DOCUMENTS_COLLECTION ◄──────────────────────────────────┐
     │                                                   │
     ▼ (Client uploads, officer begins review)           │
DOCUMENTS_UNDER_REVIEW                                   │
     │                                                   │
     ├──► DOCUMENTS_INCOMPLETE ──── (Client corrects) ──┘
     │
     ▼ (All docs accepted, no critical expiries)
DOCUMENTS_COMPLETE
     │
     ▼ (Officer pre-submission check done)
READY_FOR_SUBMISSION
     │
     ▼ (Application filed)
SUBMITTED
     │
     ▼ (Tracking number received)
UNDER_AUTHORITY_REVIEW
     │
     ├──► ADDITIONAL_INFO_REQUESTED ── (Respond) ──► UNDER_AUTHORITY_REVIEW
     │
     ▼ (Authority issues decision)
DECISION_RECEIVED
     │
     ├──► APPROVED ──► COMPLETED
     ├──► REJECTED
     │         │
     │         └──► APPEAL_IN_PROGRESS ──► UNDER_AUTHORITY_REVIEW
     └──► CANCELLED (at any stage, by manager)
```

### Stage display labels and tones (for StatusBadge)

| Stage | Label | BadgeTone |
|-------|-------|-----------|
| `INTAKE_PENDING` | Intake Pending | `neutral` |
| `DOCUMENTS_COLLECTION` | Collecting Documents | `info` |
| `DOCUMENTS_UNDER_REVIEW` | Under Review | `accent` |
| `DOCUMENTS_INCOMPLETE` | Documents Incomplete | `warning` |
| `DOCUMENTS_COMPLETE` | Documents Complete | `success` |
| `READY_FOR_SUBMISSION` | Ready to Submit | `violet` |
| `SUBMITTED` | Submitted | `cyan` |
| `UNDER_AUTHORITY_REVIEW` | With Authority | `info` |
| `ADDITIONAL_INFO_REQUESTED` | Info Requested | `warning` |
| `DECISION_RECEIVED` | Decision Received | `accent` |
| `APPROVED` | Approved | `success` |
| `REJECTED` | Rejected | `danger` |
| `APPEAL_IN_PROGRESS` | Appeal Filed | `warm` |
| `COMPLETED` | Completed | `success` |
| `CANCELLED` | Cancelled | `neutral` |

---

## 5. Document States and Lifecycle

Each checklist item (a single required document) moves through these states:

```
NOT_SUBMITTED ──► SUBMITTED ──► UNDER_REVIEW ──► ACCEPTED
                                      │
                                      └──► REJECTED ──► (Client resubmits) ──► SUBMITTED
```

Additional states:
- `EXPIRED` — document has a validity date and it has passed
- `EXPIRING_SOON` — expires within the configured threshold (default: 30 days)
- `WAIVED` — officer determined this doc is not required for this specific case
- `NOT_APPLICABLE` — the requirement does not apply (e.g., married-only doc for single applicant)

### Document criticality tiers

Each checklist item is tagged with a criticality level:

| Level | Meaning |
|-------|---------|
| `CRITICAL` | Submission is impossible without it — hard block on `READY_FOR_SUBMISSION` |
| `REQUIRED` | Standard required document — all must be accepted before advancing |
| `CONDITIONAL` | Required only if a condition is met (e.g., has dependants) |
| `SUPPORTING` | Strengthens application but not blocking — can submit without |
| `OPTIONAL` | Purely optional — no effect on stage gates |

---

## 6. Processing Dashboard — Officer View

### Metrics strip (live counts)

| Metric | Source |
|--------|--------|
| My active cases | `processing_cases WHERE assigned_officer_id = me AND stage NOT IN completed/cancelled` |
| Awaiting my review | cases in `DOCUMENTS_UNDER_REVIEW` assigned to me |
| Overdue documents | cases where `case_document_items.deadline < today AND status NOT accepted/waived` |
| Expiring documents (7d) | documents expiring within 7 days on active cases |
| Ready to submit | cases in `READY_FOR_SUBMISSION` |
| New intake (unacknowledged) | cases in `INTAKE_PENDING` |
| Reminders sent today | reminders dispatched today |

### Sections

**My Active Cases** — sortable table with:
- Client name, service, target country
- Current stage (StatusBadge)
- Document progress (e.g., "8 / 12 accepted")
- Expiry alerts (warning chip if any document expiring ≤ 7 days)
- Overdue chip (if any required doc past deadline)
- Days in current stage
- Priority badge
- Quick actions: Open workspace, Send reminder

**New Intake** — flagged section at top when there are unacknowledged cases
from Finance. Each row shows client, amount, service, received date, finance
officer name, and an "Acknowledge & Start" button.

**Document Expiry Alert Panel** — collapsible section. Lists documents
expiring within 30 days across all assigned cases. Grouped by "Critical
(≤7d)", "Soon (8–30d)". Each row: client, document name, expiry date,
action: Send reminder / View case.

**Overdue Tracker** — cases where a document correction was requested and the
client has not responded within the SLA window.

**Manager overlay** (for `processing_manager` role):
- Workload heatmap per officer (cases assigned, avg days to complete)
- Escalations and stuck cases
- Stage distribution (how many cases are in each stage right now)
- Department-level SLA status

---

## 7. Processing Intake from Finance

### Trigger

Finance fires `POST /processing/intake` when they click "Confirm — Send to
Processing". This creates a `processing_cases` record in `INTAKE_PENDING`.

### Intake queue screen

- Sorted: urgency first (URGENT priority, then date received)
- Each card: client name, service, target country, amount paid, receipt number, Finance officer, handover note from Finance, date received
- "Acknowledge & Assign" — assigns to self or to a specific officer (manager only assigns to others)
- Acknowledging moves case to `DOCUMENTS_COLLECTION` and auto-builds the
  document checklist from the template for this service + country combination

### Auto-checklist generation

When a case is acknowledged, the system:
1. Looks up `document_requirement_templates WHERE service = case.service AND country = case.target_country`
2. Creates a `case_document_items` row per requirement, copying criticality, expected format, validity rules, and description
3. Applies conditional logic (e.g., if `client.marital_status = 'married'`, include spouse docs)
4. Locks the checklist structure (additional items can be added manually but original items cannot be deleted)
5. Sends first client notification: "Your case has been received. Please log in to your portal to upload your documents."

---

## 8. Case Detail / Processing Workspace

The workspace is the primary screen for a Processing officer. It is a
multi-panel layout.

### Left rail — Case metadata
- Client photo + name + case ID
- Service + target country (with flag)
- Stage badge + stage history button
- Assigned officer + assignment date
- Priority badge
- Finance summary (amount, receipt, payment date)
- SLA deadline gauge (visual bar)
- Quick stats: docs accepted / total, docs rejected, docs pending

### Main panel — Tabs

#### Tab 1: Document Checklist
Full document requirement list with status per item. See §9.

#### Tab 2: Timeline
Append-only activity timeline. Shows:
- Every stage change (actor + timestamp + reason)
- Every document review decision (accepted/rejected + reason)
- Every message sent to client
- Every internal note added
- Every reminder sent
- Every task created/completed
- Finance handover event (first entry, read-only)

#### Tab 3: Client Communication
Thread of all messages sent to and received from the client. See §17.

#### Tab 4: Internal Notes
Officer and manager notes — not visible to client. See §18.

#### Tab 5: Tasks
Internal task list for this case. See §18.

#### Tab 6: Authority Submissions
Tracking record for each submission to the authority. Fields: submission
reference, submission date, authority, submitted by, documents included,
status, response received, response date, next action.

### Right rail — Action bar
Context-sensitive actions based on current stage:
- Request missing documents
- Send client message
- Move stage (with guard checks)
- Add internal note
- Assign to colleague
- Schedule reminder
- Flag for manager review
- Close/cancel case (manager only)

---

## 9. Document Checklist System

### Template management (admin)

A `document_requirement_templates` table stores the master checklist per
service + country combination. Managed by `processing_admin` role via a
dedicated admin screen.

Each template item has:
- Document name (e.g., "Valid Passport")
- Description / instructions for client
- Criticality: CRITICAL / REQUIRED / CONDITIONAL / SUPPORTING / OPTIONAL
- Condition rule (JSON): e.g., `{"field": "marital_status", "value": "married"}`
- Expected format: PDF / JPG / PNG / any
- Max file size (MB)
- Validity rule: `none` / `must_not_be_expired` / `must_be_valid_for_N_months`
- Required validity duration in months (e.g., passport valid for ≥ 6 months from travel date)
- Guidance URL (optional — links to official embassy requirements)
- Sort order

### Case-level checklist

Each case has its own `case_document_items` snapshot created from the
template at intake time. The snapshot is immutable in structure — items are
added but not deleted.

Each item shows on the workspace:
- Document name + description
- Criticality chip
- Status badge
- Uploaded version count (e.g., "v2")
- Uploaded file thumbnail (if image) or PDF icon
- Expiry date (if applicable) with warning if expiring
- Review decision badge (accepted / rejected)
- Rejection reason (if rejected) — displayed as expandable note
- Last action timestamp
- Quick actions: Review, Request from client, Mark not applicable, Waive

### Checklist progress bar

Visual bar at top of checklist tab:
`■■■■■■■■░░ 8 / 12 accepted · 2 pending · 1 rejected · 1 not submitted`

Colour coding:
- Green fill = accepted
- Amber = submitted/under review
- Red = rejected
- Grey = not submitted

---

## 10. Client Document Flow

### Client portal upload

1. Client logs into portal, sees their case and the document checklist
2. Each checklist item shows: name, description, status, format requirements, whether it's required
3. Client clicks "Upload" on any NOT_SUBMITTED or REJECTED item
4. FileUpload component: drag-and-drop or browse, client-side size/format validation before upload
5. File goes to **private S3-compatible storage** — never a public URL
6. `POST /processing/cases/:caseId/documents/:itemId/upload`
7. Creates a `client_document_versions` record (version N)
8. Item status moves to `SUBMITTED`
9. Processing officer receives a notification: "Client uploaded [document name] on case [ID]"

### Multi-version support

Every upload creates a new version. The officer always reviews the **latest
version**. Version history is preserved for audit.

### Supported formats

- PDF (preferred for multi-page documents)
- JPG / JPEG / PNG (for photos, single-page scans)
- HEIC is converted to JPEG server-side on upload
- Max file size per item: configurable in template (default 10 MB)
- Total case document storage: soft cap 200 MB per case (alert at 80%)

### Signed URL access

When an officer or client requests to view a document:
1. Backend checks permission (officer assigned to case OR client owns the case)
2. Generates a short-lived signed URL (15 minutes)
3. Frontend uses the signed URL to render preview or download
4. Access is logged in `document_access_log`

---

## 11. Missing Document Tracking

### How missing items are tracked

- Any item in `NOT_SUBMITTED` state past its `expected_by` date is considered
  overdue
- Officer can explicitly mark an item as "Requested from client" which sets
  `case_document_items.last_requested_at` and starts an SLA clock
- Default SLA for client to respond: 5 business days (configurable per
  service)

### Missing document panel

On the case workspace:
- **Required, not submitted** — list with days overdue (if past deadline)
- **Rejected, awaiting resubmission** — list with rejection reason shown
- **Upcoming deadline** — items where `expected_by` is within 5 days

### Bulk request

Officer can select multiple missing/rejected items and send a single
"Please upload the following documents" message to the client, listing all
items with their descriptions and deadlines. This creates one
`case_communication` record linking to multiple `case_document_items`.

---

## 12. Client Reminders System

### Reminder types

| Type | Trigger | Channel |
|------|---------|---------|
| `WELCOME` | Case acknowledged | Portal notification + WhatsApp |
| `DOCS_REQUEST` | Officer requests documents | Portal + WhatsApp + Email |
| `DOCS_DEADLINE_7D` | 7 days before document deadline | Portal + WhatsApp |
| `DOCS_DEADLINE_1D` | 1 day before deadline | Portal + WhatsApp |
| `DOCS_OVERDUE` | Deadline passed, still missing | Portal + WhatsApp + Email |
| `DOC_REJECTED` | Document rejected by officer | Portal + WhatsApp |
| `EXPIRY_30D` | Document expires in 30 days | Portal + WhatsApp |
| `EXPIRY_7D` | Document expires in 7 days | Portal + WhatsApp + Email |
| `STAGE_UPDATE` | Case stage changed | Portal notification |
| `SUBMISSION_CONFIRMED` | Application submitted to authority | Portal + WhatsApp + Email |
| `DECISION_RECEIVED` | Authority decision available | Portal + WhatsApp + Email + SMS |

### Reminder engine

- Reminders are **scheduled jobs** via BullMQ — not fired synchronously in API
- `client_reminders` table records every reminder: type, channel, sent_at,
  delivery_status, template_id, rendered_content
- Failed reminders are retried up to 3 times with exponential backoff
- Officer can suppress reminders per client (snooze) or permanently (opt-out)
- WhatsApp reminders use pre-approved Meta templates — no freeform unless
  within 24h conversation window

### Reminder calendar view (officer)

Officer can see a timeline of scheduled and sent reminders per case, and
manually trigger a reminder at any time.

---

## 13. Expired and Expiring Document Detection

### Expiry detection job

A BullMQ recurring job (runs daily at 2 AM):
1. Queries all `case_document_items` where `validity_expiry_date IS NOT NULL`
   and case is active
2. For each:
   - If `expiry_date < today` → status = `EXPIRED`, flag = `critical` if
     document criticality is CRITICAL/REQUIRED
   - If `expiry_date <= today + 30 days` → flag = `EXPIRING_SOON`
3. Creates or updates expiry alert records
4. Queues client reminders for new expiring items

### Impact on case stage

| Document state | Impact |
|----------------|--------|
| CRITICAL document EXPIRED | Hard block on `READY_FOR_SUBMISSION` transition |
| REQUIRED document EXPIRED | Hard block on `READY_FOR_SUBMISSION` transition |
| SUPPORTING/OPTIONAL EXPIRED | Warning shown, no block |
| EXPIRING_SOON (within submission window) | Warning chip on checklist, officer must decide: waive / request renewal |

### Validity buffer rules

The system accounts for transit time. If a submission takes an estimated 30
days and a passport expires in 40 days, the system flags it as a risk even
though the document is technically not expired today.

Formula: `expiry_date < (today + estimated_processing_days + validity_buffer_days)`

Both `estimated_processing_days` and `validity_buffer_days` are configurable
per service + country template.

---

## 14. Document Verification and Rejection Reasons

### Review flow

1. Officer opens the document preview panel (signed URL rendered in-app)
2. Officer checks: correct document type, legible, matches client details,
   not expired, correct format, passes any service-specific rules
3. Officer selects: **Accept** or **Reject**
4. If Reject: must select at least one rejection reason + optional free text note

### Rejection reason catalog

Managed by admin, but default set includes:

| Code | Label |
|------|-------|
| `ILLEGIBLE` | Document is blurry or unreadable |
| `WRONG_DOCUMENT` | Incorrect document type uploaded |
| `EXPIRED` | Document has passed its expiry date |
| `DETAILS_MISMATCH` | Name, date, or ID number does not match records |
| `INCOMPLETE` | Document appears to be missing pages |
| `POOR_SCAN_QUALITY` | Scan quality too low for official use |
| `SIGNATURE_MISSING` | Required signature is absent |
| `TRANSLATION_REQUIRED` | Document is in a non-accepted language |
| `CERTIFIED_COPY_REQUIRED` | Original certified copy required, not photocopy |
| `FORMAT_NOT_ACCEPTED` | File format not accepted by target authority |
| `WRONG_DATE_RANGE` | Document validity does not cover the required period |
| `OTHER` | Other — free text required |

### Review immutability

- Review decisions are written to `document_review_decisions` as an
  append-only log
- An "Accept" after a previous "Reject" is a new decision record, not an
  update to the old one
- The UI shows the full review history per document item (collapsible)

### Automatic client notification on rejection

When a document is rejected:
1. System immediately sends a portal notification to the client
2. Queues a WhatsApp message (from approved template) with the rejection
   reason within 5 minutes
3. `case_document_items.status` → `REJECTED`
4. Audit log entry

---

## 15. Correction Request Flow

### Two distinct flows

**Flow A — Document correction** (officer → client): Officer rejects a
document or explicitly requests a specific document. Client receives
notification with reason, re-uploads, officer reviews again. This is tracked
per document item, not as a separate thread.

**Flow B — Application information correction** (officer → client): The
officer needs the client to correct or confirm specific application data
(e.g., address, travel history, employment dates). This is a formal
structured request with a thread, SLA, and status.

### Correction request record

```
correction_requests:
  id, case_id, raised_by_officer_id
  correction_type: 'document' | 'information'
  document_item_id (nullable — for type=document)
  subject (free text)
  reason_codes (array of reason codes)
  officer_note (private)
  client_message (what the client sees)
  required_action (enum: reupload / confirm / correct / call_back)
  sla_hours (default from service config)
  sla_due_at
  status: 'sent' | 'in_progress' | 'resolved' | 'escalated'
  resolved_at, resolved_by
  created_at, updated_at
```

### SLA enforcement

- At 1× SLA: automated reminder to client
- At 1.5× SLA: officer gets an alert + manager visibility
- At 2× SLA: case appears in "Stuck cases" admin dashboard
- Officer can extend SLA with a reason (logged)

---

## 16. Case Stage Transition Rules

### Full gate table

| From → To | Who can trigger | Backend guards |
|-----------|----------------|----------------|
| `INTAKE_PENDING` → `DOCUMENTS_COLLECTION` | Assigned officer | Case must be acknowledged |
| `DOCUMENTS_COLLECTION` → `DOCUMENTS_UNDER_REVIEW` | Officer | At least one document submitted |
| `DOCUMENTS_UNDER_REVIEW` → `DOCUMENTS_INCOMPLETE` | Officer | At least one item rejected or missing |
| `DOCUMENTS_UNDER_REVIEW` → `DOCUMENTS_COMPLETE` | Officer | All CRITICAL + REQUIRED items accepted, no EXPIRED CRITICAL/REQUIRED |
| `DOCUMENTS_INCOMPLETE` → `DOCUMENTS_COLLECTION` | System (auto on client resubmit) | — |
| `DOCUMENTS_COMPLETE` → `READY_FOR_SUBMISSION` | Officer | Re-validates: all CRITICAL+REQUIRED accepted, no critical expiries, checklist locked |
| `READY_FOR_SUBMISSION` → `SUBMITTED` | Officer | Submission reference must be entered |
| `SUBMITTED` → `UNDER_AUTHORITY_REVIEW` | Officer | Tracking number from authority must be entered |
| `UNDER_AUTHORITY_REVIEW` → `ADDITIONAL_INFO_REQUESTED` | Officer | Request details must be entered |
| `ADDITIONAL_INFO_REQUESTED` → `UNDER_AUTHORITY_REVIEW` | Officer | Response reference must be entered |
| `UNDER_AUTHORITY_REVIEW` → `DECISION_RECEIVED` | Officer | Decision type must be selected |
| `DECISION_RECEIVED` → `APPROVED` | Officer | — |
| `DECISION_RECEIVED` → `REJECTED` | Officer | Rejection reason from authority required |
| `REJECTED` → `APPEAL_IN_PROGRESS` | Officer | Manager approval required |
| `APPEAL_IN_PROGRESS` → `UNDER_AUTHORITY_REVIEW` | Officer | Appeal reference required |
| Any active stage → `CANCELLED` | Manager only | Cancellation reason required |
| `APPROVED` → `COMPLETED` | Officer | Completion notes required |

### The READY_FOR_SUBMISSION hard gate — backend implementation

```typescript
// This check runs server-side at every stage transition attempt
async function assertReadyForSubmission(caseId: string): Promise<void> {
  const items = await getDocumentItems(caseId);

  const criticalNotAccepted = items.filter(
    (i) =>
      (i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED') &&
      i.status !== 'ACCEPTED' &&
      i.status !== 'WAIVED' &&
      i.status !== 'NOT_APPLICABLE'
  );

  const criticalExpired = items.filter(
    (i) =>
      (i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED') &&
      (i.status === 'EXPIRED' ||
        (i.validity_expiry_date && isExpiredWithBuffer(i.validity_expiry_date, caseId)))
  );

  if (criticalNotAccepted.length > 0) {
    throw new ProcessingGateException(
      `${criticalNotAccepted.length} required document(s) not yet accepted`,
      criticalNotAccepted.map((i) => i.document_name)
    );
  }

  if (criticalExpired.length > 0) {
    throw new ProcessingGateException(
      `${criticalExpired.length} critical document(s) expired or expiring before submission`,
      criticalExpired.map((i) => i.document_name)
    );
  }
}
```

---

## 17. Client Communication from Processing

### Communication types

| Type | Description |
|------|-------------|
| `WELCOME` | Welcome message when case is received |
| `DOCS_REQUEST` | Formal document request with list and deadlines |
| `DOCS_REJECTED_NOTICE` | Specific document rejection with reason |
| `GENERAL_UPDATE` | General case update from officer |
| `STAGE_UPDATE` | Automated stage-change message |
| `INFORMATION_REQUEST` | Structured request for client to provide/correct info |
| `SUBMISSION_NOTICE` | Confirmation that application has been submitted |
| `DECISION_NOTICE` | Authority decision notification |
| `APPOINTMENT_REQUEST` | Officer requesting client to attend office or biometrics |
| `REMINDER` | Automated reminder for pending actions |

### Communication channel priority

1. **Client portal inbox** — always (primary record)
2. **WhatsApp** — for time-sensitive items (uses approved templates)
3. **Email** — for formal notices, documents, decisions
4. **SMS** — for critical alerts only (decision received)

### Officer message composer

On the case workspace Communication tab:
- Select message type (pre-fills template)
- Template variables auto-filled: client name, document list, deadline, case ref
- Officer can edit the client-facing text
- Officer can add a private note (not sent to client, logged internally)
- Select channel(s) to send: Portal / WhatsApp / Email
- Preview before send
- Send — creates `case_communications` record + queues delivery jobs

### Client portal inbox

Client sees:
- Unread badge count on "Messages" nav item
- Thread per case (not per message)
- Each message: sender (officer name / "Tafsheen Processing Team"), date, content
- Client can reply — reply is a `case_communication` of direction `client_to_processing`
- Officer gets a notification in Processing workspace when client replies

---

## 18. Internal Notes and Task Assignment

### Internal notes

Notes are officer-to-officer, never visible to client.

Types:
- `GENERAL` — free text observation
- `ESCALATION` — flagging a concern to manager
- `STRATEGY` — processing strategy decision
- `CLIENT_INSIGHT` — contextual info about the client
- `AUTHORITY_NOTE` — notes about authority/embassy behaviour for this case
- `MANAGER_ONLY` — visible only to manager role

Fields:
- `content` (free text, ≥10 chars)
- `type` (enum above)
- `is_pinned` (boolean — pinned notes always shown at top)
- `created_by_user_id`, `created_at`
- Mentions: `@username` syntax creates a notification to that officer

### Task system

Tasks are internal action items tied to a case.

```
processing_tasks:
  id, case_id, created_by_user_id
  assigned_to_user_id (nullable = unassigned / general queue)
  title (required, ≤ 120 chars)
  description (optional)
  due_date
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'
  completed_at, completed_by_user_id
  created_at, updated_at
```

- Tasks appear in the case workspace Tasks tab and also on the assignee's
  personal task list on the dashboard
- Overdue tasks (past `due_date`, not done) appear in a red section on the
  dashboard
- Task completion is logged in the audit timeline

---

## 19. Client Portal — Processing Side

### Portal navigation for active case

```
My Case
├── Overview       — stage, current status, officer name, next step prompt
├── Documents      — checklist with upload/re-upload per item
├── Messages       — communication thread with officer
├── Timeline       — client-visible events only (no internal notes/tasks)
├── Appointments   — scheduled biometrics, office visits, interviews
└── Notifications  — unread count, all notifications
```

### Client document list view

Each checklist item shows to the client:
- Document name + description
- What format is required
- Status: ✗ Not uploaded / ⏳ Uploaded – awaiting review / ✓ Accepted / ✗ Rejected
- Rejection reason (if rejected) — in plain language, not technical codes
- Upload / Re-upload button
- Deadline (if set)
- Expiry warning if the document they've uploaded is expiring

Client does NOT see:
- Internal criticality tiers (CRITICAL vs REQUIRED)
- Officer notes
- Other cases
- Signed URLs in source code (only rendered through secure viewer)

### Client overview panel

- Big prominent stage display: "Your application is being reviewed"
- Progress stepper (simplified):
  `Received → Documents → Submitted → With Authority → Decision`
- "What do you need to do right now?" — action prompt if docs are missing
- "Your officer" — officer name (no direct contact info — all via portal)
- Estimated timeline (configurable, not guaranteed)

### Client portal security rules

- Client can only see their own cases
- Client cannot see other clients' documents or profile
- Client cannot change case data (read-only except uploading their own documents)
- Document upload is scoped to the client's own case_id
- Backend validates: `case.client_id === req.user.id` before allowing upload
- All uploaded files are scanned server-side (ClamAV or equivalent) before
  being stored

---

## 20. Processing Reports

### Report types

#### Officer workload report
- Cases per officer by stage
- Average days per stage per officer
- Document acceptance rate per officer
- SLA breach rate

#### Case throughput report
- Cases started / completed / cancelled per period
- Average total processing time
- By service type, target country, branch
- Stage bottleneck analysis (which stage cases sit in longest)

#### Document quality report
- Most rejected document types (by service + country)
- Most common rejection reasons
- Client resubmission rate (1st upload accepted vs required resubmission)
- Average rounds per document item

#### SLA report
- Client response SLA breaches (by case, by officer, by service)
- Document review SLA breaches
- Stage transition SLA breaches

#### Expiry risk report
- Active cases with documents expiring in 30/60/90 days
- By client, by document type
- Highlight cases near READY_FOR_SUBMISSION with expiry risks

#### Authority decision report
- Approval rate by service + country
- Rejection reasons from authorities
- Appeal outcomes
- Average authority review time

### Export formats
- CSV (raw data, all columns)
- PDF (formatted summary, charts)
- XLSX (with pivot tables)
- All exports require `processing.report.export` permission and are audit-logged

---

## 21. Completed / Closed Case Archive

### Archive trigger
A case enters the archive when it reaches `COMPLETED`, `REJECTED` (after
appeal period), or `CANCELLED`.

### Archive features
- Full searchable record (client, service, country, officer, outcome, dates)
- All documents preserved (never deleted — stored in cold storage tier)
- All communications preserved
- Full audit trail preserved
- Financial record link (receipt number, amount)
- Document links still work via signed URLs (permanent, not 15-min)

### Retention policy
- Active case documents: hot storage
- Completed/closed case documents: cold storage after 90 days
- Retention minimum: 7 years (immigration compliance requirement)
- Admin can trigger archive retrieval for review or appeal

### Re-open a closed case
Manager only. Requires reason. Re-opening a `REJECTED` case for appeal moves
it to `APPEAL_IN_PROGRESS`.

---

## 22. Backend Data Model

### Core tables

```sql
-- Main case record
processing_cases
  id                      uuid PK
  finance_handover_id     uuid FK finance_handover_queue UNIQUE
  payment_record_id       uuid FK payment_records
  client_id               uuid FK clients
  lead_id                 uuid FK leads (nullable — if not yet full client)
  service                 text
  target_country          text
  branch_id               uuid FK branches
  assigned_officer_id     uuid FK users (nullable until acknowledged)
  priority                enum: LOW | NORMAL | URGENT | CRITICAL
  stage                   enum: [all stages above]
  sla_due_at              timestamptz
  sla_status              enum: ACTIVE | APPROACHING | BREACHED | EXTENDED | COMPLETED
  finance_handover_note   text
  processing_note         text (officer's running note — informal)
  estimated_submission_date date
  actual_submission_date  date
  authority_tracking_ref  text
  authority_decision      enum: PENDING | APPROVED | REJECTED | WITHDRAWN
  authority_decision_date date
  completed_at            timestamptz
  cancelled_at            timestamptz
  cancellation_reason     text
  created_at              timestamptz
  updated_at              timestamptz
  created_by_user_id      uuid FK users
  updated_by_user_id      uuid FK users

-- Stage change history
processing_case_stages
  id                      uuid PK
  case_id                 uuid FK processing_cases
  from_stage              enum (nullable for initial)
  to_stage                enum
  changed_by_user_id      uuid FK users
  reason                  text
  notes                   text
  gate_check_result       jsonb (what the backend checked at transition time)
  created_at              timestamptz

-- Document requirement master templates (admin-managed)
document_requirement_templates
  id                      uuid PK
  service                 text
  target_country          text
  document_name           text
  description             text (shown to client)
  instructions            text (shown to client — how to get/prepare this doc)
  criticality             enum: CRITICAL | REQUIRED | CONDITIONAL | SUPPORTING | OPTIONAL
  condition_rule          jsonb (nullable — for CONDITIONAL items)
  expected_formats        text[] (e.g., ['PDF', 'JPG'])
  max_file_size_mb        integer default 10
  validity_rule           enum: NONE | MUST_NOT_EXPIRE | MUST_BE_VALID_FOR_N_MONTHS
  validity_months         integer (nullable)
  validity_buffer_days    integer default 30
  sort_order              integer
  is_active               boolean default true
  created_at              timestamptz
  created_by_user_id      uuid FK users

-- Per-case checklist (snapshot from template at intake)
case_document_items
  id                      uuid PK
  case_id                 uuid FK processing_cases
  template_id             uuid FK document_requirement_templates (nullable — for manually added)
  document_name           text
  description             text
  criticality             enum
  expected_formats        text[]
  max_file_size_mb        integer
  validity_rule           enum
  validity_months         integer
  validity_buffer_days    integer
  status                  enum: NOT_SUBMITTED | SUBMITTED | UNDER_REVIEW | ACCEPTED | REJECTED | EXPIRED | EXPIRING_SOON | WAIVED | NOT_APPLICABLE
  latest_version_id       uuid FK client_document_versions (nullable)
  validity_expiry_date    date (nullable — populated from the accepted document)
  expiry_alert_sent_at    timestamptz
  last_requested_at       timestamptz
  request_deadline        date
  waived_by_user_id       uuid FK users (nullable)
  waive_reason            text
  sort_order              integer
  is_added_manually       boolean default false
  created_at              timestamptz
  updated_at              timestamptz

-- Uploaded document versions
client_document_versions
  id                      uuid PK
  document_item_id        uuid FK case_document_items
  case_id                 uuid FK processing_cases
  client_id               uuid FK clients
  storage_key             text (S3-compatible object key — never a URL)
  file_name               text
  file_size_bytes         integer
  mime_type               text
  version_number          integer
  uploaded_at             timestamptz
  uploaded_by_user_id     uuid FK users
  virus_scan_status       enum: PENDING | CLEAN | INFECTED
  virus_scan_at           timestamptz
  is_current              boolean

-- Document review decisions (append-only)
document_review_decisions
  id                      uuid PK
  document_item_id        uuid FK case_document_items
  version_id              uuid FK client_document_versions
  decision                enum: ACCEPTED | REJECTED
  rejection_reason_codes  text[] (nullable)
  rejection_note          text (nullable)
  reviewed_by_user_id     uuid FK users
  created_at              timestamptz

-- Document access log
document_access_log
  id                      uuid PK
  document_version_id     uuid FK client_document_versions
  accessed_by_user_id     uuid FK users
  access_type             enum: VIEW | DOWNLOAD
  ip_address              inet
  user_agent              text
  signed_url_issued_at    timestamptz
  created_at              timestamptz

-- Correction requests
correction_requests
  id                      uuid PK
  case_id                 uuid FK processing_cases
  document_item_id        uuid FK case_document_items (nullable)
  raised_by_officer_id    uuid FK users
  correction_type         enum: DOCUMENT | INFORMATION
  subject                 text
  reason_codes            text[]
  officer_note            text (private)
  client_message          text (shown to client)
  required_action         enum: REUPLOAD | CONFIRM | CORRECT | CALL_BACK
  sla_hours               integer
  sla_due_at              timestamptz
  status                  enum: SENT | IN_PROGRESS | RESOLVED | ESCALATED
  resolved_at             timestamptz
  resolved_by_user_id     uuid FK users
  created_at              timestamptz
  updated_at              timestamptz

-- Client communications
case_communications
  id                      uuid PK
  case_id                 uuid FK processing_cases
  direction               enum: OFFICER_TO_CLIENT | CLIENT_TO_OFFICER | SYSTEM_TO_CLIENT
  message_type            enum: [all types in §17]
  subject                 text
  content                 text
  channels_sent           text[] (e.g., ['PORTAL', 'WHATSAPP'])
  sent_by_user_id         uuid FK users (nullable for system)
  read_by_client_at       timestamptz
  whatsapp_message_id     text (nullable)
  email_message_id        text (nullable)
  created_at              timestamptz

-- Client reminders
client_reminders
  id                      uuid PK
  case_id                 uuid FK processing_cases
  client_id               uuid FK clients
  reminder_type           enum: [all types in §12]
  channel                 enum: PORTAL | WHATSAPP | EMAIL | SMS
  scheduled_at            timestamptz
  sent_at                 timestamptz
  delivery_status         enum: PENDING | SENT | DELIVERED | FAILED
  template_id             text
  rendered_content        text
  retry_count             integer default 0
  error_message           text
  created_at              timestamptz

-- Internal notes
processing_notes
  id                      uuid PK
  case_id                 uuid FK processing_cases
  content                 text
  note_type               enum: GENERAL | ESCALATION | STRATEGY | CLIENT_INSIGHT | AUTHORITY_NOTE | MANAGER_ONLY
  is_pinned               boolean default false
  mentions                uuid[] (FK users)
  created_by_user_id      uuid FK users
  created_at              timestamptz
  updated_at              timestamptz

-- Internal tasks
processing_tasks
  id                      uuid PK
  case_id                 uuid FK processing_cases
  title                   varchar(120)
  description             text
  assigned_to_user_id     uuid FK users (nullable)
  created_by_user_id      uuid FK users
  due_date                date
  priority                enum: LOW | NORMAL | HIGH | URGENT
  status                  enum: OPEN | IN_PROGRESS | BLOCKED | DONE | CANCELLED
  completed_at            timestamptz
  completed_by_user_id    uuid FK users
  created_at              timestamptz
  updated_at              timestamptz

-- Authority submission tracking
authority_submissions
  id                      uuid PK
  case_id                 uuid FK processing_cases
  submission_number       integer (1 = first, 2 = appeal, etc.)
  submitted_by_user_id    uuid FK users
  submission_date         date
  submission_reference    text
  authority               text
  documents_included      uuid[] FK case_document_items
  tracking_number         text
  status                  enum: SUBMITTED | ACKNOWLEDGED | UNDER_REVIEW | RESPONDED | WITHDRAWN
  response_received_at    timestamptz
  response_type           enum: APPROVAL | REJECTION | INFO_REQUEST | BIOMETRICS_REQUEST | OTHER
  response_notes          text
  next_action             text
  created_at              timestamptz
  updated_at              timestamptz

-- Processing audit log
processing_audit_log
  id                      uuid PK
  case_id                 uuid FK processing_cases (nullable for system events)
  actor_user_id           uuid FK users (nullable for system)
  action                  text (e.g., 'stage_changed', 'document_accepted', 'note_added')
  entity_type             text (e.g., 'processing_case', 'case_document_item')
  entity_id               uuid
  old_values              jsonb
  new_values              jsonb
  ip_address              inet
  user_agent              text
  created_at              timestamptz
```

### Required indexes

```sql
-- Hot query paths
CREATE INDEX idx_proc_cases_officer       ON processing_cases(assigned_officer_id);
CREATE INDEX idx_proc_cases_stage         ON processing_cases(stage);
CREATE INDEX idx_proc_cases_client        ON processing_cases(client_id);
CREATE INDEX idx_proc_cases_priority      ON processing_cases(priority, stage);
CREATE INDEX idx_doc_items_case           ON case_document_items(case_id);
CREATE INDEX idx_doc_items_status         ON case_document_items(status, case_id);
CREATE INDEX idx_doc_items_expiry         ON case_document_items(validity_expiry_date) WHERE validity_expiry_date IS NOT NULL;
CREATE INDEX idx_doc_versions_item        ON client_document_versions(document_item_id);
CREATE INDEX idx_review_decisions_item    ON document_review_decisions(document_item_id);
CREATE INDEX idx_communications_case      ON case_communications(case_id, created_at DESC);
CREATE INDEX idx_audit_case               ON processing_audit_log(case_id, created_at DESC);
CREATE INDEX idx_audit_entity             ON processing_audit_log(entity_type, entity_id);
CREATE INDEX idx_tasks_assigned           ON processing_tasks(assigned_to_user_id, status);
CREATE INDEX idx_reminders_scheduled      ON client_reminders(scheduled_at) WHERE delivery_status = 'PENDING';
```

---

## 23. API Map

```
POST   /processing/intake                         Receive handover from Finance
GET    /processing/intake                         List unacknowledged cases (queue)
POST   /processing/intake/:handoverId/acknowledge Acknowledge + assign case

GET    /processing/cases                          List cases (with filters, pagination)
GET    /processing/cases/:caseId                  Case detail (workspace data)
PATCH  /processing/cases/:caseId/stage            Change stage (with gate checks)
PATCH  /processing/cases/:caseId/assign           Assign/reassign officer
PATCH  /processing/cases/:caseId/priority         Update priority

GET    /processing/cases/:caseId/documents        Get full checklist
GET    /processing/cases/:caseId/documents/:itemId         Get single item
PATCH  /processing/cases/:caseId/documents/:itemId/waive   Waive item
PATCH  /processing/cases/:caseId/documents/:itemId/request Request from client
POST   /processing/cases/:caseId/documents        Add checklist item manually

POST   /processing/cases/:caseId/documents/:itemId/upload  Client uploads file
GET    /processing/cases/:caseId/documents/:itemId/versions Version list
GET    /processing/cases/:caseId/documents/:itemId/signed-url Get signed view URL
POST   /processing/cases/:caseId/documents/:itemId/review  Accept or reject

GET    /processing/cases/:caseId/communications   Get communication thread
POST   /processing/cases/:caseId/communications   Send message to client

GET    /processing/cases/:caseId/notes            Get internal notes
POST   /processing/cases/:caseId/notes            Add internal note
PATCH  /processing/cases/:caseId/notes/:noteId/pin Toggle pin

GET    /processing/cases/:caseId/tasks            Get tasks
POST   /processing/cases/:caseId/tasks            Create task
PATCH  /processing/cases/:caseId/tasks/:taskId    Update task (status, assign, etc.)

GET    /processing/cases/:caseId/submissions      Authority submission list
POST   /processing/cases/:caseId/submissions      Record new submission
PATCH  /processing/cases/:caseId/submissions/:id  Update submission (tracking, response)

GET    /processing/cases/:caseId/reminders        Reminder log for this case
POST   /processing/cases/:caseId/reminders        Manually trigger a reminder

GET    /processing/cases/:caseId/audit            Audit timeline for this case

GET    /processing/dashboard                      Dashboard counts and metrics
GET    /processing/reports/:reportType            Generate report
POST   /processing/reports/:reportType/export     Export report

GET    /processing/archive                        Completed/closed case archive
GET    /processing/archive/:caseId                Archived case detail

GET    /processing/checklist-templates            List templates
POST   /processing/checklist-templates            Create template
PATCH  /processing/checklist-templates/:id        Update template item
DELETE /processing/checklist-templates/:id        Deactivate (soft)

-- Client portal routes
GET    /portal/my-cases                           Client's own cases
GET    /portal/my-cases/:caseId                   Client case detail
GET    /portal/my-cases/:caseId/documents         Client's checklist view
POST   /portal/my-cases/:caseId/documents/:itemId/upload  Client upload
GET    /portal/my-cases/:caseId/messages          Client communication thread
POST   /portal/my-cases/:caseId/messages          Client sends reply
GET    /portal/my-cases/:caseId/notifications     Client notifications
```

---

## 24. Critical Backend Rules

### Rule 1 — Finance gate (hard)
`processing_cases` can only be created from a valid `finance_handover_queue`
record where `status = 'sent'` and no existing `processing_cases` record
references that handover ID.

```typescript
// ProcessingService.createFromHandover()
const handover = await this.financeHandoverRepo.findOne(handoverId);
if (!handover || handover.status !== 'sent') throw new BadRequestException('...');
const exists = await this.processingCaseRepo.findByHandoverId(handoverId);
if (exists) throw new ConflictException('Case already created for this handover');
```

### Rule 2 — Ready for Submission gate (hard)
Backend enforces document completeness before any stage transition to
`READY_FOR_SUBMISSION` or beyond. This check is also run when the officer
loads the stage change modal — they see the blockers before trying to save.

### Rule 3 — Signed URLs only
No storage key or raw path is ever returned in an API response. Every
document access goes through the signed URL endpoint, which logs the access.

```typescript
// DocumentService.getSignedUrl()
// 1. Check permission: case.assigned_officer_id === req.user.id OR manager
// 2. Check client: case.client_id === req.user.id (portal route)
// 3. Generate signed URL (15 min expiry)
// 4. Log to document_access_log
// 5. Return { url, expiresAt }
```

### Rule 4 — Document review is append-only
No UPDATE on `document_review_decisions`. Accepting a previously rejected
document creates a new ACCEPTED row. The UI shows the full history.

### Rule 5 — Virus scanning before officer review
Uploaded files are scanned server-side before being made available to the
officer. `client_document_versions.virus_scan_status` must be `CLEAN` before
the review UI shows the document. Infected files are quarantined and client
is notified.

### Rule 6 — Client isolation
Every portal API route validates `case.client_id === req.user.id`. A client
cannot access any other client's case, documents, or messages, even if they
know the case ID.

### Rule 7 — Audit everything
Every sensitive action listed in the development standards must produce an
entry in `processing_audit_log`. This includes: every document review
decision, every stage change, every correction request, every message sent,
every signed URL issued, every task assigned, every note added, every
assignment change.

### Rule 8 — WhatsApp via templates only
Client notifications via WhatsApp go through approved Meta templates. No
freeform WhatsApp message to a client outside a 24-hour conversation window.
All WhatsApp sends are queued through BullMQ, not fired synchronously.

### Rule 9 — No file deletion
Documents are never hard-deleted. Files are moved to cold storage on archive.
The database record is preserved indefinitely for audit.

### Rule 10 — Checklist snapshot immutability
Once a case checklist is built at intake time, the existing items cannot be
deleted or their criticality level lowered. Officers can only add items or
waive them (with a logged reason). This prevents retroactive lowering of
standards.

---

## 25. UI Direction — Design System

All Processing module screens follow the same premium glassmorphism token
system established in Finance.

### CSS tokens used (no hardcoded values)

```css
/* All colours from design tokens */
--sos-surface, --sos-surface-2, --sos-surface-hover
--sos-text, --sos-muted
--sos-border, --sos-accent, --sos-accent-muted
--sos-success, --sos-warning, --sos-danger
--sos-radius-sm, --sos-radius-md, --sos-radius-lg
--sos-space-*, --sos-text-*, --sos-shadow-*
```

### Shared components used

| Component | Where |
|-----------|-------|
| `AppShell` / `Sidebar` / `Topbar` | All processing screens |
| `PageHeader` | Every screen title |
| `GlassCard` | Every card panel |
| `MetricCard` | Dashboard metrics |
| `DataTable` | Case list, report list, archive |
| `StatusBadge` (tone from config) | Stage badges, document status |
| `Timeline` + `TimelineStep` | Case audit timeline |
| `FileUpload` + `DocumentPreview` | Document upload + review |
| `ActionBar` | Case workspace action rail |
| `EmptyState` / `LoadingState` / `ErrorState` | All list/table states |
| `PermissionGate` | Hide actions the user cannot take |
| `NotesPanel` | Internal notes tab |
| `AssignmentModal` | Assign/reassign case |
| `ConfirmationDialog` | All destructive actions |
| `NotificationCenter` | Officer + client notification bell |
| `FilterBar` | Case list and report filters |

### New shared components needed for Processing

| Component | Purpose |
|-----------|---------|
| `DocumentChecklistItem` | Single checklist row: name, status, upload/review actions |
| `DocumentReviewPanel` | Full document viewer with accept/reject form |
| `CaseStageProgress` | Horizontal stepper showing case stages |
| `DocumentExpiryBadge` | Expiry date with colour coding (expired/expiring/ok) |
| `CorrectionRequestCard` | Correction request summary with SLA countdown |
| `ClientMessageComposer` | Structured message editor with template selector |
| `CaseMetaSidebar` | Left rail with case metadata |
| `DocumentVersionHistory` | Collapsible version list per item |
| `TaskCard` | Single task with status, due date, assignee |
| `GateCheckResult` | What's blocking a stage transition — shown before saving |

### Client portal uses same tokens but lighter visual weight

Client portal is calmer — fewer action buttons, larger readable text,
simplified status language, mobile-first responsive layout.

---

## 26. Phase-wise Build Plan

### Phase 1A — Backend foundation (2 weeks)

- [ ] Processing module NestJS module scaffold
- [ ] Database migrations: all tables above
- [ ] `POST /processing/intake` — receive from Finance, create case, build checklist
- [ ] Document requirement templates CRUD (admin)
- [ ] Checklist auto-generation from template on intake
- [ ] Stage transition API with all gate checks
- [ ] Signed URL service for document access
- [ ] Basic RBAC guards for all processing routes
- [ ] `processing_audit_log` middleware
- [ ] Unit tests: gate checks, signed URL, audit

### Phase 1B — Processing team screens (3 weeks)

- [ ] Processing Dashboard (officer view)
- [ ] Intake Queue
- [ ] Case Workspace — frame + tabs
- [ ] Document Checklist tab
- [ ] Document upload (client-side via portal, reviewed in workspace)
- [ ] Document review panel (accept/reject with reasons)
- [ ] Case Timeline tab
- [ ] Internal Notes tab
- [ ] Task system tab
- [ ] Stage change modal with gate feedback
- [ ] Case assignment modal

### Phase 1C — Client portal processing side (2 weeks)

- [ ] Client portal case overview screen
- [ ] Client document checklist view
- [ ] Client document upload (FileUpload component, signed PUT)
- [ ] Client communication thread (read messages + reply)
- [ ] Client notifications (portal inbox + unread count)
- [ ] Client case timeline (filtered — no internal events)

### Phase 1D — Reminders and comms (1 week)

- [ ] BullMQ reminder jobs
- [ ] WhatsApp template integration for processing events
- [ ] Email notifications for stage changes and decisions
- [ ] Officer message composer with channel selection
- [ ] Reminder log on case workspace

### Phase 1E — Document expiry and corrections (1 week)

- [ ] Daily expiry detection job
- [ ] Expiry alert display on checklist and dashboard
- [ ] Correction request flow (both document and information types)
- [ ] Correction SLA tracking
- [ ] Bulk missing document request

### Phase 2A — Reports and archive (1 week)

- [ ] Processing reports (all types in §20)
- [ ] CSV/PDF/XLSX export
- [ ] Completed case archive screen
- [ ] Archive search and retrieval
- [ ] Document re-open for appeal

### Phase 2B — Authority submission tracking (1 week)

- [ ] Authority submissions tab on case workspace
- [ ] Submission reference entry
- [ ] Decision recording
- [ ] Appeal flow
- [ ] Authority response log

### Phase 2C — Manager features (1 week)

- [ ] Manager dashboard overlay (workload, SLA, bottleneck)
- [ ] Officer reassignment
- [ ] Stuck case escalation
- [ ] Processing config admin (checklist templates, SLA config, reminder templates)
- [ ] Case cancellation (manager only)

### Phase 2D — Testing and hardening (1 week)

- [ ] E2E test: Finance handover → Processing intake → document upload → review → submit
- [ ] E2E test: document rejection → client resubmission → re-review
- [ ] E2E test: expiry detection job
- [ ] E2E test: READY_FOR_SUBMISSION gate with blocking docs
- [ ] E2E test: client portal isolation (cannot see other client's data)
- [ ] Security: all signed URL paths
- [ ] Load test: daily expiry job on large dataset
- [ ] Staging UAT with real processing officer workflow

---

## Summary

The Processing module is the most complex module in the system because it
combines:

- **Document lifecycle management** (upload → review → accept/reject → expiry)
- **Stage-gated case progression** with hard backend checks
- **Two-audience design** (processing team + client portal)
- **External dependency** (government authority decisions)
- **Time-sensitive alerts** (expiry, SLA, deadlines)
- **Immutable audit trail** throughout

The hardest engineering problems are:
1. The READY_FOR_SUBMISSION gate — it must be enforced server-side, tested
   exhaustively, and show clear feedback to the officer
2. Document signed URL access control — must never leak raw storage paths
3. Checklist snapshot integrity — the template can change but a case's
   checklist is locked at intake time
4. Two-side isolation — client portal must never expose internal data

Every table, every API, every state transition in this document is designed
to support a real immigration office processing hundreds of cases monthly
with full audit accountability.
