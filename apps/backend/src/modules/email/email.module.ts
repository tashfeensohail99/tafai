import { Global, Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { ImapService } from './imap.service';
import { ActivityTimelineModule } from '../activity-timeline/activity-timeline.module';

@Global()
@Module({
  imports:   [ActivityTimelineModule],
  providers: [EmailService, ImapService],
  exports:   [EmailService, ImapService],
})
export class EmailModule {}
