// Client portal mock data — Phase 1C.
// This represents Ali Hassan's VIEW of his own case (case-001).
// The client portal NEVER shows: internal notes, strategy, other clients' data,
// officer's private fields, or raw stage machine names.

// ---------- Client-side stage labels (friendly, not technical) ------------

export const CLIENT_STAGE_LABEL: Record<string, string> = {
  INTAKE_PENDING: 'Case Received',
  DOCUMENTS_COLLECTION: 'Please Upload Documents',
  DOCUMENTS_UNDER_REVIEW: 'Documents Under Review',
  DOCUMENTS_INCOMPLETE: 'Action Required — Documents Incomplete',
  DOCUMENTS_COMPLETE: 'Documents Complete',
  READY_FOR_SUBMISSION: 'Being Prepared for Submission',
  SUBMITTED: 'Application Submitted',
  UNDER_AUTHORITY_REVIEW: 'With Immigration Authority',
  ADDITIONAL_INFO_REQUESTED: 'Additional Information Required',
  DECISION_RECEIVED: 'Decision Received',
  APPROVED: 'Approved',
  REJECTED: 'Application Rejected',
  APPEAL_IN_PROGRESS: 'Appeal In Progress',
  COMPLETED: 'Case Complete',
  CANCELLED: 'Case Cancelled',
};

