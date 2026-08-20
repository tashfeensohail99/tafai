import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { MailProvisioningService } from './mail-provisioning.service';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [ConfigModule, AuditLogModule, UsersModule],
  controllers: [HrController],
  providers: [HrService, MailProvisioningService],
  exports: [HrService, MailProvisioningService],
})
export class HrModule {}
