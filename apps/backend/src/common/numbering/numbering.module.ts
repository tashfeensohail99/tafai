import { Global, Module } from '@nestjs/common';
import { NumberingService } from './numbering.service';

/** Global so every finance-domain service can mint document numbers. */
@Global()
@Module({
  providers: [NumberingService],
  exports: [NumberingService],
})
export class NumberingModule {}
