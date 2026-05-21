import { Module } from '@nestjs/common';
import { LeadImportsController } from './lead-imports.controller';
import { LeadImportsService } from './lead-imports.service';

@Module({
  controllers: [LeadImportsController],
  providers: [LeadImportsService],
  exports: [LeadImportsService],
})
export class LeadImportsModule {}
