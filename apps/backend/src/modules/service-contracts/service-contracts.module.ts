import { Module } from '@nestjs/common';
import { ServiceContractsController } from './service-contracts.controller';
import { ServiceContractsService } from './service-contracts.service';

@Module({
  controllers: [ServiceContractsController],
  providers: [ServiceContractsService],
  exports: [ServiceContractsService],
})
export class ServiceContractsModule {}
