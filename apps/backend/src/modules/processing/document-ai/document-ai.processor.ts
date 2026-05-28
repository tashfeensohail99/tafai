import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { DocumentAiService } from './document-ai.service';
import { DOC_AI_QUEUE, type DocAiJob } from './document-ai.contracts';

/**
 * Consumes document-AI assessment jobs. Concurrency 3 — the parser is I/O
 * bound (OCR + OpenAI) and idempotent per version, so a few in flight is fine.
 * Errors thrown here let BullMQ retry per the job's backoff; assess() itself
 * already swallows parser/transport failures into a stored NEEDS_REVIEW row,
 * so a thrown error here means something unexpected (DB down, etc.).
 */
@Processor(DOC_AI_QUEUE, { concurrency: 3 })
export class DocAiProcessor extends WorkerHost {
  private readonly log = new Logger(DocAiProcessor.name);

  constructor(private readonly documentAi: DocumentAiService) {
    super();
  }

  async process(job: Job<DocAiJob>): Promise<void> {
    await this.documentAi.assess(job.data.versionId);
  }
}
