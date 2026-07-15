// Processing module — deterministic mock data for Phase 1B UI build.
// All timestamps are fixed to avoid SSR/hydration mismatches.

export type ProcessingStage =
  | 'INTAKE_PENDING'
  | 'DOCUMENTS_COLLECTION'
  | 'DOCUMENTS_UNDER_REVIEW'
  | 'DOCUMENTS_INCOMPLETE'
  | 'DOCUMENTS_COMPLETE'
  | 'READY_FOR_SUBMISSION'
  | 'SUBMITTED'
  | 'UNDER_AUTHORITY_REVIEW'
  | 'ADDITIONAL_INFO_REQUESTED'
  | 'DECISION_RECEIVED'
  | 'APPROVED'
  | 'REJECTED'
  | 'APPEAL_IN_PROGRESS'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'JUNK';

export type ProcessingPriority = 'LOW' | 'NORMAL' | 'URGENT' | 'CRITICAL';

export type DocumentCriticality = 'CRITICAL' | 'REQUIRED' | 'CONDITIONAL' | 'SUPPORTING' | 'OPTIONAL';

export type DocumentItemStatus =
  | 'NOT_SUBMITTED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'EXPIRING_SOON'
  | 'WAIVED'
  | 'NOT_APPLICABLE';

export interface MockOfficer {
  id: string;
  name: string;
  email: string;
  initials: string;
  role: string;
}

export interface MockDocumentItem {
  id: string;
  documentName: string;
  description: string;
  criticality: DocumentCriticality;
  status: DocumentItemStatus;
  expectedFormats: string[];
  validityExpiryDate: string | null;
  rejectionReasonCodes?: string[];
  rejectionNote?: string;
  uploadedAt?: string;
  versionNumber?: number;
}

export interface MockCommunication {
  id: string;
  direction: 'OFFICER_TO_CLIENT' | 'CLIENT_TO_OFFICER' | 'SYSTEM_TO_CLIENT';
  messageType: string;
  subject: string;
  content: string;
  channelsSent: string[];
  sentByName: string;
  createdAt: string;
  readByClientAt: string | null;
}

export interface MockNote {
  id: string;
  content: string;
  noteType: 'GENERAL' | 'ESCALATION' | 'STRATEGY' | 'CLIENT_INSIGHT' | 'AUTHORITY_NOTE' | 'MANAGER_ONLY';
  isPinned: boolean;
  createdByName: string;
  createdAt: string;
}

export interface MockAuthoritySubmission {
  id: string;
  submissionNumber: number;
  submittedByName: string;
  submissionDate: string;         // ISO date string
  submissionReference: string | null;
  authority: string;
  documentsIncluded: string[];
  trackingNumber: string | null;
  status: 'SUBMITTED' | 'ACKNOWLEDGED' | 'UNDER_REVIEW' | 'RESPONDED' | 'WITHDRAWN';
  responseReceivedAt: string | null;
  responseType: 'APPROVAL' | 'REJECTION' | 'INFO_REQUEST' | 'BIOMETRICS_REQUEST' | 'OTHER' | null;
  responseNotes: string | null;
  nextAction: string | null;
  createdAt: string;
}

export interface MockTask {
  id: string;
  title: string;
  description?: string;
  assignedToName: string | null;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  status: 'OPEN' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED';
  dueDate: string | null;
}

export interface MockTimelineEvent {
  id: string;
  eventType: string;
  description: string;
  actorName: string;
  createdAt: string;
  metadata?: Record<string, string>;
}

