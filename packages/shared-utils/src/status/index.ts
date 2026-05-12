/**
 * @tashfeen/shared-utils — status/index.ts
 *
 * Single source of truth for status labels and badge variants across the
 * entire platform. Both the frontend (StatusBadge component) and any server-
 * side rendering should derive status display from this file only.
 *
 * Usage:
 *   import { getStatusConfig, StatusType } from '@tashfeen/shared-utils/status';
 *   const cfg = getStatusConfig('lead', lead.status);
 *   // { label: 'Follow Up', variant: 'warning' }
 */

export type StatusBadgeVariant =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'purple';

export interface StatusConfig {
  label: string;
  variant: StatusBadgeVariant;
}

export type StatusType =
  | 'lead'
  | 'client'
  | 'case'
  | 'processing_stage'
  | 'document'
  | 'document_item'
  | 'payment'
  | 'invoice'
  | 'appointment'
  | 'user'
  | 'follow_up'
  | 'finance_handover'
  | 'partner'
  | 'whatsapp_thread'
  | 'whatsapp_template'
  | 'ai_job'
  | 'correction'
  | 'processing_task'
  | 'authority_submission';

// ─── Per-status maps ──────────────────────────────────────────────────────────

const leadStatus: Record<string, StatusConfig> = {
  new:            { label: 'New',           variant: 'info' },
  contacted:      { label: 'Contacted',     variant: 'purple' },
  qualified:      { label: 'Qualified',     variant: 'info' },
  proposal_sent:  { label: 'Proposal Sent', variant: 'warning' },
  follow_up:      { label: 'Follow Up',     variant: 'warning' },
  converted:      { label: 'Converted',     variant: 'success' },
  lost:           { label: 'Lost',          variant: 'neutral' },
  duplicate:      { label: 'Duplicate',     variant: 'neutral' },
  unqualified:    { label: 'Unqualified',   variant: 'danger' },
};

const clientStatus: Record<string, StatusConfig> = {
  new_client:          { label: 'New Client',          variant: 'info' },
  documents_pending:   { label: 'Documents Pending',   variant: 'warning' },
  under_processing:    { label: 'Under Processing',    variant: 'info' },
  submitted:           { label: 'Submitted',           variant: 'warning' },
  approved:            { label: 'Approved',            variant: 'success' },
  rejected:            { label: 'Rejected',            variant: 'danger' },
  closed:              { label: 'Closed',              variant: 'neutral' },
  cancelled:           { label: 'Cancelled',           variant: 'neutral' },
  refunded:            { label: 'Refunded',            variant: 'neutral' },
  blocked:             { label: 'Blocked',             variant: 'danger' },
  inactive:            { label: 'Inactive',            variant: 'neutral' },
  completed:           { label: 'Completed',           variant: 'success' },
};

const caseStatus: Record<string, StatusConfig> = {
  open:          { label: 'Open',          variant: 'info' },
  in_progress:   { label: 'In Progress',   variant: 'info' },
  documentation: { label: 'Documentation', variant: 'warning' },
  processing:    { label: 'Processing',    variant: 'info' },
  submitted:     { label: 'Submitted',     variant: 'warning' },
  approved:      { label: 'Approved',      variant: 'success' },
  rejected:      { label: 'Rejected',      variant: 'danger' },
  on_hold:       { label: 'On Hold',       variant: 'warning' },
  withdrawn:     { label: 'Withdrawn',     variant: 'neutral' },
  completed:     { label: 'Completed',     variant: 'success' },
};

const processingStage: Record<string, StatusConfig> = {
  intake_pending:            { label: 'Intake Pending',            variant: 'neutral' },
  documents_collection:      { label: 'Documents Collection',      variant: 'warning' },
  documents_under_review:    { label: 'Documents Under Review',    variant: 'info' },
  documents_incomplete:      { label: 'Documents Incomplete',      variant: 'danger' },
  documents_complete:        { label: 'Documents Complete',        variant: 'success' },
  ready_for_submission:      { label: 'Ready for Submission',      variant: 'info' },
  submitted:                 { label: 'Submitted',                 variant: 'info' },
  under_authority_review:    { label: 'Under Authority Review',    variant: 'info' },
  additional_info_requested: { label: 'Additional Info Requested', variant: 'warning' },
  decision_received:         { label: 'Decision Received',         variant: 'purple' },
  approved:                  { label: 'Approved',                  variant: 'success' },
  rejected:                  { label: 'Rejected',                  variant: 'danger' },
  appeal_in_progress:        { label: 'Appeal In Progress',        variant: 'warning' },
  completed:                 { label: 'Completed',                 variant: 'success' },
  cancelled:                 { label: 'Cancelled',                 variant: 'neutral' },
};

