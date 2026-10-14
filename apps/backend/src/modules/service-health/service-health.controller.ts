import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ServiceHealthSentinelService } from './service-health.service';

/**
 * Active service-health alerts, for the CRM's global outage banner. JWT-gated
 * only (every signed-in user — reps included — needs to see "WhatsApp is down,
 * use calls"). Returns [] when everything is healthy.
 */
@Controller('system')
@UseGuards(JwtAuthGuard)
export class ServiceHealthController {
  constructor(private readonly sentinel: ServiceHealthSentinelService) {}

  @Get('alerts')
  alerts() {
    return this.sentinel.activeAlerts();
  }
}
