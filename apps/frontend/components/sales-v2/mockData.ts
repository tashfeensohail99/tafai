// Mock data for the Sales workspace UI rebuild.
// All screens read from this file so the new UI can be reviewed
// independently of the backend.

export type LeadSource =
  | 'WALK_IN'
  | 'FACEBOOK'
  | 'INSTAGRAM'
  | 'WEBSITE'
  | 'WHATSAPP'
  | 'REFERRAL'
  | 'PHONE';

export type AssignmentType = 'ADMIN' | 'AUTO_CRM';

export type LeadStage =
  | 'NEW'
  | 'ASSIGNED'
  | 'CONTACTED'
  | 'NO_RESPONSE'
  | 'MEETING_NEEDED'
  | 'APPOINTMENT_BOOKED'
  | 'PAYMENT_INTERESTED'
  | 'RECEIPT_UPLOADED'
  | 'SENT_TO_FINANCE';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export type SlaStatus = 'ACTIVE' | 'OVERDUE' | 'COMPLETED' | 'UPCOMING';

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email?: string;
  source: LeadSource;
  service: string;
  targetCountry: string;
  assignedBy?: string; // who assigned (admin / auto)
  assignmentType: AssignmentType;
  assignedAt: string; // ISO
  priority: Priority;
  stage: LeadStage;
  slaStatus: SlaStatus;
  slaDueAt?: string;
  nextAction: string;
  salesNote?: string;
  tags?: string[];
}

export type FollowUpType =
  | 'FIRST_CALL'
  | 'WHATSAPP'
  | 'PAYMENT_REMINDER'
  | 'APPOINTMENT_REMINDER'
  | 'NO_RESPONSE_RETRY'
  | 'OFFICE_VISIT';

export type FollowUpStatus =
  | 'PENDING'
  | 'DUE_TODAY'
  | 'OVERDUE'
  | 'COMPLETED'
  | 'RESCHEDULED'
  | 'NO_RESPONSE'
  | 'PAYMENT_INTERESTED';

export interface FollowUp {
  id: string;
  leadId: string;
  clientName: string;
  type: FollowUpType;
  channel: 'CALL' | 'WHATSAPP' | 'EMAIL' | 'IN_PERSON';
  dueAt: string;
  slaStatus: SlaStatus;
  linkedStage: LeadStage;
  reason: string;
  status: FollowUpStatus;
  outcome?: string;
}

export type AppointmentType = 'OFFICE_MEETING' | 'VIDEO_CALL' | 'PHONE_CONSULT' | 'OFFICE_VISIT';
export type AppointmentStatus = 'BOOKED' | 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';

export interface Appointment {
  id: string;
  leadId: string;
  clientName: string;
  type: AppointmentType;
  scheduledAt: string;
  durationMin: number;
  status: AppointmentStatus;
  location?: string;
  note?: string;
}

export const STAGE_LABEL: Record<LeadStage, string> = {
  NEW: 'New',
  ASSIGNED: 'Assigned',
  CONTACTED: 'Contacted',
  NO_RESPONSE: 'No Response',
  MEETING_NEEDED: 'Meeting Needed',
  APPOINTMENT_BOOKED: 'Appointment Booked',
  PAYMENT_INTERESTED: 'Payment Interested',
  RECEIPT_UPLOADED: 'Receipt Uploaded',
  SENT_TO_FINANCE: 'Sent to Finance',
};

export const SOURCE_LABEL: Record<LeadSource, string> = {
  WALK_IN: 'Walk-in',
  FACEBOOK: 'Facebook Ads',
  INSTAGRAM: 'Instagram DM',
  WEBSITE: 'Website CRM',
  WHATSAPP: 'WhatsApp',
  REFERRAL: 'Referral',
  PHONE: 'Phone Call',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
};

