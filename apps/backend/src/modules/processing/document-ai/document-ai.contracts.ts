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

/**
 * Inbound document intake (Phase E). Registered in the @Global
 * WhatsAppQueuesModule so the producer (MediaDownloadProcessor) and the
 * consumer (DocIntakeProcessor in the processing module) share it. One job =
 * one inbound WhatsApp media message to triage onto an active case.
 */
export const DOC_INTAKE_QUEUE = 'doc-intake';

export interface DocIntakeJob {
  whatsappMessageId: string;
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
  // Admin-managed OpenAI key (single source of truth, Admin → API Keys).
  // The parser uses it over its own env fallback.
  openaiApiKey?: string | null;
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
  // P4c-2: attestation authorities whose stamp keywords were found in the OCR
  // text (e.g. ["MOFA", "HEC"]). Optional — absent on responses cached before
  // the parser added it. Suggestion only; never auto-marks attestation.
  detectedAuthorities?: string[];
  // P4f: dominant non-Latin script detected in OCR text (e.g. "Arabic/Urdu").
  // null/absent = primarily Latin script (no translation hint). Suggestion only.
  detectedLanguage?: string | null;
  errorMessage: string | null;
}

// ── Split & categorize (multi-document upload) ──────────────────────────────
// One combined upload (a client dumps passport + bank statement + photo as a
// single PDF) -> N constituent documents, each extracted into its own file so
// the backend can file it. Mirrors the parser's /split-and-categorize.

export interface SplitParserRequest {
  file: ParserFile;
  caseId?: string;
  expectedProgram?: string | null;
  expectedDocTypes?: string[] | null;
}

export interface SplitParserDocument {
  /** Parser vocab tag, e.g. PASSPORT / BANK_STATEMENT. Map to a slot docType. */
  doc_type: string;
  /** 0-based source page indices this segment spans. */
  pages: number[];
  confidence: number;
  needs_review: boolean;
  ocrTier: string;
  /** This segment extracted as its own standalone file (base64). "" on failure. */
  fileBase64: string;
  mimeType: string;
}

export interface SplitParserResponse {
  documents: SplitParserDocument[];
  pageCount: number;
  truncated: boolean;
  costCents: number;
  engineUsed: string;
  modelVersion: string;
  errorMessage: string | null;
}
