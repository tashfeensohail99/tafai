/**
 * @tashfeen/shared-types — entities/case.types.ts
 * Case and processing case entity shapes as returned by the API.
 */

import { CaseStatus, ProcessingCaseStage } from '../enums/case.enums';

export interface CaseSummary {
  id: string;
  clientId: string;
  clientName: string;
  serviceId: string | null;
  serviceName: string | null;
  targetCountry: string | null;
  status: CaseStatus;
  assignedEmployeeId: string | null;
  assignedEmployeeName: string | null;
  departmentId: string | null;
  branchId: string | null;
  openedAt: string;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingCaseSummary {
  id: string;
  caseId: string;
  clientId: string;
  clientName: string;
  stage: ProcessingCaseStage;
  assignedOfficerId: string | null;
  assignedOfficerName: string | null;
  slaDueAt: string | null;
  submittedAt: string | null;
  decisionReceivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessingCaseStageHistoryEntry {
  id: string;
  processingCaseId: string;
  fromStage: ProcessingCaseStage | null;
  toStage: ProcessingCaseStage;
  changedByUserId: string;
  notes: string | null;
  createdAt: string;
}