export const FOLLOWUP_TYPE_LABEL: Record<FollowUpType, string> = {
  FIRST_CALL: 'First Call',
  WHATSAPP: 'WhatsApp',
  PAYMENT_REMINDER: 'Payment Reminder',
  APPOINTMENT_REMINDER: 'Appointment Reminder',
  NO_RESPONSE_RETRY: 'No Response Retry',
  OFFICE_VISIT: 'Office Visit',
};

export const APPT_TYPE_LABEL: Record<AppointmentType, string> = {
  OFFICE_MEETING: 'Office Meeting',
  VIDEO_CALL: 'Video Call',
  PHONE_CONSULT: 'Phone Consult',
  OFFICE_VISIT: 'Office Visit',
};

// Stage color helpers (variant returns a CSS class for sv-badge)
export function stageBadgeClass(stage: LeadStage): string {
  switch (stage) {
    case 'NEW':
    case 'ASSIGNED':
      return 'sv-b-info';
    case 'CONTACTED':
      return 'sv-b-cyan';
    case 'NO_RESPONSE':
      return 'sv-b-warning';
    case 'MEETING_NEEDED':
      return 'sv-b-violet';
    case 'APPOINTMENT_BOOKED':
      return 'sv-b-info';
    case 'PAYMENT_INTERESTED':
      return 'sv-b-success';
    case 'RECEIPT_UPLOADED':
      return 'sv-b-cyan';
    case 'SENT_TO_FINANCE':
      return 'sv-b-success';
    default:
      return 'sv-b-slate';
  }
}

export function stageDotColor(stage: LeadStage): string {
  switch (stage) {
    case 'NEW':
    case 'ASSIGNED':
      return '#2563eb';
    case 'CONTACTED':
      return '#0891b2';
    case 'NO_RESPONSE':
      return '#d97706';
    case 'MEETING_NEEDED':
      return '#7c3aed';
    case 'APPOINTMENT_BOOKED':
      return '#3b82f6';
    case 'PAYMENT_INTERESTED':
      return '#10b981';
    case 'RECEIPT_UPLOADED':
      return '#06b6d4';
    case 'SENT_TO_FINANCE':
      return '#059669';
    default:
      return '#64748b';
  }
}

export function priorityBadgeClass(p: Priority): string {
  return p === 'HIGH' ? 'sv-b-danger' : p === 'MEDIUM' ? 'sv-b-warning' : 'sv-b-slate';
}

export function slaBadgeClass(s: SlaStatus): string {
  return s === 'OVERDUE'
    ? 'sv-b-danger'
    : s === 'ACTIVE'
      ? 'sv-b-success'
      : s === 'UPCOMING'
        ? 'sv-b-info'
        : 'sv-b-slate';
}

export function sourceBadgeClass(s: LeadSource): string {
  switch (s) {
    case 'WALK_IN':
      return 'sv-b-slate';
    case 'FACEBOOK':
      return 'sv-b-info';
    case 'INSTAGRAM':
      return 'sv-b-pink';
    case 'WEBSITE':
      return 'sv-b-violet';
    case 'WHATSAPP':
      return 'sv-b-success';
    case 'REFERRAL':
      return 'sv-b-warning';
    case 'PHONE':
      return 'sv-b-cyan';
  }
}

export function followUpStatusBadgeClass(s: FollowUpStatus): string {
  switch (s) {
    case 'OVERDUE':
      return 'sv-b-danger';
    case 'DUE_TODAY':
      return 'sv-b-warning';
    case 'COMPLETED':
      return 'sv-b-success';
    case 'RESCHEDULED':
      return 'sv-b-info';
    case 'NO_RESPONSE':
      return 'sv-b-warning';
    case 'PAYMENT_INTERESTED':
      return 'sv-b-success';
    case 'PENDING':
    default:
      return 'sv-b-slate';
  }
}

export function appointmentStatusBadgeClass(s: AppointmentStatus): string {
  switch (s) {
    case 'BOOKED':
      return 'sv-b-info';
    case 'PENDING':
      return 'sv-b-warning';
    case 'COMPLETED':
      return 'sv-b-success';
    case 'CANCELLED':
      return 'sv-b-danger';
    case 'NO_SHOW':
      return 'sv-b-warning';
  }
}