// Friendly tone for client-facing status display (subset of BadgeTone)
export const CLIENT_STAGE_TONE: Record<string, string> = {
  INTAKE_PENDING: 'neutral',
  DOCUMENTS_COLLECTION: 'info',
  DOCUMENTS_UNDER_REVIEW: 'accent',
  DOCUMENTS_INCOMPLETE: 'warning',
  DOCUMENTS_COMPLETE: 'success',
  READY_FOR_SUBMISSION: 'violet',
  SUBMITTED: 'cyan',
  UNDER_AUTHORITY_REVIEW: 'info',
  ADDITIONAL_INFO_REQUESTED: 'warning',
  DECISION_RECEIVED: 'accent',
  APPROVED: 'success',
  REJECTED: 'danger',
  APPEAL_IN_PROGRESS: 'warm',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

// What the client should do at each stage
export const CLIENT_NEXT_ACTION: Record<string, string | null> = {
  INTAKE_PENDING: 'Your application has been received. We will be in touch shortly.',
  DOCUMENTS_COLLECTION: 'Please upload all required documents via the Documents tab.',
  DOCUMENTS_UNDER_REVIEW: 'Your documents are being reviewed. No action needed at this time.',
  DOCUMENTS_INCOMPLETE: 'Some documents require attention. Please check the Documents tab.',
  DOCUMENTS_COMPLETE: 'All documents are complete. We are preparing your application.',
  READY_FOR_SUBMISSION: 'Your application is ready. We will submit it soon.',
  SUBMITTED: 'Your application has been submitted. We will notify you when there is an update.',
  UNDER_AUTHORITY_REVIEW: 'Your application is with the authority. This process takes time — we will keep you informed.',
  ADDITIONAL_INFO_REQUESTED: 'The authority has requested additional information. Please check your messages.',
  DECISION_RECEIVED: 'A decision has been received. Your consultant will contact you shortly.',
  APPROVED: 'Congratulations — your application has been approved! Your consultant will explain the next steps.',
  REJECTED: 'Your application has been rejected. Please check your messages for details and options.',
  APPEAL_IN_PROGRESS: 'An appeal has been filed on your behalf. We will keep you informed.',
  COMPLETED: 'Your case is complete. Thank you for trusting Tafsheen Immigration.',
  CANCELLED: null,
};

// ---------- Client profile -----------------------------------------------

export interface ClientPortalUser {
  id: string;
  name: string;
  email: string;
  phone: string;
  initials: string;
}

export const MOCK_CLIENT: ClientPortalUser = {
  id: 'client-ali-001',
  name: 'Ali Hassan',
  email: 'ali.hassan@example.com',
  phone: '+92 300 1234567',
  initials: 'AH',
};

// ---------- Client-visible case summary ----------------------------------

export interface ClientCaseSummary {
  id: string;
  service: string;
  targetCountry: string;
  stage: string;
  assignedOfficerName: string;
  assignedOfficerInitials: string;
  createdAt: string;
  docsAccepted: number;
  docsTotal: number;
  docsActionRequired: number;  // NOT_SUBMITTED + REJECTED
  unreadMessages: number;
}

export const MOCK_CLIENT_CASE: ClientCaseSummary = {
  id: 'case-001',
  service: 'Work Permit',
  targetCountry: 'Canada',
  stage: 'DOCUMENTS_UNDER_REVIEW',
  assignedOfficerName: 'Sara Malik',
  assignedOfficerInitials: 'SM',
  createdAt: '2026-05-05T09:00:00.000Z',
  docsAccepted: 3,
  docsTotal: 8,
  docsActionRequired: 3,   // Police Clearance + Medical + Educational Degree (rejected)
  unreadMessages: 0,
};

// ---------- Client-visible documents (filtered from case-001 docs) --------
// Client sees: name, description, status, what they need to do.
// Client does NOT see: officer review notes that are internal-only.

export interface ClientDocumentItem {
  id: string;
  documentName: string;
  description: string;
  criticality: 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';
  status: string;
  expectedFormats: string[];
  validityExpiryDate: string | null;
  rejectionNote: string | null;  // client-visible rejection message only
  uploadedAt: string | null;
  versionNumber: number;
  canUpload: boolean;
}

export const MOCK_CLIENT_DOCUMENTS: ClientDocumentItem[] = [
  {
    id: 'doc-001-1',
    documentName: 'Valid Passport',
    description: 'Must have minimum 6 months validity remaining',
    criticality: 'CRITICAL',
    status: 'ACCEPTED',
    expectedFormats: ['PDF', 'JPG'],
    validityExpiryDate: '2028-03-15',
    rejectionNote: null,
    uploadedAt: '2026-05-06T10:00:00.000Z',
    versionNumber: 1,
    canUpload: false,
  },
  {
    id: 'doc-001-2',
    documentName: 'IELTS Certificate',
    description: 'English proficiency test — Band 6.0 or higher',
    criticality: 'CRITICAL',
    status: 'UNDER_REVIEW',
    expectedFormats: ['PDF'],
    validityExpiryDate: '2027-04-10',
    rejectionNote: null,
    uploadedAt: '2026-05-07T14:00:00.000Z',
    versionNumber: 1,
    canUpload: false,
  },
  {
    id: 'doc-001-3',
    documentName: 'Employment Contract',
    description: 'Signed copy from your current employer',
    criticality: 'REQUIRED',
    status: 'ACCEPTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: null,
    uploadedAt: '2026-05-07T15:00:00.000Z',
    versionNumber: 2,
    canUpload: false,
  },
  {
    id: 'doc-001-4',
    documentName: 'Educational Degree',
    description: 'Attested copy from HEC (Higher Education Commission)',
    criticality: 'REQUIRED',
    status: 'REJECTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: 'Please provide the HEC-attested copy. A plain photocopy is not accepted.',
    uploadedAt: '2026-05-06T11:00:00.000Z',
    versionNumber: 1,
    canUpload: true,
  },
  {
    id: 'doc-001-5',
    documentName: 'Police Clearance Certificate',
    description: 'From your country or city of residence — must be recent (within 6 months)',
    criticality: 'REQUIRED',
    status: 'NOT_SUBMITTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: null,
    uploadedAt: null,
    versionNumber: 0,
    canUpload: true,
  },
  {
    id: 'doc-001-6',
    documentName: 'Medical Certificate',
    description: 'From an approved physician — immigration medical exam',
    criticality: 'REQUIRED',
    status: 'NOT_SUBMITTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: null,
    uploadedAt: null,
    versionNumber: 0,
    canUpload: true,
  },
  {
    id: 'doc-001-7',
    documentName: 'Reference Letter',
    description: 'Character reference from current employer',
    criticality: 'SUPPORTING',
    status: 'ACCEPTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: null,
    uploadedAt: '2026-05-06T12:00:00.000Z',
    versionNumber: 1,
    canUpload: false,
  },
  {
    id: 'doc-001-8',
    documentName: 'Bank Statement (6 months)',
    description: 'Showing sufficient funds for the immigration process',
    criticality: 'SUPPORTING',
    status: 'SUBMITTED',
    expectedFormats: ['PDF'],
    validityExpiryDate: null,
    rejectionNote: null,
    uploadedAt: '2026-05-08T09:00:00.000Z',
    versionNumber: 1,
    canUpload: false,
  },
];

// ---------- Client-visible communications (filtered) ----------------------
// Excludes any SYSTEM→SYSTEM or internal messages.
// Client can only see: OFFICER_TO_CLIENT, CLIENT_TO_OFFICER, SYSTEM_TO_CLIENT.

export interface ClientMessage {
  id: string;
  direction: 'FROM_OFFICER' | 'FROM_CLIENT' | 'FROM_SYSTEM';
  subject: string;
  content: string;
  senderName: string;
  channel: string;
  createdAt: string;
  readAt: string | null;
}

export const MOCK_CLIENT_MESSAGES: ClientMessage[] = [
  {
    id: 'msg-001-1',
    direction: 'FROM_SYSTEM',
    subject: 'Your case has been received',
    content:
      'Dear Ali Hassan, your Work Permit application for Canada has been received by our processing team. Please log in to your portal to upload your required documents.',
    senderName: 'Tafsheen Immigration',
    channel: 'Portal',
    createdAt: '2026-05-05T09:30:00.000Z',
    readAt: '2026-05-05T10:00:00.000Z',
  },
  {
    id: 'msg-001-2',
    direction: 'FROM_OFFICER',
    subject: 'Documents required — please upload',
    content:
      'Dear Ali, we have reviewed your checklist. Please upload your Police Clearance Certificate and Medical Certificate at your earliest convenience. For your Educational Degree, please provide the HEC-attested copy — a photocopy is not accepted.',
    senderName: 'Sara Malik',
    channel: 'Portal & WhatsApp',
    createdAt: '2026-05-08T11:00:00.000Z',
    readAt: '2026-05-08T14:00:00.000Z',
  },
  {
    id: 'msg-001-3',
    direction: 'FROM_CLIENT',
    subject: 'Re: Documents required',
    content:
      'I will upload the police clearance by Friday. Currently waiting for the medical appointment — the earliest available is May 14.',
    senderName: 'Ali Hassan',
    channel: 'Portal',
    createdAt: '2026-05-08T16:00:00.000Z',
    readAt: null,
  },
];

// ---------- Client-visible timeline (filtered) ----------------------------
// Excludes: internal notes, STRATEGY events, MANAGER_ONLY events.

export interface ClientTimelineItem {
  id: string;
  description: string;
  actorLabel: string;   // "Sara Malik (Officer)" or "You" or "System"
  icon: 'case' | 'stage' | 'document_ok' | 'document_warn' | 'message' | 'system';
  createdAt: string;
}

export const MOCK_CLIENT_TIMELINE: ClientTimelineItem[] = [
  {
    id: 'ct-001-1',
    description: 'Your case was received and registered — Work Permit / Canada',
    actorLabel: 'Tafsheen Finance',
    icon: 'case',
    createdAt: '2026-05-05T09:00:00.000Z',
  },
  {
    id: 'ct-001-2',
    description: 'Your case was assigned to Sara Malik and documents collection has begun',
    actorLabel: 'Sara Malik (Officer)',
    icon: 'stage',
    createdAt: '2026-05-05T10:00:00.000Z',
  },
  {
    id: 'ct-001-3',
    description: 'Document accepted: Valid Passport',
    actorLabel: 'Sara Malik (Officer)',
    icon: 'document_ok',
    createdAt: '2026-05-07T11:00:00.000Z',
  },
  {
    id: 'ct-001-4',
    description: 'Document requires correction: Educational Degree — please upload the HEC-attested copy',
    actorLabel: 'Sara Malik (Officer)',
    icon: 'document_warn',
    createdAt: '2026-05-07T11:30:00.000Z',
  },
  {
    id: 'ct-001-5',
    description: 'Your documents are now under review',
    actorLabel: 'Sara Malik (Officer)',
    icon: 'stage',
    createdAt: '2026-05-08T10:00:00.000Z',
  },
  {
    id: 'ct-001-6',
    description: 'Message sent: Documents required — please upload',
    actorLabel: 'Sara Malik (Officer)',
    icon: 'message',
    createdAt: '2026-05-08T11:00:00.000Z',
  },
];

// ---------- Helpers -------------------------------------------------------

export function getDocActionRequired(): ClientDocumentItem[] {
  return MOCK_CLIENT_DOCUMENTS.filter((d) => d.canUpload);
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}