export interface MockProcessingCase {
  id: string;
  service: string;
  targetCountry: string;
  stage: ProcessingStage;
  /** Lightweight per-service tracking label (feedback F3). Optional so mock
   *  fixtures need no update; surfaced by the workspace adapter. */
  subStage?: string | null;
  priority: ProcessingPriority;
  clientName: string;
  clientPhone: string;
  assignedOfficer: MockOfficer | null;
  /** Originating SALES rep (who closed the deal) — distinct from the processing
   *  officer. Optional so the mock fixtures need no update. */
  salesRep?: { name: string } | null;
  financeAmount: number;
  financeCurrency: string;
  financeHandoverNote: string | null;
  handoverOfficerName: string;
  createdAt: string;
  documentItems: MockDocumentItem[];
  communications: MockCommunication[];
  notes: MockNote[];
  tasks: MockTask[];
  timeline: MockTimelineEvent[];
  submissions: MockAuthoritySubmission[];
  daysInCurrentStage: number;
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const MOCK_PROCESSING_OFFICER: MockOfficer = {
  id: 'officer-1',
  name: 'Sara Malik',
  email: 'sara.malik@tafsheen.com',
  initials: 'SM',
  role: 'Processing Officer',
};

export const MOCK_SENIOR_OFFICER: MockOfficer = {
  id: 'officer-2',
  name: 'Bilal Ahmed',
  email: 'bilal.ahmed@tafsheen.com',
  initials: 'BA',
  role: 'Processing Senior',
};

export const MOCK_MANAGER: MockOfficer = {
  id: 'manager-1',
  name: 'Zara Khan',
  email: 'zara.khan@tafsheen.com',
  initials: 'ZK',
  role: 'Processing Manager',
};

// ---------------------------------------------------------------------------
// Mock cases
// ---------------------------------------------------------------------------

export const MOCK_PROCESSING_CASES: MockProcessingCase[] = [
  {
    id: 'case-001',
    service: 'Work Permit',
    targetCountry: 'Canada',
    stage: 'DOCUMENTS_UNDER_REVIEW',
    priority: 'URGENT',
    clientName: 'Ali Hassan',
    clientPhone: '+92 300 1234567',
    assignedOfficer: MOCK_PROCESSING_OFFICER,
    financeAmount: 150000,
    financeCurrency: 'PKR',
    financeHandoverNote: 'Client travelling in 3 weeks. Expedite review.',
    handoverOfficerName: 'Kamran Baig',
    createdAt: '2026-05-05T09:00:00.000Z',
    daysInCurrentStage: 4,
    documentItems: [
      { id: 'doc-001-1', documentName: 'Valid Passport', description: 'Must have min 6 months validity', criticality: 'CRITICAL', status: 'ACCEPTED', expectedFormats: ['PDF', 'JPG'], validityExpiryDate: '2028-03-15', versionNumber: 1, uploadedAt: '2026-05-06T10:00:00.000Z' },
      { id: 'doc-001-2', documentName: 'IELTS Certificate', description: 'Band 6.0 or higher', criticality: 'CRITICAL', status: 'UNDER_REVIEW', expectedFormats: ['PDF'], validityExpiryDate: '2027-04-10', versionNumber: 1, uploadedAt: '2026-05-07T14:00:00.000Z' },
      { id: 'doc-001-3', documentName: 'Employment Contract', description: 'Signed copy from employer', criticality: 'REQUIRED', status: 'ACCEPTED', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 2, uploadedAt: '2026-05-07T15:00:00.000Z' },
      { id: 'doc-001-4', documentName: 'Educational Degree', description: 'Attested from HEC', criticality: 'REQUIRED', status: 'REJECTED', expectedFormats: ['PDF'], validityExpiryDate: null, rejectionReasonCodes: ['CERTIFIED_COPY_REQUIRED'], rejectionNote: 'Please provide HEC-attested copy', versionNumber: 1, uploadedAt: '2026-05-06T11:00:00.000Z' },
      { id: 'doc-001-5', documentName: 'Police Clearance Certificate', description: 'From country of residence', criticality: 'REQUIRED', status: 'NOT_SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null },
      { id: 'doc-001-6', documentName: 'Medical Certificate', description: 'From approved physician', criticality: 'REQUIRED', status: 'NOT_SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null },
      { id: 'doc-001-7', documentName: 'Reference Letter', description: 'From current employer', criticality: 'SUPPORTING', status: 'ACCEPTED', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-05-06T12:00:00.000Z' },
      { id: 'doc-001-8', documentName: 'Bank Statement (6 months)', description: 'Showing sufficient funds', criticality: 'SUPPORTING', status: 'SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-05-08T09:00:00.000Z' },
    ],
    communications: [
      { id: 'comm-001-1', direction: 'SYSTEM_TO_CLIENT', messageType: 'WELCOME', subject: 'Your case has been received', content: 'Dear Ali Hassan, your Work Permit application for Canada has been received by our processing team. Please log in to upload your required documents.', channelsSent: ['PORTAL', 'WHATSAPP'], sentByName: 'System', createdAt: '2026-05-05T09:30:00.000Z', readByClientAt: '2026-05-05T10:00:00.000Z' },
      { id: 'comm-001-2', direction: 'OFFICER_TO_CLIENT', messageType: 'DOCS_REQUEST', subject: 'Documents required — please upload', content: 'Dear Ali, we have reviewed your checklist. Please upload your Police Clearance Certificate and Medical Certificate at your earliest convenience.', channelsSent: ['PORTAL', 'WHATSAPP'], sentByName: 'Sara Malik', createdAt: '2026-05-08T11:00:00.000Z', readByClientAt: '2026-05-08T14:00:00.000Z' },
      { id: 'comm-001-3', direction: 'CLIENT_TO_OFFICER', messageType: 'GENERAL_UPDATE', subject: 'Re: Documents required', content: 'I will upload the police clearance by Friday. Currently waiting for the medical appointment.', channelsSent: ['PORTAL'], sentByName: 'Ali Hassan', createdAt: '2026-05-08T16:00:00.000Z', readByClientAt: null },
    ],
    notes: [
      { id: 'note-001-1', content: 'Client is highly cooperative and responsive. Has business contacts in Canada who may provide reference.', noteType: 'CLIENT_INSIGHT', isPinned: true, createdByName: 'Sara Malik', createdAt: '2026-05-06T09:00:00.000Z' },
      { id: 'note-001-2', content: 'Degree attestation issue is common for this university. HEC processing takes 7-10 days. Advised client.', noteType: 'AUTHORITY_NOTE', isPinned: false, createdByName: 'Sara Malik', createdAt: '2026-05-07T11:00:00.000Z' },
    ],
    tasks: [
      { id: 'task-001-1', title: 'Follow up on medical certificate', description: 'Client said appointment is pending — follow up after 3 days', assignedToName: 'Sara Malik', priority: 'HIGH', status: 'OPEN', dueDate: '2026-05-13' },
      { id: 'task-001-2', title: 'Review IELTS certificate when uploaded', assignedToName: null, priority: 'NORMAL', status: 'IN_PROGRESS', dueDate: '2026-05-12' },
    ],
    timeline: [
      { id: 'tl-001-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Work Permit / Canada', actorName: 'Kamran Baig', createdAt: '2026-05-05T09:00:00.000Z', metadata: { priority: 'URGENT' } },
      { id: 'tl-001-2', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Case acknowledged — moved to Document Collection', actorName: 'Sara Malik', createdAt: '2026-05-05T10:00:00.000Z' },
      { id: 'tl-001-3', eventType: 'PROCESSING_DOCUMENT_ACCEPTED', description: 'Document accepted: Valid Passport', actorName: 'Sara Malik', createdAt: '2026-05-07T11:00:00.000Z' },
      { id: 'tl-001-4', eventType: 'PROCESSING_DOCUMENT_REJECTED', description: 'Document rejected: Educational Degree — CERTIFIED_COPY_REQUIRED', actorName: 'Sara Malik', createdAt: '2026-05-07T11:30:00.000Z' },
      { id: 'tl-001-5', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: DOCUMENTS_COLLECTION → DOCUMENTS_UNDER_REVIEW', actorName: 'Sara Malik', createdAt: '2026-05-08T10:00:00.000Z' },
    ],
    submissions: [],
  },
  {
    id: 'case-002',
    service: 'Study Visa',
    targetCountry: 'UK',
    stage: 'DOCUMENTS_COLLECTION',
    priority: 'NORMAL',
    clientName: 'Ayesha Tariq',
    clientPhone: '+92 321 9876543',
    assignedOfficer: MOCK_PROCESSING_OFFICER,
    financeAmount: 85000,
    financeCurrency: 'PKR',
    financeHandoverNote: null,
    handoverOfficerName: 'Fatima Noor',
    createdAt: '2026-05-07T11:00:00.000Z',
    daysInCurrentStage: 2,
    documentItems: [
      { id: 'doc-002-1', documentName: 'Valid Passport', description: 'Must have min 6 months validity', criticality: 'CRITICAL', status: 'NOT_SUBMITTED', expectedFormats: ['PDF', 'JPG'], validityExpiryDate: null },
      { id: 'doc-002-2', documentName: 'University Offer Letter', description: 'Conditional or unconditional offer', criticality: 'CRITICAL', status: 'ACCEPTED', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-05-08T09:00:00.000Z' },
      { id: 'doc-002-3', documentName: 'Bank Statement', description: 'Show GBP 12,000 equivalent', criticality: 'REQUIRED', status: 'SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-05-09T10:00:00.000Z' },
      { id: 'doc-002-4', documentName: 'Academic Transcripts', description: 'Last 2 years', criticality: 'REQUIRED', status: 'NOT_SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null },
      { id: 'doc-002-5', documentName: 'English Proficiency (IELTS/OET)', description: 'Band 6.5 or above', criticality: 'REQUIRED', status: 'NOT_SUBMITTED', expectedFormats: ['PDF'], validityExpiryDate: null },
    ],
    communications: [
      { id: 'comm-002-1', direction: 'SYSTEM_TO_CLIENT', messageType: 'WELCOME', subject: 'Your case has been received', content: 'Dear Ayesha, your Study Visa application for UK has been received. Please log in to upload your required documents.', channelsSent: ['PORTAL', 'WHATSAPP'], sentByName: 'System', createdAt: '2026-05-07T11:30:00.000Z', readByClientAt: '2026-05-07T14:00:00.000Z' },
    ],
    notes: [],
    tasks: [
      { id: 'task-002-1', title: 'Request passport scan from client', assignedToName: 'Sara Malik', priority: 'NORMAL', status: 'OPEN', dueDate: '2026-05-12' },
    ],
    timeline: [
      { id: 'tl-002-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Study Visa / UK', actorName: 'Fatima Noor', createdAt: '2026-05-07T11:00:00.000Z' },
      { id: 'tl-002-2', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Case acknowledged — moved to Document Collection', actorName: 'Sara Malik', createdAt: '2026-05-07T12:00:00.000Z' },
    ],
    submissions: [],
  },
  {
    id: 'case-003',
    service: 'Permanent Residency',
    targetCountry: 'Australia',
    stage: 'READY_FOR_SUBMISSION',
    priority: 'NORMAL',
    clientName: 'Usman Raza',
    clientPhone: '+92 333 4567890',
    assignedOfficer: MOCK_SENIOR_OFFICER,
    financeAmount: 220000,
    financeCurrency: 'PKR',
    financeHandoverNote: 'Premium client — priority service.',
    handoverOfficerName: 'Kamran Baig',
    createdAt: '2026-04-15T09:00:00.000Z',
    daysInCurrentStage: 1,
    documentItems: [
      { id: 'doc-003-1', documentName: 'Valid Passport', criticality: 'CRITICAL', status: 'ACCEPTED', description: '', expectedFormats: ['PDF'], validityExpiryDate: '2029-06-01', versionNumber: 1, uploadedAt: '2026-04-20T10:00:00.000Z' },
      { id: 'doc-003-2', documentName: 'Skills Assessment', criticality: 'CRITICAL', status: 'ACCEPTED', description: '', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-04-21T10:00:00.000Z' },
      { id: 'doc-003-3', documentName: 'Employment Records (5 years)', criticality: 'REQUIRED', status: 'ACCEPTED', description: '', expectedFormats: ['PDF'], validityExpiryDate: null, versionNumber: 1, uploadedAt: '2026-04-22T10:00:00.000Z' },
      { id: 'doc-003-4', documentName: 'IELTS (Band 7.0+)', criticality: 'REQUIRED', status: 'ACCEPTED', description: '', expectedFormats: ['PDF'], validityExpiryDate: '2028-01-15', versionNumber: 1, uploadedAt: '2026-04-22T11:00:00.000Z' },
      { id: 'doc-003-5', documentName: 'Police Clearance', criticality: 'REQUIRED', status: 'ACCEPTED', description: '', expectedFormats: ['PDF'], validityExpiryDate: '2026-10-01', versionNumber: 1, uploadedAt: '2026-04-23T10:00:00.000Z' },
      { id: 'doc-003-6', documentName: 'Health Insurance', criticality: 'SUPPORTING', status: 'WAIVED', description: '', expectedFormats: ['PDF'], validityExpiryDate: null },
    ],
    communications: [],
    notes: [
      { id: 'note-003-1', content: 'All documents verified. Pre-submission checklist complete. Recommend immediate filing.', noteType: 'STRATEGY', isPinned: true, createdByName: 'Bilal Ahmed', createdAt: '2026-05-10T15:00:00.000Z' },
    ],
    tasks: [],
    timeline: [
      { id: 'tl-003-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Permanent Residency / Australia', actorName: 'Kamran Baig', createdAt: '2026-04-15T09:00:00.000Z' },
      { id: 'tl-003-2', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: INTAKE_PENDING → DOCUMENTS_COLLECTION', actorName: 'Bilal Ahmed', createdAt: '2026-04-15T10:00:00.000Z' },
      { id: 'tl-003-3', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: DOCUMENTS_COMPLETE → READY_FOR_SUBMISSION', actorName: 'Bilal Ahmed', createdAt: '2026-05-10T15:00:00.000Z' },
    ],
    submissions: [],
  },
  {
    id: 'case-004',
    service: 'Family Sponsorship',
    targetCountry: 'Germany',
    stage: 'INTAKE_PENDING',
    priority: 'CRITICAL',
    clientName: 'Nadia Iqbal',
    clientPhone: '+92 311 2345678',
    assignedOfficer: null,
    financeAmount: 60000,
    financeCurrency: 'PKR',
    financeHandoverNote: "Client's husband is already in Germany. Flight in 10 days.",
    handoverOfficerName: 'Fatima Noor',
    createdAt: '2026-05-11T07:00:00.000Z',
    daysInCurrentStage: 0,
    documentItems: [],
    communications: [],
    notes: [],
    tasks: [],
    timeline: [
      { id: 'tl-004-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Family Sponsorship / Germany', actorName: 'Fatima Noor', createdAt: '2026-05-11T07:00:00.000Z' },
    ],
    submissions: [],
  },
  {
    id: 'case-005',
    service: 'Business Visa',
    targetCountry: 'UAE',
    stage: 'INTAKE_PENDING',
    priority: 'URGENT',
    clientName: 'Tariq Mehmood',
    clientPhone: '+92 345 6789012',
    assignedOfficer: null,
    financeAmount: 45000,
    financeCurrency: 'PKR',
    financeHandoverNote: 'Conference attendance. Visa needed within 5 days.',
    handoverOfficerName: 'Kamran Baig',
    createdAt: '2026-05-11T08:30:00.000Z',
    daysInCurrentStage: 0,
    documentItems: [],
    communications: [],
    notes: [],
    tasks: [],
    timeline: [
      { id: 'tl-005-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Business Visa / UAE', actorName: 'Kamran Baig', createdAt: '2026-05-11T08:30:00.000Z' },
    ],
    submissions: [],
  },
  {
    id: 'case-006',
    service: 'Work Permit',
    targetCountry: 'UK',
    stage: 'SUBMITTED',
    priority: 'NORMAL',
    clientName: 'Hassan Ali',
    clientPhone: '+92 322 5678901',
    assignedOfficer: MOCK_PROCESSING_OFFICER,
    financeAmount: 130000,
    financeCurrency: 'PKR',
    financeHandoverNote: null,
    handoverOfficerName: 'Fatima Noor',
    createdAt: '2026-04-01T09:00:00.000Z',
    daysInCurrentStage: 6,
    documentItems: [],
    communications: [],
    notes: [],
    tasks: [],
    timeline: [
      { id: 'tl-006-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Work Permit / UK', actorName: 'Fatima Noor', createdAt: '2026-04-01T09:00:00.000Z' },
      { id: 'tl-006-2', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: READY_FOR_SUBMISSION → SUBMITTED', actorName: 'Sara Malik', createdAt: '2026-05-06T11:00:00.000Z' },
      { id: 'tl-006-3', eventType: 'PROCESSING_SUBMISSION_FILED', description: 'Submission #1 filed with UK Visas and Immigration (UKVI)', actorName: 'Sara Malik', createdAt: '2026-05-06T11:10:00.000Z' },
    ],
    submissions: [
      {
        id: 'sub-006-1',
        submissionNumber: 1,
        submittedByName: 'Sara Malik',
        submissionDate: '2026-05-06',
        submissionReference: 'GWF-2026-0052871',
        authority: 'UK Visas and Immigration (UKVI)',
        documentsIncluded: ['doc-006-passport', 'doc-006-employment', 'doc-006-ielts'],
        trackingNumber: null,
        status: 'SUBMITTED',
        responseReceivedAt: null,
        responseType: null,
        responseNotes: null,
        nextAction: 'Await acknowledgement from UKVI (typically 3-5 working days)',
        createdAt: '2026-05-06T11:10:00.000Z',
      },
    ],
  },
  {
    id: 'case-007',
    service: 'Permanent Residency',
    targetCountry: 'Canada',
    stage: 'UNDER_AUTHORITY_REVIEW',
    priority: 'URGENT',
    clientName: 'Sana Mirza',
    clientPhone: '+92 300 9988776',
    assignedOfficer: MOCK_SENIOR_OFFICER,
    financeAmount: 195000,
    financeCurrency: 'PKR',
    financeHandoverNote: 'Express Entry profile score 480. Submitted under draw 295.',
    handoverOfficerName: 'Kamran Baig',
    createdAt: '2026-03-01T09:00:00.000Z',
    daysInCurrentStage: 28,
    documentItems: [],
    communications: [],
    notes: [],
    tasks: [],
    timeline: [
      { id: 'tl-007-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Permanent Residency / Canada', actorName: 'Kamran Baig', createdAt: '2026-03-01T09:00:00.000Z' },
      { id: 'tl-007-2', eventType: 'PROCESSING_SUBMISSION_FILED', description: 'Submission #1 filed with IRCC', actorName: 'Bilal Ahmed', createdAt: '2026-04-01T10:00:00.000Z' },
      { id: 'tl-007-3', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: SUBMITTED → UNDER_AUTHORITY_REVIEW', actorName: 'Bilal Ahmed', createdAt: '2026-04-14T09:00:00.000Z' },
    ],
    submissions: [
      {
        id: 'sub-007-1',
        submissionNumber: 1,
        submittedByName: 'Bilal Ahmed',
        submissionDate: '2026-04-01',
        submissionReference: 'IRCC-2026-EE-00381',
        authority: 'Immigration, Refugees and Citizenship Canada (IRCC)',
        documentsIncluded: [],
        trackingNumber: 'IRCC-TRK-00381-A',
        status: 'UNDER_REVIEW',
        responseReceivedAt: null,
        responseType: null,
        responseNotes: null,
        nextAction: 'Await decision — estimated 60-90 days from submission date',
        createdAt: '2026-04-01T10:00:00.000Z',
      },
    ],
  },
  {
    id: 'case-008',
    service: 'Work Permit',
    targetCountry: 'Australia',
    stage: 'REJECTED',
    priority: 'NORMAL',
    clientName: 'Imran Siddiqui',
    clientPhone: '+92 311 5544332',
    assignedOfficer: MOCK_SENIOR_OFFICER,
    financeAmount: 110000,
    financeCurrency: 'PKR',
    financeHandoverNote: null,
    handoverOfficerName: 'Fatima Noor',
    createdAt: '2026-02-15T09:00:00.000Z',
    daysInCurrentStage: 18,
    documentItems: [],
    communications: [],
    notes: [
      { id: 'note-008-1', content: 'Authority rejected citing skills assessment gap. Client has 5 years exp but assessment body used 3-year threshold. Appeal grounds strong — consult migration lawyer.', noteType: 'STRATEGY', isPinned: true, createdByName: 'Bilal Ahmed', createdAt: '2026-04-24T09:00:00.000Z' },
    ],
    tasks: [],
    timeline: [
      { id: 'tl-008-1', eventType: 'PROCESSING_CASE_CREATED', description: 'Processing case opened — Work Permit / Australia', actorName: 'Fatima Noor', createdAt: '2026-02-15T09:00:00.000Z' },
      { id: 'tl-008-2', eventType: 'PROCESSING_SUBMISSION_FILED', description: 'Submission #1 filed with Department of Home Affairs', actorName: 'Bilal Ahmed', createdAt: '2026-03-10T10:00:00.000Z' },
      { id: 'tl-008-3', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: UNDER_AUTHORITY_REVIEW → DECISION_RECEIVED', actorName: 'Bilal Ahmed', createdAt: '2026-04-20T14:00:00.000Z' },
      { id: 'tl-008-4', eventType: 'PROCESSING_STAGE_CHANGED', description: 'Stage changed: DECISION_RECEIVED → REJECTED', actorName: 'Bilal Ahmed', createdAt: '2026-04-24T09:00:00.000Z' },
    ],
    submissions: [
      {
        id: 'sub-008-1',
        submissionNumber: 1,
        submittedByName: 'Bilal Ahmed',
        submissionDate: '2026-03-10',
        submissionReference: 'DHA-482-2026-00817',
        authority: 'Department of Home Affairs (Australia)',
        documentsIncluded: [],
        trackingNumber: 'DHA-TRK-00817',
        status: 'RESPONDED',
        responseReceivedAt: '2026-04-20T08:00:00.000Z',
        responseType: 'REJECTION',
        responseNotes: 'Application refused under s.482 — skills assessment not meeting required threshold. Applicant may lodge a merit review with the AAT within 28 days.',
        nextAction: 'File appeal with AAT — deadline 2026-05-18',
        createdAt: '2026-03-10T10:00:00.000Z',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getCaseById(id: string): MockProcessingCase | undefined {
  return MOCK_PROCESSING_CASES.find((c) => c.id === id);
}

export function getIntakePending(): MockProcessingCase[] {
  return MOCK_PROCESSING_CASES.filter((c) => c.stage === 'INTAKE_PENDING')
    .sort((a, b) => {
      const pOrder: Record<ProcessingPriority, number> = { CRITICAL: 0, URGENT: 1, NORMAL: 2, LOW: 3 };
      return pOrder[a.priority] - pOrder[b.priority];
    });
}

export function getMyCases(officerId: string): MockProcessingCase[] {
  return MOCK_PROCESSING_CASES.filter(
    (c) => c.assignedOfficer?.id === officerId && c.stage !== 'COMPLETED' && c.stage !== 'CANCELLED',
  );
}

export function countByStage(stage: ProcessingStage): number {
  return MOCK_PROCESSING_CASES.filter((c) => c.stage === stage).length;
}

export function getDocumentProgress(items: MockDocumentItem[]): { accepted: number; total: number; rejected: number; pending: number } {
  const critical = items.filter((i) => i.criticality === 'CRITICAL' || i.criticality === 'REQUIRED');
  const accepted = critical.filter((i) => i.status === 'ACCEPTED' || i.status === 'WAIVED' || i.status === 'NOT_APPLICABLE').length;
  const rejected = critical.filter((i) => i.status === 'REJECTED').length;
  const pending = critical.filter((i) => i.status === 'SUBMITTED' || i.status === 'UNDER_REVIEW').length;
  return { accepted, total: critical.length, rejected, pending };
}

export function fmtAmount(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-PK', { style: 'decimal', maximumFractionDigits: 0 }).format(amount) + ' ' + currency;
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Karachi' });
}

export function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  // Use the real current time, not a fixed base. Clamp future timestamps (clock
  // skew) to "just now" so we never render negative ("-34927m ago").
  const diff = Date.now() - t;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const STAGE_LABEL: Record<ProcessingStage, string> = {
  INTAKE_PENDING: 'Intake Pending',
  DOCUMENTS_COLLECTION: 'Collecting Documents',
  DOCUMENTS_UNDER_REVIEW: 'Under Review',
  DOCUMENTS_INCOMPLETE: 'Documents Incomplete',
  DOCUMENTS_COMPLETE: 'Documents Complete',
  READY_FOR_SUBMISSION: 'Ready to Submit',
  SUBMITTED: 'Submitted',
  UNDER_AUTHORITY_REVIEW: 'With Authority',
  ADDITIONAL_INFO_REQUESTED: 'Info Requested',
  DECISION_RECEIVED: 'Decision Received',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  APPEAL_IN_PROGRESS: 'Appeal Filed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  JUNK: 'Junk',
};

export const PRIORITY_LABEL: Record<ProcessingPriority, string> = {
  CRITICAL: 'Critical',
  URGENT: 'Urgent',
  NORMAL: 'Normal',
  LOW: 'Low',
};

export const DOC_STATUS_LABEL: Record<DocumentItemStatus, string> = {
  NOT_SUBMITTED: 'Not Submitted',
  SUBMITTED: 'Uploaded',
  UNDER_REVIEW: 'Under Review',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring Soon',
  WAIVED: 'Waived',
  NOT_APPLICABLE: 'N/A',
};

export const REJECTION_REASON_LABEL: Record<string, string> = {
  ILLEGIBLE: 'Blurry or unreadable',
  WRONG_DOCUMENT: 'Incorrect document type',
  EXPIRED: 'Document expired',
  DETAILS_MISMATCH: 'Name/date/ID mismatch',
  INCOMPLETE: 'Missing pages',
  POOR_SCAN_QUALITY: 'Scan quality too low',
  SIGNATURE_MISSING: 'Signature absent',
  TRANSLATION_REQUIRED: 'Translation required',
  CERTIFIED_COPY_REQUIRED: 'Certified copy required',
  FORMAT_NOT_ACCEPTED: 'Format not accepted',
  WRONG_DATE_RANGE: 'Wrong validity period',
  OTHER: 'Other',
};

// ---------------------------------------------------------------------------
// Correction requests
// ---------------------------------------------------------------------------

export type CorrectionRequestStatus = 'SENT' | 'IN_PROGRESS' | 'RESOLVED' | 'ESCALATED';
export type CorrectionType = 'DOCUMENT' | 'INFORMATION';
export type CorrectionRequiredAction = 'REUPLOAD' | 'CONFIRM' | 'CORRECT' | 'CALL_BACK';

export interface MockCorrectionRequest {
  id: string;
  caseId: string;
  correctionType: CorrectionType;
  documentItemId: string | null;
  documentName: string | null;
  subject: string;
  reasonCodes: string[];
  clientMessage: string;
  requiredAction: CorrectionRequiredAction;
  slaHours: number;
  slaDueAt: string;
  status: CorrectionRequestStatus;
  raisedByName: string;
  resolvedByName: string | null;
  resolvedAt: string | null;
  createdAt: string;
}

export const CORRECTION_STATUS_LABEL: Record<CorrectionRequestStatus, string> = {
  SENT: 'Sent',
  IN_PROGRESS: 'In Progress',
  RESOLVED: 'Resolved',
  ESCALATED: 'Escalated',
};

export const REQUIRED_ACTION_LABEL: Record<CorrectionRequiredAction, string> = {
  REUPLOAD: 'Re-upload document',
  CONFIRM: 'Confirm information',
  CORRECT: 'Correct information',
  CALL_BACK: 'Call back office',
};

/** Deterministic mock corrections for case-001 */
export const MOCK_CORRECTIONS: MockCorrectionRequest[] = [
  {
    id: 'corr-001-1',
    caseId: 'case-001',
    correctionType: 'DOCUMENT',
    documentItemId: 'doc-001-4',
    documentName: 'Educational Degree',
    subject: 'Please upload HEC-attested copy',
    reasonCodes: ['CERTIFIED_COPY_REQUIRED'],
    clientMessage: 'Dear Ali, the Educational Degree you uploaded must be attested by HEC. Please obtain the certified copy and re-upload at your earliest convenience.',
    requiredAction: 'REUPLOAD',
    slaHours: 120,
    slaDueAt: '2026-05-16T11:00:00.000Z',
    status: 'SENT',
    raisedByName: 'Sara Malik',
    resolvedByName: null,
    resolvedAt: null,
    createdAt: '2026-05-11T11:00:00.000Z',
  },
  {
    id: 'corr-001-2',
    caseId: 'case-001',
    correctionType: 'INFORMATION',
    documentItemId: null,
    documentName: null,
    subject: 'Confirm mailing address for document delivery',
    reasonCodes: ['CONFIRM_DETAILS'],
    clientMessage: 'Dear Ali, please confirm your current mailing address so we can arrange document delivery after approval.',
    requiredAction: 'CONFIRM',
    slaHours: 48,
    slaDueAt: '2026-05-13T09:00:00.000Z',
    status: 'RESOLVED',
    raisedByName: 'Sara Malik',
    resolvedByName: 'Sara Malik',
    resolvedAt: '2026-05-09T14:00:00.000Z',
    createdAt: '2026-05-08T09:00:00.000Z',
  },
];

// ---------------------------------------------------------------------------
// Aggregated document queue helper
// ---------------------------------------------------------------------------

/** One row in the cross-case document queue. */
export interface AggregatedDocRow {
  docItem: MockDocumentItem;
  caseId: string;
  clientName: string;
  service: string;
  targetCountry: string;
  casePriority: ProcessingPriority;
  assignedOfficerName: string | null;
}

/** Actionable statuses shown in the document queue. */
export const DOC_QUEUE_STATUSES: DocumentItemStatus[] = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'REJECTED',
  'EXPIRING_SOON',
];

/**
 * Returns all document items across all cases that are in an actionable
 * status, attached to their case context. Sorted by priority → uploadedAt asc.
 */
export function getAggregatedDocQueue(officerId?: string): AggregatedDocRow[] {
  const pOrder: Record<ProcessingPriority, number> = { CRITICAL: 0, URGENT: 1, NORMAL: 2, LOW: 3 };
  const rows: AggregatedDocRow[] = [];

  for (const c of MOCK_PROCESSING_CASES) {
    if (officerId && c.assignedOfficer?.id !== officerId) continue;
    for (const doc of c.documentItems) {
      if (!DOC_QUEUE_STATUSES.includes(doc.status)) continue;
      rows.push({
        docItem: doc,
        caseId: c.id,
        clientName: c.clientName,
        service: c.service,
        targetCountry: c.targetCountry,
        casePriority: c.priority,
        assignedOfficerName: c.assignedOfficer?.name ?? null,
      });
    }
  }

  rows.sort((a, b) => {
    const pd = pOrder[a.casePriority] - pOrder[b.casePriority];
    if (pd !== 0) return pd;
    const ta = a.docItem.uploadedAt ?? '';
    const tb = b.docItem.uploadedAt ?? '';
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Aggregated task queue helper
// ---------------------------------------------------------------------------

/** One row in the cross-case task queue. */
export interface AggregatedTaskRow {
  task: MockTask;
  caseId: string;
  clientName: string;
  service: string;
  targetCountry: string;
  casePriority: ProcessingPriority;
}

/**
 * Returns all non-terminal tasks across all officer cases, sorted by:
 * case priority → task priority → due date asc (nulls last).
 */
export function getAggregatedTaskQueue(officerId?: string): AggregatedTaskRow[] {
  const pOrder: Record<ProcessingPriority, number> = { CRITICAL: 0, URGENT: 1, NORMAL: 2, LOW: 3 };
  const tOrder: Record<MockTask['priority'], number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  const rows: AggregatedTaskRow[] = [];

  for (const c of MOCK_PROCESSING_CASES) {
    if (officerId && c.assignedOfficer?.id !== officerId) continue;
    for (const task of c.tasks) {
      if (task.status === 'DONE' || task.status === 'CANCELLED') continue;
      rows.push({
        task,
        caseId: c.id,
        clientName: c.clientName,
        service: c.service,
        targetCountry: c.targetCountry,
        casePriority: c.priority,
      });
    }
  }

  rows.sort((a, b) => {
    const cpd = pOrder[a.casePriority] - pOrder[b.casePriority];
    if (cpd !== 0) return cpd;
    const tpd = tOrder[a.task.priority] - tOrder[b.task.priority];
    if (tpd !== 0) return tpd;
    const da = a.task.dueDate ?? '9999-12-31';
    const db = b.task.dueDate ?? '9999-12-31';
    return da < db ? -1 : da > db ? 1 : 0;
  });

  return rows;
}

// ---------------------------------------------------------------------------
// Report mock data — Phase 1G
// ---------------------------------------------------------------------------

// ---- Workload ----

export interface WorkloadOfficerRow {
  officerId: string | null;
  officerName: string;
  caseCount: number;
  avgDaysOpen: number;
  stageCounts: Partial<Record<ProcessingStage, number>>;
}
export interface WorkloadReport {
  from: string;
  to: string;
  rows: WorkloadOfficerRow[];
}

export const MOCK_WORKLOAD_REPORT: WorkloadReport = {
  from: '2026-04-12',
  to:   '2026-05-12',
  rows: [
    {
      officerId: MOCK_PROCESSING_OFFICER.id,
      officerName: MOCK_PROCESSING_OFFICER.name,
      caseCount: 4,
      avgDaysOpen: 22,
      stageCounts: { DOCUMENTS_COLLECTION: 1, DOCUMENTS_UNDER_REVIEW: 1, READY_FOR_SUBMISSION: 1, UNDER_AUTHORITY_REVIEW: 1 },
    },
    {
      officerId: MOCK_SENIOR_OFFICER.id,
      officerName: MOCK_SENIOR_OFFICER.name,
      caseCount: 3,
      avgDaysOpen: 35,
      stageCounts: { DOCUMENTS_COLLECTION: 1, SUBMITTED: 1, COMPLETED: 1 },
    },
    {
      officerId: null,
      officerName: 'Unassigned',
      caseCount: 1,
      avgDaysOpen: 5,
      stageCounts: { INTAKE_PENDING: 1 },
    },
  ],
};

// ---- Throughput ----

export interface ThroughputWeekRow {
  week: string;
  completed: number;
  cancelled: number;
  rejected: number;
  total: number;
}
export interface ThroughputReport {
  from: string;
  to: string;
  totalClosed: number;
  weeks: ThroughputWeekRow[];
}

export const MOCK_THROUGHPUT_REPORT: ThroughputReport = {
  from: '2026-02-09',
  to:   '2026-05-12',
  totalClosed: 14,
  weeks: [
    { week: '2026-W07', completed: 1, cancelled: 0, rejected: 0, total: 1 },
    { week: '2026-W08', completed: 2, cancelled: 1, rejected: 0, total: 3 },
    { week: '2026-W09', completed: 1, cancelled: 0, rejected: 1, total: 2 },
    { week: '2026-W10', completed: 0, cancelled: 1, rejected: 0, total: 1 },
    { week: '2026-W11', completed: 2, cancelled: 0, rejected: 0, total: 2 },
    { week: '2026-W12', completed: 3, cancelled: 1, rejected: 1, total: 5 },
  ],
};

// ---- Doc Quality ----

export interface DocQualityDocRow {
  documentName: string;
  accepted: number;
  rejected: number;
  total: number;
  rejectionRate: number;
  topReasonCodes: { code: string; count: number }[];
}
export interface DocQualityReport {
  from: string;
  to: string;
  documents: DocQualityDocRow[];
  topReasonCodes: { code: string; count: number }[];
}

export const MOCK_DOC_QUALITY_REPORT: DocQualityReport = {
  from: '2026-02-09',
  to:   '2026-05-12',
  topReasonCodes: [
    { code: 'POOR_QUALITY',        count: 12 },
    { code: 'INCOMPLETE_FORM',     count: 9  },
    { code: 'WRONG_DOCUMENT',      count: 7  },
    { code: 'EXPIRED',             count: 5  },
    { code: 'SIGNATURE_MISSING',   count: 4  },
    { code: 'WRONG_LANGUAGE',      count: 3  },
    { code: 'NOTARIZATION_NEEDED', count: 2  },
    { code: 'WRONG_SIZE',          count: 2  },
    { code: 'MISSING_PAGES',       count: 1  },
    { code: 'OTHER',               count: 1  },
  ],
  documents: [
    { documentName: 'Bank Statement',         accepted: 8, rejected: 7,  total: 15, rejectionRate: 47, topReasonCodes: [{ code: 'POOR_QUALITY', count: 4 }, { code: 'INCOMPLETE_FORM', count: 3 }] },
    { documentName: 'Passport Copy',          accepted: 18, rejected: 4, total: 22, rejectionRate: 18, topReasonCodes: [{ code: 'EXPIRED', count: 3 }, { code: 'WRONG_SIZE', count: 1 }] },
    { documentName: 'Employment Letter',      accepted: 12, rejected: 5, total: 17, rejectionRate: 29, topReasonCodes: [{ code: 'SIGNATURE_MISSING', count: 3 }, { code: 'INCOMPLETE_FORM', count: 2 }] },
    { documentName: 'Police Clearance',       accepted: 9,  rejected: 2, total: 11, rejectionRate: 18, topReasonCodes: [{ code: 'NOTARIZATION_NEEDED', count: 2 }] },
    { documentName: 'Birth Certificate',      accepted: 7,  rejected: 3, total: 10, rejectionRate: 30, topReasonCodes: [{ code: 'WRONG_LANGUAGE', count: 3 }] },
    { documentName: 'Marriage Certificate',   accepted: 5,  rejected: 1, total: 6,  rejectionRate: 17, topReasonCodes: [{ code: 'MISSING_PAGES', count: 1 }] },
    { documentName: 'Medical Examination',    accepted: 10, rejected: 0, total: 10, rejectionRate: 0,  topReasonCodes: [] },
  ],
};

// ---- SLA ----

export interface OverdueCorrectionRow {
  correctionId: string;
  caseId: string;
  subject: string;
  status: CorrectionRequestStatus;
  slaDueAt: string;
  hoursOverdue: number;
  raisedByName: string;
}
export interface AgingCaseRow {
  caseId: string;
  service: string;
  targetCountry: string;
  stage: ProcessingStage;
  priority: ProcessingPriority;
  daysOpen: number;
  bucket: '30-60' | '60-90' | '90+';
  officerName: string;
}
export interface SlaReport {
  overdueCorrections: OverdueCorrectionRow[];
  agingCases: AgingCaseRow[];
  summary: { overdueCount: number; aging30to60: number; aging60to90: number; aging90plus: number };
}

export const MOCK_SLA_REPORT: SlaReport = {
  summary: { overdueCount: 2, aging30to60: 3, aging60to90: 1, aging90plus: 0 },
  overdueCorrections: [
    {
      correctionId: 'cr-001',
      caseId: 'case-001',
      subject: 'Bank statement pages missing',
      status: 'SENT',
      slaDueAt: '2026-05-07T08:00:00Z',
      hoursOverdue: 120,
      raisedByName: MOCK_PROCESSING_OFFICER.name,
    },
    {
      correctionId: 'cr-002',
      caseId: 'case-002',
      subject: 'Employment letter re-sign required',
      status: 'IN_PROGRESS',
      slaDueAt: '2026-05-09T10:00:00Z',
      hoursOverdue: 42,
      raisedByName: MOCK_SENIOR_OFFICER.name,
    },
  ],
  agingCases: [
    { caseId: 'case-005', service: 'Student Visa', targetCountry: 'Germany', stage: 'DOCUMENTS_COLLECTION', priority: 'URGENT',   daysOpen: 62, bucket: '60-90', officerName: MOCK_SENIOR_OFFICER.name },
    { caseId: 'case-003', service: 'Work Permit',  targetCountry: 'Canada',  stage: 'UNDER_AUTHORITY_REVIEW', priority: 'NORMAL', daysOpen: 55, bucket: '30-60', officerName: MOCK_PROCESSING_OFFICER.name },
    { caseId: 'case-006', service: 'PR Application', targetCountry: 'Australia', stage: 'SUBMITTED', priority: 'NORMAL',          daysOpen: 48, bucket: '30-60', officerName: MOCK_PROCESSING_OFFICER.name },
    { caseId: 'case-007', service: 'Visitor Visa', targetCountry: 'UK',      stage: 'DOCUMENTS_UNDER_REVIEW', priority: 'LOW',    daysOpen: 33, bucket: '30-60', officerName: MOCK_SENIOR_OFFICER.name },
  ],
};

// ---- Expiry Risk ----

export interface ExpiryRiskRow {
  documentItemId: string;
  documentName: string;
  criticality: DocumentCriticality;
  status: DocumentItemStatus;
  validityExpiryDate: string;
  daysUntilExpiry: number;
  bucket: 'expired' | '0-30' | '31-60' | '61-90';
  caseId: string;
  service: string;
  targetCountry: string;
  casePriority: ProcessingPriority;
  officerName: string;
}
export interface ExpiryRiskReport {
  generatedAt: string;
  summary: { expired: number; within30: number; within60: number; within90: number };
  rows: ExpiryRiskRow[];
}

export const MOCK_EXPIRY_RISK_REPORT: ExpiryRiskReport = {
  generatedAt: '2026-05-12T08:00:00Z',
  summary: { expired: 1, within30: 2, within60: 2, within90: 1 },
  rows: [
    { documentItemId: 'di-r01', documentName: 'Medical Examination', criticality: 'CRITICAL',  status: 'ACCEPTED',      validityExpiryDate: '2026-05-05', daysUntilExpiry: -7,  bucket: 'expired', caseId: 'case-003', service: 'Work Permit',    targetCountry: 'Canada',    casePriority: 'URGENT',  officerName: MOCK_PROCESSING_OFFICER.name },
    { documentItemId: 'di-r02', documentName: 'Police Clearance',    criticality: 'REQUIRED',  status: 'ACCEPTED',      validityExpiryDate: '2026-05-18', daysUntilExpiry: 6,   bucket: '0-30',    caseId: 'case-001', service: 'PR Application', targetCountry: 'Canada',    casePriority: 'CRITICAL', officerName: MOCK_PROCESSING_OFFICER.name },
    { documentItemId: 'di-r03', documentName: 'Passport Copy',       criticality: 'CRITICAL',  status: 'ACCEPTED',      validityExpiryDate: '2026-05-28', daysUntilExpiry: 16,  bucket: '0-30',    caseId: 'case-005', service: 'Student Visa',   targetCountry: 'Germany',   casePriority: 'URGENT',  officerName: MOCK_SENIOR_OFFICER.name },
    { documentItemId: 'di-r04', documentName: 'Bank Statement',      criticality: 'REQUIRED',  status: 'UNDER_REVIEW',  validityExpiryDate: '2026-06-15', daysUntilExpiry: 34,  bucket: '31-60',   caseId: 'case-002', service: 'Work Permit',    targetCountry: 'Australia', casePriority: 'NORMAL',  officerName: MOCK_SENIOR_OFFICER.name },
    { documentItemId: 'di-r05', documentName: 'Employment Letter',   criticality: 'REQUIRED',  status: 'SUBMITTED',     validityExpiryDate: '2026-06-20', daysUntilExpiry: 39,  bucket: '31-60',   caseId: 'case-006', service: 'PR Application', targetCountry: 'Australia', casePriority: 'NORMAL',  officerName: MOCK_PROCESSING_OFFICER.name },
    { documentItemId: 'di-r06', documentName: 'Birth Certificate',   criticality: 'SUPPORTING', status: 'NOT_SUBMITTED', validityExpiryDate: '2026-07-30', daysUntilExpiry: 79,  bucket: '61-90',   caseId: 'case-007', service: 'Visitor Visa',   targetCountry: 'UK',        casePriority: 'LOW',     officerName: MOCK_SENIOR_OFFICER.name },
  ],
};

