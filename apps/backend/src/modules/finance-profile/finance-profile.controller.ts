import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { RequireAnyPermissions } from '../../common/decorators/require-permissions.decorator';
import { FinanceProfileService } from './finance-profile.service';

/**
 * Finance customer profile — the 360° view Finance opens from an agreement /
 * contract. Aggregates bio + agreement + ledger + invoices + payments +
 * receipts for one customer (keyed by the originating lead id).
 */
@Controller('finance/customer')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class FinanceProfileController {
  constructor(private readonly service: FinanceProfileService) {}

  @Get(':leadId')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  getProfile(@Param('leadId') leadId: string) {
    return this.service.getCustomerProfile(leadId);
  }
}
