// Status badge configuration — single source of truth for all status labels/styles
// Keys are lowercase versions of Prisma enum values (normalised in getStatusConfig).
// Usage: <StatusBadge type="lead" status={lead.status} />

export type StatusType = 'lead' | 'case' | 'document' | 'payment' | 'invoice' | 'appointment' | 'user' | 'follow_up' | 'finance_handover';

export interface StatusConfig {
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'purple';
}

// Matches LeadStatus enum: NEW, CONTACTED, QUALIFIED, PROPOSAL_SENT, FOLLOW_UP,
// CONVERTED, LOST, DUPLICATE, UNQUALIFIED
const leadStatusConfig: Record<string, StatusConfig> = {
  new: { label: 'New', variant: 'info' },
  contacted: { label: 'Contacted', variant: 'purple' },
  qualified: { label: 'Qualified', variant: 'info' },
  proposal_sent: { label: 'Proposal Sent', variant: 'warning' },
  follow_up: { label: 'Follow Up', variant: 'warning' },
  converted: { label: 'Converted', variant: 'success' },
  lost: { label: 'Lost', variant: 'neutral' },
  duplicate: { label: 'Duplicate', variant: 'neutral' },
  unqualified: { label: 'Unqualified', variant: 'danger' },
};

// Matches CaseStatus enum: OPEN, IN_PROGRESS, DOCUMENTATION, PROCESSING, SUBMITTED,
// APPROVED, REJECTED, WITHDRAWN, COMPLETED, ON_HOLD
const caseStatusConfig: Record<string, StatusConfig> = {
  open: { label: 'Open', variant: 'info' },
  in_progress: { label: 'In Progress', variant: 'info' },
  documentation: { label: 'Documentation', variant: 'warning' },
  processing: { label: 'Processing', variant: 'info' },
  submitted: { label: 'Submitted', variant: 'warning' },
  approved: { label: 'Approved', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  on_hold: { label: 'On Hold', variant: 'warning' },
  withdrawn: { label: 'Withdrawn', variant: 'neutral' },
  completed: { label: 'Completed', variant: 'success' },
};

// Matches DocumentStatus enum: PENDING, UPLOADED, UNDER_REVIEW, VERIFIED, REJECTED,
// EXPIRED, REPLACEMENT_REQUIRED
const documentStatusConfig: Record<string, StatusConfig> = {
  pending: { label: 'Pending', variant: 'warning' },
  uploaded: { label: 'Uploaded', variant: 'info' },
  under_review: { label: 'Under Review', variant: 'info' },
  verified: { label: 'Verified', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  expired: { label: 'Expired', variant: 'danger' },
  replacement_required: { label: 'Replacement Required', variant: 'warning' },
};

// Matches PaymentStatus enum: PENDING, PARTIAL, PAID, OVERDUE, REFUNDED, CANCELLED, DISPUTED
const paymentStatusConfig: Record<string, StatusConfig> = {
  pending: { label: 'Pending', variant: 'warning' },
  partial: { label: 'Partial', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  overdue: { label: 'Overdue', variant: 'danger' },
  refunded: { label: 'Refunded', variant: 'neutral' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
  disputed: { label: 'Disputed', variant: 'danger' },
};

// Matches InvoiceStatus enum: DRAFT, SENT, PARTIALLY_PAID, PAID, OVERDUE, CANCELLED
const invoiceStatusConfig: Record<string, StatusConfig> = {
  draft: { label: 'Draft', variant: 'neutral' },
  sent: { label: 'Sent', variant: 'info' },
  partially_paid: { label: 'Partially Paid', variant: 'warning' },
  paid: { label: 'Paid', variant: 'success' },
  overdue: { label: 'Overdue', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

// Matches AppointmentStatus enum: SCHEDULED, CONFIRMED, COMPLETED, CANCELLED, NO_SHOW, RESCHEDULED
const appointmentStatusConfig: Record<string, StatusConfig> = {
  scheduled: { label: 'Scheduled', variant: 'info' },
  confirmed: { label: 'Confirmed', variant: 'success' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'danger' },
  no_show: { label: 'No Show', variant: 'danger' },
  rescheduled: { label: 'Rescheduled', variant: 'warning' },
};

const followUpStatusConfig: Record<string, StatusConfig> = {
  open: { label: 'Open', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

const financeHandoverStatusConfig: Record<string, StatusConfig> = {
  submitted: { label: 'Submitted', variant: 'warning' },
  in_review: { label: 'In Review', variant: 'info' },
  payment_recorded: { label: 'Payment Recorded', variant: 'info' },
  payment_verified: { label: 'Payment Verified', variant: 'success' },
  rejected: { label: 'Rejected', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'neutral' },
};

// Matches UserStatus enum: ACTIVE, INACTIVE, SUSPENDED, PENDING_VERIFICATION
const userStatusConfig: Record<string, StatusConfig> = {
  active: { label: 'Active', variant: 'success' },
  inactive: { label: 'Inactive', variant: 'neutral' },
  suspended: { label: 'Suspended', variant: 'danger' },
  pending_verification: { label: 'Pending Verification', variant: 'warning' },
};

export const STATUS_CONFIG: Record<StatusType, Record<string, StatusConfig>> = {
  lead: leadStatusConfig,
  case: caseStatusConfig,
  document: documentStatusConfig,
  payment: paymentStatusConfig,
  invoice: invoiceStatusConfig,
  appointment: appointmentStatusConfig,
  user: userStatusConfig,
  follow_up: followUpStatusConfig,
  finance_handover: financeHandoverStatusConfig,
};

export function getStatusConfig(type: StatusType, status: string): StatusConfig {
  // Normalise Prisma enum values (e.g. "IN_PROGRESS" → "in_progress")
  const normalised = status.toLowerCase();
  return STATUS_CONFIG[type]?.[normalised] ?? { label: status, variant: 'neutral' };
}
