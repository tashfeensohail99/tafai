import { Module } from '@nestjs/common';
import { SmartOfficeController } from './smart-office.controller';
import { SmartOfficeService } from './smart-office.service';

/**
 * Telephony integrations. Currently the Telenor Smart Office inbound-call
 * routing "Customer API" (caller -> owning salesperson -> PBX extension).
 * PrismaService is provided globally, so no imports are required.
 */
@Module({
  controllers: [SmartOfficeController],
  providers: [SmartOfficeService],
})
export class TelephonyModule {}
