/**
 * @tashfeen/shared-utils — validation/index.ts
 *
 * Shared validation helpers used across frontend forms and backend DTOs.
 * Pure functions — no external dependencies.
 */

// ─── Email ────────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value.trim());
}

// ─── Phone ────────────────────────────────────────────────────────────────────

/** E.164 format: +[country code][number], 7–15 digits total */
const PHONE_E164_RE = /^\+[1-9]\d{6,14}$/;

export function isValidPhone(value: string): boolean {
  return PHONE_E164_RE.test(value.trim());
}

// ─── CNIC (Pakistan national ID) ──────────────────────────────────────────────

/** CNIC format: 00000-0000000-0 */
const CNIC_RE = /^\d{5}-\d{7}-\d$/;

export function isValidCnic(value: string): boolean {
  return CNIC_RE.test(value.trim());
}

// ─── Password ─────────────────────────────────────────────────────────────────

/**
 * Password must be at least 8 characters, contain an uppercase letter,
 * a lowercase letter, a digit, and a special character.
 */
export function isStrongPassword(value: string): boolean {
  if (value.length < 8) return false;
  if (!/[A-Z]/.test(value)) return false;
  if (!/[a-z]/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(value)) return false;
  return true;
}

export function passwordStrengthLabel(value: string): 'weak' | 'medium' | 'strong' {
  let score = 0;
  if (value.length >= 8) score++;
  if (value.length >= 12) score++;
  if (/[A-Z]/.test(value)) score++;
  if (/[a-z]/.test(value)) score++;
  if (/[0-9]/.test(value)) score++;
  if (/[^A-Za-z0-9]/.test(value)) score++;
  if (score <= 2) return 'weak';
  if (score <= 4) return 'medium';
  return 'strong';
}

// ─── File validation ─────────────────────────────────────────────────────────

const ALLOWED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

export function isAllowedDocumentMimeType(mimeType: string): boolean {
  return ALLOWED_DOCUMENT_MIME_TYPES.has(mimeType.toLowerCase());
}

/**
 * Check file size does not exceed a limit in megabytes.
 */
export function isWithinFileSizeLimit(bytes: number, limitMb: number): boolean {
  return bytes <= limitMb * 1024 * 1024;
}

// ─── UUID ─────────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// ─── Required ─────────────────────────────────────────────────────────────────

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
