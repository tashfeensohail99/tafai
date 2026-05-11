# Week 1 Design System Starter - Tashfeen AI Platform

Prepared date: May 8, 2026
Status: Draft for Week 1 review

The design system must be created before full screens are built. Feature teams should use shared components and tokens instead of one-off UI code.

## Design Direction

The platform is an operational immigration CRM and automation system. The UI should feel professional, clear, dense enough for daily office work, and easy to scan.

Avoid marketing-page composition inside the app. Prioritize tables, filters, queues, timelines, document review surfaces, action modals, and focused dashboards.

## Theme Requirement

- Light and dark theme from day 1.
- Theme preference saved per user where practical.
- Default can follow system/browser theme.
- All colors must come from design tokens.
- No hard-coded colors inside feature components.

## Proposed Color Tokens

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| color.background | #F7FAFC | #07111F | App background |
| color.surface | #FFFFFF | #0F2238 | Panels, tables, modals |
| color.surfaceMuted | #EEF2F7 | #152B45 | Subtle grouped areas |
| color.border | #D7DEE8 | #2B4361 | Borders/dividers |
| color.text | #111827 | #F8FAFC | Primary text |
| color.textMuted | #64748B | #A8B5C7 | Secondary text |
| color.primary | #0B1F3A | #8FB9E8 | Primary brand/action |
| color.action | #0E7C86 | #2DD4BF | Main action accent |
| color.accent | #D6A84F | #F2C76B | Highlight/accent |
| color.success | #15803D | #4ADE80 | Success |
| color.warning | #B7791F | #FBBF24 | Warning |
| color.error | #B91C1C | #F87171 | Error |
| color.info | #2563EB | #60A5FA | Info |

## Spacing Tokens

| Token | Value |
| --- | --- |
| spacing.1 | 4px |
| spacing.2 | 8px |
| spacing.3 | 12px |
| spacing.4 | 16px |
| spacing.5 | 20px |
| spacing.6 | 24px |
| spacing.8 | 32px |
| spacing.10 | 40px |
| spacing.12 | 48px |

## Radius Tokens

| Token | Value | Usage |
| --- | --- | --- |
| radius.sm | 4px | Inputs, small controls |
| radius.md | 6px | Buttons, badges |
| radius.lg | 8px | Cards/modals maximum default |
| radius.full | 999px | Pills where needed only |

Cards should normally use 8px radius or less.

## Typography Tokens

| Token | Value | Usage |
| --- | --- | --- |
| font.family | Inter or system sans-serif | Web UI |
| font.size.xs | 12px | Metadata |
| font.size.sm | 14px | Body/table text |
| font.size.md | 16px | Form text |
| font.size.lg | 18px | Section headings |
| font.size.xl | 22px | Page headings |
| font.weight.normal | 400 | Regular text |
| font.weight.medium | 500 | Labels/actions |
| font.weight.semibold | 600 | Headings |

Do not scale font size with viewport width. Letter spacing should be 0.

## Required Shared Components

### Layout

- AppShell
- Sidebar
- Topbar
- Breadcrumbs
- PageHeader
- PageSection
- SplitPanel
- Drawer

### Data And Filters

- DataTable
- FilterBar
- SearchInput
- DateRangePicker
- ColumnVisibilityMenu
- Pagination
- SortHeader
- BulkActionBar

### Status And Workflow

- StatusBadge
- PriorityBadge
- SourceBadge
- PermissionGate
- Timeline
- AuditEventSummary
- HandoverModal
- AssignmentModal
- ConfirmationDialog

### Forms

- TextInput
- PhoneInput
- EmailInput
- Select
- MultiSelect
- Checkbox
- Toggle
- RadioGroup
- SegmentedControl
- DatePicker
- TimePicker
- TextArea
- FormErrorSummary

### Documents

- FileUpload
- DocumentPreview
- DocumentChecklist
- DocumentStatusPanel
- OCRResultPanel
- ReplacementRequestModal

### Communication

- ConversationList
- MessageThread
- MessageComposer
- TemplatePicker
- BotHandoverBanner
- VoiceTranscriptPanel

### Feedback

- EmptyState
- LoadingState
- ErrorState
- ForbiddenState
- Toast
- NotificationCenter

## Central Status Config

Status badges must come from central config.

Example status groups:

### Lead Statuses

- new
- assigned
- contacted
- follow_up
- appointment_booked
- documents_requested
- converted
- rejected
- closed

### Lead Priority

- hot
- warm
- cold

### Case Statuses

- case_received
- documents_under_review
- missing_documents_requested
- application_preparation
- application_submitted
- under_review
- additional_information_required
- approved
- rejected
- closed

### Document Statuses

- uploaded
- under_review
- verified
- rejected
- expired
- missing
- replacement_requested
- manual_review_required

### Payment Statuses

- pending
- partial
- received
- verified
- overdue
- refunded
- cancelled

### Appointment Statuses

- scheduled
- confirmed
- rescheduled
- completed
- cancelled
- no_show

## Frontend Folder Suggestion

If using a monorepo:

```text
apps/
  web/
    app/
    components/
    features/
    lib/
    styles/
  mobile/
packages/
  ui/
  config/
  types/
  api-client/
```

If using separate repos, keep the same conceptual boundaries.

## Component Acceptance Rules

A shared component is not ready unless it supports:

- light and dark theme
- disabled state
- loading state where useful
- error/invalid state where useful
- keyboard accessible interaction
- predictable sizing
- reusable props/types
- no hard-coded business status colors outside central config

## Week 2 Design Deliverables

- Token file draft.
- Status config draft.
- AppShell and Sidebar prototype.
- Login screen component set.
- DataTable prototype.
- StatusBadge component.
- Empty/Loading/Error/Forbidden states.
