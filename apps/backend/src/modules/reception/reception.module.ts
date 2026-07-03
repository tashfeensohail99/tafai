import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { ReceptionController } from './reception.controller';
import { ReceptionService } from './reception.service';

/**
 * Reception / Front Desk. A register of everyone who physically walks into the
 * office (walk-in prospects, existing clients, paid consultations) plus the
 * lookup + walk-in-to-lead flow. Reuses LeadsService (create) + the shared
 * round-robin (LeadAssignmentService); PrismaModule is global.
 */
@Module({
  imports: [LeadsModule, LeadAssignmentModule],
  controllers: [ReceptionController],
  providers: [ReceptionService],
})
export class ReceptionModule {}
