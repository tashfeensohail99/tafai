import { Module } from '@nestjs/common';
import { FinanceProfileController } from './finance-profile.controller';
import { FinanceProfileService } from './finance-profile.service';

/** Read-only Finance customer-profile aggregation (PrismaModule is global). */
@Module({
  controllers: [FinanceProfileController],
  providers: [FinanceProfileService],
})
export class FinanceProfileModule {}
