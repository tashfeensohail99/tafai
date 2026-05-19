import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ServiceContractsController } from './service-contracts.controller';
import { ServiceContractsService } from './service-contracts.service';

@Module({
  imports: [StorageModule],
  controllers: [ServiceContractsController],
  providers: [ServiceContractsService],
  exports: [ServiceContractsService],
})
export class ServiceContractsModule {}
