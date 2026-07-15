import type { ProcessingStage } from './mockData';

/**
 * Officer-facing "what to do now" for each case stage — powers the Next-step
 * banner on the case workspace so the next action is never a guess.
 * `null` = terminal stage (Completed / Cancelled), no action needed.
 */
export const STAGE_NEXT_STEP: Record<ProcessingStage, string | null> = {
  INTAKE_PENDING:
    'New case from Finance. Acknowledge it, confirm the service / category, and assign a processing associate to get started.',
  DOCUMENTS_COLLECTION:
    'Request the required documents from the client in the Documents tab, and chase anything still missing.',
  DOCUMENTS_UNDER_REVIEW:
    'Review each uploaded document — accept, reject with a reason, or waive it. Once every critical and required document is accepted, move the case to “Documents Complete”.',
  DOCUMENTS_INCOMPLETE:
    'Some required documents are missing or were rejected. Request them from the client, then move the case back to “Collecting Documents”.',
  DOCUMENTS_COMPLETE:
    'All required documents are in. Run the pre-submission checks, then move the case to “Ready to Submit”.',
  READY_FOR_SUBMISSION:
    'Assemble the submission package and file it with the authority, then change the stage to “Submitted” and add the reference number.',
  SUBMITTED:
    'Filed with the authority. Log the tracking number, then move to “With Authority” once they begin reviewing.',
  UNDER_AUTHORITY_REVIEW:
    'With the authority now — monitor for updates and log timeline events. Move to “Decision Received” when they respond.',
  ADDITIONAL_INFO_REQUESTED:
    'The authority has asked for more information. Review the request, raise a correction to the client if needed, then resubmit.',
  DECISION_RECEIVED:
    'A decision has arrived. Record the outcome, then move the case to “Approved” or “Rejected”.',
  APPROVED:
    'Approved — record the approval details and the client’s next steps, then move the case to “Completed”.',
  REJECTED:
    'Rejected. Review the reason with the client, then either file an appeal or close the case.',
  APPEAL_IN_PROGRESS:
    'Appeal filed — monitor it like an authority review. Re-submit or close the case depending on the outcome.',
  COMPLETED: null,
  CANCELLED: null,
  JUNK: null,
};

/**
 * Stages where the case is waiting on an external party (the authority), so a
 * long time-in-stage is expected and should NOT trigger an "overdue" nudge.
 */
export const STAGE_WAITING_ON_EXTERNAL: ReadonlySet<ProcessingStage> = new Set([
  'SUBMITTED',
  'UNDER_AUTHORITY_REVIEW',
  'APPEAL_IN_PROGRESS',
]);
