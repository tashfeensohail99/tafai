/**
 * BullMQ queue name + job payload, and the wire contract shared with the
 * Python document parser (github.com/tashfeensohail99/pythonphraser).
 *
 * Keep these types in lockstep with the parser's app/schemas.py.
 */

export const DOC_AI_QUEUE = 'doc-ai-assessment';

/** One assessment job = one uploaded document version. */
export interface DocAiJob {
  versionId: string;
}

export interface ParserExpected {
  docType: string | null;
  documentKind: 'TEXT_DOCUMENT' | 'PHOTO';
  documentName: string;
  validityRule: 'NONE' | 'MUST_NOT_EXPIRE' | 'MUST_BE_VALID_FOR_N_MONTHS';
  validityMonths: number | null;
  validityBufferDays: number;
  photoSpec: Record<string, unknown> | null;
  clientName: string | null;
  // Ownership reference values from the CRM Client record (any may be null).
  clientDob: string | null;
  clientPassportNumber: string | null;
  clientNationalId: string | null;
  service: string | null;
  targetCountry: string | null;
}

export interface ParserFile {
  url?: string;
  contentBase64?: string;
  mimeType: string;
  fileName: string;
}

export interface ParserRequest {
  caseId: string;
  documentItemId: string;
  versionId: string;
  expected: ParserExpected;
  file: ParserFile;
}

export interface ParserCheck {
  code: string;
  pass: boolean;
  detail: string;
}

export interface ParserResponse {
  detectedDocType: string | null;
  confidence: number;
  extracted: Record<string, unknown>;
  checks: ParserCheck[];
  suggestedDecision: 'APPROVE' | 'REJECT' | 'NEEDS_REVIEW';
  reasonCodes: string[];
  ocrTier: string;
  costCents: number;
  cacheHit: boolean;
  modelVersion: string;
  errorMessage: string | null;
}