// ----------- Mock data -----------
export const SALES_LOCALE = 'en-PK';
export const SALES_TIME_ZONE = 'Asia/Karachi';
export const MOCK_REFERENCE_ISO = '2026-05-09T15:02:00+05:00';

const MOCK_REFERENCE_MS = new Date(MOCK_REFERENCE_ISO).getTime();
const inHours = (h: number) => new Date(MOCK_REFERENCE_MS + h * 3600000).toISOString();
const minusHours = (h: number) => new Date(MOCK_REFERENCE_MS - h * 3600000).toISOString();

export const MOCK_LEADS: Lead[] = [
  {
    id: 'L-1042',
    firstName: 'Awasi',
    lastName: 'Rehman',
    phone: '+92 300 9876543',
    email: 'awasi@example.com',
    source: 'WALK_IN',
    service: 'Study Visa',
    targetCountry: 'Canada',
    assignedBy: 'Admin · Sara K.',
    assignmentType: 'ADMIN',
    assignedAt: minusHours(2),
    priority: 'HIGH',
    stage: 'PAYMENT_INTERESTED',
    slaStatus: 'ACTIVE',
    slaDueAt: inHours(4),
    nextAction: 'Confirm payment & upload receipt',
    salesNote: 'Hot lead. Visited office today and ready to pay tomorrow morning.',
    tags: ['Hot', 'Walk-in'],
  },
  {
    id: 'L-1041',
    firstName: 'Bilal',
    lastName: 'Hussain',
    phone: '+92 321 4451221',
    email: 'bilal.h@example.com',
    source: 'FACEBOOK',
    service: 'Work Permit',
    targetCountry: 'Australia',
    assignedBy: 'Auto CRM',
    assignmentType: 'AUTO_CRM',
    assignedAt: minusHours(6),
    priority: 'MEDIUM',
    stage: 'CONTACTED',
    slaStatus: 'ACTIVE',
    slaDueAt: inHours(20),
    nextAction: 'Send service brochure on WhatsApp',
    tags: ['New'],
  },
  {
    id: 'L-1040',
    firstName: 'Zoya',
    lastName: 'Malik',
    phone: '+92 333 7770099',
    source: 'INSTAGRAM',
    service: 'Visit Visa',
    targetCountry: 'United Kingdom',
    assignedBy: 'Auto CRM',
    assignmentType: 'AUTO_CRM',
    assignedAt: minusHours(14),
    priority: 'MEDIUM',
    stage: 'NO_RESPONSE',
    slaStatus: 'OVERDUE',
    slaDueAt: minusHours(2),
    nextAction: 'Retry call in 24 hours',
  },
  {
    id: 'L-1039',
    firstName: 'Daniyal',
    lastName: 'Ahmed',
    phone: '+92 312 1112233',
    email: 'daniyal@example.com',
    source: 'WEBSITE',
    service: 'Study Visa',
    targetCountry: 'Germany',
    assignedBy: 'Admin · Sara K.',
    assignmentType: 'ADMIN',
    assignedAt: minusHours(28),
    priority: 'HIGH',
    stage: 'APPOINTMENT_BOOKED',
    slaStatus: 'UPCOMING',
    slaDueAt: inHours(22),
    nextAction: 'Reminder before tomorrow 11:00 AM consult',
    tags: ['Returning'],
  },
  {
    id: 'L-1038',
    firstName: 'Hira',
    lastName: 'Saeed',
    phone: '+92 345 4040502',
    source: 'WHATSAPP',
    service: 'Tourist Visa',
    targetCountry: 'United States',
    assignedBy: 'Auto CRM',
    assignmentType: 'AUTO_CRM',
    assignedAt: minusHours(40),
    priority: 'LOW',
    stage: 'NEW',
    slaStatus: 'ACTIVE',
    slaDueAt: inHours(2),
    nextAction: 'First contact call',
  },
  {
    id: 'L-1037',
    firstName: 'Usman',
    lastName: 'Shah',
    phone: '+92 308 8889911',
    email: 'usman.shah@example.com',
    source: 'REFERRAL',
    service: 'Permanent Residency',
    targetCountry: 'Canada',
    assignedBy: 'Admin · Imran R.',
    assignmentType: 'ADMIN',
    assignedAt: minusHours(48),
    priority: 'MEDIUM',
    stage: 'SENT_TO_FINANCE',
    slaStatus: 'COMPLETED',
    nextAction: 'Awaiting finance verification',
    salesNote: 'CAD 1,500 deposit received in cash. Receipt uploaded.',
  },
  {
    id: 'L-1036',
    firstName: 'Maria',
    lastName: 'Khan',
    phone: '+92 317 5500431',
    source: 'PHONE',
    service: 'Spouse Visa',
    targetCountry: 'Saudi Arabia',
    assignedBy: 'Auto CRM',
    assignmentType: 'AUTO_CRM',
    assignedAt: minusHours(72),
    priority: 'LOW',
    stage: 'MEETING_NEEDED',
    slaStatus: 'ACTIVE',
    slaDueAt: inHours(48),
    nextAction: 'Book consultation appointment',
  },
];

