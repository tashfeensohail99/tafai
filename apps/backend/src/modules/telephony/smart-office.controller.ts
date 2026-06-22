import { Body, Controller, Post, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { NoAudit } from '../../common/decorators/audit.decorator';
import { SmartOfficeApiKeyGuard } from './smart-office-api-key.guard';
import { SmartOfficeService } from './smart-office.service';
import { ResolveCallDto } from './smart-office.dto';

/**
 * Telenor Smart Office call-routing "Customer API".
 *
 * POST /integrations/telephony/smart-office/resolve
 *   Auth: shared key (X-API-Key or Authorization: Bearer) + optional IP allow-
 *   list — NOT a user JWT. Called by the Telenor PBX on every inbound call;
 *   must reply within Smart Office's 5-second budget.
 */
@Controller('integrations/telephony/smart-office')
@UseGuards(SmartOfficeApiKeyGuard, ThrottlerGuard)
export class SmartOfficeController {
  constructor(private readonly service: SmartOfficeService) {}

  /**
   * Resolve caller -> owning salesperson -> PBX extension. Unknown extra fields
   * are stripped (not rejected) so the contract can drift without breaking
   * routing. No audit row — we keep our own SmartOfficeCallLog (this endpoint is
   * high-volume + unauthenticated).
   */
  @Post('resolve')
  @NoAudit()
  // Flood backstop on this JWT-bypassing external endpoint. Generous headroom
  // over real inbound-call volume; legitimate Smart Office traffic stays well
  // under it, while a misconfigured/abusive caller can't hammer the DB.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  resolve(@Body() dto: ResolveCallDto) {
    return this.service.resolve(dto);
  }
}
