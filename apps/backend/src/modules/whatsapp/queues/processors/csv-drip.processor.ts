import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { WHATSAPP_QUEUE, type CsvDripJob } from '../queue-contracts';
import { CsvDripService } from '../../drip/csv-drip.service';

/**
 * Consumes CSV_DRIP jobs (touch 1 fired ~on import; touch 2 ~40h later). All
 * business logic + fire-time guards live in CsvDripService.runTouch. Low
 * concurrency so drip sends trickle out (belt-and-braces with the per-channel
 * daily cap) instead of bursting.
 */
@Processor(WHATSAPP_QUEUE.CSV_DRIP, { concurrency: 3 })
export class CsvDripProcessor extends WorkerHost {
  private readonly log = new Logger(CsvDripProcessor.name);

  constructor(private readonly drip: CsvDripService) {
    super();
  }

  override async process(job: Job<CsvDripJob>): Promise<void> {
    await this.drip.runTouch(job.data);
  }
}
