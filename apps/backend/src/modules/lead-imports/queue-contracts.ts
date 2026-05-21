/**
 * BullMQ queue name + job payload shapes for the lead-import pipeline.
 */
export const LEAD_IMPORT_QUEUE = 'lead-import';

export interface LeadImportJob {
  batchId: string;
}
