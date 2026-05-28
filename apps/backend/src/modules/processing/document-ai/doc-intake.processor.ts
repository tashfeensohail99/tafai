import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DocumentIntakeService } from './document-intake.service';
import { DOC_INTAKE_QUEUE, type DocIntakeJob } from './document-ai.contracts';

/**
 * Consumes inbound-document intake jobs (one per inbound WhatsApp media
 * message). Concurrency 3 — I/O bound (media fetch + parser). ingest swallows
 * its own per-message errors, so a throw here means something unexpected.
 */
@Processor(DOC_INTAKE_QUEUE, { concurrency: 3 })
export class DocIntakeProcessor extends WorkerHost {
  private readonly log = new Logger(DocIntakeProcessor.name);

  constructor(private readonly intake: DocumentIntakeService) {
    super();
  }

  async process(job: Job<DocIntakeJob>): Promise<void> {
    await this.intake.ingestWhatsAppMessage(job.data.whatsappMessageId);
  }
}
