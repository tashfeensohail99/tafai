/**
 * Document rejection reason codes → client-friendly messages.
 *
 * Internal codes are the canonical record kept on `DocumentReviewDecision.rejectionReasonCodes`.
 * The codes themselves stay terse for reporting and analytics. This file
 * translates them into plain language for the client portal so we never leak
 * jargon like ILLEGIBLE or NAME_MISMATCH directly to the customer.
 *
 * If you add a new code in `processing.dto.ts` / `documents.dto.ts`, add the
 * mapping here as well. An unknown code falls back to a generic line.
 */

export interface FriendlyRejection {
  /** The raw internal code (kept for audit traces). */
  code: string;
  /** Short internal label — what officers see in the admin UI. */
  internalLabel: string;
  /** What the client sees in the portal. Plain English, no jargon. */
  clientMessage: string;
}

const REJECTION_CATALOG: Record<string, Omit<FriendlyRejection, 'code'>> = {
  ILLEGIBLE: {
    internalLabel: 'Illegible',
    clientMessage:
      'This document is blurry or unreadable. Please upload a clearer copy with all text and details visible.',
  },
  EXPIRED: {
    internalLabel: 'Expired',
    clientMessage:
      'This document has expired. Please upload a current, valid version.',
  },
  EXPIRING_SOON: {
    internalLabel: 'Expiring soon',
    clientMessage:
      'This document is close to expiry. Please upload a renewed copy that stays valid through the application period.',
  },
  WRONG_DOCUMENT: {
    internalLabel: 'Wrong document',
    clientMessage:
      'This is not the right document. Please review the requirements and upload the correct file.',
  },
  INCOMPLETE: {
    internalLabel: 'Incomplete pages',
    clientMessage:
      'Some pages of this document are missing. Please upload a complete copy with every page included.',
  },
  POOR_QUALITY: {
    internalLabel: 'Poor scan quality',
    clientMessage:
      'The scan quality is too low. Please re-scan or photograph the document with better lighting and focus.',
  },
  WRONG_FORMAT: {
    internalLabel: 'Wrong file format',
    clientMessage:
      'This file format isn\'t accepted. Please upload as PDF, JPG, or PNG.',
  },
  NAME_MISMATCH: {
    internalLabel: 'Name mismatch',
    clientMessage:
      'The name on this document doesn\'t match your application. Please upload the correct version, or contact your officer if the difference is intentional.',
  },
  NOT_ATTESTED: {
    internalLabel: 'Missing attestation',
    clientMessage:
      'This document requires official attestation (e.g. HEC, notary, embassy). Please upload an attested copy.',
  },
  NOT_TRANSLATED: {
    internalLabel: 'Missing translation',
    clientMessage:
      'This document needs to be translated into English by a certified translator. Please upload the translated copy along with the original.',
  },
  NOT_SIGNED: {
    internalLabel: 'Not signed',
    clientMessage:
      'This document is missing a required signature. Please have it signed and upload again.',
  },
  STAMP_MISSING: {
    internalLabel: 'Missing official stamp',
    clientMessage:
      'This document is missing the required official stamp or seal. Please upload a properly stamped copy.',
  },
  WATERMARK_MISSING: {
    internalLabel: 'Missing security watermark',
    clientMessage:
      'This document doesn\'t show the expected security features. Please upload an original or a certified true copy.',
  },
  PHOTO_QUALITY: {
    internalLabel: 'Photo quality issue',
    clientMessage:
      'The photo doesn\'t meet immigration standards. Please upload a passport-style photo that follows the official guidelines (plain background, neutral expression, no glasses).',
  },
  WRONG_PERSON: {
    internalLabel: 'Wrong person on document',
    clientMessage:
      'This document seems to belong to a different person. Please upload the document that matches your application.',
  },
  TAMPERED: {
    internalLabel: 'Possible tampering',
    clientMessage:
      'This document looks edited or altered. Please upload an unmodified original — your officer will contact you if there\'s a misunderstanding.',
  },
  OTHER: {
    internalLabel: 'Other',
    clientMessage:
      'There\'s an issue with this document. Please check the message from your officer for details and re-upload.',
  },
};

const FALLBACK: Omit<FriendlyRejection, 'code'> = {
  internalLabel: 'Needs correction',
  clientMessage:
    'This document needs to be corrected. Please check the message from your officer for details and upload an updated copy.',
};

/**
 * Translate one rejection code. Unknown codes fall back to a generic line so
 * we never crash the portal if an officer introduces a new code before it's
 * mapped here.
 */
export function describeRejection(code: string): FriendlyRejection {
  const entry = REJECTION_CATALOG[code] ?? FALLBACK;
  return { code, ...entry };
}

/** Translate a batch of codes. Dedupes — clients only see each reason once. */
export function describeRejections(codes: string[]): FriendlyRejection[] {
  const seen = new Set<string>();
  const out: FriendlyRejection[] = [];
  for (const c of codes) {
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(describeRejection(c));
  }
  return out;
}
