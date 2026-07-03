import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  RequireAnyPermissions,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestUser } from '../../common/types/auth.types';
import { Audit } from '../../common/decorators/audit.decorator';
import { ReceptionService } from './reception.service';
import {
  CollectConsultationDto,
  ConsultAvailabilityQueryDto,
  CreateVisitDto,
  ListVisitsQueryDto,
  LookupQueryDto,
  ReceptionReportQueryDto,
  RejectVisitorPaymentDto,
  UpdateReceptionSettingsDto,
  UpdateVisitDto,
  VisitorPaymentQueryDto,
} from './reception.dto';

@Controller('reception')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class ReceptionController {
  constructor(private readonly reception: ReceptionService) {}

  @Get('lookup')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  lookup(@Query() query: LookupQueryDto) {
    return this.reception.lookup(query);
  }

  @Get('hosts')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  hosts() {
    return this.reception.getHosts();
  }

  @Get('visits')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  list(@Query() query: ListVisitsQueryDto) {
    return this.reception.listVisits(query);
  }

  @Get('reports')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  reports(@Query() query: ReceptionReportQueryDto) {
    return this.reception.getReports(query);
  }

  @Post('visits')
  @RequirePermissions('reception.check_in')
  @Audit({ entityType: 'Visit', category: 'MUTATION', severity: 'LOW' })
  create(@Body() dto: CreateVisitDto, @CurrentUser() user: RequestUser) {
    return this.reception.createVisit(dto, user.id);
  }

  @Patch('visits/:id')
  @RequirePermissions('reception.check_in')
  @Audit({ entityType: 'Visit', category: 'MUTATION', severity: 'LOW' })
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVisitDto) {
    return this.reception.updateVisit(id, dto);
  }

  // ── Consultation settings (principal, fee, receiving bank) ────────────────
  @Get('settings')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  getSettings() {
    return this.reception.getSettings();
  }

  @Patch('settings')
  @RequirePermissions('reception.manage_settings')
  @Audit({ entityType: 'ReceptionSettings', category: 'CONFIG', severity: 'HIGH', action: 'SETTING_CHANGED' })
  updateSettings(@Body() dto: UpdateReceptionSettingsDto) {
    return this.reception.updateSettings(dto);
  }

  // ── Paid consultation with the principal ──────────────────────────────────
  @Get('consult/availability')
  @RequireAnyPermissions('reception.view', 'reception.check_in')
  consultAvailability(@Query() query: ConsultAvailabilityQueryDto) {
    return this.reception.consultAvailability(query.date);
  }

  @Post('visits/:id/collect-consultation')
  @RequirePermissions('reception.check_in')
  @Audit({ entityType: 'Visit', category: 'MUTATION', severity: 'HIGH', action: 'PAYMENT_RECORDED' })
  collectConsultation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CollectConsultationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reception.collectConsultation(id, dto, user.id);
  }

  // ── Visitor payments — register (reception) + verification queue (finance) ──
  @Get('visitor-payments')
  @RequireAnyPermissions('reception.view', 'reception.check_in', 'finance.verify_payment')
  visitorPayments(@Query() query: VisitorPaymentQueryDto) {
    return this.reception.listVisitorPayments(query);
  }

  @Post('visitor-payments/:id/verify')
  @RequirePermissions('finance.verify_payment')
  @Audit({ entityType: 'VisitorPayment', category: 'MUTATION', severity: 'HIGH', action: 'PAYMENT_VERIFIED' })
  verifyVisitorPayment(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.reception.verifyVisitorPayment(id, user.id);
  }

  @Post('visitor-payments/:id/reject')
  @RequirePermissions('finance.verify_payment')
  @Audit({ entityType: 'VisitorPayment', category: 'MUTATION', severity: 'HIGH', action: 'RECORD_UPDATED' })
  rejectVisitorPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectVisitorPaymentDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.reception.rejectVisitorPayment(id, dto.reason ?? '', user.id);
  }
}