const documentStatus: Record<string, StatusConfig> = {
  pending:              { label: 'Pending',              variant: 'warning' },
  uploaded:             { label: 'Uploaded',             variant: 'info' },
  under_review:         { label: 'Under Review',         variant: 'info' },
  verified:             { label: 'Verified',             variant: 'success' },
  rejected:             { label: 'Rejected',             variant: 'danger' },
  expired:              { label: 'Expired',              variant: 'danger' },
  replacement_required: { label: 'Replacement Required', variant: 'warning' },
};

const documentItemStatus: Record<string, StatusConfig> = {
  not_submitted:        { label: 'Not Submitted',        variant: 'neutral' },
  submitted:            { label: 'Submitted',            variant: 'info' },
  under_review:         { label: 'Under Review',         variant: 'info' },
  accepted:             { label: 'Accepted',             variant: 'success' },
  rejected:             { label: 'Rejected',             variant: 'danger' },
  waived:               { label: 'Waived',               variant: 'neutral' },
  expired:              { label: 'Expired',              variant: 'danger' },
  replacement_required: { label: 'Replacement Required', variant: 'warning' },
  conditional_accept:   { label: 'Conditional Accept',   variant: 'warning' },
};

const paymentStatus: Record<string, StatusConfig> = {
  pending:   { label: 'Pending',   variant: 'warning' },
  partial:   { label: 'Partial',   variant: 'warning' },
  paid:      { label: 'Paid',      variant: 'success' },
  overdue:   { label: 'Overdue',   variant: 'danger' },
  refunded:  { label: 'Refunded',  variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
  disputed:  { label: 'Disputed',  variant: 'danger' },
};

const invoiceStatus: Record<string, StatusConfig> = {
  draft:          { label: 'Draft',          variant: 'neutral' },
  sent:           { label: 'Sent',           variant: 'info' },
  partially_paid: { label: 'Partially Paid', variant: 'warning' },
  paid:           { label: 'Paid',           variant: 'success' },
  overdue:        { label: 'Overdue',        variant: 'danger' },
  cancelled:      { label: 'Cancelled',      variant: 'neutral' },
};

const appointmentStatus: Record<string, StatusConfig> = {
  scheduled:   { label: 'Scheduled',   variant: 'info' },
  confirmed:   { label: 'Confirmed',   variant: 'success' },
  completed:   { label: 'Completed',   variant: 'success' },
  cancelled:   { label: 'Cancelled',   variant: 'danger' },
  no_show:     { label: 'No Show',     variant: 'danger' },
  rescheduled: { label: 'Rescheduled', variant: 'warning' },
};

const userStatus: Record<string, StatusConfig> = {
  active:               { label: 'Active',               variant: 'success' },
  inactive:             { label: 'Inactive',             variant: 'neutral' },
  suspended:            { label: 'Suspended',            variant: 'danger' },
  pending_verification: { label: 'Pending Verification', variant: 'warning' },
};

const followUpStatus: Record<string, StatusConfig> = {
  open:      { label: 'Open',      variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const financeHandoverStatus: Record<string, StatusConfig> = {
  submitted:        { label: 'Submitted',        variant: 'warning' },
  in_review:        { label: 'In Review',        variant: 'info' },
  payment_recorded: { label: 'Payment Recorded', variant: 'info' },
  payment_verified: { label: 'Payment Verified', variant: 'success' },
  rejected:         { label: 'Rejected',         variant: 'danger' },
  cancelled:        { label: 'Cancelled',        variant: 'neutral' },
};

const partnerStatus: Record<string, StatusConfig> = {
  active:    { label: 'Active',    variant: 'success' },
  inactive:  { label: 'Inactive',  variant: 'neutral' },
  suspended: { label: 'Suspended', variant: 'danger' },
};

const whatsappThreadStatus: Record<string, StatusConfig> = {
  open:       { label: 'Open',       variant: 'info' },
  bot:        { label: 'Bot',        variant: 'purple' },
  human:      { label: 'Human',      variant: 'warning' },
  resolved:   { label: 'Resolved',   variant: 'success' },
  unassigned: { label: 'Unassigned', variant: 'neutral' },
};

const whatsappTemplateStatus: Record<string, StatusConfig> = {
  draft:    { label: 'Draft',    variant: 'neutral' },
  pending:  { label: 'Pending',  variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  paused:   { label: 'Paused',   variant: 'warning' },
  disabled: { label: 'Disabled', variant: 'neutral' },
};

const aiJobStatus: Record<string, StatusConfig> = {
  queued:     { label: 'Queued',     variant: 'neutral' },
  processing: { label: 'Processing', variant: 'info' },
  completed:  { label: 'Completed',  variant: 'success' },
  failed:     { label: 'Failed',     variant: 'danger' },
  cancelled:  { label: 'Cancelled',  variant: 'neutral' },
};

const correctionStatus: Record<string, StatusConfig> = {
  open:        { label: 'Open',        variant: 'warning' },
  in_progress: { label: 'In Progress', variant: 'info' },
  resolved:    { label: 'Resolved',    variant: 'success' },
  cancelled:   { label: 'Cancelled',   variant: 'neutral' },
};

const processingTaskStatus: Record<string, StatusConfig> = {
  pending:     { label: 'Pending',     variant: 'neutral' },
  in_progress: { label: 'In Progress', variant: 'info' },
  completed:   { label: 'Completed',   variant: 'success' },
  blocked:     { label: 'Blocked',     variant: 'danger' },
  cancelled:   { label: 'Cancelled',   variant: 'neutral' },
};

const authoritySubmissionStatus: Record<string, StatusConfig> = {
  pending:                   { label: 'Pending',                   variant: 'neutral' },
  submitted:                 { label: 'Submitted',                 variant: 'info' },
  acknowledged:              { label: 'Acknowledged',              variant: 'info' },
  under_review:              { label: 'Under Review',              variant: 'info' },
  additional_info_requested: { label: 'Additional Info Requested', variant: 'warning' },
  approved:                  { label: 'Approved',                  variant: 'success' },
  rejected:                  { label: 'Rejected',                  variant: 'danger' },
  withdrawn:                 { label: 'Withdrawn',                 variant: 'neutral' },
};

// ─── Master config map ────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<StatusType, Record<string, StatusConfig>> = {
  lead:                 leadStatus,
  client:               clientStatus,
  case:                 caseStatus,
  processing_stage:     processingStage,
  document:             documentStatus,
  document_item:        documentItemStatus,
  payment:              paymentStatus,
  invoice:              invoiceStatus,
  appointment:          appointmentStatus,
  user:                 userStatus,
  follow_up:            followUpStatus,
  finance_handover:     financeHandoverStatus,
  partner:              partnerStatus,
  whatsapp_thread:      whatsappThreadStatus,
  whatsapp_template:    whatsappTemplateStatus,
  ai_job:               aiJobStatus,
  correction:           correctionStatus,
  processing_task:      processingTaskStatus,
  authority_submission: authoritySubmissionStatus,
};

/**
 * Resolve the display label and badge variant for any entity status.
 *
 * @param type   - The entity type (e.g. 'lead', 'case', 'document')
 * @param status - The raw status string (Prisma enum value or lowercase)
 *
 * @example
 *   getStatusConfig('lead', 'FOLLOW_UP') // { label: 'Follow Up', variant: 'warning' }
 *   getStatusConfig('case', 'in_progress') // { label: 'In Progress', variant: 'info' }
 */
export function getStatusConfig(type: StatusType, status: string): StatusConfig {
  const normalised = status.toLowerCase();
  return STATUS_CONFIG[type]?.[normalised] ?? { label: status, variant: 'neutral' };
}

export { STATUS_CONFIG };
