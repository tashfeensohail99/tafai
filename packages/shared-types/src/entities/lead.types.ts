/**
 * @tashfeen/shared-types — entities/lead.types.ts
 * Lead entity shapes as returned by the API.
 */

import { LeadStatus, SourceChannel } from '../enums/lead.enums';

export interface LeadSummary {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string;
  nationality: string | null;
  targetCountry: string | null;
  serviceInterest: string | null;
  sourceChannel: SourceChannel | null;
  status: LeadStatus;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  branchId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDetail extends LeadSummary {
  notes: string | null;
  referredByPartnerId: string | null;
  convertedClientId: string | null;
  followUps: FollowUpSummary[];
}

export interface FollowUpSummary {
  id: string;
  leadId: string | null;
  clientId: string | null;
  assignedEmployeeId: string | null;
  title: string;
  notes: string | null;
  dueAt: string | null;
  completedAt: string | null;
  status: string;
  createdAt: string;
}
