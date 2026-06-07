import { Module } from '@nestjs/common';
import { ReminderDispatcherService } from './reminder-dispatcher.service';

/**
 * Durable reminder system. The dispatcher is a self-starting background service
 * (OnModuleInit) — no controller; it reconciles appointments + follow-ups into
 * the `reminder_jobs` ledger and fires due reminders. PrismaService and
 * NotificationsService are provided by their @Global modules.
 */
@Module({
  providers: [ReminderDispatcherService],
})
export class RemindersModule {}
