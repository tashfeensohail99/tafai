import { isCanonicalServiceCode } from './service-types';

/**
 * Resolve a free-text "Program" (from an imported spreadsheet) to a canonical
 * service code, optionally carrying a program sub-type that drives the
 * program-specific document checklist (e.g. C11 under WORK_PERMIT).
 */
export interface ResolvedProgram {
  /** One of SERVICE_TYPE_CODES. */
  service: string;
  /** Optional sub-type preserved from the source (e.g. "C11", "ICT"). */
  programCode?: string;
}

function norm(s: string): string {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Normalized free-text → resolved program. Order-independent (exact-key lookup).
const ALIASES: Record<string, ResolvedProgram> = {
  'STUDY VISA': { service: 'STUDY_VISA' },
  'STUDENT VISA': { service: 'STUDY_VISA' },
  'WORK PERMIT': { service: 'WORK_PERMIT' },
  WP: { service: 'WORK_PERMIT' },
  LMIA: { service: 'WORK_PERMIT' },
  'LMIA EXEMPT': { service: 'WORK_PERMIT' },
  'LMIA EXEMPTED': { service: 'WORK_PERMIT' },
  'LMIA EXEMPTED WP': { service: 'WORK_PERMIT' },
  // C11 = LMIA-exempt work permit (significant benefit / entrepreneur).
  C11: { service: 'WORK_PERMIT', programCode: 'C11' },
  'C11 CASE': { service: 'WORK_PERMIT', programCode: 'C11' },
  ICT: { service: 'WORK_PERMIT', programCode: 'ICT' },
  'ICT CASE': { service: 'WORK_PERMIT', programCode: 'ICT' },
  PR: { service: 'PR_CASE' },
  'PR CASE': { service: 'PR_CASE' },
  'PERMANENT RESIDENCY': { service: 'PR_CASE' },
  'PERMANENT RESIDENCE': { service: 'PR_CASE' },
  'VISIT VISA': { service: 'VISIT_VISA' },
  // The processing sheets often write just "Visit" (or "Visit Case", matching
  // the "C11 Case" / "JR Resubmission Case" style) — treat those as Visit Visa.
  VISIT: { service: 'VISIT_VISA' },
  'VISIT CASE': { service: 'VISIT_VISA' },
  'VISITOR VISA': { service: 'VISIT_VISA' },
  'TOURIST VISA': { service: 'TOURIST_VISA' },
  TOURIST: { service: 'TOURIST_VISA' },
  'SPOUSE VISA': { service: 'SPOUSE_VISA' },
  E2: { service: 'E2_VISA' },
  'E2 VISA': { service: 'E2_VISA' },
  CBI: { service: 'CBI' },
  'CITIZENSHIP BY INVESTMENT': { service: 'CBI' },
  JR: { service: 'JR_RESUBMISSION' },
  'JR CASE': { service: 'JR_RESUBMISSION' },
  'JR RESUBMISSION': { service: 'JR_RESUBMISSION' },
  'JR RESUBMISSION CASE': { service: 'JR_RESUBMISSION' },
  'JUDICIAL REVIEW': { service: 'JR_RESUBMISSION' },
};

/**
 * Map a raw "Program" cell to a canonical service (+ optional sub-type).
 * Returns null when it can't be confidently resolved — callers MUST flag such
 * rows rather than guessing a default (a wrong code drives the wrong checklist).
 */
export function resolveProgram(raw: string | null | undefined): ResolvedProgram | null {
  if (!raw) return null;
  const n = norm(raw);
  if (!n) return null;
  if (ALIASES[n]) return ALIASES[n];
  // Someone may have typed the code itself (e.g. "VISIT_VISA" / "WORK PERMIT").
  const asCode = n.replace(/ /g, '_');
  if (isCanonicalServiceCode(asCode)) return { service: asCode };
  return null;
}
