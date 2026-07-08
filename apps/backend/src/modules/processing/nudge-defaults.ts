/**
 * Default wording for the automated processing client-nudges, shared by the
 * sender (ClientNudgeService) and the manager-facing email-template CRUD so the
 * two never drift. A saved ProcessingEmailTemplate overrides the matching
 * default; when none exists the default is used, so email always sends.
 *
 * Placeholders (filled at send time): {{clientName}} {{service}} {{country}}
 * {{documentList}}. `body` is sent on WhatsApp AND email; `subject` is
 * email-only.
 */
export const NUDGE_DEFAULTS: Record<string, { subject: string; body: string }> = {
  DOCS_REQUEST: {
    subject: 'Documents still needed — your {{service}} application',
    body:
      'Hi {{clientName}}! This is a reminder from Tashfeen Immigration regarding your ' +
      '{{service}} case.\n\n' +
      'The following documents are still pending:\n{{documentList}}\n\n' +
      'Please upload them via your client portal as soon as possible. ' +
      'Reply here if you need any help.',
  },
  DOC_REJECTED: {
    subject: 'Action needed: documents to re-submit — {{service}}',
    body:
      'Hi {{clientName}}! Some documents in your {{service}} case require your attention.\n\n' +
      'Documents that need to be re-submitted:\n{{documentList}}\n\n' +
      'Please check the notes in your client portal and re-upload. ' +
      'Reply here if you have any questions.',
  },
  EXPIRY_7D: {
    subject: 'Urgent: documents expiring within 7 days — {{service}}',
    body:
      '⚠️ URGENT: Hi {{clientName}}! The following documents in your {{service}} case ' +
      'expire within 7 days:\n\n{{documentList}}\n\n' +
      'Please renew them and upload updated copies immediately to avoid a delay in your application.',
  },
  EXPIRY_30D: {
    subject: 'Reminder: documents expiring within 30 days — {{service}}',
    body:
      'Hi {{clientName}}! A reminder that the following documents in your {{service}} case ' +
      'will expire within 30 days:\n\n{{documentList}}\n\n' +
      'Please arrange renewal in advance to avoid any disruption to your application.',
  },
  ATTESTATION_REMINDER: {
    subject: 'Attestation required — your {{service}} documents',
    body:
      'Hi {{clientName}}! The following documents in your {{service}} case require ' +
      'attestation before they can be accepted:\n\n{{documentList}}\n\n' +
      'Please arrange attestation by the relevant authority (HEC, MOFA, IBCC, etc.) ' +
      'and upload the attested copies. Reply here if you need guidance on which authority to contact.',
  },
};

/** Human-friendly labels for the manager UI (keyed by ReminderType value). */
export const NUDGE_TYPE_LABELS: Record<string, string> = {
  DOCS_REQUEST: 'Missing documents',
  DOC_REJECTED: 'Documents to re-submit',
  EXPIRY_7D: 'Expiring within 7 days',
  EXPIRY_30D: 'Expiring within 30 days',
  ATTESTATION_REMINDER: 'Attestation required',
};