export const MOCK_FOLLOWUPS: FollowUp[] = [
  {
    id: 'F-2031',
    leadId: 'L-1042',
    clientName: 'Awasi Rehman',
    type: 'PAYMENT_REMINDER',
    channel: 'WHATSAPP',
    dueAt: inHours(2),
    slaStatus: 'ACTIVE',
    linkedStage: 'PAYMENT_INTERESTED',
    reason: 'Confirm payment slot for tomorrow morning',
    status: 'DUE_TODAY',
  },
  {
    id: 'F-2030',
    leadId: 'L-1040',
    clientName: 'Zoya Malik',
    type: 'NO_RESPONSE_RETRY',
    channel: 'CALL',
    dueAt: minusHours(2),
    slaStatus: 'OVERDUE',
    linkedStage: 'NO_RESPONSE',
    reason: 'Lead missed two calls — retry today',
    status: 'OVERDUE',
  },
  {
    id: 'F-2029',
    leadId: 'L-1041',
    clientName: 'Bilal Hussain',
    type: 'WHATSAPP',
    channel: 'WHATSAPP',
    dueAt: inHours(8),
    slaStatus: 'ACTIVE',
    linkedStage: 'CONTACTED',
    reason: 'Send Australia work permit brochure',
    status: 'PENDING',
  },
  {
    id: 'F-2028',
    leadId: 'L-1039',
    clientName: 'Daniyal Ahmed',
    type: 'APPOINTMENT_REMINDER',
    channel: 'WHATSAPP',
    dueAt: inHours(22),
    slaStatus: 'UPCOMING',
    linkedStage: 'APPOINTMENT_BOOKED',
    reason: 'Reminder for tomorrow 11:00 AM office consult',
    status: 'PENDING',
  },
  {
    id: 'F-2027',
    leadId: 'L-1036',
    clientName: 'Maria Khan',
    type: 'OFFICE_VISIT',
    channel: 'IN_PERSON',
    dueAt: inHours(48),
    slaStatus: 'ACTIVE',
    linkedStage: 'MEETING_NEEDED',
    reason: 'Schedule first office visit consultation',
    status: 'PENDING',
  },
  {
    id: 'F-2026',
    leadId: 'L-1038',
    clientName: 'Hira Saeed',
    type: 'FIRST_CALL',
    channel: 'CALL',
    dueAt: inHours(1),
    slaStatus: 'ACTIVE',
    linkedStage: 'NEW',
    reason: 'First touch within SLA window',
    status: 'DUE_TODAY',
  },
  {
    id: 'F-2025',
    leadId: 'L-1037',
    clientName: 'Usman Shah',
    type: 'PAYMENT_REMINDER',
    channel: 'WHATSAPP',
    dueAt: minusHours(20),
    slaStatus: 'COMPLETED',
    linkedStage: 'SENT_TO_FINANCE',
    reason: 'Confirmed deposit received',
    status: 'COMPLETED',
    outcome: 'Client paid CAD 1,500. Receipt uploaded and sent to Finance.',
  },
];

