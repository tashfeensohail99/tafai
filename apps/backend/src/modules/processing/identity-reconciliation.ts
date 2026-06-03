/**
 * Cross-document identity reconciliation (Phase 4).
 *
 * The parser already extracts identity fields (name / DOB / passport# / id#)
 * per document and the backend stores them on DocumentAiAssessment.extracted.
 * Per-doc checks already compare each doc against the CRM client. What this adds
 * is the CASE-LEVEL view: collect every extracted value for each identity field
 * across all of a case's current documents, line them up against the CRM record,
 * and surface where they AGREE vs CONFLICT (e.g. the passport says DOB 1990-01-02
 * but the CNIC says 1991-01-02).
 *
 * Pure + side-effect free. FLAG-ONLY by design — per the locked rule we never
 * auto-reject on an identity mismatch (Urdu transliteration variance makes name
 * matching inherently fuzzy); a human always decides. The engine only reports.
 */

export type FieldStatus = 'agree' | 'conflict' | 'insufficient';
export type OverallStatus = 'ok' | 'review' | 'insufficient';
/** Where a field's reference value came from, in priority order. */
export type ReferenceFrom = 'passport' | 'nationalId' | 'crm' | 'documents' | null;

export interface IdentityClient {
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: Date | null;
  passportNumber: string | null;
  nationalId: string | null;
  cnic: string | null;
}

export interface IdentityDocInput {
  itemId: string;
  documentName: string;
  docType: string | null;
  extracted: Record<string, unknown> | null;
}

export interface IdentitySource {
  itemId: string;
  documentName: string;
  docType: string | null;
  value: string;
  /** Whether this doc's value lines up with the agreed/CRM value. */
  matchesReference: boolean;
}

export interface IdentityFieldRow {
  key: 'name' | 'dateOfBirth' | 'passportNumber' | 'nationalId';
  label: string;
  crmValue: string | null;
  /** Does the CRM-stored value agree with the reference? null = nothing to compare. */
  crmMatches: boolean | null;
  /** The value every source is checked against (from the reference document). */
  referenceValue: string | null;
  /** Where referenceValue came from (passport > national-ID > CRM > documents). */
  referenceFrom: ReferenceFrom;
  sources: IdentitySource[];
  status: FieldStatus;
}

export interface IdentityReconciliation {
  client: {
    name: string | null;
    dateOfBirth: string | null;
    passportNumber: string | null;
    nationalId: string | null;
  };
  fields: IdentityFieldRow[];
  overall: OverallStatus;
  /** How many documents contributed at least one identity value. */
  documentCount: number;
  /** The primary anchor the whole panel is checked against. */
  referenceFrom: ReferenceFrom;
  referenceItemId: string | null;
  referenceDocumentName: string | null;
}

// ── normalizers / comparators ───────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
}

/**
 * Transliteration-tolerant name agreement: enough shared tokens, or one name's
 * tokens are a subset of the other's (handles "Muhammad Ali Khan" vs "Ali Khan").
 */
function namesAgree(a: string, b: string): boolean {
  const ta = new Set(nameTokens(a));
  const tb = new Set(nameTokens(b));
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  const minSize = Math.min(ta.size, tb.size);
  return overlap >= 2 || overlap >= minSize;
}

