import { Global, Module } from '@nestjs/common';
import { FxService } from './fx.service';

/** Global so any finance-domain service can convert foreign amounts to CAD. */
@Global()
@Module({
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