export const MOCK_APPOINTMENTS: Appointment[] = [
  {
    id: 'A-3010',
    leadId: 'L-1039',
    clientName: 'Daniyal Ahmed',
    type: 'OFFICE_MEETING',
    scheduledAt: inHours(22),
    durationMin: 45,
    status: 'BOOKED',
    location: 'Tafsheen HQ — Meeting Room 2',
    note: 'Bring Germany student visa checklist',
  },
  {
    id: 'A-3009',
    leadId: 'L-1042',
    clientName: 'Awasi Rehman',
    type: 'OFFICE_MEETING',
    scheduledAt: inHours(28),
    durationMin: 30,
    status: 'BOOKED',
    location: 'Tafsheen HQ — Front Desk',
    note: 'Bring CAD 1,500 deposit and CNIC',
  },
  {
    id: 'A-3008',
    leadId: 'L-1036',
    clientName: 'Maria Khan',
    type: 'VIDEO_CALL',
    scheduledAt: inHours(56),
    durationMin: 30,
    status: 'PENDING',
  },
  {
    id: 'A-3007',
    leadId: 'L-1041',
    clientName: 'Bilal Hussain',
    type: 'PHONE_CONSULT',
    scheduledAt: minusHours(20),
    durationMin: 20,
    status: 'COMPLETED',
  },
  {
    id: 'A-3006',
    leadId: 'L-1040',
    clientName: 'Zoya Malik',
    type: 'OFFICE_MEETING',
    scheduledAt: minusHours(48),
    durationMin: 30,
    status: 'NO_SHOW',
  },
];

// Lookups
export function getLead(id: string): Lead | undefined {
  return MOCK_LEADS.find((l) => l.id === id);
}

export function getFollowUp(id: string): FollowUp | undefined {
  return MOCK_FOLLOWUPS.find((f) => f.id === id);
}

// Date helpers
function formatSalesDate(iso: string, options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(SALES_LOCALE, {
    ...options,
    timeZone: SALES_TIME_ZONE,
  }).format(new Date(iso));
}

function formatRelative(iso: string, referenceMs: number) {
  const diffMs = new Date(iso).getTime() - referenceMs;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const sign = diffMs < 0 ? 'ago' : 'in';
  if (minutes < 60) return `${sign === 'ago' ? '' : sign + ' '}${minutes}m${sign === 'ago' ? ' ago' : ''}`;
  if (hours < 24) return `${sign === 'ago' ? '' : sign + ' '}${hours}h${sign === 'ago' ? ' ago' : ''}`;
  return `${sign === 'ago' ? '' : sign + ' '}${days}d${sign === 'ago' ? ' ago' : ''}`;
}

export function fmtDateTime(iso: string) {
  return formatSalesDate(iso, { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtTimeOnly(iso: string) {
  return formatSalesDate(iso, { timeStyle: 'short' });
}

export function fmtMonthShort(iso: string) {
  return formatSalesDate(iso, { month: 'short' });
}

export function fmtDayOfMonth(iso: string) {
  return Number(
    new Intl.DateTimeFormat(SALES_LOCALE, {
      day: 'numeric',
      timeZone: SALES_TIME_ZONE,
    }).format(new Date(iso)),
  );
}

export function fmtLongDate(iso: string) {
  return formatSalesDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
}

export function fmtRelative(iso: string) {
  return formatRelative(iso, MOCK_REFERENCE_MS);
}

export function fmtRelativeToNow(iso: string) {
  return formatRelative(iso, Date.now());
}

export function initialsOf(first: string, last?: string) {
  return `${first[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}
