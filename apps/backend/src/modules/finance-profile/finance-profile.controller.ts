import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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

  /** Searchable customer list (the Finance "Customers" home). Paginated (take
   *  default 50, max 200) with keyset cursor on leadId to keep the list snappy
   *  as the finance-touched lead pool grows. Frontend debounces `search` so
   *  this doesn't fire on every keystroke. */
  @Get()
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  listCustomers(
    @Query('search') search?: string,
    @Query('take') take?: string,
    @Query('cursor') cursor?: string,
  ) {
    const n = take ? Number(take) : undefined;
    return this.service.listCustomers(search, {
      take: Number.isFinite(n) ? n : undefined,
      cursor,
    });
  }

  @Get(':leadId')
  @RequireAnyPermissions('finance.view_all', 'settings.manage')
  getProfile(@Param('leadId') leadId: string) {
    return this.service.getCustomerProfile(leadId);
  }
}