function normId(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function idsAgree(a: string, b: string): boolean {
  const na = normId(a);
  const nb = normId(b);
  return na.length > 0 && na === nb;
}

/** Identity reference hierarchy — recognise the authoritative document types. */
function isPassport(docType: string | null): boolean {
  return !!docType && /passport/i.test(docType);
}
function isNationalId(docType: string | null): boolean {
  if (!docType) return false;
  return /cnic/i.test(docType) || /national[\s_-]?id(entity)?/i.test(docType);
}

/** Parse common date encodings to a YYYY-MM-DD key; null if unparseable. */
function dateKey(s: string): string | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/); // YYYY-MM-DD
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); // DD-MM-YYYY (or MM-DD-YYYY; treat day/month leniently)
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    const day = a > 12 ? a : b > 12 ? b : a; // best-effort when ambiguous
    const mon = a > 12 ? b : a;
    return `${m[3]}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  const d = new Date(t);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function datesAgree(a: string, b: string): boolean {
  const ka = dateKey(a);
  const kb = dateKey(b);
  return !!ka && ka === kb;
}

/**
 * Pick the value the documents most agree on, clustering equivalent values with
 * the field's own (possibly fuzzy) comparator. Returns the representative of the
 * largest cluster; ties resolve to the first-seen value. Used as the reference
 * when there is no CRM anchor, so the majority wins and a lone outlier is the
 * one flagged — rather than whichever document happened to be processed first.
 */
function pickReference(
  values: string[],
  agree: (a: string, b: string) => boolean,
): string | null {
  const clusters: Array<{ rep: string; count: number }> = [];
  for (const v of values) {
    const c = clusters.find((cl) => agree(cl.rep, v));
    if (c) c.count++;
    else clusters.push({ rep: v, count: 1 });
  }
  if (clusters.length === 0) return null;
  let best = clusters[0];
  for (const c of clusters) if (c.count > best.count) best = c;
  return best.rep;
}

// ── field extraction from the parser's `extracted` blob ─────────────────────

function extractValue(
  extracted: Record<string, unknown> | null,
  keys: string[],
): string | null {
  if (!extracted) return null;
  for (const k of keys) {
    const v = str(extracted[k]);
    if (v) return v;
  }
  return null;
}

interface FieldDef {
  key: IdentityFieldRow['key'];
  label: string;
  extractKeys: string[];
  crm: (c: IdentityClient) => string | null;
  agree: (a: string, b: string) => boolean;
}

const FIELDS: FieldDef[] = [
  {
    key: 'name',
    label: 'Full name',
    extractKeys: ['fullName', 'name', 'accountHolder', 'holderName'],
    crm: (c) => [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || null,
    agree: namesAgree,
  },
  {
    key: 'dateOfBirth',
    label: 'Date of birth',
    extractKeys: ['dateOfBirth', 'dob'],
    crm: (c) => (c.dateOfBirth ? c.dateOfBirth.toISOString().slice(0, 10) : null),
    agree: datesAgree,
  },
  {
    key: 'passportNumber',
    label: 'Passport #',
    extractKeys: ['passportNumber', 'passportNo'],
    crm: (c) => c.passportNumber,
    agree: idsAgree,
  },
  {
    key: 'nationalId',
    label: 'National ID / CNIC',
    extractKeys: ['idNumber', 'nationalId', 'cnic'],
    crm: (c) => c.nationalId ?? c.cnic,
    agree: idsAgree,
  },
];

export function reconcileIdentity(
  client: IdentityClient,
  docs: IdentityDocInput[],
): IdentityReconciliation {
  const contributingDocs = new Set<string>();

  const fields: IdentityFieldRow[] = FIELDS.map((def) => {
    const crmValue = def.crm(client);

    const sources: IdentitySource[] = [];
    for (const d of docs) {
      const value = extractValue(d.extracted, def.extractKeys);
      if (!value) continue;
      contributingDocs.add(d.itemId);
      sources.push({
        itemId: d.itemId,
        documentName: d.documentName,
        docType: d.docType,
        value,
        matchesReference: true, // filled in below
      });
    }

    // Reference hierarchy: the passport is the source of truth for a person's
    // identity, then the national-ID / CNIC, then the CRM record, and only if
    // none of those carry this field do we fall back to the value the documents
    // most agree on. Everything (including the CRM value) is checked against it.
    const passportSrc = sources.find((s) => isPassport(s.docType));
    const nationalIdSrc = sources.find((s) => isNationalId(s.docType));
    let reference: string | null;
    let referenceFrom: ReferenceFrom;
    if (passportSrc) {
      reference = passportSrc.value;
      referenceFrom = 'passport';
    } else if (nationalIdSrc) {
      reference = nationalIdSrc.value;
      referenceFrom = 'nationalId';
    } else if (crmValue != null) {
      reference = crmValue;
      referenceFrom = 'crm';
    } else if (sources.length > 0) {
      reference = pickReference(sources.map((s) => s.value), def.agree);
      referenceFrom = 'documents';
    } else {
      reference = null;
      referenceFrom = null;
    }

    let conflict = false;
    for (const s of sources) {
      const ok = reference != null ? def.agree(reference, s.value) : true;
      s.matchesReference = ok;
      if (!ok) conflict = true;
    }
    const crmMatches =
      crmValue != null && reference != null ? def.agree(reference, crmValue) : null;

    let status: FieldStatus;
    if (sources.length === 0) status = 'insufficient';
    else if (conflict) status = 'conflict';
    else status = 'agree';

    return {
      key: def.key,
      label: def.label,
      crmValue,
      crmMatches,
      referenceValue: reference,
      referenceFrom,
      sources,
      status,
    };
  });

  const anyConflict = fields.some((f) => f.status === 'conflict');
  const anyData = fields.some((f) => f.sources.length > 0);
  const overall: OverallStatus = !anyData ? 'insufficient' : anyConflict ? 'review' : 'ok';

  // The primary anchor for the whole panel: the passport doc if one contributed
  // identity data, else the national-ID / CNIC doc, else the CRM record, else
  // the documents themselves.
  const passportDoc = docs.find((d) => isPassport(d.docType) && contributingDocs.has(d.itemId));
  const nationalIdDoc = docs.find((d) => isNationalId(d.docType) && contributingDocs.has(d.itemId));
  let referenceFrom: ReferenceFrom = null;
  let referenceItemId: string | null = null;
  let referenceDocumentName: string | null = null;
  if (passportDoc) {
    referenceFrom = 'passport';
    referenceItemId = passportDoc.itemId;
    referenceDocumentName = passportDoc.documentName;
  } else if (nationalIdDoc) {
    referenceFrom = 'nationalId';
    referenceItemId = nationalIdDoc.itemId;
    referenceDocumentName = nationalIdDoc.documentName;
  } else if (fields.some((f) => f.crmValue != null)) {
    referenceFrom = 'crm';
  } else if (contributingDocs.size > 0) {
    referenceFrom = 'documents';
  }

  return {
    client: {
      name: [client.firstName, client.lastName].filter(Boolean).join(' ').trim() || null,
      dateOfBirth: client.dateOfBirth ? client.dateOfBirth.toISOString().slice(0, 10) : null,
      passportNumber: client.passportNumber,
      nationalId: client.nationalId ?? client.cnic,
    },
    fields,
    overall,
    documentCount: contributingDocs.size,
    referenceFrom,
    referenceItemId,
    referenceDocumentName,
  };
}
