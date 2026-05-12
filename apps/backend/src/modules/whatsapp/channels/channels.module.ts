import { Module } from '@nestjs/common';
import { ActivityTimelineModule } from '../../activity-timeline/activity-timeline.module';
import { WhatsAppChannelsController } from './channels.controller';
import { WhatsAppChannelsService } from './channels.service';

@Module({
  imports: [ActivityTimelineModule],
  controllers: [WhatsAppChannelsController],
  providers: [WhatsAppChannelsService],
  exports: [WhatsAppChannelsService],
})
export class WhatsAppChannelsModule {}
