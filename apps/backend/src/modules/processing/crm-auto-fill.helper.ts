/**
 * P4g — CRM Auto-Fill Helper
 *
 * When a PASSPORT or NATIONAL_ID document is accepted (manually or auto-approved),
 * copy the parser-extracted identity fields into the Client record — but ONLY for
 * fields that are currently empty. This preserves any data the CRM team has already
 * entered and is fully non-destructive.
 *
 * Returns the list of field names that were actually written (empty = nothing filled).
 * The caller is responsible for logging if desired; this helper writes its own
 * processingAuditLog entry so there's always a trace.
 *
 * Design: educate-and-nudge — we auto-fill empty fields silently; the associate sees
 * the result via the identity panel next time they open the case.
 */
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

// Doc types that carry identity data the CRM cares about.
const IDENTITY_DOC_TYPES = new Set(['PASSPORT', 'NATIONAL_ID']);

// Supported date string formats (tried in order).
const DATE_FMTS = [
  /^(\d{4})-(\d{2})-(\d{2})$/,                   // YYYY-MM-DD
  /^(\d{2})\/(\d{2})\/(\d{4})$/,                  // DD/MM/YYYY
  /^(\d{2})-(\d{2})-(\d{4})$/,                    // DD-MM-YYYY
  /^(\d{2}) ([A-Za-z]+) (\d{4})$/,                // DD Mon YYYY
];

function parseDate(raw: unknown): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();

  // Try ISO first
  const iso = Date.parse(s);
  if (!isNaN(iso) && /^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(iso);

  // DD/MM/YYYY and DD-MM-YYYY
  const dmy = s.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = new Date(`${dmy[3]}-${dmy[2]}-${dmy[1]}T00:00:00Z`);
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback — let JS try
  const fb = new Date(s);
  return isNaN(fb.getTime()) ? null : fb;
}

function parseStr(raw: unknown): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.trim();
  return s.length > 0 ? s : null;
}

/** Split "Muhammad Ali Khan" → {first: "Muhammad Ali", last: "Khan"}. */
function splitName(fullName: string): { first: string; last: string } | null {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 0) return null;
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts.slice(0, -1).join(' '), last: parts[parts.length - 1] };
}

// --------------------------------------------------------------------------

const log = new Logger('CrmAutoFill');

export async function applyCrmAutoFill(
  prisma: PrismaService,
  clientId: string | null | undefined,
  docType: string | null | undefined,
  extracted: Record<string, unknown> | null | undefined,
  caseId: string,
  actorUserId: string | null,
): Promise<string[]> {
  if (!clientId || !docType || !extracted) return [];
  if (!IDENTITY_DOC_TYPES.has(docType)) return [];

  // Fetch current client record — only read, no lock needed.
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      firstName: true,
      lastName: true,
      nationality: true,
      dateOfBirth: true,
      passportNumber: true,
      passportExpiry: true,
      nationalId: true,
      cnic: true,
    },
  });
  if (!client) return [];

  const update: Record<string, unknown> = {};
  const filled: string[] = [];

  // Helper: only fill if currently empty
  function tryFill(field: string, currentValue: unknown, newValue: unknown) {
    if (currentValue !== null && currentValue !== undefined && currentValue !== '') return;
    if (newValue === null || newValue === undefined || newValue === '') return;
    update[field] = newValue;
    filled.push(field);
  }

  // --- Shared fields (PASSPORT + NATIONAL_ID) ---

  // Full name → firstName + lastName (only when BOTH are empty)
  const rawName = parseStr(extracted['fullName'] ?? extracted['name']);
  if (rawName && !client.firstName && !client.lastName) {
    const name = splitName(rawName);
    if (name) {
      if (name.first) { update['firstName'] = name.first; filled.push('firstName'); }
      if (name.last)  { update['lastName'] = name.last;   filled.push('lastName'); }
    }
  }

  tryFill('nationality', client.nationality, parseStr(extracted['nationality']));
  tryFill('dateOfBirth', client.dateOfBirth, parseDate(extracted['dateOfBirth'] ?? extracted['dob']));

  // --- PASSPORT-specific ---
  if (docType === 'PASSPORT') {
    tryFill(
      'passportNumber',
      client.passportNumber,
      parseStr(extracted['passportNumber'] ?? extracted['passportNo']),
    );
    tryFill(
      'passportExpiry',
      client.passportExpiry,
      parseDate(extracted['expiryDate'] ?? extracted['passportExpiry']),
    );
  }

  // --- NATIONAL_ID-specific (CNIC + generic nationalId) ---
  if (docType === 'NATIONAL_ID') {
    const idVal = parseStr(extracted['idNumber'] ?? extracted['cnic'] ?? extracted['nationalId']);
    // Pakistani CNIC pattern: 00000-0000000-0 (13 digits with dashes)
    const looksLikeCnic = idVal ? /^\d{5}-\d{7}-\d$/.test(idVal) || /^\d{13}$/.test(idVal.replace(/-/g, '')) : false;
    if (looksLikeCnic) {
      tryFill('cnic', client.cnic, idVal);
    } else {
      tryFill('nationalId', client.nationalId, idVal);
    }
  }

  if (filled.length === 0) return [];

  // Apply the update (best-effort — a failure must not block the calling flow)
  try {
    await prisma.client.update({ where: { id: clientId }, data: update });
  } catch (err) {
    log.warn(`P4g: client update failed for ${clientId}: ${(err as Error).message}`);
    return [];
  }

  // Audit log (best-effort)
  await prisma.processingAuditLog
    .create({
      data: {
        caseId,
        actorUserId,
        action: 'crm_auto_filled',
        entityType: 'client',
        entityId: clientId,
        newValues: { filledFields: filled, docType, automated: !actorUserId },
      },
    })
    .catch(() => {});

  log.log(`P4g: auto-filled [${filled.join(', ')}] on client ${clientId} from ${docType}`);
  return filled;
}
