import { Module } from '@nestjs/common';
import { LeadsModule } from '../leads/leads.module';
import { LeadAssignmentModule } from '../lead-assignment/lead-assignment.module';
import { FinanceModule } from '../finance/finance.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { WhatsAppNotificationsModule } from '../whatsapp/notifications/notifications.module';
import { StorageModule } from '../storage/storage.module';
import { ReceptionController } from './reception.controller';
import { PublicConsultPayController } from './public-consult-pay.controller';
import { ReceptionService } from './reception.service';
import { ConsultPayTokenService } from './consult-pay-token.service';

/**
 * Reception / Front Desk. A register of everyone who physically walks into the
 * office (walk-in prospects, existing clients, paid consultations) plus the
 * lookup + walk-in-to-lead flow. Reuses LeadsService (create) + the shared
 * round-robin (LeadAssignmentService); PrismaModule is global. StorageModule
 * backs the QR receipt upload (P4b). PublicConsultPayController is the
 * unauthenticated, token-gated "scan & upload your receipt" surface.
 */
@Module({
  imports: [LeadsModule, LeadAssignmentModule, FinanceModule, AppointmentsModule, WhatsAppNotificationsModule, StorageModule],
  controllers: [ReceptionController, PublicConsultPayController],
  providers: [ReceptionService, ConsultPayTokenService],
})
export class ReceptionModule {}
