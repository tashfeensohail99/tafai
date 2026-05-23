import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import appConfig from './config/app.config';
import { PrismaModule } from './common/prisma/prisma.module';
import { ActivityTrackerInterceptor } from './common/interceptors/activity-tracker.interceptor';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { PermissionsModule } from './modules/permissions/permissions.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { ActivityTimelineModule } from './modules/activity-timeline/activity-timeline.module';
import { StorageModule } from './modules/storage/storage.module';
import { BranchesModule } from './modules/branches/branches.module';
import { ServicesModule } from './modules/services/services.module';
import { CountriesModule } from './modules/countries/countries.module';
import { PartnersModule } from './modules/partners/partners.module';
import { LeadsModule } from './modules/leads/leads.module';
import { LeadImportsModule } from './modules/lead-imports/lead-imports.module';
import { ClientsModule } from './modules/clients/clients.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { CasesModule } from './modules/cases/cases.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ServiceContractsModule } from './modules/service-contracts/service-contracts.module';
import { FollowUpsModule } from './modules/follow-ups/follow-ups.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ProcessingModule } from './modules/processing/processing.module';
import { PortalModule } from './modules/portal/portal.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { EmailModule } from './modules/email/email.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { AgreementsModule } from './modules/agreements/agreements.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10) * 1000,
        limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
      },
    ]),
    PrismaModule,
    HealthModule,
    AuthModule,
    UsersModule,
    RolesModule,
    PermissionsModule,
    DepartmentsModule,
    EmployeesModule,
    BranchesModule,
    ServicesModule,
    CountriesModule,
    PartnersModule,
    LeadsModule,
    LeadImportsModule,
    ClientsModule,
    AppointmentsModule,
    CasesModule,
    DocumentsModule,
    FinanceModule,
    ServiceContractsModule,
    FollowUpsModule,
    ReportsModule,
    ProcessingModule,
    PortalModule,
    AuditLogModule,
    ActivityTimelineModule,
    StorageModule,
    WhatsAppModule,
    EmailModule,
    PdfModule,
    AgreementsModule,
  ],
  providers: [
    // Global: keep Employee.lastActivityAt fresh on every authenticated request
    // so the admin "who's online" view reflects real, automatic activity.
    { provide: APP_INTERCEPTOR, useClass: ActivityTrackerInterceptor },
  ],
})
export class AppModule {}
